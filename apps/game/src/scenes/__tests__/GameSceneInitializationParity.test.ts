import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { TRAINING_REQUEST_TIMEOUT_MS } from '../../tutorial/trainingRequest.js';

const { chooseBotDifficultyMock } = vi.hoisted(() => ({ chooseBotDifficultyMock: vi.fn().mockResolvedValue('normal') }));
vi.mock('../../ui/BotDifficultyPicker.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../ui/BotDifficultyPicker.js')>(),
  chooseBotDifficulty: chooseBotDifficultyMock,
}));

const { MockScene, MockGameObject, MockGraphics, MockContainer, storage } = vi.hoisted(() => {
  const storage = new Map<string, string>();
  const localStorageMock: any = {
    get length() {
      return storage.size;
    },
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  };

  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: localStorageMock,
      matchMedia: () => ({ matches: false }),
      dispatchEvent: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
      location: { hostname: '127.0.0.1', protocol: 'http:', search: '' },
    },
    configurable: true,
  });

  class MockGameObject {
    x: number = 0;
    y: number = 0;
    width: number = 0;
    height: number = 0;
    alpha: number = 1;
    scaleX: number = 1;
    scaleY: number = 1;
    depth: number = 0;
    text: string = '';
    color: string = '';
    fillColor: number = 0;
    strokeColor: number = 0;
    originX: number = 0;
    originY: number = 0;
    parentContainer: MockContainer | null = null;
    interactive: boolean = false;
    destroyed: boolean = false;
    visible: boolean = true;
    active: boolean = true;
    texture = { key: '' };
    _listeners = new Map<string, Set<Function>>();

    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
    }

    setVisible(v: boolean) { this.visible = v; return this; }
    setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
    setX(x: number) { this.x = x; return this; }
    setY(y: number) { this.y = y; return this; }
    setSize(w: number, h: number) { this.width = w; this.height = h; return this; }
    setRadius(r: number) { this.width = r * 2; this.height = r * 2; return this; }
    setDisplaySize(_w: number, _h: number) { return this; }
    setText(t: string) { this.text = t; return this; }
    setWordWrapWidth(_width: number) { return this; }
    setColor(c: string) { this.color = c; return this; }
    setOrigin(x = 0.5, y = x) { this.originX = x; this.originY = y; return this; }
    setStrokeStyle(_thickness: number, color: number, _alpha = 1) { this.strokeColor = color; return this; }
    setFillStyle(color: number, _alpha = 1) { this.fillColor = color; return this; }
    setDepth(d: number) { this.depth = d; return this; }
    setAlpha(a: number) { this.alpha = a; return this; }
    setScale(x = 1, y = x) { this.scaleX = x; this.scaleY = y; return this; }
    setFlipX(_flip?: boolean) { return this; }
    setRotation(_r?: number) { return this; }
    setTexture(key: string) { this.texture.key = key; return this; }
    setInteractive() { this.interactive = true; return this; }
    disableInteractive() { this.interactive = false; return this; }
    on(event: string, fn: Function) {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event)!.add(fn);
      return this;
    }
    off(event: string, fn: Function) {
      this._listeners.get(event)?.delete(fn);
      return this;
    }
    emit(event: string, ...args: any[]) {
      this._listeners.get(event)?.forEach((fn) => fn(...args));
    }
    destroy() { this.destroyed = true; this.active = false; }
  }

  class MockContainer extends MockGameObject {
    list: MockGameObject[] = [];
    add(child: MockGameObject | MockGameObject[]) {
      const items = Array.isArray(child) ? child : [child];
      for (const item of items) {
        item.parentContainer = this;
        this.list.push(item);
      }
      return this;
    }
  }

  class MockGraphics extends MockGameObject {
    clear() { return this; }
    lineStyle() { return this; }
    fillStyle() { return this; }
    beginPath() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    strokePath() { return this; }
    fillPath() { return this; }
    closePath() { return this; }
    stroke() { return this; }
    arc() { return this; }
    lineBetween() { return this; }
    fillRoundedRect() { return this; }
    strokeRoundedRect() { return this; }
    fillCircle() { return this; }
    strokeCircle() { return this; }
    fillEllipse() { return this; }
    strokeEllipse() { return this; }
    fillTriangle() { return this; }
    strokeRect() { return this; }
    fillRect() { return this; }
  }

  class MockScene {
    events = {
      _listeners: new Map<string, Set<Function>>(),
      once(event: string, fn: Function) {
        const wrapper = (...args: any[]) => {
          this.off(event, wrapper);
          fn(...args);
        };
        this.on(event, wrapper);
      },
      on(event: string, fn: Function) {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event)!.add(fn);
      },
      off(event: string, fn: Function) {
        this._listeners.get(event)?.delete(fn);
      },
      emit(event: string, ...args: any[]) {
        this._listeners.get(event)?.forEach((fn) => fn(...args));
      },
    };
    registry = {
      data: new Map<string, any>(),
      get(k: string) { return this.data.get(k); },
      set(k: string, v: any) { this.data.set(k, v); },
    };
    cameras = {
      main: {
        setZoom: () => {},
        centerOn: () => {},
        shake: () => {},
        flash: () => {},
      },
    };
    scale = {
      gameSize: { width: 400, height: 720 },
      width: 400,
      height: 720,
      _listeners: new Map<string, Set<Function>>(),
      on(event: string, fn: Function) {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event)!.add(fn);
      },
      off(event: string, fn: Function) {
        this._listeners.get(event)?.delete(fn);
      },
      emit(event: string, ...args: any[]) {
        this._listeners.get(event)?.forEach((fn) => fn(...args));
      },
      listenerCount(event: string) {
        return this._listeners.get(event)?.size ?? 0;
      },
    };
    children = {
      list: [] as MockGameObject[],
      add(obj: MockGameObject) { this.list.push(obj); },
    };
    add = {
      rectangle: (x: number, y: number, w: number, h: number, color?: number, alpha?: number) => {
        const obj = new MockGameObject(x, y, w, h);
        if (color !== undefined) obj.fillColor = color;
        if (alpha !== undefined) obj.alpha = alpha;
        this.children.add(obj);
        return obj;
      },
      text: (x: number, y: number, text: string) => {
        const obj = new MockGameObject(x, y, 60, 20);
        obj.text = text;
        this.children.add(obj);
        return obj;
      },
      circle: (x: number, y: number, radius: number, color?: number, alpha?: number) => {
        const obj = new MockGameObject(x, y, radius * 2, radius * 2);
        if (color !== undefined) obj.fillColor = color;
        if (alpha !== undefined) obj.alpha = alpha;
        this.children.add(obj);
        return obj;
      },
      arc: (x: number, y: number, radius = 0, _s = 0, _e = 360, _a = false, color?: number, alpha?: number) => {
        const obj = new MockGameObject(x, y, radius * 2, radius * 2);
        if (color !== undefined) obj.fillColor = color;
        if (alpha !== undefined) obj.alpha = alpha;
        this.children.add(obj);
        return obj;
      },
      ellipse: (x: number, y: number, w: number, h: number, color?: number, alpha?: number) => {
        const obj = new MockGameObject(x, y, w, h);
        if (color !== undefined) obj.fillColor = color;
        if (alpha !== undefined) obj.alpha = alpha;
        this.children.add(obj);
        return obj;
      },
      zone: (x: number, y: number, w: number, h: number) => {
        const obj = new MockGameObject(x, y, w, h);
        this.children.add(obj);
        return obj;
      },
      image: (x: number, y: number, key?: string) => {
        const obj = new MockGameObject(x, y);
        obj.texture.key = key ?? '';
        this.children.add(obj);
        return obj;
      },
      graphics: () => {
        const obj = new MockGraphics();
        this.children.add(obj);
        return obj;
      },
      container: (x = 0, y = 0) => {
        const obj = new MockContainer(x, y);
        this.children.add(obj);
        return obj;
      },
    };
    tweens = {
      add: (config?: any) => {
        if (config?.targets && typeof config.y === 'number') {
          const targets = Array.isArray(config.targets) ? config.targets : [config.targets];
          targets.forEach((t: any) => t.setY?.(config.y));
        }
        return { stop: () => {}, remove: () => {} };
      },
      killTweensOf: () => {},
      killAll: () => {},
    };
    time = {
      delayedCall: () => ({ destroy: () => {} }),
      removeAllEvents: () => {},
    };
    input = {
      removeAllListeners: () => {},
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    };
    scene = {
      start: vi.fn(),
      restart: vi.fn(),
      isActive: vi.fn(() => true),
      key: 'GameScene',
      settings: {
        data: {
          mode: 'bot',
          botMatch: { matchId: 'bot_test_parity', battlefieldId: 'crown_cross' },
        },
      },
    };
  }

  return { MockScene, MockGameObject, MockGraphics, MockContainer, storage };
});

