import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '@crown-clash/game-core';
import { createPlatformAdapter } from '@crown-clash/platform';
import { GameScene } from './scenes/GameScene.js';

// 1. Initialize Platform Adapter (Bale -> Eitaa -> Telegram -> Browser)
const platform = createPlatformAdapter();
platform.initialize().catch((err: unknown) => {
  console.warn('[Platform] Async init warning:', err);
});
platform.ready();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: LOGICAL_WIDTH,
  height: LOGICAL_HEIGHT,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  backgroundColor: '#0a0e17',
  scene: [GameScene],
  render: {
    antialias: true,
    pixelArt: false,
    powerPreference: 'high-performance',
  },
  fps: {
    target: 60,
    forceSetTimeOut: true,
  },
  callbacks: {
    postBoot: (bootedGame) => {
      bootedGame.registry.set('platform', platform);
    },
  },
};

export const game = new Phaser.Game(config);

