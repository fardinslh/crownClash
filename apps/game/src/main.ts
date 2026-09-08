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
  // The camera zoom (set in each scene's create()) maps logical
  // coordinates back onto the scaled canvas.
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
      // FIT stretches the canvas up to fill whatever parent size it's
      // given, regardless of devicePixelRatio. On a viewport wider than
      // our RENDER_SCALE compensates for (e.g. a desktop window, or a
      // low-DPI screen bigger than a phone), that stretch can exceed the
      // canvas's actual backing-store resolution, upscaling it and
      // producing visible smearing/tiling artifacts. Capping the CSS
      // size to the backing-store size guarantees we only ever scale
      // down, never up, and simply letterboxes on oversized viewports
      // (acceptable for a portrait, mobile-first game).
      max: {
        width: LOGICAL_WIDTH * RENDER_SCALE,
        height: LOGICAL_HEIGHT * RENDER_SCALE,
      },
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

  new Phaser.Game(config);
};

void platform.initialize()
  .catch((err: unknown) => {
    console.warn('[Platform] Async init warning:', err);
  })
  .finally(() => {
    startApp();
  });
