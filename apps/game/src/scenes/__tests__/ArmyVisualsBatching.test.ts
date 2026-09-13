import { describe, expect, it, vi, beforeEach } from 'vitest';

const { MockScene, MockGameObject, MockGraphics, MockContainer, MockVector2, MockImage, MockRectangle, MockEllipse, MockCircle, MockText } = vi.hoisted(() => {
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
    tint: number = 0;
    fillColor: number = 0;
    strokeColor: number = 0;
    strokeWidth: number = 0;
    originX: number = 0;
    originY: number = 0;
    parentContainer: MockContainer | null = null;
    destroyed: boolean = false;
    visible: boolean = true;
    texture = { key: '' };
    kind: string = 'gameobject';

    constructor(kind: string, x = 0, y = 0, width = 0, height = 0) {
      this.kind = kind;
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
    }

    setVisible(v: boolean) { this.visible = v; return this; }
    setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
    setSize(w: number, h: number) { this.width = w; this.height = h; return this; }
    setDisplaySize(w: number, h: number) { this.width = w; this.height = h; return this; }
    setText(t: string) { this.text = t; return this; }
    setOrigin(x = 0.5, y = x) { this.originX = x; this.originY = y; return this; }
    setStrokeStyle(thickness: number, color: number, _alpha = 1) {
      this.strokeWidth = thickness;
      this.strokeColor = color;
      return this;
    }
    setFillStyle(color: number, _alpha = 1) { this.fillColor = color; return this; }
    setDepth(d: number) { this.depth = d; return this; }
    setAlpha(a: number) { this.alpha = a; return this; }
    setScale(x = 1, y = x) { this.scaleX = x; this.scaleY = y; return this; }
    setTint(color: number) { this.tint = color; return this; }
    setTexture(key: string) { this.texture.key = key; return this; }
    setFlipX(_flip: boolean) { return this; }
    setInteractive(_config?: any) { return this; }
    disableInteractive() { return this; }
    on(_event: string, _fn: Function) { return this; }
    off(_event: string, _fn: Function) { return this; }
    emit(_event: string, ..._args: any[]) { return this; }
    destroy() { this.destroyed = true; }
  }

  class MockContainer extends MockGameObject {
    list: MockGameObject[] = [];

    constructor(x = 0, y = 0) {
      super('Container', x, y);
    }

    add(child: MockGameObject | MockGameObject[]) {
      const items = Array.isArray(child) ? child : [child];
      for (const item of items) {
        item.parentContainer = this;
        this.list.push(item);
      }
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
    constructor() {
      super('Graphics');
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
    clear() { return this; }
  }

  class MockImage extends MockGameObject {
    constructor(x = 0, y = 0) { super('Image', x, y); }
  }
  class MockRectangle extends MockGameObject {
    constructor(x = 0, y = 0, w = 0, h = 0) { super('Rectangle', x, y, w, h); }
  }
  class MockEllipse extends MockGameObject {
    constructor(x = 0, y = 0, w = 0, h = 0) { super('Ellipse', x, y, w, h); }
  }
  class MockCircle extends MockGameObject {
    constructor(x = 0, y = 0, r = 0) { super('Circle', x, y, r * 2, r * 2); }
  }
  class MockText extends MockGameObject {
    constructor(x = 0, y = 0, text = '') {
      super('Text', x, y, 60, 20);
      this.text = text;
    }
  }

  class MockScene {
    registry = {
      data: new Map<string, any>(),
      get(k: string) { return this.data.get(k); },
      set(k: string, v: any) { this.data.set(k, v); },
    };

    events = {
      once: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    };

    textures = {
      store: new Map<string, any>(),
      exists(k: string) { return this.store.has(k); },
      addCanvas(k: string, canvas: any) { this.store.set(k, canvas); },
      remove(k: string) { this.store.delete(k); },
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
        const obj = new MockRectangle(x, y, w, h);
        if (color !== undefined) obj.fillColor = color;
        if (alpha !== undefined) obj.alpha = alpha;
        this.children.add(obj);
        return obj;
      },
      text: (x: number, y: number, text: string, _style?: any) => {
        const obj = new MockText(x, y, text);
        this.children.add(obj);
        return obj;
      },
      circle: (x: number, y: number, radius: number, color?: number, alpha?: number) => {
        const obj = new MockCircle(x, y, radius);
        if (color !== undefined) obj.fillColor = color;
        if (alpha !== undefined) obj.alpha = alpha;
        this.children.add(obj);
        return obj;
      },
      arc: (x: number, y: number, radius = 0, _start = 0, _end = 360, _anti = false, color?: number, alpha?: number) => {
        const obj = new MockCircle(x, y, radius);
        if (color !== undefined) obj.fillColor = color;
        if (alpha !== undefined) obj.alpha = alpha;
        this.children.add(obj);
        return obj;
      },
      ellipse: (x: number, y: number, w: number, h: number, color?: number, alpha?: number) => {
        const obj = new MockEllipse(x, y, w, h);
        if (color !== undefined) obj.fillColor = color;
        if (alpha !== undefined) obj.alpha = alpha;
        this.children.add(obj);
        return obj;
      },
      image: (x: number, y: number, key?: string) => {
        const obj = new MockImage(x, y);
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
        const obj = new MockGameObject('Zone', x, y, w, h);
        this.children.add(obj);
        return obj;
      },
    };

    tweens = {
      add: vi.fn(),
      killTweensOf: vi.fn(),
      killAll: vi.fn(),
    };

    time = {
      delayedCall: () => ({ destroy: () => {} }),
      addEvent: () => ({ destroy: () => {} }),
      removeAllEvents: () => {},
    };

    input = {
      removeAllListeners: () => {},
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    };

    scale = {
      width: 400,
      height: 720,
      gameSize: { width: 400, height: 720 },
      on: vi.fn(),
    };

    scene = {
      start: vi.fn(),
      restart: vi.fn(),
      isActive: vi.fn(() => true),
      key: 'GameScene',
      settings: {
        data: {
          mode: 'bot',
          botMatch: { matchId: 'bot_test_batching', battlefieldId: 'crown_cross' },
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

  return { MockScene, MockGameObject, MockGraphics, MockContainer, MockVector2, MockImage, MockRectangle, MockEllipse, MockCircle, MockText };
});

vi.mock('phaser', () => {
  return {
    default: {
      Scene: MockScene,
      GameObjects: {
        GameObject: MockGameObject,
        Container: MockContainer,
        Graphics: MockGraphics,
        Image: MockImage,
        Rectangle: MockRectangle,
        Ellipse: MockEllipse,
        Circle: MockCircle,
        Arc: MockCircle,
        Text: MockText,
      },
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
        Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)),
        Linear: (a: number, b: number, t: number) => a + (b - a) * t,
      },
      Scenes: {
        Events: {
          SHUTDOWN: 'shutdown',
        },
      },
    },
  };
});

import { GameScene } from '../GameScene.js';
import { BrowserPlatformAdapter } from '@crown-clash/platform';
import { TERRITORY_TYPE_PRESENTATION } from '@crown-clash/game-core';

describe('Army Visuals Batching Optimization', () => {
  let scene: GameScene;

  beforeEach(() => {
    vi.clearAllMocks();
    // Provide a mocked DOM canvas environment for node/vitest
    if (typeof document === 'undefined') {
      (globalThis as any).document = {
        createElement: (tag: string) => {
          if (tag === 'canvas') {
            return {
              width: 0,
              height: 0,
              getContext: () => ({
                createRadialGradient: () => ({ addColorStop: vi.fn() }),
                beginPath: vi.fn(),
                ellipse: vi.fn(),
                arc: vi.fn(),
                roundRect: vi.fn(),
                rect: vi.fn(),
                fill: vi.fn(),
                stroke: vi.fn(),
                scale: vi.fn(),
                measureText: (text: string) => ({ width: (text || '').length * 8 }),
              }),
            };
          }
          return {};
        },
      };
    }

    const platform = new BrowserPlatformAdapter();
    scene = new GameScene();
    scene.registry.set('platform', platform);
    scene.scene.settings.data = {
      mode: 'bot',
      botMatch: {
        matchId: 'bot_test_batching',
        battlefieldId: 'crown_cross',
      },
    };
    scene.create();
  });

  it('generates shared army visual textures during scene initialization', () => {
    expect(scene.textures.exists('cc_army_shadow')).toBe(true);
    expect(scene.textures.exists('cc_army_aura_normal')).toBe(true);
    expect(scene.textures.exists('cc_army_aura_fortress')).toBe(true);
  });

  it('creates batch-friendly Image instances for shadows, aura, and badge instead of Shape objects', () => {
    // Inject an active army into game state
    (scene as any).gameState.armies = [
      {
        id: 'army_1',
        owner: 'player',
        sourceId: 'p_base',
        targetId: 'n_center',
        units: 10,
        startX: 100,
        startY: 200,
        targetX: 200,
        targetY: 200,
        progress: 0.2,
      },
    ];

    // Trigger update to instantiate visuals
    (scene as any).updateArmyVisuals(0.016);

    const armyVisual = (scene as any).armyVisuals.get('player:army_1');
    expect(armyVisual).toBeDefined();

    // 1. Leader shadow MUST be an Image on MultiPipeline, not an Ellipse Shape
    expect(armyVisual.leaderShadow.kind).toBe('Image');
    expect(armyVisual.leaderShadow.texture.key).toBe('cc_army_shadow');
    expect(armyVisual.leaderShadow.tint).toBe(0x000000);

    // 2. Role aura MUST be an Image on MultiPipeline, not a Circle Shape
    expect(armyVisual.roleAura).toBeDefined();
    expect(armyVisual.roleAura.kind).toBe('Image');
    expect(armyVisual.roleAura.texture.key).toBe('cc_army_aura_fortress');
    expect(armyVisual.roleAura.tint).toBe(TERRITORY_TYPE_PRESENTATION.fortress.color);

    // 3. Follower shadows MUST be Images on MultiPipeline, not Ellipse Shapes
    expect(armyVisual.followers.length).toBeGreaterThan(0);
    for (const f of armyVisual.followers) {
      expect(f.shadow.kind).toBe('Image');
      expect(f.shadow.texture.key).toBe('cc_army_shadow');
      expect(f.shadow.tint).toBe(0x000000);
    }

    // 4. Badge background MUST be an Image on MultiPipeline, not a Rectangle Shape
    expect(armyVisual.badgeBg.kind).toBe('Image');
    expect(armyVisual.badgeBg.texture.key).toMatch(/^cc_badge_/);
  });

  it('organizes children within army container in pipeline-coherent order', () => {
    (scene as any).gameState.territories['p_base'].type = 'fortress';
    (scene as any).gameState.armies = [
      {
        id: 'army_2',
        owner: 'player',
        sourceId: 'p_base',
        targetId: 'n_center',
        units: 16, // >= 15 produces 3 followers
        startX: 100,
        startY: 200,
        targetX: 200,
        targetY: 200,
        progress: 0.1,
      },
    ];

    (scene as any).updateArmyVisuals(0.016);

    const armyVisual = (scene as any).armyVisuals.get('player:army_2');
    const children: Array<InstanceType<typeof MockGameObject>> = armyVisual.container.list;

    // Check layer order:
    // 0: Role aura (Image)
    // 1..3: Follower shadows (Image)
    // 4: Leader shadow (Image)
    // 5..7: Follower sprites (Image)
    // 8: Leader sprite (Image)
    // 9: Badge bg (Image)
    // 10: Badge text (Text)
    expect(children[0]).toBe(armyVisual.roleAura);
    expect(children[0].kind).toBe('Image');

    // All shadows come next (indices 1..4)
    for (let i = 1; i <= armyVisual.followers.length; i++) {
      expect(children[i]).toBe(armyVisual.followers[i - 1].shadow);
      expect(children[i].kind).toBe('Image');
    }
    expect(children[armyVisual.followers.length + 1]).toBe(armyVisual.leaderShadow);
    expect(children[armyVisual.followers.length + 1].kind).toBe('Image');

    // Unit sprites come next
    const spriteOffset = armyVisual.followers.length + 2;
    for (let i = 0; i < armyVisual.followers.length; i++) {
      expect(children[spriteOffset + i]).toBe(armyVisual.followers[i].sprite);
      expect(children[spriteOffset + i].kind).toBe('Image');
    }
    expect(children[spriteOffset + armyVisual.followers.length]).toBe(armyVisual.leaderSprite);

    // Badge bg then badge text
    expect(children[children.length - 2]).toBe(armyVisual.badgeBg);
    expect(children[children.length - 2].kind).toBe('Image');
    expect(children[children.length - 1]).toBe(armyVisual.badgeText);
    expect(children[children.length - 1].kind).toBe('Text');
  });

  it('updates badge texture when army units count changes', () => {
    (scene as any).gameState.armies = [
      {
        id: 'army_units_test',
        owner: 'player',
        sourceId: 'p_base',
        targetId: 'n_center',
        units: 5,
        startX: 100,
        startY: 200,
        targetX: 200,
        targetY: 200,
        progress: 0.1,
      },
    ];

    (scene as any).updateArmyVisuals(0.016);
    const armyVisual = (scene as any).armyVisuals.get('player:army_units_test');
    const initialKey = armyVisual.badgeBg.texture.key;

    // Change army units count (from single digit 5 to triple digit 120)
    (scene as any).gameState.armies[0].units = 120;
    (scene as any).updateArmyVisuals(0.016);

    expect(armyVisual.badgeText.text).toContain('120');
    expect(armyVisual.badgeBg.texture.key).not.toBe(initialKey);
    expect(armyVisual.badgeBg.texture.key).toMatch(/^cc_badge_/);
  });

  it('destroys all visual game objects without leaking when army finishes march', () => {
    (scene as any).gameState.armies = [
      {
        id: 'army_destroy_test',
        owner: 'player',
        sourceId: 'p_base',
        targetId: 'n_center',
        units: 8,
        startX: 100,
        startY: 200,
        targetX: 200,
        targetY: 200,
        progress: 0.1,
      },
    ];

    (scene as any).updateArmyVisuals(0.016);
    const armyVisual = (scene as any).armyVisuals.get('player:army_destroy_test');
    expect(armyVisual).toBeDefined();

    // Remove army to trigger destruction
    (scene as any).gameState.armies = [];
    (scene as any).updateArmyVisuals(0.016);

    expect(armyVisual.container.destroyed).toBe(true);
    expect(armyVisual.leaderSprite.destroyed).toBe(true);
    expect(armyVisual.leaderShadow.destroyed).toBe(true);
    expect(armyVisual.roleAura.destroyed).toBe(true);
    expect(armyVisual.badgeBg.destroyed).toBe(true);
    expect(armyVisual.badgeText.destroyed).toBe(true);
    for (const f of armyVisual.followers) {
      expect(f.sprite.destroyed).toBe(true);
      expect(f.shadow.destroyed).toBe(true);
    }
  });

  it('falls back gracefully to Shape objects if textures are not available', () => {
    // Create a new scene where texture manager has no custom textures
    const fallbackScene = new GameScene();
    fallbackScene.registry.set('platform', new BrowserPlatformAdapter());
    fallbackScene.scene.settings.data = {
      mode: 'bot',
      botMatch: { matchId: 'bot_fallback', battlefieldId: 'crown_cross' },
    };
    // Clear textures
    (fallbackScene as any).textures = {
      exists: () => false,
      addCanvas: vi.fn(),
    };
    fallbackScene.create();

    (fallbackScene as any).gameState.armies = [
      {
        id: 'army_fallback',
        owner: 'player',
        sourceId: 'p_base',
        targetId: 'n_center',
        units: 8,
        startX: 100,
        startY: 200,
        targetX: 200,
        targetY: 200,
        progress: 0.1,
      },
    ];

    (fallbackScene as any).updateArmyVisuals(0.016);

    const visual = (fallbackScene as any).armyVisuals.get('player:army_fallback');
    expect(visual).toBeDefined();
    // In fallback mode, it must gracefully produce Shape objects without crashing
    expect(visual.leaderShadow.kind).toBe('Ellipse');
    expect(visual.roleAura.kind).toBe('Circle');
    expect(visual.badgeBg.kind).toBe('Rectangle');
    for (const f of visual.followers) {
      expect(f.shadow.kind).toBe('Ellipse');
    }
  });
});
