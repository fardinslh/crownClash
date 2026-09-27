/**
 * Crown Clash — Guided training battle overlay.
 *
 * Renders the tutorial controller's current step inside the real battle:
 * an instruction bubble, step pips, and a pulsing spotlight ring on the
 * guided territory. Also renders the completion-saving and save-failure
 * states (fail-closed: a failed save offers RETRY and never unblocks the
 * tutorial by itself).
 *
 * Kept as a self-contained object so GameScene only routes controller
 * events into it; no gameplay logic lives here.
 */

import Phaser from 'phaser';
import { LOGICAL_WIDTH } from '@crown-clash/game-core';
import { THEME } from '../theme.js';
import { bindSceneViewportResize, getSceneViewport } from '../ui/Viewport.js';
import { trainingOverlayPanelY } from '../ui/BattlefieldArenaLayout.js';
import type { TutorialStepInfo } from '../tutorial/TutorialController.js';
import { TUTORIAL_STEPS } from '../tutorial/TutorialController.js';

const FONT_FAMILY =
  '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';

/** Minimum comfortable touch target (AGENTS.md UX rules). */
const RETRY_TARGET_SIZE = 48;

export class TrainingOverlayUI {
  private readonly container: Phaser.GameObjects.Container;
  private readonly panel: Phaser.GameObjects.Rectangle;
  private readonly instruction: Phaser.GameObjects.Text;
  private readonly stateLabel: Phaser.GameObjects.Text;
  private readonly pips: Phaser.GameObjects.Arc[] = [];
  private readonly spotlight: Phaser.GameObjects.Arc;
  private readonly spotlightGlow: Phaser.GameObjects.Arc;
  private retryButton?: Phaser.GameObjects.Rectangle;
  private retryLabel?: Phaser.GameObjects.Text;
  private destroyed = false;
  private readonly unbindResize: () => void;

  constructor(private readonly scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0).setDepth(96);
    this.panel = scene.add
      .rectangle(LOGICAL_WIDTH / 2, 0, 348, 58, 0x0b1220, 0.96)
      .setStrokeStyle(2, THEME.gold, 0.95);
    this.instruction = scene.add
      .text(LOGICAL_WIDTH / 2, -6, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: '900',
        color: '#fde68a',
        stroke: '#000000',
        strokeThickness: 3,
        resolution: 2,
        align: 'center',
        wordWrap: { width: 322 },
      })
      .setOrigin(0.5);
    this.stateLabel = scene.add
      .text(LOGICAL_WIDTH / 2, 16, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#93c5fd',
        resolution: 2,
      })
      .setOrigin(0.5);
    this.container.add([this.panel, this.instruction, this.stateLabel]);

    for (let index = 0; index < TUTORIAL_STEPS.length; index += 1) {
      const pip = scene.add.circle(
        LOGICAL_WIDTH / 2 - 27 + index * 18,
        38,
        3.5,
        0x334155,
        1
      );
      this.pips.push(pip);
      this.container.add(pip);
    }

    this.spotlightGlow = scene.add.circle(0, 0, 10, THEME.gold, 0.18).setVisible(false).setDepth(6);
    this.spotlight = scene.add
      .circle(0, 0, 10, THEME.gold, 0)
      .setStrokeStyle(2.5, THEME.gold, 0.95)
      .setVisible(false)
      .setDepth(7);

    this.applyLayout();
    this.unbindResize = bindSceneViewportResize(scene, () => this.applyLayout());
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  private applyLayout(): void {
    const { visibleWidth, visibleHeight } = getSceneViewport(this.scene);
    const y = trainingOverlayPanelY(visibleHeight);
    this.container.setPosition(0, 0);
    this.panel.setPosition(LOGICAL_WIDTH / 2, y);
    this.instruction.setPosition(LOGICAL_WIDTH / 2, y - 7);
    this.stateLabel.setPosition(LOGICAL_WIDTH / 2, y + 15);
    const pipY = y + 30;
    this.pips.forEach((pip) => pip.setY(pipY));
    if (visibleWidth > 0) {
      this.panel.setSize(Math.min(360, visibleWidth - 24), 58);
    }
  }

  /** Positions the pulsing spotlight on a territory center. */
  spotlightTarget(x: number | null, y: number | null, radius: number): void {
    if (this.destroyed || x === null || y === null) {
      this.spotlight.setVisible(false);
      this.spotlightGlow.setVisible(false);
      return;
    }
    const ringRadius = radius + 12;
    this.spotlight.setPosition(x, y).setRadius(ringRadius).setVisible(true);
    this.spotlightGlow.setPosition(x, y).setRadius(ringRadius + 8).setVisible(true);
    this.scene.tweens.killTweensOf(this.spotlight);
    this.scene.tweens.add({
      targets: this.spotlight,
      scale: 1.12,
      duration: 650,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** Renders the current guided step (instruction + pip state). */
  renderStep(step: TutorialStepInfo | null, stepIndex: number): void {
    if (this.destroyed) return;
    this.clearRetry();
    this.instruction.setText(step ? step.instruction : '');
    this.stateLabel.setText(step ? `TRAINING  ${stepIndex + 1}/${TUTORIAL_STEPS.length}` : '');
    this.pips.forEach((pip, index) => {
      pip.setFillStyle(index < stepIndex ? 0x34d399 : index === stepIndex ? THEME.gold : 0x334155, 1);
      pip.setScale(index === stepIndex ? 1.3 : 1);
    });
  }

  /** Transient state while the account-wide completion is being saved. */
  showSaving(): void {
    if (this.destroyed) return;
    this.clearRetry();
    this.spotlight.setVisible(false);
    this.spotlightGlow.setVisible(false);
    this.instruction.setText('TRAINING COMPLETE!');
    this.stateLabel.setText('SAVING YOUR PROGRESS…').setColor('#93c5fd');
  }

  /**
   * Fail-closed save failure: the tutorial stays incomplete until the
   * server accepts the write. RETRY re-invokes the provided handler.
   */
  showSaveError(onRetry: () => void): void {
    if (this.destroyed) return;
    this.clearRetry();
    this.instruction.setText('COULD NOT SAVE TRAINING');
    this.stateLabel.setText('Check your connection, then retry.').setColor('#fca5a5');
    const y = this.panel.y + 44;
    this.retryButton = this.scene.add
      .rectangle(LOGICAL_WIDTH / 2, y, 168, RETRY_TARGET_SIZE, 0x2563eb, 1)
      .setStrokeStyle(2, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true });
    this.retryLabel = this.scene.add
      .text(LOGICAL_WIDTH / 2, y, 'RETRY  ›', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: '900',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.retryButton.on('pointerdown', () => {
      onRetry();
    });
    this.container.add([this.retryButton, this.retryLabel]);
  }

  private clearRetry(): void {
    this.retryButton?.destroy();
    this.retryLabel?.destroy();
    this.retryButton = undefined;
    this.retryLabel = undefined;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unbindResize();
    this.scene.tweens.killTweensOf(this.spotlight);
    this.spotlight.destroy();
    this.spotlightGlow.destroy();
    this.clearRetry();
    this.container.destroy(true);
  }
}