vi.mock('phaser', () => ({
  default: {
    Scene: MockScene,
    Math: {
      Vector2: class { x = 0; y = 0; set(x: number, y: number) { this.x = x; this.y = y; return this; } },
      Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
      Angle: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1) },
      Clamp: (v: number, min: number, max: number) => Math.min(Math.max(v, min), max),
      Linear: (p1: number, p2: number, t: number) => p1 + (p2 - p1) * t,
    },
    Scenes: { Events: { SHUTDOWN: 'shutdown', DESTROY: 'destroy' } },
    GameObjects: {
      Rectangle: MockGameObject,
      Text: MockGameObject,
      Graphics: MockGraphics,
      Container: MockContainer,
    },
  },
}));

vi.mock('../../analytics/Analytics.js', () => ({
  trackEvent: vi.fn(),
  trackTerminalMatchEvent: vi.fn(),
}));

vi.mock('../../audio/SoundEffects.js', () => ({
  sounds: new Proxy({}, { get: () => () => false }),
}));

import { PilotClient } from '../../realm/PilotClient.js';
import { GameScene } from '../GameScene.js';
import { END_BEAT_MS } from '../../match/EndBeat.js';
import { CareerManager } from '../../career/CareerManager.js';
import { BrowserPlatformAdapter } from '@crown-clash/platform';
import {
  createDefaultCareer,
  settleMatch,
  type BotMatchTicket,
  type MatchSettlement,
  type PlayerCareer,
} from '@crown-clash/game-core';
import type { CareerApi } from '../../api/GameApiClient.js';
import { trackEvent, trackTerminalMatchEvent } from '../../analytics/Analytics.js';
import {
  isStartupLoadingShellDismissed,
  LOADING_SHELL_ID,
  resetStartupLoadingShellStateForTesting,
} from '../../ui/StartupLoadingShell.js';

/**
 * Deterministically drains pending microtasks (promise continuations) without
 * relying on real timers, so assertions about whether a response has or has
 * not been applied cannot race the test runner.
 */
