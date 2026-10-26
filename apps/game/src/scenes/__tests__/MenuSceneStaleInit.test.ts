import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state } = vi.hoisted(() => {
  const state = {
    resolveConnect: (() => {}) as () => void,
    getCareer: undefined as unknown as ReturnType<typeof vi.fn>,
    startHubMusic: undefined as unknown as ReturnType<typeof vi.fn>,
    sceneStart: undefined as unknown as ReturnType<typeof vi.fn>,
  };
  return { state };
});

vi.mock('phaser', () => ({
  default: {
    Scene: class {
      registry = new Map<string, unknown>([
        ['platform', { getUser: () => ({ id: 'u1' }), hideBackButton: () => {} }],
      ]);
      events = { once: vi.fn() };
      scene = { start: (...args: unknown[]) => state.sceneStart(...args), isActive: () => true };
    },
    Scenes: { Events: { SHUTDOWN: 'shutdown' } },
  },
}));

vi.mock('@crown-clash/platform', () => ({ createPlatformAdapter: vi.fn() }));
vi.mock('@crown-clash/game-core', () => ({
  getRankTier: vi.fn(() => ({ id: 'bronze' })),
  getCommander: vi.fn(),
  LOGICAL_HEIGHT: 844,
  LOGICAL_WIDTH: 390,
}));
vi.mock('../../audio/SoundEffects.js', () => ({
  sounds: new Proxy({}, { get: (_t, key) => (key === 'startHubMusic' ? state.startHubMusic : vi.fn()) }),
}));
vi.mock('../../career/CareerManager.js', () => ({
  CareerManager: {
    getInstance: () => ({
      connect: () => new Promise<void>((resolve) => (state.resolveConnect = resolve)),
      isRemoteConnected: () => false,
      getCareer: (...args: unknown[]) => state.getCareer(...args),
      isTutorialCompleted: () => true,
    }),
  },
}));
vi.mock('../../api/GameApiClient.js', () => ({ isLocalCareerFallbackAllowed: () => true }));
vi.mock('../../ui/Viewport.js', () => ({
  bindSceneViewportResize: vi.fn(),
  getSceneViewport: vi.fn(),
  setupSceneCamera: vi.fn(),
}));
vi.mock('../../ui/BotDifficultyPicker.js', () => ({ startChosenBotMatch: vi.fn() }));
vi.mock('../../realm/PilotClient.js', () => ({ PilotClient: vi.fn() }));
vi.mock('../../analytics/Analytics.js', () => ({ trackEvent: vi.fn() }));
vi.mock('../../api/LiveMatchClient.js', () => ({ LiveMatchClient: vi.fn() }));
vi.mock('../../pvp/LivePvpController.js', () => ({
  LivePvpController: vi.fn(),
  isValidRoomCode: vi.fn(),
  sanitizeRoomCode: vi.fn(),
}));
vi.mock('../../config/featureFlags.js', () => ({ featureFlags: {} }));
vi.mock('../../ui/StartupLoadingShell.js', () => ({ dismissStartupLoadingShell: vi.fn() }));
vi.mock('../../ui/MenuLayout.js', () => ({ computeMenuLayout: vi.fn(), MENU_NAV_TILE_HEIGHT: 0 }));
vi.mock('../../ui/TextStyles.js', () => ({ createText: vi.fn(), MONO_FONT_FAMILY: 'mono' }));
vi.mock('../../ui/icons.js', () => ({ commanderIcon: vi.fn(), createIcon: vi.fn(), rankIcon: vi.fn() }));
vi.mock('../../ui/kit/index.js', () => ({
  bindPressFeedback: vi.fn(),
  createButton: vi.fn(),
  createGlow: vi.fn(),
  createIconButton: vi.fn(),
  createRays: vi.fn(),
  drawPanel: vi.fn(),
  fadeIn: vi.fn(),
  goToScene: vi.fn(),
}));
vi.mock('../../i18n/fa.js', () => ({ commanderCopy: vi.fn(), fa: {}, rankName: vi.fn() }));
vi.mock('../../tutorial/TutorialStatus.js', () => ({
  resolveMenuEntryAction: vi.fn(() => 'menu'),
  resolvePlayEntryAction: vi.fn(),
  resolvePvpEntryAction: vi.fn(),
}));
vi.mock('../../theme.js', () => ({ THEME: {}, UI: {} }));

import { MenuScene } from '../MenuScene.js';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('MenuScene async init', () => {
  beforeEach(() => {
    state.getCareer = vi.fn(() => {
      throw new Error('init continued after the scene was stopped');
    });
    state.startHubMusic = vi.fn();
    state.sceneStart = vi.fn();
  });

  it('does not keep initializing (or start hub music) after the scene shut down', async () => {
    const scene = new MenuScene();
    scene.create();
    scene.shutdown();

    state.resolveConnect();
    await flush();

    expect(state.getCareer).not.toHaveBeenCalled();
    expect(state.startHubMusic).not.toHaveBeenCalled();
    expect(state.sceneStart).not.toHaveBeenCalled();
  });

  it('ignores a stale init when the scene was re-created before connect resolved', async () => {
    const scene = new MenuScene();
    scene.create();
    const resolveFirst = state.resolveConnect;
    scene.shutdown();
    scene.create();

    resolveFirst();
    await flush();

    expect(state.getCareer).not.toHaveBeenCalled();
  });
});
