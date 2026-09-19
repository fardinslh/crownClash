import { describe, expect, it, vi, beforeEach } from 'vitest';

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
    setDisplaySize(_w: number, _h: number) { return this; }
    setText(t: string) { this.text = t; return this; }
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
    destroy() { this.destroyed = true; }
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

import { GameScene } from '../GameScene.js';
import { CareerManager } from '../../career/CareerManager.js';
import { BrowserPlatformAdapter } from '@crown-clash/platform';
import {
  createDefaultCareer,
  settleMatch,
  type MatchSettlement,
  type PlayerCareer,
} from '@crown-clash/game-core';
import type { CareerApi } from '../../api/GameApiClient.js';

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