async function flushMicrotasks(times = 25): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe('GameScene Initialization Parity & Late-Response Guards', () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    (CareerManager as any).instance = null;
  });

  it('Finding 1: Delayed login response never resets troops produced during an advancing match', async () => {
    const platform = new BrowserPlatformAdapter();
    const platformUserId = platform.getUser().id;

    let resolveConnect!: (career: PlayerCareer) => void;
    const connectPromise = new Promise<PlayerCareer>((res) => {
      resolveConnect = res;
    });

    const fakeApi: CareerApi = {
      login: async () => connectPromise,
      completeTutorial: async () => connectPromise,
      getCareer: async () => createDefaultCareer(platformUserId),
      getLedger: async () => [],
      startBotMatch: async () => ({ matchId: 'bot_delayed_test', battlefieldId: 'crown_cross' }),
      settleMatch: async () => { throw new Error('not_used'); },
      purchaseUpgrade: async () => { throw new Error('not_used'); },
      selectCommander: async () => { throw new Error('not_used'); },
      getDailyState: async () => { throw new Error('not_used'); },
      claimDailyReward: async () => { throw new Error('not_used'); },
      getLeagueState: async () => { throw new Error('not_used'); },
      claimLeagueReward: async () => { throw new Error('not_used'); },
      trackEvents: async () => undefined,
      openLiveMatch: () => { throw new Error('not_used'); },
      isAuthenticated: () => false,
    };

    const manager = CareerManager.getInstance(platformUserId);
    // Connect is in-flight; keep the handle so the continuation can be
    // awaited deterministically after the delayed response resolves.
    const connectDone = manager.connect(platform, fakeApi);

    const scene = new GameScene();
    scene.registry.set('platform', platform);
    scene.scene.settings.data = {
      mode: 'bot',
      botMatch: { matchId: 'bot_delayed_test', battlefieldId: 'crown_cross' },
    };
    scene.create();
    (scene as any).introHolding = false; // skip the 3-2-1 countdown (timers are mocked)

    const pBase = (scene as any).gameState.territories['p_base'];
    expect(pBase.units).toBe(20);

    // Advance match simulation by 5 seconds (250 ticks @ 20ms)
    // At 1.2 units/second, p_base produces 6 units -> 26 units
    for (let i = 0; i < 250; i++) {
      scene.update(i * 20, 20);
    }

    expect((scene as any).gameState.territories['p_base'].units).toBe(26);

    // Delayed authoritative login completes with unchanged starting units (20)
    resolveConnect(createDefaultCareer(platformUserId));
    // Awaiting the connect promise guarantees the career apply + listener
    // notification completed before the assertions: if a late-sync reset
    // returned, it would already have happened here.
    await connectDone;

    // Critical assertion: p_base troops MUST NOT be reset back to 20!
    expect((scene as any).gameState.territories['p_base'].units).toBe(26);
  });

  it('Finding 2: Startup waits for delayed login and initializes authoritative production rate over stale cache', async () => {
    const platform = new BrowserPlatformAdapter();
    const platformUserId = platform.getUser().id;

    // 1. Start with stale cached production in local storage (level 0 -> prod multiplier 1.0 -> 1.2 units/s)
    const staleCareer: PlayerCareer = {
      ...createDefaultCareer(platformUserId),
      startingGarrisonLevel: 0,
      productionLevel: 0,
      armySpeedLevel: 0,
      selectedCommanderId: 'crown_guard',
    };
    storage.set(`crown_clash_career_${platformUserId}`, JSON.stringify(staleCareer));

    let resolveLogin!: (career: PlayerCareer) => void;
    const loginPromise = new Promise<PlayerCareer>((res) => {
      resolveLogin = res;
    });

    const fakeApi: CareerApi = {
      login: async () => loginPromise,
      completeTutorial: async () => loginPromise,
      getCareer: async () => createDefaultCareer(platformUserId),
      getLedger: async () => [],
      startBotMatch: async () => ({ matchId: 'bot_prod_auth_ticket', battlefieldId: 'crown_cross' }),
      settleMatch: async () => { throw new Error('not_used'); },
      purchaseUpgrade: async () => { throw new Error('not_used'); },
      selectCommander: async () => { throw new Error('not_used'); },
      getDailyState: async () => { throw new Error('not_used'); },
      claimDailyReward: async () => { throw new Error('not_used'); },
      getLeagueState: async () => { throw new Error('not_used'); },
      claimLeagueReward: async () => { throw new Error('not_used'); },
      trackEvents: async () => undefined,
      openLiveMatch: () => { throw new Error('not_used'); },
      isAuthenticated: () => false,
    };

    const manager = CareerManager.getInstance(platformUserId);
    void manager.connect(platform, fakeApi);

    // Exercise real startup method
    let ticketResolved = false;
    const ticketPromise = manager.startBotMatch(platform).then((ticket) => {
      ticketResolved = true;
      return ticket;
    });

    // Deterministically drain microtasks: startBotMatch reaches its await on
    // the pending login and cannot resolve until the login is released. No
    // real-timer sleep is needed.
    await flushMicrotasks();

    // Assert that bot startup WAITS for login to finish before issuing the ticket
    expect(ticketResolved).toBe(false);

    // Resolve login returning authoritative career differing ONLY in production (level 5 -> 1.4 multiplier -> 1.68 units/s)
    const authoritativeCareer: PlayerCareer = {
      ...createDefaultCareer(platformUserId),
      startingGarrisonLevel: 0,
      productionLevel: 5,
      armySpeedLevel: 0,
      selectedCommanderId: 'crown_guard',
    };
    resolveLogin(authoritativeCareer);

    // Ticket now resolves via real startup flow
    const ticket = await ticketPromise;
    expect(ticketResolved).toBe(true);
    expect(ticket.matchId).toBe('bot_prod_auth_ticket');

    // Create GameScene with the real ticket
    const scene = new GameScene();
    scene.registry.set('platform', platform);
    scene.scene.settings.data = {
      mode: 'bot',
      botMatch: ticket,
    };
    scene.create();

    const pBase = (scene as any).gameState.territories['p_base'];
    expect(pBase.units).toBe(20);
    expect((scene as any).playerArmySpeedMultiplier).toBe(1.0);
    // Baseline 1.2 * 1.4 = 1.68, NOT the stale 1.2
    expect(pBase.productionRate).toBeCloseTo(1.68, 4);
    expect(pBase.productionRate).not.toBeCloseTo(1.2, 4);

    // Verify flawed late-sync method has been removed from GameScene
    expect((scene as any).syncMatchStateWithAuthoritativeCareer).toBeUndefined();
  });

  it('Finding 3: an older match settlement response cannot mutate a newer running match', async () => {
    const platform = new BrowserPlatformAdapter();
    const platformUserId = platform.getUser().id;

    // Match 1's settlement response is held in flight so it can be released
    // only after match 2 is already running: the real production vehicle for
    // a late career response (recordMatchResultRemote -> applyRemoteState ->
    // listener notification).
    let resolveSettlement!: (settlement: MatchSettlement) => void;
    const settlementInFlight = new Promise<MatchSettlement>((res) => {
      resolveSettlement = res;
    });

    let matchCount = 0;
    const fakeApi: CareerApi = {
      login: async () => createDefaultCareer(platformUserId),
      completeTutorial: async () => createDefaultCareer(platformUserId),
      getCareer: async () => createDefaultCareer(platformUserId),
      getLedger: async () => [],
      startBotMatch: async () => {
        matchCount++;
        return { matchId: `bot_real_ticket_${matchCount}`, battlefieldId: 'crown_cross' };
      },
      settleMatch: async () => settlementInFlight,
      purchaseUpgrade: async () => { throw new Error('not_used'); },
      selectCommander: async () => { throw new Error('not_used'); },
      getDailyState: async () => { throw new Error('not_used'); },
      claimDailyReward: async () => { throw new Error('not_used'); },
      getLeagueState: async () => { throw new Error('not_used'); },
      claimLeagueReward: async () => { throw new Error('not_used'); },
      trackEvents: async () => undefined,
      openLiveMatch: () => { throw new Error('not_used'); },
      isAuthenticated: () => false,
    };

    const manager = CareerManager.getInstance(platformUserId);
    await manager.connect(platform, fakeApi);

    // Match 1 via the real startup path.
    const ticket1 = await manager.startBotMatch(platform);
    expect(ticket1.matchId).toBe('bot_real_ticket_1');

    const scene1 = new GameScene();
    scene1.registry.set('platform', platform);
    scene1.scene.settings.data = {
      mode: 'bot',
      botMatch: ticket1,
    };
    scene1.create();

    // Scene 1 advances simulation
    for (let i = 0; i < 25; i++) {
      scene1.update(i * 20, 20);
    }
    const scene1Units = (scene1 as any).gameState.territories['p_base'].units;

    // Match 1 settles server-side; the response is still in flight.
    const settlementDone = manager.recordMatchResultRemote([], ticket1.matchId, platform, 'defeat');

    // Scene 1 shuts down while its settlement response is pending.
    scene1.events.emit('shutdown');

    // Newer match (scene 2) via the real startup path.
    const ticket2 = await manager.startBotMatch(platform);
    expect(ticket2.matchId).toBe('bot_real_ticket_2');

    const scene2 = new GameScene();
    scene2.registry.set('platform', platform);
    scene2.scene.settings.data = {
      mode: 'bot',
      botMatch: ticket2,
    };
    scene2.create();

    // Scene 2 advances simulation by 50 ticks (1s)
    for (let i = 0; i < 50; i++) {
      scene2.update(i * 20, 20);
    }

    const scene2UnitsBefore = (scene2 as any).gameState.territories['p_base'].units;
    const scene2ProdRateBefore = (scene2 as any).gameState.territories['p_base'].productionRate;
    const scene2SpeedBefore = (scene2 as any).playerArmySpeedMultiplier;
    const scene2ElapsedBefore = (scene2 as any).gameState.elapsedTimeSeconds;

    // The OLDER settlement response now arrives, carrying career progression
    // that differs from match 2's initialization.
    const staleCareer: PlayerCareer = {
      ...createDefaultCareer(platformUserId),
      startingGarrisonLevel: 8,
      productionLevel: 6,
      armySpeedLevel: 5,
    };
    resolveSettlement(
      settleMatch(staleCareer, 'defeat', {
        matchDurationSeconds: 42,
        playerUnitsDispatched: 12,
        enemyUnitsDispatched: 9,
        territoriesCapturedByPlayer: 1,
        territoriesCapturedByEnemy: 2,
      }, ticket1.matchId)
    );
    // Awaiting the real settlement promise guarantees applyRemoteState and the
    // listener notification completed: any mutation they cause has happened.
    await settlementDone;

    // Server authority is preserved: the manager applied the older response.
    expect(manager.getCareer().startingGarrisonLevel).toBe(8);

    // Newer match (scene2) must remain completely unchanged: career responses
    // may only touch the career manager and HUD, never match simulation.
    expect((scene2 as any).gameState.territories['p_base'].units).toBe(scene2UnitsBefore);
    expect((scene2 as any).gameState.territories['p_base'].productionRate).toBe(scene2ProdRateBefore);
    expect((scene2 as any).playerArmySpeedMultiplier).toBe(scene2SpeedBefore);
    expect((scene2 as any).gameState.elapsedTimeSeconds).toBe(scene2ElapsedBefore);

    // The already-shut-down scene must also remain unchanged.
    expect((scene1 as any).gameState.territories['p_base'].units).toBe(scene1Units);
  });

  it('Scenario 4: Retaining connected CareerManager initializes complete match from authoritative career before simulation starts', async () => {
    const platform = new BrowserPlatformAdapter();
    const platformUserId = platform.getUser().id;

    const authoritativeCareer: PlayerCareer = {
      ...createDefaultCareer('server_uuid_999'),
      startingGarrisonLevel: 3, // 20 + 3 * 3 = 29 units
      productionLevel: 2,       // 1 + 2 * 0.08 = 1.16 multiplier
      armySpeedLevel: 1,        // 1 + 1 * 0.06 = 1.06 multiplier
      selectedCommanderId: 'quartermaster', // +15% prod (1.16 * 1.15 = 1.334), -10% speed (1.06 * 0.9 = 0.954)
    };

    const fakeApi: CareerApi = {
      login: async () => authoritativeCareer,
      completeTutorial: async () => authoritativeCareer,
      getCareer: async () => authoritativeCareer,
      getLedger: async () => [],
      startBotMatch: async () => ({ matchId: 'bot_auth_test', battlefieldId: 'crown_cross' }),
      settleMatch: async () => { throw new Error('not_used'); },
      purchaseUpgrade: async () => { throw new Error('not_used'); },
      selectCommander: async () => { throw new Error('not_used'); },
      getDailyState: async () => { throw new Error('not_used'); },
      claimDailyReward: async () => { throw new Error('not_used'); },
      getLeagueState: async () => { throw new Error('not_used'); },
      claimLeagueReward: async () => { throw new Error('not_used'); },
      trackEvents: async () => undefined,
      openLiveMatch: () => { throw new Error('not_used'); },
      isAuthenticated: () => true,
    };

    // MenuScene connects
    const menuManager = CareerManager.getInstance(platformUserId);
    await menuManager.connect(platform, fakeApi);
    expect(menuManager.isRemoteConnected()).toBe(true);

    // Ticket issued and GameScene created
    const ticket = await menuManager.startBotMatch(platform);

    const scene = new GameScene();
    scene.registry.set('platform', platform);
    scene.scene.settings.data = {
      mode: 'bot',
      botMatch: ticket,
    };
    scene.create();
    (scene as any).introHolding = false; // skip the 3-2-1 countdown (timers are mocked)

    // Verification: Match is initialized cleanly from authoritative career before simulation/input
    expect((scene as any).careerManager.isRemoteConnected()).toBe(true);
    expect((scene as any).gameState.territories['p_base'].units).toBe(29);
    expect((scene as any).gameState.territories['p_base'].productionRate).toBeCloseTo(1.2 * 1.334, 4);
    expect((scene as any).playerArmySpeedMultiplier).toBeCloseTo(0.954, 4);

    // Ticking simulation advances production from the authoritative baseline
    for (let i = 0; i < 50; i++) {
      scene.update(i * 20, 20); // 1 second (50 ticks @ 20ms)
    }
    expect((scene as any).gameState.territories['p_base'].units).toBeGreaterThanOrEqual(30);
  });
});

