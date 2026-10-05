/**
 * Crown Clash — Guided training battle overlay (Clash Royale-style).
 *
 * Renders the tutorial controller's current step inside the real battle:
 *   - a short, bold instruction strip pinned to the BOTTOM hint-bar band —
 *     the only horizontal band that never overlaps any tower, so it can
 *     never cover the enemy castle (the finale's target). GameScene hides
 *     the redundant bottom hint + legend during training to make room;
 *   - small step pips inline at the strip's right end (no "TRAINING 1/5"
 *     exam label);
 *   - pulsing spotlight rings on every guided territory (sources + target);
 *   - an animated TOUCH INDICATOR (soft glow dot + breathing pulse ring)
 *     that demonstrates the exact drag gesture along the guided path,
 *     Clash Royale-style — no hand anatomy, so it reads cleanly over any
 *     board art. Hidden while the player's own finger is down and resumed
 *     on release;
 *   - a victory celebration (banner + confetti) when the player captures the
 *     enemy base, before the account-wide completion save;
 *   - the fail-closed save-failure state: the strip transforms into a wide
 *     RETRY button (retrying never unblocks the tutorial by itself).
 *
 * Kept as a self-contained object so GameScene only routes controller
 * events into it; no gameplay logic lives here. Nothing in this overlay is
 * interactive (except RETRY) so it never blocks the real battle controls.
 */

import Phaser from 'phaser';
import { LOGICAL_WIDTH } from '@crown-clash/game-core';
import { THEME } from '../theme.js';
import { bindSceneViewportResize, getSceneViewport } from '../ui/Viewport.js';
import { trainingOverlayPanelY } from '../ui/BattlefieldArenaLayout.js';
import type { TutorialStepInfo } from '../tutorial/TutorialController.js';
import { TUTORIAL_STEPS } from '../tutorial/TutorialController.js';
import { createText, FONT_FAMILY } from '../ui/TextStyles.js';

/** Overlay depth layering: above the board, below the instruction panel. */
const SPOTLIGHT_DEPTH = 6;
const HINT_PATH_DEPTH = 57;
const HAND_DEPTH = 58;
const PANEL_DEPTH = 96;
const CELEBRATION_DEPTH = 97;

export interface SpotlightPoint {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

interface SpotlightPair {
  readonly glow: Phaser.GameObjects.Arc;
  readonly ring: Phaser.GameObjects.Arc;
}

export class TrainingOverlayUI {
  private readonly scene: Phaser.Scene;
  private readonly container: Phaser.GameObjects.Container;
  private readonly panel: Phaser.GameObjects.Rectangle;
  private readonly instruction: Phaser.GameObjects.Text;
  private readonly pips: Phaser.GameObjects.Arc[] = [];
  private destroyed = false;
  private readonly unbindResize: () => void;

  // Spotlights (pooled pairs, one per guided territory).
  private readonly spotlights: SpotlightPair[] = [];
  private spotlightsVisible = 0;

  // Touch indicator (animated drag-gesture demonstration).
  private readonly indicatorContainer: Phaser.GameObjects.Container;
  private readonly hintPathGraphics: Phaser.GameObjects.Graphics;
  private readonly pulseRing: Phaser.GameObjects.Arc;
  private pulseTween?: Phaser.Tweens.Tween;
  private hintPoints: readonly { x: number; y: number }[] = [];
  private hintToken = 0;
  private handHiddenByInteraction = false;

  // Victory celebration.
  private celebration?: Phaser.GameObjects.Container;
  private celebrationSubtitle?: Phaser.GameObjects.Text;
  private confetti: Phaser.GameObjects.Rectangle[] = [];

  // Save-failure retry (fail-closed).
  private retryButton?: Phaser.GameObjects.Rectangle;
  private retryLabel?: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.container = scene.add.container(0, 0).setDepth(PANEL_DEPTH);
    this.panel = scene.add
      .rectangle(LOGICAL_WIDTH / 2, 0, 364, 46, 0x0b1220, 0.96)
      .setStrokeStyle(2.5, THEME.gold, 0.95);
    this.instruction = createText(scene, LOGICAL_WIDTH / 2, 0, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '14px',
        fontStyle: '900',
        color: '#fde68a',
        stroke: '#000000',
        strokeThickness: 3,
        resolution: 2,
        align: 'center',
        wordWrap: { width: 286 },
      })
      .setOrigin(0.5);
    this.container.add([this.panel, this.instruction]);

