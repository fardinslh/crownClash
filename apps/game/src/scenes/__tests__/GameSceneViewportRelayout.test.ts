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
    fillAlpha: number = 1;
    strokeColor: number = 0;
    strokeWidth: number = 0;
    strokeAlpha: number = 1;
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

    setStrokeStyle(thickness: number, color: number, alpha = 1) {
      this.strokeColor = color;
      this.strokeWidth = thickness;
      this.strokeAlpha = alpha;
      return this;
    }

    setFillStyle(color: number, alpha = 1) {
      this.fillColor = color;
      this.fillAlpha = alpha;
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
        if (alpha !== undefined) {
          obj.alpha = alpha;
          obj.fillAlpha = alpha;
        }
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
        Image: MockGameObject,
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
import { BOARD_VERTICAL_SPACING, createBoardLayout, PLINTH_TOP_LIFT, projectLifted } from '../../art/boardProjection.js';
import { arenaPropTextureKey, getArenaGroundSprite, getArenaPropPositions,
  listEnvironmentPropSpritePaths, listRuntimeSpritePaths, runtimeTerritoryTextureKey,
  territoryArtFootprint,
  type ArenaPropKind } from '../../art/BattlefieldArt.js';
import { THEME } from '../../theme.js';
import type { BattlefieldId, Territory } from '@crown-clash/game-core';

interface TrackedObject {
  x: number;
  y: number;
  width: number;
  height: number;
  destroyed: boolean;
  fillColor: number;
  texture?: { key: string };
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

function createGameScene(battlefieldId: string, groundLoaded?: boolean): GameScene {
  const scene = new GameScene();
  if (groundLoaded !== undefined) {
    const ground = getArenaGroundSprite(battlefieldId as BattlefieldId);
    expect(ground, 'relayout fixture needs a declared ground plate').not.toBeNull();
    Object.assign(scene, {
      textures: { exists: (key: string) => groundLoaded || key !== ground!.textureKey },
    });
  }
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

  it.each(['crown_cross', 'twin_passes', 'royal_ring', 'quad_citadel'] as const)(
    'preloads the complete %s map kit with a shared cache revision', (battlefieldId) => {
      const scene = new GameScene();
      const image = vi.fn();
      Object.assign(scene, { load: { on: vi.fn(), image } });
      scene.scene.settings.data = { botMatch: { matchId: 'cache_test', battlefieldId } };
      scene.preload();

      const ground = getArenaGroundSprite(battlefieldId);
      expect(ground, 'each shipped battlefield needs a ground plate').not.toBeNull();
      const buildings = Object.entries(listRuntimeSpritePaths(battlefieldId));
      const props = Object.entries(listEnvironmentPropSpritePaths());
      expect(buildings.length).toBeGreaterThan(0);
      expect(props.length).toBeGreaterThan(0);
      const expectedAssets = [
        ...buildings.map(([key, path]) => [runtimeTerritoryTextureKey(battlefieldId, key), path]),
        ...props.map(([key, path]) => [arenaPropTextureKey(key as ArenaPropKind), path]),
        [ground!.textureKey, ground!.path],
      ];
      const units = image.mock.calls.filter(([, path]) => path.includes('assets/units/'));
      expect(units, 'all leaders, followers and facings need a fresh revision').toHaveLength(16);
      for (const [, path] of units) {
        expect(new URL(path, 'https://game.invalid/').searchParams.get('v')).toBe('cartoon-meadow-v1.6');
      }
      for (const [key, path] of expectedAssets) {
        const calls = image.mock.calls.filter(([loadedKey]) => loadedKey === key);
        expect(calls, `preload must load ${key} exactly once`).toHaveLength(1);
        const url = new URL(calls[0][1], 'https://game.invalid/');
        expect(url.pathname).toBe(`/${path}`);
        expect(url.searchParams.get('v'), `${key} must bypass the old immutable cache`)
          .toBe('cartoon-meadow-v1.6');
      }
    },
  );

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
    expect(baseSpan).toBeCloseTo(500 * tallLayout.verticalScale() * BOARD_VERTICAL_SPACING, 6);

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

  it.each(['crown_cross', 'twin_passes', 'royal_ring', 'quad_citadel'] as const)(
    'keeps %s baked-plinth anchors and one ownership ring through resize and capture',
    (battlefieldId) => {
      const scene = createGameScene(battlefieldId, true);
      const probe = scene as unknown as {
        hasGroundPlate: boolean;
        gameState: { territories: Record<string, Territory> };
        territoryVisuals: Map<string, {
          container: InstanceType<typeof MockGameObject>;
          basePlate: InstanceType<typeof MockGameObject>;
          ring: InstanceType<typeof MockGameObject>;
          sprite: InstanceType<typeof MockGameObject>;
          unitBadge: InstanceType<typeof MockGameObject>;
          unitText: InstanceType<typeof MockGameObject>;
          typeIcon: InstanceType<typeof MockGameObject>;
        }>;
        selectionRings: Map<string, InstanceType<typeof MockGameObject>>;
        highlightSelectedTerritory(id: string): void;
      };
      expect(probe.hasGroundPlate, 'loaded ground must exercise baked-plinth presentation').toBe(true);
      const propCount = getArenaPropPositions(battlefieldId).length;
      expect(propCount, 'loaded-ground fixture must include environment props').toBeGreaterThan(0);
      const initialVisuals = new Map(probe.territoryVisuals);
      const source = Object.values(probe.gameState.territories).find(
        (territory) => territory.owner === 'player' && territory.tier === 3,
      );
      expect(source, 'fixture needs a player-owned base to select and capture').toBeDefined();
      const sourceId = source!.id;
      probe.highlightSelectedTerritory(sourceId);

      const verifyPresentation = (height: number): void => {
        const layout = createBoardLayout(battlefieldId, height);
        expect(layout.isDimetric).toBe(true);
        expect(probe.hasGroundPlate).toBe(true);
        // Tall layouts may add a board glow/drop shadow; only prop images
        // have a fixed count across viewport sizes.
        expect(arenaVisualsOf(scene).filter((visual) => visual.texture?.key.startsWith('cc_prop_')))
          .toHaveLength(propCount);
        expect(arenaVisualsOf(scene).every((visual) => !visual.destroyed)).toBe(true);
        for (const [id, visual] of probe.territoryVisuals) {
          const territory = probe.gameState.territories[id];
          const lifted = projectLifted(layout, territory.x, territory.y, PLINTH_TOP_LIFT);
          expect(visual, 'resize must preserve existing interactive territory objects').toBe(initialVisuals.get(id));
          expect(visual.container.x).toBeCloseTo(lifted.u, 6);
          expect(visual.container.y).toBeCloseTo(lifted.v, 6);
          const art = territoryArtFootprint(battlefieldId, territory);
          expect(visual.sprite.width).toBeCloseTo(art.spriteSize * layout.scale, 6);
          expect(visual.sprite.height).toBeCloseTo(art.spriteSize * layout.scale, 6);
          expect(visual.sprite.y).toBeCloseTo((art.spriteY - 2) * layout.scale, 6);
          expect(visual.unitBadge.parentContainer).toBeNull();
          expect(visual.unitBadge.x).toBeCloseTo(lifted.u, 6);
          expect(visual.unitBadge.y).toBeCloseTo(lifted.v + art.badgeY * layout.scale, 6);
          expect(visual.unitText.x).toBeCloseTo(visual.unitBadge.x, 6);
          expect(visual.unitText.y).toBeCloseTo(visual.unitBadge.y, 6);
          if (art.roleIconX === 0) {
            expect(visual.typeIcon.y - 8).toBeGreaterThanOrEqual(visual.unitBadge.y + 13);
          } else {
            expect(Math.abs(visual.typeIcon.x - visual.unitBadge.x)).toBeGreaterThan(25);
          }
          expect(visual.unitBadge.depth).toBeGreaterThan(visual.container.depth);
          expect(visual.basePlate.fillAlpha).toBe(0);
          expect(visual.basePlate.strokeAlpha).toBe(0);
          expect(visual.ring.strokeWidth).toBe(2);
          expect(visual.ring.strokeColor).toBe(THEME.teams[territory.owner].primary);
          expect(visual.ring.fillAlpha).toBe(0.06);
        }
        const selected = probe.selectionRings.get(sourceId);
        expect(selected, 'active selection ring must survive resize').toBeDefined();
        const selectedSource = probe.gameState.territories[sourceId];
        const selectedAnchor = projectLifted(layout, selectedSource.x, selectedSource.y, PLINTH_TOP_LIFT);
        expect(selected!.x).toBeCloseTo(selectedAnchor.u, 6);
        expect(selected!.y).toBeCloseTo(selectedAnchor.v, 6);
      };

      verifyPresentation(720);
      resizeTo(scene, 400, 866);
      vi.advanceTimersByTime(250);
      verifyPresentation(866);

      // Replace the authoritative state object so ownership synchronization
      // reads a real state transition, rather than mutating its visual copy.
      probe.gameState.territories[sourceId] = {
        ...probe.gameState.territories[sourceId], owner: 'enemy',
      };
      scene.updateTerritoryVisuals(true);
      const captured = probe.territoryVisuals.get(sourceId);
      expect(captured).toBeDefined();
      expect(captured!.ring.strokeColor).toBe(THEME.teams.enemy.primary);
      expect(captured!.ring.fillColor).toBe(THEME.teams.enemy.glow);
      expect(captured!.ring.strokeAlpha).toBe(0.95);
      expect(captured!.sprite.texture.key).toContain('_enemy');
      verifyPresentation(866);

      resizeTo(scene, 400, 720);
      vi.advanceTimersByTime(250);
      verifyPresentation(720);
      scene.events.emit('shutdown');
      for (const visual of initialVisuals.values()) {
        expect(visual.unitBadge.destroyed).toBe(true);
        expect(visual.unitText.destroyed).toBe(true);
        expect(visual.typeIcon.destroyed).toBe(true);
      }
    },
  );

  it('keeps missing-ground grounding and flat anchors through resize and capture', () => {
    const scene = createGameScene('crown_cross', false);
    const probe = scene as unknown as {
      hasGroundPlate: boolean;
      gameState: { territories: Record<string, Territory> };
      territoryVisuals: Map<string, {
        container: InstanceType<typeof MockGameObject>;
        basePlate: InstanceType<typeof MockGameObject>;
        ring: InstanceType<typeof MockGameObject>;
      }>;
    };
    expect(probe.hasGroundPlate).toBe(false);
    resizeTo(scene, 400, 866);
    vi.advanceTimersByTime(250);
    probe.gameState.territories['p_base'] = {
      ...probe.gameState.territories['p_base'], owner: 'enemy',
    };
    scene.updateTerritoryVisuals(true);

    const layout = createBoardLayout('crown_cross', 866);
    for (const [id, visual] of probe.territoryVisuals) {
      const territory = probe.gameState.territories[id];
      const anchor = layout.project(territory.x, territory.y);
      expect(visual.container.x).toBeCloseTo(anchor.u, 6);
      expect(visual.container.y).toBeCloseTo(anchor.v, 6);
      expect(visual.basePlate.fillAlpha).toBe(0.98);
      expect(visual.basePlate.strokeAlpha).toBe(0.95);
      expect(visual.basePlate.strokeColor).toBe(THEME.teams[territory.owner].dark);
      expect(visual.ring.strokeWidth).toBe(2);
      expect(visual.ring.strokeColor).toBe(THEME.teams[territory.owner].primary);
      expect(visual.ring.fillAlpha).toBe(0.06);
    }
    scene.events.emit('shutdown');
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
