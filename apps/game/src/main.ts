import { PilotClient } from './realm/PilotClient.js';
import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '@crown-clash/game-core';
import { createPlatformAdapter } from '@crown-clash/platform';
import { AnalyticsSink } from './analytics/AnalyticsSink.js';
import { trackEvent, trackSessionStart } from './analytics/Analytics.js';
import { installClientErrorReporter } from './analytics/ClientErrorReporter.js';
import { getSharedGameApiClient } from './api/sharedClient.js';
import { GameScene } from './scenes/GameScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { createFpsGuard, readRenderTierCap, writeRenderTierCap } from './render/FpsGuard.js';
import { selectRenderProfile } from './render/RenderProfile.js';

// 1. Initialize Platform Adapter (Bale -> Eitaa -> Telegram -> Browser).
// Phaser must not boot before platform init resolves: scenes read the
// platform user in create() and a half-initialized adapter yields an
// unstable guest identity.
const platform = createPlatformAdapter();

const GAME_FONT_SPECS = [
  '700 16px "Vazirmatn"',
  '800 16px "Vazirmatn"',
  '700 16px "Baloo 2"',
  '800 16px "Baloo 2"',
  '400 16px "JetBrains Mono"',
  '700 16px "JetBrains Mono"',
] as const;

/**
 * Phaser rasterizes text into canvas textures once, when each scene creates
 * its text objects, so the bundled faces must be ready before boot. The woff2
 * files are preloaded in parallel with the JS bundle; the timeout keeps a
 * stalled font fetch from blocking boot on very slow networks.
 */
const loadGameFonts = async (): Promise<void> => {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const loads = Promise.all(
    GAME_FONT_SPECS.map((spec) => document.fonts.load(spec).catch(() => undefined))
  );
  const timeout = new Promise<void>((resolve) => {
    setTimeout(resolve, 2500);
  });
  await Promise.race([loads, timeout]);
};

const safeLocalStorage = (): Storage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

/**
 * Samples the frame rate while a battle is on screen and, if the first stretch is clearly slow, stores a
 * lower tier cap so the next launch renders cheaper. Never changes resolution mid-session.
 */
const watchBattleFps = (game: Phaser.Game, tier: 'low' | 'mid' | 'high'): void => {
  const guard = createFpsGuard({
    tier,
    onDowngrade: (from, to, averageFps) => {
      writeRenderTierCap(safeLocalStorage(), to);
      trackEvent({ name: 'render_tier_downgraded', from, to, fps: averageFps });
    },
  });
  if (guard.judged) return;
  const intervalMs = 500;
  const timer = window.setInterval(() => {
    if (guard.judged) {
      window.clearInterval(timer);
      return;
    }
    if (document.visibilityState !== 'visible' || !game.scene.isActive('GameScene')) return;
    guard.sample(game.loop.actualFps, intervalMs / 1000);
  }, intervalMs);
};

const startApp = async (): Promise<void> => {
  platform.ready();
  new PilotClient(platform).captureEntry();

  const api = getSharedGameApiClient();
  const analyticsSink = new AnalyticsSink({
    storageKey: `analytics:${platform.platform}:${platform.getUser().id}`,
    flush: (events) => api.trackEvents(events),
    shouldFlush: () => api.isAuthenticated(),
  });
  analyticsSink.start();
  trackSessionStart();
  installClientErrorReporter(window, {
    getSceneKey: () =>
      (window as unknown as { __PHASER_GAME__?: Phaser.Game }).__PHASER_GAME__?.scene
        .getScenes(true)[0]?.sys.settings.key ?? 'unknown',
  });

  // Render the canvas at a higher internal resolution than the 400x720
  // logical coordinate system to avoid blurriness on high-DPI screens.
  // The camera zoom (set in each scene's create()) maps logical
  // coordinates back onto the scaled canvas.
  // Bale's legacy Android WebGL compositor can stall for seconds while presenting
  // the game canvas. Keep the existing high-DPI WebGL path for capable devices.
  const renderProfile = selectRenderProfile({
    platform: platform.platform,
    devicePixelRatio: window.devicePixelRatio || 1,
    userAgent: navigator.userAgent,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency || undefined,
    tierCap: readRenderTierCap(safeLocalStorage()),
  });
  const RENDER_SCALE = renderProfile.renderScale;

  const config: Phaser.Types.Core.GameConfig = {
    type: renderProfile.renderer === 'canvas' ? Phaser.CANVAS : Phaser.AUTO,
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
    scene: [
      MenuScene,
      GameScene,
    ],
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
        bootedGame.registry.set('reducedEffects', renderProfile.reducedEffects);
        bootedGame.registry.set('renderTier', renderProfile.tier);
        bootedGame.registry.set('assetTier', renderProfile.assetTier);
      },
    },
  };

  const game = new Phaser.Game(config);
  (window as unknown as { __PHASER_GAME__?: Phaser.Game }).__PHASER_GAME__ = game;
  watchBattleFps(game, renderProfile.tier);

  if (
    typeof window !== 'undefined' &&
    window.location?.search &&
    new URLSearchParams(window.location.search).get('debug_performance') === '1'
  ) {
    import('./debug/DebugPerformanceHud.js')
      .then(({ initDebugPerformanceIfEnabled }) => {
        initDebugPerformanceIfEnabled(game);
      })
      .catch((err) => {
        console.warn('[DebugHUD] Failed to load debug HUD:', err);
      });
  }
};

void platform.initialize()
  .catch((err: unknown) => {
    console.warn('[Platform] Async init warning:', err);
  })
  .finally(() => {
    void loadGameFonts().finally(() => {
      void startApp();
    });
  });
