import Phaser from 'phaser';
import { ABILITY_CONFIG, type AbilityId } from '@crown-clash/game-core';
import { createText, FONT_FAMILY } from './TextStyles.js';

export type AbilityButtonState = 'charging' | 'ready' | 'targeting' | 'used';

const RADIUS = 27;
const COLORS: Record<AbilityId, number> = {
  royal_shield: 0xfbbf24,
  supply_drop: 0x34d399,
  vanguard_charge: 0xf87171,
};

/**
 * Round thumb-reach button for the v4 commander ability: a radial
 * countdown until it unlocks, a pulse when ready, a ring while the player
 * picks a target, and a greyed state once spent. Gameplay lives in
 * GameScene/game-core; this only renders and reports presses.
 */
export class AbilityButton {
  readonly container: Phaser.GameObjects.Container;
  private readonly progress: Phaser.GameObjects.Graphics;
  private readonly glyph: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly ring: Phaser.GameObjects.Arc;
  private state: AbilityButtonState = 'charging';
  private lastProgressStep = -1;
  private pulse?: Phaser.Tweens.Tween;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ability: AbilityId,
    name: string,
    x: number,
    y: number,
    depth: number,
    private readonly reducedMotion: boolean,
    onPress: () => void,
  ) {
    const color = COLORS[ability];
    const shadow = scene.add.circle(0, 3, RADIUS + 2, 0x000000, 0.4);
    const base = scene.add.circle(0, 0, RADIUS, 0x0b1220, 0.97).setStrokeStyle(2, 0x334155, 1);
    this.ring = scene.add.circle(0, 0, RADIUS + 5, color, 0).setStrokeStyle(3, color, 0);
    this.progress = scene.add.graphics();
    this.glyph = scene.add.graphics();
    this.drawGlyph(color);
    this.label = createText(scene, 0, RADIUS + 9, name, {
      fontFamily: FONT_FAMILY,
      fontSize: '11px',
      fontStyle: '800',
      color: '#e2e8f0',
      stroke: '#030712',
      strokeThickness: 3,
    }).setOrigin(0.5);
    this.container = scene.add.container(x, y, [shadow, this.ring, base, this.progress, this.glyph, this.label])
      .setDepth(depth)
      .setSize(RADIUS * 2 + 12, RADIUS * 2 + 12);
    // 66px circular hit area (container hit areas are top-left based),
    // comfortably above the 44px touch minimum.
    this.container.setInteractive(
      new Phaser.Geom.Circle(RADIUS + 6, RADIUS + 6, RADIUS + 6),
      Phaser.Geom.Circle.Contains,
    );
    this.container.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      onPress();
    });
    this.render(0);
  }

  get current(): AbilityButtonState {
    return this.state;
  }

  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  /** Called every frame with match time; redraws only when something changes. */
  update(elapsedSeconds: number, used: boolean, targeting: boolean): void {
    const next: AbilityButtonState = used ? 'used' : targeting ? 'targeting'
      : elapsedSeconds + 1e-9 >= ABILITY_CONFIG.unlockSeconds ? 'ready' : 'charging';
    if (next !== this.state) {
      const becameReady = next === 'ready' && this.state === 'charging';
      this.state = next;
      this.lastProgressStep = -1;
      this.applyState(becameReady);
    }
    if (this.state === 'charging') this.render(elapsedSeconds / ABILITY_CONFIG.unlockSeconds);
  }

  destroy(): void {
    this.pulse?.stop();
    this.container.destroy(true);
  }

  private render(fraction: number): void {
    const step = Math.floor(Math.min(1, Math.max(0, fraction)) * 60);
    if (step === this.lastProgressStep) return;
    this.lastProgressStep = step;
    this.progress.clear();
    if (this.state !== 'charging') return;
    this.progress.lineStyle(4, COLORS[this.ability], 0.9);
    this.progress.beginPath();
    this.progress.arc(0, 0, RADIUS - 3, -Math.PI / 2, -Math.PI / 2 + (step / 60) * Math.PI * 2, false);
    this.progress.strokePath();
  }

  private applyState(becameReady: boolean): void {
    const color = COLORS[this.ability];
    this.progress.clear();
    this.pulse?.stop();
    this.pulse = undefined;
    this.ring.setScale(1);
    const charging = this.state === 'charging';
    const used = this.state === 'used';
    this.glyph.setAlpha(used ? 0.3 : charging ? 0.55 : 1);
    this.label.setAlpha(used ? 0.45 : 1);
    this.ring.setStrokeStyle(3, color, this.state === 'ready' || this.state === 'targeting' ? 1 : 0)
      .setFillStyle(color, this.state === 'targeting' ? 0.22 : 0);
    if (this.state === 'ready' && !this.reducedMotion) {
      this.pulse = this.scene.tweens.add({
        targets: this.ring, scale: 1.12, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      if (becameReady) {
        this.container.setScale(0.8);
        this.scene.tweens.add({ targets: this.container, scale: 1, duration: 260, ease: 'Back.easeOut' });
      }
    }
  }

  /** Simple commander emblems in the shared flat icon style. */
  private drawGlyph(color: number): void {
    const g = this.glyph;
    g.clear();
    if (this.ability === 'royal_shield') {
      g.fillStyle(color, 1);
      g.beginPath();
      g.moveTo(0, -14); g.lineTo(12, -9); g.lineTo(10, 5); g.lineTo(0, 14); g.lineTo(-10, 5); g.lineTo(-12, -9);
      g.closePath(); g.fillPath();
      g.fillStyle(0x0b1220, 1);
      g.fillRect(-2, -8, 4, 15);
      g.fillRect(-7, -3, 14, 4);
    } else if (this.ability === 'supply_drop') {
      g.fillStyle(color, 1);
      g.fillRoundedRect(-12, -8, 24, 19, 3);
      g.fillStyle(0x0b1220, 1);
      g.fillRect(-12, -2, 24, 3);
      g.fillRect(-1.5, -8, 3, 19);
      g.fillStyle(color, 1);
      g.fillTriangle(-6, -9, 6, -9, 0, -15);
    } else {
      g.fillStyle(color, 1);
      g.fillTriangle(14, 0, 2, -9, 2, 9);
      g.fillRect(-12, -3, 16, 6);
      g.fillTriangle(-14, -8, -8, 0, -14, 8);
    }
  }
}
