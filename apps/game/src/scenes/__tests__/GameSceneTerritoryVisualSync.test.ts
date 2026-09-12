import { describe, expect, it, vi, beforeEach } from 'vitest';

const { MockScene, MockGameObject, MockGraphics, MockContainer, MockVector2 } = vi.hoisted(() => {
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

    setVisible(v: boolean) {
      this.visible = v;
      return this;
    }

    setPosition(x: number, y: number) {
      this.x = x;
      this.y = y;
      return this;
    }

    setX(x: number) {
      this.x = x;
      return this;
    }

    setY(y: number) {
      this.y = y;
      return this;
    }

    setSize(w: number, h: number) {
      this.width = w;
      this.height = h;
      return this;
    }

    setText(t: string) {
      this.text = t;
      return this;
    }

    setColor(c: string) {
      this.color = c;
      return this;
    }

    setOrigin(x = 0.5, y = x) {
      this.originX = x;
      this.originY = y;
      return this;
    }

    setStrokeStyle(_thickness: number, color: number, _alpha = 1) {
      this.strokeColor = color;
      return this;
    }

    setFillStyle(color: number, _alpha = 1) {
      this.fillColor = color;
      return this;
    }

    setDepth(d: number) {
      this.depth = d;
      return this;
    }

    setAlpha(a: number) {
      this.alpha = a;
      return this;
    }

    setScale(x = 1, y = x) {
      this.scaleX = x;
      this.scaleY = y;
      return this;
    }

    setDisplaySize(w: number, h: number) {
      this.width = w;
      this.height = h;
      return this;
    }

    setTexture(key: string) {
      this.texture.key = key;
      return this;
    }

    setRotation(_angle: number) {
      return this;
    }

    setFlipX(_flip: boolean) {
      return this;
    }

    setInteractive() {
      this.interactive = true;
      return this;
    }

    disableInteractive() {
      this.interactive = false;
      return this;
    }

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

    destroy() {
      this.destroyed = true;
    }
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

    removeAll(destroy = false) {
      if (destroy) {
        for (const child of this.list) {
          child.destroy();
        }
      }
      this.list = [];
      return this;
    }

    setScrollFactor() {
      return this;
    }

    destroy() {
      super.destroy();
      for (const child of this.list) {
        child.destroy();
      }
      this.list = [];
    }
  }

  class MockGraphics extends MockGameObject {
    commands: string[] = [];
    clear() {
      this.commands = [];
      return this;
    }
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
    lineBetween(x1: number, y1: number, x2: number, y2: number) {
      this.commands.push(`line:${x1},${y1}-${x2},${y2}`);
      return this;
    }
    fillRoundedRect() { return this; }
    strokeRoundedRect() { return this; }
    fillCircle() { return this; }
    strokeCircle() { return this; }
    fillEllipse() { return this; }
    fillTriangle() { return this; }
    fillRect() { return this; }
  }

  class MockScene {
    scale = {
      gameSize: { width: 400, height: 720 },
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
        setBounds: () => {},
        shake: vi.fn(),
        scrollX: 0,
        scrollY: 0,
        zoom: 1,
        width: 400,
        height: 720,
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
      text: (x: number, y: number, text: string, _style?: any) => {
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
      arc: (x: number, y: number, radius = 0, _start = 0, _end = 360, _anti = false, color?: number, alpha?: number) => {
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
      zone: (x: number, y: number, w: number, h: number) => {
        const obj = new MockGameObject(x, y, w, h);
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
      delayedCall: (_delay: number, _cb?: Function) => ({ destroy: () => {} }),
      addEvent: () => ({ destroy: () => {} }),
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
          botMatch: { matchId: 'bot_test_1', battlefieldId: 'crown_cross' },
        },
      },
    };
  }

  class MockVector2 {
    x: number = 0;
    y: number = 0;
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
    set(x: number, y: number) {
      this.x = x;
      this.y = y;
      return this;
    }
  }

  return { MockScene, MockGameObject, MockGraphics, MockContainer, MockVector2 };
});