// ---------------------------------------------------------------------------
// First-launch training integration (review findings 1-3)
// ---------------------------------------------------------------------------

describe('First-launch training integration', () => {
  let shellStub: { remove: ReturnType<typeof vi.fn>; style: Record<string, string>; classList: { add: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    // The node environment has no window, so BrowserPlatformAdapter falls
    // back to the stable 'server_guest' id — every test in this describe
    // must start from clean per-player storage.
    storage.clear();
    vi.clearAllMocks();
    (CareerManager as any).instance = null;
    resetStartupLoadingShellStateForTesting();
    shellStub = {
      remove: vi.fn(),
      style: {},
      classList: { add: vi.fn() },
    };
    (globalThis as any).document = {
      getElementById: (id: string) => (id === LOADING_SHELL_ID ? shellStub : null),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).document;
  });

  const makeTrainingApi = (behavior: {
    completeTutorial: () => Promise<PlayerCareer>;
    startBotMatch?: () => Promise<BotMatchTicket>;
  }): CareerApi => ({
    login: async () => ({ ...createDefaultCareer('training_player'), tutorialCompleted: false }),
    completeTutorial: behavior.completeTutorial,
    getCareer: async () => createDefaultCareer('training_player'),
    getLedger: async () => [],
    startBotMatch:
      behavior.startBotMatch ??
      (async () => ({ matchId: 'bot_after_training', battlefieldId: 'crown_cross' } satisfies BotMatchTicket)),
    settleMatch: async () => { throw new Error('settlement_must_not_run_in_training'); },
    purchaseUpgrade: async () => { throw new Error('not_used'); },
    selectCommander: async () => { throw new Error('not_used'); },
    getDailyState: async () => { throw new Error('not_used'); },
    claimDailyReward: async () => { throw new Error('not_used'); },
    getLeagueState: async () => { throw new Error('not_used'); },
    claimLeagueReward: async () => { throw new Error('not_used'); },
    trackEvents: async () => undefined,
    openLiveMatch: () => { throw new Error('not_used'); },
    isAuthenticated: () => true,
  });

  async function bootTrainingScene(
    api: CareerApi,
    platformId?: string
  ): Promise<GameScene> {
    const platform = new BrowserPlatformAdapter();
    const manager = CareerManager.getInstance(platformId ?? platform.getUser().id);
    await manager.connect(platform, api);
    const scene = new GameScene();
    scene.registry.set('platform', platform);
    scene.scene.settings.data = { source: 'menu', mode: 'bot', training: true };
    scene.create();
    return scene;
  }

  /** Performs the five guided actions through the real controller hooks. */
  function performGuidedActions(scene: GameScene): void {
    const controller = (scene as any).trainingController;
    controller.onDispatch(['p_base'], 'n_bot_left');
    controller.onPreviewShown();
    controller.onTimerTick(2.6);
    controller.onCapture('n_bot_left', true);
    controller.onTimerTick(1.6);
    controller.onReinforcement();
    controller.onCapture('e_base', true);
  }

  const trackedNames = (): string[] =>
    (trackEvent as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[0] as { name: string }).name
    );

  it('first launch: the startup shell is dismissed once the training scene is ready, and training is interactive', async () => {
    const api = makeTrainingApi({ completeTutorial: async () => createDefaultCareer('training_player') });
    const scene = await bootTrainingScene(api);

    // The DOM shell (z-index 10000, touch-capturing) must be gone once the
    // training scene finished constructing.
    expect(isStartupLoadingShellDismissed()).toBe(true);
    expect(shellStub.remove).toHaveBeenCalledTimes(1);

    // The training scene is ready for input: the guided controller sits on
    // its first step, the overlay renders it, the spotlights mark the
    // guided towers, and the scene's pointer listeners are attached.
    expect((scene as any).trainingMode).toBe(true);
    const controller = (scene as any).trainingController;
    expect(controller.currentStepId).toBe('drag_to_attack');
    expect(controller.isActive).toBe(true);
    const overlay = (scene as any).trainingOverlay;
    expect(overlay).toBeDefined();
    expect(overlay.isSpotlightActive).toBe(true);
    expect((scene as any).input.on).toHaveBeenCalled();
    // Step pips sit INLINE at the strip's right end and must stay fully
    // INSIDE the panel bounds (they previously spilled past the strip).
    const panelLeft = overlay.panel.x - overlay.panel.width / 2;
    const panelRight = overlay.panel.x + overlay.panel.width / 2;
    for (const pip of overlay.pips) {
      expect(pip.x - pip.width / 2).toBeGreaterThanOrEqual(panelLeft);
      expect(pip.x + pip.width / 2).toBeLessThanOrEqual(panelRight);
      expect(pip.y).toBe(overlay.panel.y);
    }
    // No shell element remains in the DOM to swallow the canvas touches.
    expect((globalThis as any).document.getElementById('loading-shell')).toBe(shellStub);
    expect(shellStub.style.display).toBe('none');
    expect(shellStub.style.pointerEvents).toBe('none');
  });

  it('completion save: failure keeps the actions-complete state, retry succeeds exactly once, and no settlement runs', async () => {
    let saveAttempts = 0;
    const api = makeTrainingApi({
      completeTutorial: () => {
        saveAttempts += 1;
        if (saveAttempts === 1) return Promise.reject(new Error('network_down'));
        return Promise.resolve({
          ...createDefaultCareer('training_player'),
          tutorialCompleted: true,
        });
      },
    });
    const platform = new BrowserPlatformAdapter();
    const playerId = platform.getUser().id;
    const scene = await bootTrainingScene(api, playerId);

    performGuidedActions(scene);
    await flushMicrotasks();

    // Save failed: the five performed actions are persisted as the
    // actions-complete sentinel so nothing is repeated, and the completion
    // analytics has NOT fired yet.
    expect(saveAttempts).toBe(1);
    expect(storage.get(`crown_clash_training_progress_${playerId}`)).toBe('5');
    expect(trackedNames()).not.toContain('tutorial_completed');
    // The fail-closed retry affordance is on screen.
    expect((scene as any).trainingOverlay.retryButton).toBeDefined();

    // RETRY: the same save flow re-runs without re-performing actions.
    (scene as any).handleTrainingCompleted();
    await flushMicrotasks();

    expect(saveAttempts).toBe(2);
    expect(storage.has(`crown_clash_training_progress_${playerId}`)).toBe(false);
    // Exactly-once completion analytics across the failed + retry path.
    expect(trackedNames().filter((name) => name === 'tutorial_completed')).toHaveLength(1);
    expect(trackedNames().filter((name) => name === 'tutorial_step_completed')).toHaveLength(5);
    // The first real match starts from the confirmed server write.
    expect((scene as any).scene.start).toHaveBeenCalledWith('GameScene', {
      source: 'menu',
      botMatch: { matchId: 'bot_after_training', battlefieldId: 'crown_cross' },
    });
    // Training never settles and never rewards.
    expect(trackedNames()).not.toContain('match_end');
    expect(trackedNames()).not.toContain('match_reward_received');
    expect(trackedNames()).not.toContain('reward_granted');
  });

  it('unanswered completion is bounded, preserves performed actions, and offers a working retry', async () => {
    vi.useFakeTimers();
    let finishLate!: (career: PlayerCareer) => void;
    const completed = { ...createDefaultCareer('training_player'), tutorialCompleted: true };
    const completeTutorial = vi.fn()
      .mockImplementationOnce(() => new Promise<PlayerCareer>(resolve => { finishLate = resolve; }))
      .mockResolvedValue(completed);
    const startBotMatch = vi.fn().mockResolvedValue({ matchId: 'bot_after_training', battlefieldId: 'crown_cross' });
    const scene = await bootTrainingScene(makeTrainingApi({ completeTutorial, startBotMatch }));
    const s = scene as any;
    const key = `crown_clash_training_progress_${s.platform.getUser().id}`;
    performGuidedActions(scene);
    await flushMicrotasks();
    expect(storage.get(key)).toBe('5');
    expect(s.trainingOverlay.celebrationSubtitle.text).toContain('در حال ذخیره');
    await vi.advanceTimersByTimeAsync(TRAINING_REQUEST_TIMEOUT_MS - 1);
    expect(s.trainingCompletionPending).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.trainingCompletionPending).toBe(false);
    expect(s.trainingOverlay.retryButton.interactive).toBe(true);
    expect(s.careerManager.getCareer().tutorialCompleted).toBe(false);
    expect(startBotMatch).not.toHaveBeenCalled();
    expect(trackedNames()).not.toContain('tutorial_completed');
    const step = vi.spyOn(s, 'stepBotMatch');
    scene.update(16_000, 1000);
    expect(step).not.toHaveBeenCalled();
    expect(s.trainingOverlay.retryButton.interactive).toBe(true);

    // An old response may update authoritative career state, but cannot
    // navigate, clear resume progress or emit completion for an expired UI attempt.
    finishLate(completed);
    await flushMicrotasks();
    expect(storage.get(key)).toBe('5');
    expect(startBotMatch).not.toHaveBeenCalled();
    expect(trackedNames()).not.toContain('tutorial_completed');
    s.trainingOverlay.retryButton.emit('pointerdown');
    await flushMicrotasks();
    expect(completeTutorial).toHaveBeenCalledTimes(2);
    expect(startBotMatch).toHaveBeenCalledTimes(1);
    expect(storage.has(key)).toBe(false);
    expect(trackedNames().filter(name => name === 'tutorial_completed')).toHaveLength(1);
    expect(s.scene.start).toHaveBeenCalledWith('GameScene', {
      source: 'menu', botMatch: { matchId: 'bot_after_training', battlefieldId: 'crown_cross' },
    });
  });

  it('the first bot match after training starts on Easy without a difficulty picker', async () => {
    const startBotMatch = vi.fn().mockResolvedValue({ matchId: 'first_easy', battlefieldId: 'crown_cross', botDifficulty: 'easy' });
    const scene = await bootTrainingScene(makeTrainingApi({
      completeTutorial: async () => ({ ...createDefaultCareer('training_player'), tutorialCompleted: true }),
      startBotMatch,
    }));
    performGuidedActions(scene);
    await flushMicrotasks();
    expect(chooseBotDifficultyMock).not.toHaveBeenCalled();
    expect(startBotMatch).toHaveBeenCalledExactlyOnceWith('easy');
    expect((scene as any).scene.start).toHaveBeenCalledWith('GameScene', {
      source: 'menu', botMatch: { matchId: 'first_easy', battlefieldId: 'crown_cross', botDifficulty: 'easy' },
    });
  });

  it('unanswered first match returns to the menu with server-confirmed training intact', async () => {
    vi.useFakeTimers();
    const scene = await bootTrainingScene(makeTrainingApi({
      completeTutorial: async () => ({ ...createDefaultCareer('training_player'), tutorialCompleted: true }),
      startBotMatch: () => new Promise(() => {}),
    }));
    const s = scene as any;
    performGuidedActions(scene);
    await flushMicrotasks();
    expect(s.trainingOverlay.celebrationSubtitle.text).toContain('نبرد اول');
    expect(s.careerManager.getCareer().tutorialCompleted).toBe(true);
    expect(trackedNames().filter(name => name === 'tutorial_completed')).toHaveLength(1);
    expect(s.scene.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(TRAINING_REQUEST_TIMEOUT_MS);
    expect(s.scene.start).toHaveBeenCalledWith('MenuScene');
    expect(s.careerManager.getCareer().tutorialCompleted).toBe(true);
    expect(s.trainingOverlay.retryButton).toBeUndefined();
  });

  it('shutdown cancels completion waiting and ignores a late response after the scene is reused', async () => {
    vi.useFakeTimers();
    let finishLate!: (career: PlayerCareer) => void;
    const scene = await bootTrainingScene(makeTrainingApi({
      completeTutorial: () => new Promise(resolve => { finishLate = resolve; }),
    }));
    const s = scene as any;
    performGuidedActions(scene);
    await flushMicrotasks();
    const request = s.trainingRequest;
    expect(request).toBeInstanceOf(AbortController);
    s.cleanup();
    expect(request.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    s.isExiting = false;
    s.trainingRequest = new AbortController();
    finishLate({ ...createDefaultCareer('training_player'), tutorialCompleted: true });
    await flushMicrotasks();
    expect(s.scene.start).not.toHaveBeenCalled();
    expect(trackedNames()).not.toContain('tutorial_completed');
    expect(storage.get(`crown_clash_training_progress_${s.platform.getUser().id}`)).toBe('5');
  });

  it('reload after a failed save: training resumes straight into the save flow without repeating any action', async () => {
    const platform = new BrowserPlatformAdapter();
    const playerId = platform.getUser().id;
    // A previous session performed all five guided actions but the save failed.
    storage.set(`crown_clash_training_progress_${playerId}`, '5');

    // One connected api whose network recovers after the first failed save.
    let saveAttempts = 0;
    const api = makeTrainingApi({
      completeTutorial: () => {
        saveAttempts += 1;
        if (saveAttempts === 1) return Promise.reject(new Error('still_offline'));
        return Promise.resolve({
          ...createDefaultCareer(playerId),
          tutorialCompleted: true,
        });
      },
    });
    const scene = await bootTrainingScene(api, playerId);
    await flushMicrotasks();

    // The controller boots silently into the completed state: no guided
    // step is active and no step analytics fires for already-done actions.
    const controller = (scene as any).trainingController;
    expect(controller.isCompleted).toBe(true);
    expect(controller.isActive).toBe(false);
    expect(controller.currentStep).toBeNull();
    expect(trackedNames().filter((name) => name === 'tutorial_step_completed')).toHaveLength(0);
    // The save retry already ran once automatically and failed closed again.
    expect(saveAttempts).toBe(1);
    expect(storage.get(`crown_clash_training_progress_${playerId}`)).toBe('5');
    expect((scene as any).trainingOverlay.retryButton).toBeDefined();
    expect(trackedNames()).not.toContain('tutorial_completed');

    // The network recovered: the idempotent retry closes the loop with the
    // same exactly-once completion — no actions are ever repeated.
    (scene as any).handleTrainingCompleted();
    await flushMicrotasks();
    expect(saveAttempts).toBe(2);
    expect(storage.has(`crown_clash_training_progress_${playerId}`)).toBe(false);
    expect(trackedNames().filter((name) => name === 'tutorial_step_completed')).toHaveLength(0);
    expect(trackedNames().filter((name) => name === 'tutorial_completed')).toHaveLength(1);
  });

  it('training menu: match_* navigation events are remapped or suppressed; confirming exit never emits match events or settles', async () => {
    const api = makeTrainingApi({
      completeTutorial: async () => ({ ...createDefaultCareer('training_player'), tutorialCompleted: true }),
    });
    const scene = await bootTrainingScene(api);
    const menu = (scene as any).matchMenuController;

    // Open the pause menu, request leave, cancel, reopen, confirm.
    menu.openMenu();
    expect(trackedNames()).toContain('tutorial_menu_opened');
    menu.openConfirm('menu');
    expect(trackedNames()).toContain('tutorial_leave_requested');
    menu.backToMenu();
    expect(trackedNames()).toContain('tutorial_leave_cancelled');
    menu.closeMenu();
    expect(trackedNames()).toContain('tutorial_menu_closed');
    menu.openConfirm('menu');
    menu.confirmExit();

    // No ordinary bot-match navigation or quit events ever fire.
    const names = trackedNames();
    for (const banned of [
      'match_menu_opened',
      'match_resumed',
      'match_leave_requested',
      'match_leave_cancelled',
      'match_quit_confirmed',
      'match_quit',
      'match_start',
      'match_end',
      'match_reward_received',
    ]) {
      expect(names).not.toContain(banned);
    }
    // Leaving training is a tutorial skip.
    expect(names).toContain('tutorial_skipped');
    // No terminal match tracking and no settlement/reward attempt.
    expect(trackTerminalMatchEvent).not.toHaveBeenCalled();
    expect((scene as any).careerManager.getCareer().matchesPlayed).toBe(0);
  });
});