    // Step pips sit INLINE at the strip's right end: below the strip there
    // is no on-screen room on 720-tall viewports.
    for (let index = 0; index < TUTORIAL_STEPS.length; index += 1) {
      const pip = scene.add.circle(0, 0, 3, 0x334155, 1);
      this.pips.push(pip);
      this.container.add(pip);
    }

    // Spotlight pool: up to 10 guided territories — the finale spotlights
    // every owned tower plus the enemy base (crown_cross has 9 territories).
    for (let index = 0; index < 10; index += 1) {
      const glow = this.scene.add
        .circle(0, 0, 10, THEME.gold, 0.16)
        .setVisible(false)
        .setDepth(SPOTLIGHT_DEPTH);
      const ring = this.scene.add
        .circle(0, 0, 10, THEME.gold, 0)
        .setStrokeStyle(2.5, THEME.gold, 0.95)
        .setVisible(false)
        .setDepth(SPOTLIGHT_DEPTH + 1);
      this.spotlights.push({ glow, ring });
    }

    this.hintPathGraphics = scene.add.graphics().setDepth(HINT_PATH_DEPTH);
    this.indicatorContainer = scene.add.container(0, 0).setDepth(HAND_DEPTH);
    this.pulseRing = scene.add
      .circle(0, 0, 15, THEME.gold, 0)
      .setStrokeStyle(2.5, 0xffffff, 0.9);
    this.buildTouchIndicator();

    this.applyLayout();
    this.unbindResize = bindSceneViewportResize(scene, () => this.applyLayout());
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  private applyLayout(): void {
    // The strip keeps a fixed 364px width (the viewport is never narrower
    // than the 400px board), so only the vertical placement reacts to the
    // viewport: below the board on tall screens, over the bottom hint-bar
    // band on board-fitted ones (see trainingOverlayPanelY).
    const { visibleHeight } = getSceneViewport(this.scene);
    const y = trainingOverlayPanelY(visibleHeight);
    this.container.setPosition(0, 0);
    this.panel.setPosition(LOGICAL_WIDTH / 2, y);
    // Instruction text is centered in the strip minus the pip zone.
    this.instruction.setPosition(LOGICAL_WIDTH / 2 - 24, y - 1);
    // Step pips sit INLINE at the strip's right end: below the strip there
    // is no on-screen room on 720-tall viewports. The whole row must fit
    // INSIDE the panel (364 wide, so the strip spans 18..382) — center it
    // in the right margin so no dot spills past the strip edge.
    const pipSpacing = 12;
    const pipRowHalfWidth = ((this.pips.length - 1) * pipSpacing) / 2;
    const pipZoneCenterX = this.panel.x + this.panel.width / 2 - 32;
    this.pips.forEach((pip, index) =>
      pip.setPosition(pipZoneCenterX - pipRowHalfWidth + index * pipSpacing, y)
    );
    this.celebration?.setPosition(LOGICAL_WIDTH / 2, Math.max(150, visibleHeight * 0.34));
  }

  // -------------------------------------------------------------------------
  // Touch indicator (Clash Royale-style drag-gesture demonstration)
  // -------------------------------------------------------------------------

  /**
   * Builds the touch indicator: a soft white glow dot with a breathing
   * pulse ring. Deliberately NOT a drawn hand — abstract touch dots read
   * cleanly over any board art and match the mobile-game convention the
   * target audience already knows.
   */
  private buildTouchIndicator(): void {
    const halo = this.scene.add.circle(0, 0, 30, THEME.gold, 0.14);
    const glow = this.scene.add.circle(0, 0, 19, 0xffffff, 0.32);
    const core = this.scene.add
      .circle(0, 0, 10.5, 0xffffff, 0.95)
      .setStrokeStyle(1.5, 0x0b1220, 0.25);
    this.indicatorContainer.add([halo, glow, core, this.pulseRing]);
    this.indicatorContainer.setVisible(false);
  }

  /** Continuous "touch here" pulse around the dot while it is visible. */
  private startPulse(): void {
    this.stopPulse();
    if (this.isReducedMotion()) return;
    this.pulseTween = this.scene.tweens.add({
      targets: this.pulseRing,
      scale: { from: 1, to: 1.7 },
      alpha: { from: 0.9, to: 0 },
      duration: 950,
      repeat: -1,
      ease: 'Cubic.easeOut',
    });
  }