vi.mock('phaser', () => {
  return {
    default: {
      Scene: MockScene,
      Math: {
        Vector2: MockVector2,
        Distance: {
          Between: (x1: number, y1: number, x2: number, y2: number) =>
            Math.hypot(x2 - x1, y2 - y1),
        },
        Angle: {
          Between: (x1: number, y1: number, x2: number, y2: number) =>
            Math.atan2(y2 - y1, x2 - x1),
        },
        Clamp: (v: number, min: number, max: number) => Math.min(Math.max(v, min), max),
        Linear: (p1: number, p2: number, t: number) => p1 + (p2 - p1) * t,
      },
      Scenes: {
        Events: {
          SHUTDOWN: 'shutdown',
          DESTROY: 'destroy',
        },
      },
      GameObjects: {
        Rectangle: MockGameObject,
        Text: MockGameObject,
        Graphics: MockGraphics,
        Container: MockContainer,
      },
    },
  };
});

vi.mock('../../analytics/Analytics.js', () => ({
  trackEvent: vi.fn(),
  trackTerminalMatchEvent: vi.fn(),
}));

vi.mock('../../audio/SoundEffects.js', () => {
  const methodMap = new Map<string, any>();
  return {
    sounds: new Proxy(
      {},
      {
        get: (_target, prop: string) => {
          if (prop === 'isMuted') return () => false;
          if (!methodMap.has(prop)) {
            methodMap.set(prop, vi.fn());
          }
          return methodMap.get(prop);
        },
      }
    ),
  };
});

vi.mock('../../career/CareerManager.js', () => ({
  CareerManager: {
    getInstance: () => ({
      connect: () => Promise.resolve(),
      subscribe: () => () => {},
      getCareer: () => ({
        totalMatches: 0,
        upgrades: {},
      }),
    }),
  },
}));

import { GameScene } from '../GameScene.js';
import { BrowserPlatformAdapter } from '@crown-clash/platform';
import type { CombatResult } from '@crown-clash/game-core';