describe('production C scene integration',()=>{
  beforeEach(()=>{storage.clear();vi.clearAllMocks();(CareerManager as any).instance=null;});
  it.each([1,2] as const)('honors the server ticket rule version %s', version=>{
    const scene=new GameScene();scene.registry.set('platform',new BrowserPlatformAdapter());
    scene.scene.settings.data={mode:'bot',botMatch:{matchId:'bot_C',battlefieldId:'crown_cross',gameplayRulesVersion:version}};
    scene.create();expect((scene as any).gameState.gameplayRulesVersion).toBe(version);(scene as any).cleanup();
  });
  it.each(['player','neutral','enemy'])('short tap inspects a %s base without sending an attack',owner=>{
    const scene=new GameScene();scene.registry.set('platform',new BrowserPlatformAdapter());
    scene.scene.settings.data={mode:'bot',botMatch:{matchId:'bot_C',battlefieldId:'crown_cross',gameplayRulesVersion:2}};
    scene.create();const s=scene as any;
    s.game={canvas:{width:400,height:720,getBoundingClientRect:()=>({width:360,height:640})}};
    const t=s.gameState.territories.p_base;t.owner=owner;vi.spyOn(s,'getTerritoryUnderPointer').mockReturnValue(t);
    const pointer={x:100,y:100};s.territoryVisuals.get('p_base').container.emit('pointerdown',pointer);
    for(const [event,handler] of s.input.on.mock.calls)if(event==='pointerdown')handler(pointer);
    for(const [event,handler] of s.input.on.mock.calls)if(event==='pointerup')handler(pointer);
    expect(s.inspectionId).toBe('p_base');expect(s.inspector.visible).toBe(true);
    expect(s.inspectorText.text).toContain('تولید 1.20/s');expect(s.matchActions).toEqual([]);
    t.owner='enemy';s.updateTerritoryInspection();expect(s.inspectorText.text).toContain('دشمن');s.cleanup();
  });
  it('keeps multi-select as two real, recorded production commands',()=>{
    const scene=new GameScene();scene.registry.set('platform',new BrowserPlatformAdapter());
    scene.scene.settings.data={mode:'bot',botMatch:{matchId:'bot_C',battlefieldId:'crown_cross',gameplayRulesVersion:2}};
    scene.create();const s=scene as any;s.gameState.territories.n_bot_right.owner='player';s.gameState.territories.n_bot_right.units=40;
    s.selectedSourceIds=['p_base','n_bot_right'];s.hoveredTargetId='n_bot_left';s.handlePointerRelease();
    expect(s.matchActions.map((a:any)=>[a.sourceId,a.targetId])).toEqual([['p_base','n_bot_left'],['n_bot_right','n_bot_left']]);
    expect(s.gameState.territories.n_bot_right.units).toBe(20);s.cleanup();
  });
});

