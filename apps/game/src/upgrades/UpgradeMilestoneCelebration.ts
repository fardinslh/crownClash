import type Phaser from 'phaser';
import type { PlatformAdapter } from '@crown-clash/platform';
import { sounds } from '../audio/SoundEffects.js';
import { createText } from '../ui/TextStyles.js';
import { fa } from '../i18n/fa.js';

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
  const celebration = createText(scene, position.x, position.y, fa.kingdom.milestone(level), {
      fontSize: '13px',
      fontStyle: '900',
      color: '#fef08a',
      stroke: '#000000',
      strokeThickness: 3,
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