describe('GameScene Territory Visual Synchronization', () => {
  let scene: GameScene;
  let platform: BrowserPlatformAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    platform = new BrowserPlatformAdapter();
    scene = new GameScene();
    scene.registry.set('platform', platform);
    scene.scene.settings.data = {
      mode: 'bot',
      botMatch: {
        matchId: 'bot_test_sync',
        battlefieldId: 'crown_cross',
      },
    };
    scene.create();
  });

  it('Scenario 1: Bot production advance updates unitText to match state (20 -> 22 after 1.8s)', () => {
    const pBaseVisual = (scene as any).territoryVisuals.get('p_base');

    expect(pBaseVisual).toBeDefined();

    // Initial state: p_base has 20 units
    expect((scene as any).gameState.territories['p_base'].units).toBe(20);
    expect(pBaseVisual.unitText.text).toBe('20');
    expect(pBaseVisual.lastUnits).toBe(20);

    // Advance simulation by 0.9s (45 ticks @ 20ms) before any AI turn (1.0s)
    // p_base produces units at 1.2 units/second -> +1 unit (21)
    for (let i = 0; i < 45; i++) {
      scene.update(i * 20, 20);
    }

    // Assert that simulation advanced units to 21 and visual is synced
    expect((scene as any).gameState.territories['p_base'].units).toBe(21);
    expect(pBaseVisual.unitText.text).toBe('21');
    expect(pBaseVisual.lastUnits).toBe(21);

    // Advance simulation another 45 ticks to 1.8s -> +2 units total (22)
    for (let i = 45; i < 90; i++) {
      scene.update(i * 20, 20);
    }

    // Assert that simulation advanced units to 22
    expect((scene as any).gameState.territories['p_base'].units).toBe(22);

    // CRITICAL: Visual text MUST equal state units
    expect(pBaseVisual.unitText.text).toBe('22');
    expect(pBaseVisual.lastUnits).toBe(22);
  });

  it('Scenario 2: Tower arrival and capture updates unitText, owner, and texture key', () => {
    const centerVisual = (scene as any).territoryVisuals.get('n_center');
    expect(centerVisual).toBeDefined();

    // Initially neutral
    expect((scene as any).gameState.territories['n_center'].owner).toBe('neutral');

    // Mutate state as stepSimulation does upon arrival
    (scene as any).gameState.territories['n_center'].owner = 'player';
    (scene as any).gameState.territories['n_center'].units = 14;

    // Simulate arrival result
    const captureResult: CombatResult = {
      targetId: 'n_center',
      attackerOwner: 'player',
      previousOwner: 'neutral',
      newOwner: 'player',
      previousUnits: 10,
      incomingUnits: 25,
      remainingUnits: 14,
      captured: true,
      reinforced: false,
    };

    (scene as any).onCombatArrival(captureResult);

    // Run render update
    scene.updateTerritoryVisuals();

    // Assert visual reflects capture
    expect(centerVisual.unitText.text).toBe('14');
    expect(centerVisual.lastUnits).toBe(14);
    expect(centerVisual.lastOwner).toBe('player');
    expect(centerVisual.sprite.texture.key).toBe('crown_keep_player');
  });

  it('Scenario 3: Player dispatch immediately deducts source units from visual', () => {
    const pBaseVisual = (scene as any).territoryVisuals.get('p_base');

    expect((scene as any).gameState.territories['p_base'].units).toBe(20);
    expect(pBaseVisual.unitText.text).toBe('20');

    // Trigger player dispatch from p_base to n_center
    (scene as any).selectedSourceIds = ['p_base'];
    (scene as any).hoveredTargetId = 'n_center';
    (scene as any).handlePointerRelease();

    // 20 units dispatched halved -> 10 units remain
    expect((scene as any).gameState.territories['p_base'].units).toBe(10);
    expect(pBaseVisual.unitText.text).toBe('10');
    expect(pBaseVisual.lastUnits).toBe(10);
  });

  it('Scenario 4: Live authoritative snapshot refreshes visual even without local dispatch', () => {
    const pBaseVisual = (scene as any).territoryVisuals.get('p_base');
    const centerVisual = (scene as any).territoryVisuals.get('n_center');

    // Mutate state to mimic live snapshot arrival
    (scene as any).gameState.territories['p_base'].units = 35;
    (scene as any).gameState.territories['n_center'].owner = 'enemy';
    (scene as any).gameState.territories['n_center'].units = 18;

    scene.markTerritoriesDirty();
    scene.updateTerritoryVisuals();

    expect(pBaseVisual.unitText.text).toBe('35');
    expect(pBaseVisual.lastUnits).toBe(35);
    expect(centerVisual.unitText.text).toBe('18');
    expect(centerVisual.lastUnits).toBe(18);
    expect(centerVisual.lastOwner).toBe('enemy');
    expect(centerVisual.sprite.texture.key).toBe('crown_keep_enemy');
  });

  it('Scenario 5: Signature mismatch catches missed dirty marks and forces synchronization', () => {
    const pBase = (scene as any).gameState.territories['p_base'];
    const pBaseVisual = (scene as any).territoryVisuals.get('p_base');

    // Explicitly reset dirty flag to false
    (scene as any).territoriesDirty = false;
    (scene as any).lastTerritorySignature = (scene as any).computeTerritorySignature();

    // Directly mutate territory state behind scene's back
    pBase.units = 42;

    // Call updateTerritoryVisuals without calling markTerritoriesDirty()
    scene.updateTerritoryVisuals();

    // Signature change MUST detect the divergence and update visual
    expect(pBaseVisual.unitText.text).toBe('42');
    expect(pBaseVisual.lastUnits).toBe(42);
  });
});
