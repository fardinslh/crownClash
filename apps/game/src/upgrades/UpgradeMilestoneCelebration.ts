import type Phaser from 'phaser';
import type { PlatformAdapter } from '@crown-clash/platform';
import { sounds } from '../audio/SoundEffects.js';

const FONT_FAMILY = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Shared milestone celebration (every 5th upgrade level), so the result
 * panel and the Kingdom hub give the player the same distinct feedback
 * regardless of where the purchase happened.
 */
export function playUpgradeMilestoneCelebration(
  scene: Phaser.Scene,
  platform: PlatformAdapter,
  level: number,
  position: { x: number; y: number },
  reducedMotion: boolean
): void {
  const celebration = scene.add
    .text(position.x, position.y, `✦ MILESTONE ${level} REACHED ✦`, {
      fontFamily: FONT_FAMILY,
      fontSize: '11px',
      fontStyle: '900',
      color: '#fef08a',
      stroke: '#000000',
      strokeThickness: 2,
      resolution: 2,
    })
    .setDepth(230)
    .setOrigin(0.5);
  sounds.playVictory();
  platform.hapticImpact('heavy');

  if (reducedMotion) {
    scene.time.delayedCall(900, () => celebration.destroy());
    return;
  }
  scene.tweens.add({
    targets: celebration,
    y: celebration.y - 10,
    alpha: 0,
    duration: 950,
    ease: 'Cubic.easeOut',
    onComplete: () => celebration.destroy(),
  });
}
