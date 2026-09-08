import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '@crown-clash/game-core';
import { createPlatformAdapter } from '@crown-clash/platform';
import { AnalyticsSink } from './analytics/AnalyticsSink.js';
import { getSharedGameApiClient } from './api/sharedClient.js';
import { GameScene } from './scenes/GameScene.js';
import { MenuScene } from './scenes/MenuScene.js';

// 1. Initialize Platform Adapter (Bale -> Eitaa -> Telegram -> Browser).
// Phaser must not boot before platform init resolves: scenes read the
// platform user in create() and a half-initialized adapter yields an
// unstable guest identity.
const platform = createPlatformAdapter();

const startApp = (): void => {
  platform.ready();

  const api = getSharedGameApiClient();
  const analyticsSink = new AnalyticsSink({
    flush: (events) => api.trackEvents(events),
    shouldFlush: () => api.isAuthenticated(),
  });
  analyticsSink.start();

  // Render the canvas at a higher internal resolution than the 400x720
  // logical coordinate system to avoid blurriness on high-DPI screens.
  // The camera zoom maps logical coordinates back to the scaled canvas.
  const RENDER_SCALE = Math.min(window.devicePixelRatio || 1, 2);

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: 'game-container',
    width: LOGICAL_WIDTH * RENDER_SCALE,
    height: LOGICAL_HEIGHT * RENDER_SCALE,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      autoRound: true,
    },
    dom: {
      createContainer: true,
    },
    backgroundColor: '#070b14',
    scene: [MenuScene, GameScene],
    render: {
      antialias: true,
      antialiasGL: true,
      roundPixels: true,
      powerPreference: 'high-performance',
    },
    fps: {
      target: 60,
      forceSetTimeOut: true,
    },
    callbacks: {
      postBoot: (bootedGame) => {
        bootedGame.registry.set('platform', platform);
        bootedGame.registry.set('renderScale', RENDER_SCALE);
      },
    },
  };

  new Phaser.Game(config);
};

void platform.initialize()
  .catch((err: unknown) => {
    console.warn('[Platform] Async init warning:', err);
  })
  .finally(() => {
    startApp();
  });
