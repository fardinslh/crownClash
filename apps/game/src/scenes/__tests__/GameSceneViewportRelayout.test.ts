import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

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
      if (!this._listeners.has(event)) this._listeners.set(event, new Set<Function>());
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
    moveTo(x: number, y: number) {
      this.commands.push(`moveTo:${x},${y}`);
      return this;
    }
    lineTo(x: number, y: number) {
      this.commands.push(`lineTo:${x},${y}`);
      return this;
    }
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
    fillCircle(cx: number, cy: number, radius: number) {
      this.commands.push(`fillCircle:${cx},${cy},${radius}`);
      return this;
    }
    strokeCircle() { return this; }
    fillEllipse() { return this; }
    strokeEllipse() { return this; }
    fillTriangle() { return this; }
    fillRect() { return this; }
    strokeRect() { return this; }
    strokeEllipseShape() { return this; }
    save() { return this; }
    restore() { return this; }
    translateCanvas() { return this; }
    scaleCanvas() { return this; }
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

  return { MockScene, MockGameObject, MockGraphics, MockContainer, MockVector2, storage };
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
import { createBoardLayout } from '../../art/boardProjection.js';

interface TrackedObject {
  x: number;
  y: number;
  width: number;
  height: number;
  destroyed: boolean;
  fillColor: number;
}

const arenaVisualsOf = (scene: GameScene): TrackedObject[] =>
  (scene as unknown as { arenaVisuals: TrackedObject[] }).arenaVisuals;

const territoryContainersOf = (scene: GameScene) =>
  (scene as unknown as {
    territoryVisuals: Map<
      string,
      { container: { x: number; y: number; depth: number } }
    >;
  }).territoryVisuals;

function createGameScene(battlefieldId: string): GameScene {
  const scene = new GameScene();
  scene.registry.set('platform', new BrowserPlatformAdapter());
  scene.scene.settings.data = {
    mode: 'bot',
    botMatch: { matchId: 'bot_relayout_test', battlefieldId },
  };
  scene.create();
  return scene;
}

/** Emits a resize to the given logical game size and settles the debounce. */
function resizeTo(scene: GameScene, width: number, height: number): void {
  (scene.scale as unknown as { gameSize: { width: number; height: number } }).gameSize = {
    width,
    height,
  };
  scene.scale.emit('resize');
}

