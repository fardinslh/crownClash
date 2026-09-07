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

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: 'game-container',
    width: LOGICAL_WIDTH,
    height: LOGICAL_HEIGHT,
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
      roundPixels: false,
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

  new Phaser.Game(config);
};

void platform.initialize()
  .catch((err: unknown) => {
    console.warn('[Platform] Async init warning:', err);
  })
  .finally(() => {
    startApp();
  });
