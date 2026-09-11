import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '@crown-clash/game-core';
import { createPlatformAdapter } from '@crown-clash/platform';
import { AnalyticsSink } from './analytics/AnalyticsSink.js';
import { trackSessionStart } from './analytics/Analytics.js';
import { getSharedGameApiClient } from './api/sharedClient.js';
import { GameScene } from './scenes/GameScene.js';
import { DailyScene } from './scenes/DailyScene.js';
import { KingdomScene } from './scenes/KingdomScene.js';
import { TrainingScene } from './scenes/TrainingScene.js';
import { LeagueScene } from './scenes/LeagueScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { CommanderScene } from './scenes/CommanderScene.js';

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
  trackSessionStart();

  // Render the canvas at a higher internal resolution than the 400x720
  // logical coordinate system to avoid blurriness on high-DPI screens.
  // The camera zoom (set in each scene's create()) maps logical
  // coordinates back onto the scaled canvas.
  const RENDER_SCALE = Math.min(window.devicePixelRatio || 1, 2);

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: 'game-container',
    width: LOGICAL_WIDTH * RENDER_SCALE,
    height: LOGICAL_HEIGHT * RENDER_SCALE,
    scale: {
      mode: Phaser.Scale.EXPAND,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      autoRound: false,
    },
    dom: {
      createContainer: true,
    },
    backgroundColor: '#070b14',
    scene: [MenuScene, GameScene, TrainingScene, KingdomScene, DailyScene, LeagueScene, CommanderScene],
    render: {
      antialias: true,
      antialiasGL: true,
      roundPixels: true,
      powerPreference: 'high-performance',
    },
    fps: {
      target: 60,
      forceSetTimeOut: false,
    },
    callbacks: {
      // preBoot (not postBoot) because the first scene's create() runs as
      // part of the Game's internal boot/READY sequence, before postBoot
      // fires. Registry values written in postBoot arrive too late for
      // MenuScene.create() to see them.
      preBoot: (bootedGame) => {
        bootedGame.registry.set('platform', platform);
        bootedGame.registry.set('renderScale', RENDER_SCALE);
      },
    },
  };

  const game = new Phaser.Game(config);
  (window as unknown as { __PHASER_GAME__?: Phaser.Game }).__PHASER_GAME__ = game;
};

void platform.initialize()
  .catch((err: unknown) => {
    console.warn('[Platform] Async init warning:', err);
  })
  .finally(() => {
    startApp();
  });