describe('match intro countdown', () => {
  beforeEach(() => { storage.clear(); vi.clearAllMocks(); (CareerManager as any).instance = null; });
  afterEach(() => vi.restoreAllMocks());
  it('holds the bot battle and ignores orders until GO, then runs normally', () => {
    const scene: any = new GameScene();
    scene.registry.set('platform', new BrowserPlatformAdapter());
    scene.scene.settings.data = { mode: 'bot', botMatch: { matchId: 'bot_intro', battlefieldId: 'crown_cross', gameplayRulesVersion: 3 } };
    scene.create();
    expect(scene.introHolding).toBe(true);
    for (let i = 1; i <= 60; i++) scene.update(i * 20, 20);
    expect(scene.gameState.elapsedTimeSeconds).toBe(0);
    const t = scene.gameState.territories.p_base, p = scene.projectSocketPoint(t.x, t.y);
    for (const [name, handler] of scene.input.on.mock.calls) {
      if (name === 'pointerdown') handler({ x: p.u, y: p.v, positionToCamera: (_c: unknown, out: any) => out.set(p.u, p.v) });
    }
    expect(scene.selectedSourceIds).toEqual([]);
    scene.introHolding = false; // GO
    for (let i = 61; i <= 110; i++) scene.update(i * 20, 20);
    expect(scene.gameState.elapsedTimeSeconds).toBeGreaterThan(0.9);
    scene.cleanup();
  });

  it.each([
    ['slow server: the syncing card follows the end stamp', false, true],
    ['fast server: straight from the end stamp to the result', true, false],
  ])('%s', (_name, serverAnswered, expectSyncing) => {
    const scene: any = new GameScene();
    scene.registry.set('platform', new BrowserPlatformAdapter());
    scene.scene.settings.data = { mode: 'bot', botMatch: { matchId: 'bot_end_beat', battlefieldId: 'crown_cross', gameplayRulesVersion: 3 } };
    scene.create();
    scene.introHolding = false;
    const timers: Array<{ delay: number; cb: () => void }> = [];
    scene.time.delayedCall = (delay: number, cb: () => void) => { timers.push({ delay, cb }); return { destroy() {} }; };
    scene.finalizeMatch = vi.fn(async () => {});
    scene.endMatch();
    expect(scene.finalizeMatch).toHaveBeenCalledTimes(1); // settlement starts at once
    expect(scene.syncingModalContainer).toBeUndefined();
    if (serverAnswered) scene.settlementReady = true;
    const beat = timers.find((t) => t.delay === END_BEAT_MS);
    expect(beat).toBeDefined();
    beat!.cb();
    return scene.endBeatDone.then(() => Promise.resolve()).then(() => {
      expect(Boolean(scene.syncingModalContainer)).toBe(expectSyncing);
      scene.cleanup();
    });
  });

  it('never counts down in training', () => {
    const scene: any = new GameScene();
    scene.registry.set('platform', new BrowserPlatformAdapter());
    scene.scene.settings.data = { source: 'menu', mode: 'bot', training: true };
    scene.create();
    expect(scene.introHolding).toBe(false);
    scene.cleanup();
  });
});