describe('GameScene viewport relayout (map uses the live mobile height)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rebuilds the diorama board band after the viewport grows (Bale expand / rotation)', () => {
    const scene = createGameScene('crown_cross');
    expect(arenaVisualsOf(scene).length).toBeGreaterThan(0);
    // createArenaBackground already ends with the prop layer: a rebuild must
    // never duplicate it (tracked-object count stays create-time identical).
    const arenaCountAtCreate = arenaVisualsOf(scene).length;

    const arenaBefore = [...arenaVisualsOf(scene)];
    const containersBefore = new Map(
      [...territoryContainersOf(scene).entries()].map(([id, vis]) => [id, { ...vis.container }])
    );

    // Tall phone: 400 logical width, 866 logical height.
    resizeTo(scene, 400, 866);
    vi.advanceTimersByTime(250);

    // The old dressing was destroyed and rebuilt for the new height.
    expect(arenaBefore.every((visual) => visual.destroyed)).toBe(true);
    expect(arenaVisualsOf(scene).length).toBe(arenaCountAtCreate);
    expect(arenaVisualsOf(scene).every((visual) => !visual.destroyed)).toBe(true);

    // Territory platforms moved onto the new projected band (diorama band
    // re-centers: originY grows with visibleHeight).
    const tallLayout = createBoardLayout('crown_cross', 866);
    const territories = (
      scene as unknown as {
        gameState: { territories: Record<string, { x: number; y: number }> };
      }
    ).gameState.territories;
    for (const [id, vis] of territoryContainersOf(scene).entries()) {
      const territory = territories[id];
      const anchor = tallLayout.project(territory.x, territory.y);
      expect(vis.container.x).toBeCloseTo(anchor.u, 6);
      expect(vis.container.y).toBeCloseTo(anchor.v, 6);
      expect(vis.container.y).toBeGreaterThan(containersBefore.get(id)!.y);
    }

    // Bottom HUD chrome followed the viewport bottom edge (866 - 28).
    const sceneAny = scene as unknown as Record<string, TrackedObject>;
    expect(sceneAny['bottomBarBg'].y).toBe(838);
    expect(sceneAny['bottomBarShadow'].y).toBe(841);
    expect(sceneAny['bottomHintText'].y).toBe(848);
  });

  it('relayouts a second diorama battlefield (twin_passes) onto a taller viewport (world coordinates preserved)', () => {
    const scene = createGameScene('twin_passes');
    const containersBefore = new Map(
      [...territoryContainersOf(scene).entries()].map(([id, vis]) => [id, { ...vis.container }])
    );
    const arenaCountAtCreate = arenaVisualsOf(scene).length;
    const arenaBefore = [...arenaVisualsOf(scene)];

    resizeTo(scene, 400, 866);
    vi.advanceTimersByTime(250);

    expect(arenaBefore.every((visual) => visual.destroyed)).toBe(true);
    // The rebuild covers the whole dressing stack once: no prop-layer
    // duplication (count matches the create-time count).
    expect(arenaVisualsOf(scene).length).toBe(arenaCountAtCreate);

    // twin_passes now ships a diorama ground plate, so the taller viewport
    // re-centers the foreshortened diorama band: platforms follow the dimetric
    // projection, and screen points round-trip back to the authoritative flat
    // world (hit radii stay correct).
    const tallLayout = createBoardLayout('twin_passes', 866);
    expect(tallLayout.isDimetric).toBe(true);
    expect(tallLayout.originY).toBeGreaterThan(createBoardLayout('twin_passes', 720).originY);
    const territories = (
      scene as unknown as {
        gameState: { territories: Record<string, { x: number; y: number }> };
      }
    ).gameState.territories;
    for (const [id, vis] of territoryContainersOf(scene).entries()) {
      const territory = territories[id];
      const anchor = tallLayout.project(territory.x, territory.y);
      expect(vis.container.x).toBeCloseTo(anchor.u, 6);
      expect(vis.container.y).toBeCloseTo(anchor.v, 6);
      const world = tallLayout.unproject(vis.container.x, vis.container.y);
      expect(world.x).toBeCloseTo(territory.x, 6);
      expect(world.y).toBeCloseTo(territory.y, 6);
    }
    // The diorama band re-centers downward on the taller viewport: the player
    // base (authored at world y=610) moves down with the band.
    const playerBase = territoryContainersOf(scene).get('p_base');
    expect(playerBase!.container.y).toBeGreaterThan(containersBefore.get('p_base')!.y);
    // The bases keep their projected foreshortened separation (the flat-world
    // distance stays authoritative; only the projection changed).
    const baseSpan =
      territoryContainersOf(scene).get('p_base')!.container.y -
      territoryContainersOf(scene).get('e_base')!.container.y;
    expect(baseSpan).toBeCloseTo(500 * tallLayout.verticalScale(), 6);

    // The team light pools anchor to the projected bases and foreshorten with
    // the ground plane: the player pool sits on the projected p_base socket
    // (290 logical px tall -> 290 * verticalScale on the dimetric board).
    const playerPoolAnchor = tallLayout.project(200, 610);
    const playerPoolHeight = 290 * tallLayout.verticalScale();
    const pooled = (scene.children.list as unknown as TrackedObject[]).filter(
      (obj) =>
        obj.x === 200 &&
        Math.abs(obj.y - playerPoolAnchor.v) < 0.5 &&
        Math.abs(obj.height - playerPoolHeight) < 0.5
    );
    expect(pooled.length).toBeGreaterThanOrEqual(1);

    const sceneAny = scene as unknown as Record<string, TrackedObject>;
    expect(sceneAny['bottomBarBg'].y).toBe(838);
  });

  it('is idempotent: a same-size resize does not rebuild the arena', () => {
    const scene = createGameScene('crown_cross');
    resizeTo(scene, 400, 866);
    vi.advanceTimersByTime(250);
    expect(arenaVisualsOf(scene).every((visual) => !visual.destroyed)).toBe(true);

    const childCountAfterFirst = scene.children.list.length;
    const arenaSnapshot = [...arenaVisualsOf(scene)];

    resizeTo(scene, 400, 866);
    vi.advanceTimersByTime(500);

    expect(arenaVisualsOf(scene).every((visual) => !visual.destroyed)).toBe(true);
    expect(scene.children.list.length).toBe(childCountAfterFirst);
    expect(arenaVisualsOf(scene)).toEqual(arenaSnapshot);
  });

  it('cancels the pending rebuild when the scene shuts down', () => {
    const scene = createGameScene('crown_cross');
    const childCount = scene.children.list.length;

    resizeTo(scene, 400, 866);
    scene.events.emit('shutdown');
    vi.advanceTimersByTime(500);

    // The debounced rebuild never ran: no new objects, no destroyed dressing.
    expect(scene.children.list.length).toBe(childCount);
    expect(arenaVisualsOf(scene).every((visual) => !visual.destroyed)).toBe(true);
  });
});