  private stopPulse(): void {
    this.pulseTween?.remove();
    this.pulseTween = undefined;
    this.pulseRing.setScale(1).setAlpha(0.9);
  }

  /**
   * Plays one full demonstration cycle along the guided path:
   * press at the source → slide through the path → press at the target →
   * fade out → repeat. Re-invocations cancel and restart the loop.
   */
  private animateHintCycle(token: number): void {
    const scene = this.scene;
    const points = this.hintPoints;
    if (this.destroyed || token !== this.hintToken || points.length === 0) return;

    const dot = this.indicatorContainer;
    scene.tweens.killTweensOf(dot);

    const start = points[0];
    dot.setPosition(start.x, start.y).setAlpha(0).setScale(1).setVisible(true);
    this.startPulse();

    if (this.isReducedMotion()) {
      // Reduced motion: a static "touch here" dot at the source plus the
      // drawn path — no looping animation.
      dot.setAlpha(0.92);
      return;
    }

    this.spawnRipple(start.x, start.y, token);
    scene.tweens.add({
      targets: dot,
      alpha: 1,
      duration: 200,
      ease: 'Sine.easeOut',
      onComplete: () => {
        if (this.destroyed || token !== this.hintToken) return;
        // Press beat at the source.
        scene.tweens.add({
          targets: dot,
          scale: 0.82,
          duration: 120,
          yoyo: true,
          ease: 'Sine.easeInOut',
          onComplete: () => this.hintAfterPress(token, 0),
        });
      },
    });
  }

  private hintAfterPress(token: number, segmentIndex: number): void {
    const scene = this.scene;
    const points = this.hintPoints;
    if (this.destroyed || token !== this.hintToken) return;
    if (segmentIndex >= points.length - 1) {
      this.hintFinishAtTarget(token);
      return;
    }

    const dot = this.indicatorContainer;
    const from = points[segmentIndex];
    const to = points[segmentIndex + 1];
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const duration = Phaser.Math.Clamp((distance / 240) * 1000, 320, 1050);

    // A chained drag through multiple towers hitches briefly on each one.
    const isWaypoint = segmentIndex + 1 < points.length - 1;

    scene.tweens.add({
      targets: dot,
      x: to.x,
      y: to.y,
      duration,
      ease: isWaypoint ? 'Sine.easeInOut' : 'Cubic.easeOut',
      onComplete: () => {
        if (this.destroyed || token !== this.hintToken) return;
        if (isWaypoint) {
          scene.tweens.add({
            targets: dot,
            scale: 0.88,
            duration: 110,
            yoyo: true,
            ease: 'Sine.easeInOut',
            onComplete: () => this.hintAfterPress(token, segmentIndex + 1),
          });
        } else {
          this.hintFinishAtTarget(token);
        }
      },
    });
  }