describe('tactical main-game integration', () => {
  beforeEach(() => { storage.clear(); vi.clearAllMocks(); (CareerManager as any).instance = null; });
  afterEach(() => vi.restoreAllMocks());
  it('collects two friendly towers during a drag and records both legal attacks', () => {
    const scene: any = new GameScene();
    scene.registry.set('platform', new BrowserPlatformAdapter());
    scene.scene.settings.data = { mode: 'bot', botMatch: { matchId: 'bot_multi_touch', battlefieldId: 'crown_cross', gameplayRulesVersion: 3 } };
    scene.create();
    (scene as any).introHolding = false; // skip the 3-2-1 countdown (timers are mocked)
    scene.game = { canvas: { width: 400, height: 720, getBoundingClientRect: () => ({ width: 360, height: 640 }) } };
    const pointerAt = (id: string) => {
      const t = scene.gameState.territories[id], p = scene.projectSocketPoint(t.x, t.y);
      return { x: p.u, y: p.v, positionToCamera: (_camera: unknown, out: any) => out.set(p.u, p.v) };
    };
    const emit = (event: string, id: string) => {
      for (const [name, handler] of scene.input.on.mock.calls) if (name === event) handler(pointerAt(id));
    };
    emit('pointerdown', 'p_base');
    emit('pointermove', 'n_bot_left');
    emit('pointermove', 'n_center');
    expect(scene.selectedSourceIds).toEqual(['p_base', 'n_bot_left']);
    expect(scene.dragBadgeText.text).toContain('21 ارسال');
    emit('pointerup', 'n_center');
    expect(scene.matchActions.map((a: any) => [a.sourceId, a.targetId])).toEqual([['p_base', 'n_center'], ['n_bot_left', 'n_center']]);
    expect(scene.gameState.territories.p_base.units).toBe(14);
    expect(scene.gameState.territories.n_bot_left.units).toBe(7);
    expect(scene.gameState.armies).toHaveLength(2);
    scene.cleanup();
  });
  it('lets the rear left tower attack the next left tower through the friendly tower in front of it', () => {
    const scene: any = new GameScene();
    scene.registry.set('platform', new BrowserPlatformAdapter());
    scene.scene.settings.data = { mode: 'bot', botMatch: { matchId: 'bot_left_lane', battlefieldId: 'crown_cross', gameplayRulesVersion: 3 } };
    scene.create();
    (scene as any).introHolding = false; // skip the 3-2-1 countdown (timers are mocked)
    scene.game = { canvas: { width: 400, height: 720, getBoundingClientRect: () => ({ width: 360, height: 640 }) } };
    scene.gameState.territories.n_mid_left.owner = 'player';
    scene.gameState.territories.n_mid_left.units = 20;
    const emit = (event: string, id: string) => {
      const t = scene.gameState.territories[id], p = scene.projectSocketPoint(t.x, t.y);
      const pointer = { x: p.u, y: p.v, positionToCamera: (_camera: unknown, out: any) => out.set(p.u, p.v) };
      for (const [name, handler] of scene.input.on.mock.calls) if (name === event) handler(pointer);
    };
    emit('pointerdown', 'n_bot_left');
    emit('pointermove', 'n_mid_left');
    emit('pointermove', 'n_top_left');
    expect(scene.selectedSourceIds).toEqual(['n_bot_left', 'n_mid_left']);
    expect(scene.dragBadgeText.text).toContain('2/2 برج');
    expect(scene.dragBadgeText.text).toContain('17 ارسال');
    expect(scene.bottomHintText.text).not.toContain('ندارد');
    emit('pointerup', 'n_top_left');
    expect(scene.matchActions.map((a: any) => [a.sourceId, a.targetId])).toEqual(
      expect.arrayContaining([['n_bot_left', 'n_top_left'], ['n_mid_left', 'n_top_left']]),
    );
    expect(scene.matchActions).toHaveLength(2);
    expect(scene.gameState.territories.n_bot_left.units).toBe(7);
    expect(scene.gameState.territories.n_mid_left.units).toBe(10);
    scene.cleanup();
  });
  it('records a versioned bot quit through the menu controller', () => {
    const scene:any=new GameScene();scene.registry.set('platform',new BrowserPlatformAdapter());
    scene.scene.settings.data={mode:'bot',botMatch:{matchId:'bot_quit_v3',battlefieldId:'crown_cross',gameplayRulesVersion:3}};
    scene.create();scene.matchMenuController.confirmExit();
    expect(trackTerminalMatchEvent).toHaveBeenCalledWith(expect.objectContaining({name:'match_quit',mode:'bot',matchId:'bot_quit_v3',gameplayRulesVersion:3}));
    scene.cleanup();
  });
  it('records the commanded destination, not the current waypoint, for replay', () => {
    const scene:any=new GameScene();scene.registry.set('platform',new BrowserPlatformAdapter());
    scene.scene.settings.data={mode:'bot',botMatch:{matchId:'bot_route',battlefieldId:'crown_cross',gameplayRulesVersion:3}};
    scene.create();scene.gameState.territories.n_bot_right.owner='player';
    scene.selectedSourceIds=['n_bot_left'];scene.hoveredTargetId='n_bot_right';scene.handlePointerRelease();
    expect(scene.gameState.armies[0]).toMatchObject({targetId:'p_base',routeIds:['n_bot_left','p_base','n_bot_right'],routeLeg:0});
    expect(scene.matchActions).toEqual([{sequence:0,atSeconds:0,sourceId:'n_bot_left',targetId:'n_bot_right'}]);
    scene.cleanup();
  });
  it('rejects a retired prototype launch without a server ticket', () => {
    const scene: any = new GameScene(); scene.registry.set('platform', new BrowserPlatformAdapter());
    scene.scene.settings.data = { prototypeMode: 'crown' }; scene.create();
    expect(scene.scene.start).toHaveBeenCalledWith('MenuScene');
    expect(scene.gameState).toBeUndefined();
  });
  it.each([2, 3] as const)('uses the server-pinned rules v%s and resets AI cadence on restart', async version => {
    const scene: any = new GameScene(), platform = new BrowserPlatformAdapter();
    scene.registry.set('platform', platform);
    const manager = CareerManager.getInstance(platform.getUser().id);
    vi.spyOn(manager, 'connect').mockResolvedValue(createDefaultCareer(platform.getUser().id));
    scene.scene.settings.data = { mode: 'bot', botMatch: { matchId: 'pinned_' + version, battlefieldId: 'crown_cross', gameplayRulesVersion: version } };
    scene.create();
    expect(scene.gameState.gameplayRulesVersion).toBe(version);
    expect(scene.gameState.territories.p_base.units).toBe(version === 3 ? 28 : 20);
    expect(scene.gameState.territories.n_bot_left.owner).toBe(version === 3 ? 'player' : 'neutral');
    expect(scene.crownHud).toBeUndefined();
    expect(trackEvent).toHaveBeenCalledWith(expect.objectContaining({ name: 'match_start', gameplayRulesVersion: version }));
    scene.stepBotMatch(.25); expect(scene.gameState.elapsedTimeSeconds).toBe(.24);
    scene.aiNextTick = 70; scene.cleanup(); scene.create(); expect(scene.aiNextTick).toBe(1.8);
    scene.cleanup();
  });
});

describe('authoritative result to next-battle loop',()=>{
 it('presents the server result inside the battle instead of routing to the realm hub',async()=>{
  const scene:any=new GameScene();
  const stats={matchDurationSeconds:64,playerUnitsDispatched:40,enemyUnitsDispatched:50,territoriesCapturedByPlayer:2,territoriesCapturedByEnemy:3};
  const career=createDefaultCareer('retention_test');
  const settlement=settleMatch(career,'defeat',stats,'realm_result');
  const ticket:any={matchId:'realm_result'};
  const response={ticket,settlement,rewarded:true};
  const settle=vi.spyOn(PilotClient.prototype,'settle').mockResolvedValue(response);
  try{
   scene.realmTicket=ticket;scene.activeMatchId=ticket.matchId;scene.matchActions=[];
   scene.gameState={status:'victory'};scene.backendConnectPromise=Promise.resolve();
   scene.careerManager={refreshRemoteCareer:vi.fn().mockResolvedValue(settlement.newCareer)};
   scene.renderResultModal=vi.fn();scene.dismissSyncingModal=vi.fn();
   await scene.finalizeMatch();
   expect(scene.renderResultModal).toHaveBeenCalledWith('defeat',stats,settlement);
   expect(scene.scene.start).not.toHaveBeenCalled();
   expect(scene.offlineBattleClosed).toBe(true);expect(scene.resultPending).toBe(false);
   expect(scene.careerManager.refreshRemoteCareer).toHaveBeenCalledOnce();
  }finally{settle.mockRestore();}
 });
});