  private hintFinishAtTarget(token: number): void {
    const scene = this.scene;
    if (this.destroyed || token !== this.hintToken) return;
    const points = this.hintPoints;
    const target = points[points.length - 1];
    const dot = this.indicatorContainer;

    this.spawnRipple(target.x, target.y, token);
    scene.tweens.add({
      targets: dot,
      scale: 0.82,
      duration: 120,
      yoyo: true,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        if (this.destroyed || token !== this.hintToken) return;
        scene.tweens.add({
          targets: dot,
          alpha: 0,
          scale: 1,
          delay: 420,
          duration: 240,
          ease: 'Sine.easeIn',
          onComplete: () => {
            if (this.destroyed || token !== this.hintToken) return;
            dot.setVisible(false);
            this.stopPulse();
            // Loop the demonstration until the player interacts or the
            // step changes.
            scene.time.delayedCall(520, () => {
              if (this.destroyed || token !== this.hintToken) return;
              if (!this.handHiddenByInteraction) {
                this.animateHintCycle(token);
              }
            });
          },
        });
      },
    });
  }

  /** Short-lived ripple ring at a press point ("touch here" cue). */
  private spawnRipple(x: number, y: number, token: number): void {
    if (this.destroyed || token !== this.hintToken) return;
    const ring = this.scene.add
      .circle(x, y, 12, THEME.gold, 0)
      .setStrokeStyle(3, THEME.gold, 0.85)
      .setDepth(HAND_DEPTH - 1);
    this.scene.tweens.add({
      targets: ring,
      scale: 2.1,
      alpha: 0,
      duration: 640,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  /** Dashed guide line along the hint path, with an arrowhead at the end. */
  private drawHintPath(): void {
    const g = this.hintPathGraphics;
    g.clear();
    const points = this.hintPoints;
    if (points.length < 2) return;

    const dashLength = 10;
    const gap = 8;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const total = Math.hypot(b.x - a.x, b.y - a.y);
      if (total <= 0) continue;
      const steps = Math.max(1, Math.floor(total / (dashLength + gap)));
      const ux = (b.x - a.x) / total;
      const uy = (b.y - a.y) / total;
      for (let s = 0; s < steps; s += 1) {
        const t0 = (s / steps) * total;
        const t1 = Math.min(t0 + dashLength, total);
        g.lineStyle(4, 0x020617, 0.55);
        g.lineBetween(a.x + ux * t0, a.y + uy * t0, a.x + ux * t1, a.y + uy * t1);
        g.lineStyle(2, THEME.gold, 0.55);
        g.lineBetween(a.x + ux * t0, a.y + uy * t0, a.x + ux * t1, a.y + uy * t1);
      }
    }

    // Arrowhead on the final point.
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const angle = Phaser.Math.Angle.Between(prev.x, prev.y, last.x, last.y);
    const back = 18;
    const wing = 9;
    const tipX = last.x - Math.cos(angle) * 4;
    const tipY = last.y - Math.sin(angle) * 4;
    const rearX = tipX - Math.cos(angle) * back;
    const rearY = tipY - Math.sin(angle) * back;
    const wingX = Math.cos(angle + Math.PI / 2) * wing;
    const wingY = Math.sin(angle + Math.PI / 2) * wing;
    const drawArrow = (color: number, alpha: number, inflate: number) => {
      g.fillStyle(color, alpha);
      g.fillTriangle(
        tipX,
        tipY,
        rearX + wingX * inflate,
        rearY + wingY * inflate,
        rearX - wingX * inflate,
        rearY - wingY * inflate
      );
    };
    drawArrow(0x020617, 0.6, 1.5);
    drawArrow(THEME.gold, 0.8, 1);
  }

  // -------------------------------------------------------------------------
  // Public API — steps, spotlights, hand hint
  // -------------------------------------------------------------------------

  /**
   * True while at least one guided territory is spotlighted (used by the
   * initialization parity test).
   */
  get isSpotlightActive(): boolean {
    return this.spotlightsVisible > 0;
  }

  /**
   * Points the pulsing spotlights at the guided territories (sources +
   * suggested target). An empty list hides them.
   */
  spotlightTargets(points: readonly SpotlightPoint[]): void {
    if (this.destroyed) return;
    this.spotlightsVisible = Math.min(points.length, this.spotlights.length);
    for (let index = 0; index < this.spotlights.length; index += 1) {
      const pair = this.spotlights[index];
      if (index >= points.length) {
        pair.glow.setVisible(false);
        pair.ring.setVisible(false);
        this.scene.tweens.killTweensOf(pair.ring);
        continue;
      }
      const { x, y, radius } = points[index];
      const ringRadius = radius + 12;
      pair.ring.setPosition(x, y).setRadius(ringRadius).setVisible(true);
      pair.glow.setPosition(x, y).setRadius(ringRadius + 8).setVisible(true);
      this.scene.tweens.killTweensOf(pair.ring);
      pair.ring.setScale(1);
      if (!this.isReducedMotion()) {
        this.scene.tweens.add({
          targets: pair.ring,
          scale: 1.12,
          duration: 650,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    }
  }

  /**
   * Shows the touch indicator along the given gesture path (territory
   * centers, sources first, release target last). An empty list hides it.
   * While the player's own finger is down the indicator stays hidden (only
   * the drawn path refreshes); it resumes on release.
   */
  showHandHint(points: readonly { x: number; y: number }[]): void {
    if (this.destroyed) return;
    this.hintToken += 1;
    this.hintPoints = points;
    this.scene.tweens.killTweensOf(this.indicatorContainer);
    if (points.length === 0) {
      this.hintPathGraphics.clear();
      this.indicatorContainer.setVisible(false);
      this.stopPulse();
      return;
    }
    this.drawHintPath();
    if (this.handHiddenByInteraction) {
      // Mid-gesture: the player's own finger is the live demonstration, so
      // only refresh the drawn path (a capture may have re-pointed the
      // guidance at a new target). The dot returns on release.
      return;
    }
    this.animateHintCycle(this.hintToken);
  }

  /**
   * Hides the touch indicator when the player touches the screen (their
   * own gesture replaces the demonstration). The drawn path is hidden too;
   * both return on release (notifyInteractionEnded) or with the next step.
   */
  notifyPlayerInteraction(): void {
    if (this.destroyed) return;
    this.handHiddenByInteraction = true;
    this.hintToken += 1;
    this.scene.tweens.killTweensOf(this.indicatorContainer);
    this.hintPathGraphics.clear();
    this.indicatorContainer.setVisible(false);
    this.stopPulse();
  }

  /**
   * The player released the screen: their finger is no longer the live
   * demonstration, so the guided demo resumes if a hint path exists.
   */
  notifyInteractionEnded(): void {
    if (this.destroyed) return;
    if (!this.handHiddenByInteraction) return;
    this.handHiddenByInteraction = false;
    if (this.hintPoints.length === 0) return;
    this.drawHintPath();
    this.animateHintCycle(this.hintToken);
  }

  /** Renders the current guided step (instruction + pip state). */
  renderStep(step: TutorialStepInfo | null, stepIndex: number): void {
    if (this.destroyed) return;
    this.clearRetry();
    this.instruction.setText(step ? step.instruction : '');
    this.pips.forEach((pip, index) => {
      pip.setFillStyle(index < stepIndex ? 0x34d399 : index === stepIndex ? THEME.gold : 0x334155, 1);
      pip.setScale(index === stepIndex ? 1.3 : 1);
    });
  }

  // -------------------------------------------------------------------------
  // Victory celebration + completion save states
  // -------------------------------------------------------------------------

  /**
   * Clash Royale-style victory beat: banner + confetti while the
   * account-wide completion save runs under it.
   */
  showVictoryCelebration(): void {
    if (this.destroyed) return;
    this.clearRetry();
    this.spotlightTargets([]);
    this.notifyPlayerInteraction();
    this.instruction.setText('');
    this.instruction.setColor('#fde68a');
    this.pips.forEach((pip) => pip.setFillStyle(0x34d399, 1));
    // The banner owns the moment: hide the whole instruction strip so the
    // victory beat reads clean (showSaveError brings it back as RETRY).
    this.panel.setVisible(false);
    this.instruction.setVisible(false);
    this.pips.forEach((pip) => pip.setVisible(false));

    const scene = this.scene;
    this.celebration?.destroy(true);
    const { visibleHeight } = getSceneViewport(scene);
    const bannerY = Math.max(150, visibleHeight * 0.34);
    this.celebration = scene.add.container(LOGICAL_WIDTH / 2, bannerY).setDepth(CELEBRATION_DEPTH);

    const bannerW = 300;
    const shadow = scene.add.rectangle(0, 4, bannerW, 84, 0x000000, 0.45);
    const banner = scene.add
      .rectangle(0, 0, bannerW, 84, 0x0b1220, 0.97)
      .setStrokeStyle(3, THEME.gold, 1);
    const title = createText(scene, 0, -14, '👑 VICTORY!', {
        fontFamily: FONT_FAMILY,
        fontSize: '27px',
        fontStyle: '900',
        color: '#fde68a',
        stroke: '#000000',
        strokeThickness: 4,
        resolution: 2,
      })
      .setOrigin(0.5);
    const subtitle = createText(scene, 0, 22, 'TRAINING COMPLETE — SAVING…', {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#93c5fd',
        resolution: 2,
      })
      .setOrigin(0.5);
    this.celebrationSubtitle = subtitle;
    this.celebration.add([shadow, banner, title, subtitle]);

    if (this.isReducedMotion()) {
      return;
    }
    this.celebration.setScale(0.7).setAlpha(0);
    scene.tweens.add({
      targets: this.celebration,
      scale: 1,
      alpha: 1,
      duration: 380,
      ease: 'Back.easeOut',
    });
    this.spawnConfetti();
  }

  /** Transient subtitle swap while the completion save is in flight. */
  setCelebrationSaving(saving: boolean): void {
    if (this.destroyed) return;
    this.celebrationSubtitle?.setText(
      saving ? 'TRAINING COMPLETE — SAVING…' : 'TRAINING COMPLETE!'
    );
  }

  showStartingMatch(): void {
    if (this.destroyed) return;
    this.celebrationSubtitle?.setText('TRAINING COMPLETE — STARTING BATTLE…');
  }

  /** Light one-shot confetti burst from the banner (skipped when reduced). */
  private spawnConfetti(): void {
    if (this.destroyed || this.isReducedMotion()) return;
    const scene = this.scene;
    const origin = this.celebration ?? { x: LOGICAL_WIDTH / 2, y: 300 };
    const colors = [THEME.gold, 0xffffff, THEME.teams.player.primary, 0x34d399];
    for (let index = 0; index < 34; index += 1) {
      const piece = scene.add
        .rectangle(
          origin.x,
          origin.y,
          5 + Math.random() * 4,
          8 + Math.random() * 5,
          colors[index % colors.length],
          1
        )
        .setDepth(CELEBRATION_DEPTH + 1);
      this.confetti.push(piece);
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const speed = 130 + Math.random() * 150;
      scene.tweens.add({
        targets: piece,
        x: origin.x + Math.cos(angle) * speed,
        y: origin.y + Math.sin(angle) * speed + 120,
        rotation: Math.random() * 6,
        alpha: 0,
        delay: index * 14,
        duration: 950 + Math.random() * 350,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          piece.destroy();
          const at = this.confetti.indexOf(piece);
          if (at >= 0) this.confetti.splice(at, 1);
        },
      });
    }
  }

  /**
   * Fail-closed save failure: the tutorial stays incomplete until the
   * server accepts the write. The instruction strip transforms into a wide
   * RETRY button — the only tower-free band, and a hanging button would
   * fall off-screen on 720-tall viewports.
   */
  showSaveError(onRetry: () => void): void {
    if (this.destroyed) return;
    this.clearRetry();
    this.setCelebrationSaving(false);
    this.instruction.setVisible(false);
    this.pips.forEach((pip) => pip.setVisible(false));
    this.panel
      .setVisible(true)
      .setFillStyle(0x2563eb, 1)
      .setStrokeStyle(2.5, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => onRetry());
    this.retryButton = this.panel;
    this.retryLabel = createText(this.scene,
        LOGICAL_WIDTH / 2,
        this.panel.y,
        '⚠ COULD NOT SAVE — TAP TO RETRY',
        {
          fontFamily: FONT_FAMILY,
          fontSize: '13px',
          fontStyle: '900',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 2.5,
          resolution: 2,
        }
      )
      .setOrigin(0.5);
    this.container.add(this.retryLabel);
  }

  /** Restores the instruction strip after a retry state. */
  private clearRetry(): void {
    if (this.retryButton) {
      this.retryButton.off('pointerdown');
      this.retryButton = undefined;
    }
    this.retryLabel?.destroy();
    this.retryLabel = undefined;
    this.panel
      .setFillStyle(0x0b1220, 0.96)
      .setStrokeStyle(2.5, THEME.gold, 0.95)
      .disableInteractive();
    this.instruction.setVisible(true);
    this.pips.forEach((pip) => pip.setVisible(true));
  }

  private isReducedMotion(): boolean {
    return this.scene.registry.get('reducedEffects') === true;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unbindResize();
    for (const pair of this.spotlights) {
      this.scene.tweens.killTweensOf(pair.ring);
      pair.ring.destroy();
      pair.glow.destroy();
    }
    this.spotlights.length = 0;
    this.scene.tweens.killTweensOf(this.indicatorContainer);
    this.indicatorContainer.destroy(true);
    this.stopPulse();
    this.hintPathGraphics.destroy();
    for (const piece of this.confetti) piece.destroy();
    this.confetti = [];
    this.celebration?.destroy(true);
    this.celebration = undefined;
    // Only neutralize the retry state here — NEVER call clearRetry(): at
    // scene shutdown Phaser's display list destroys the strip objects
    // BEFORE this handler runs, and touching the destroyed panel from
    // clearRetry (e.g. disableInteractive) throws, which unwinds the
    // scene manager's queued restart AND kills Phaser's frame loop —
    // the exact "game locks after the tutorial" freeze.
    this.retryButton = undefined;
    this.retryLabel?.destroy();
    this.retryLabel = undefined;
    this.container.destroy(true);
  }
}
