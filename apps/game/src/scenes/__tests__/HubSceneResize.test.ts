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
    lineBetween(x1: number, y1: number, x2: number, y2: number) {
      this.commands.push(`line:${x1},${y1}-${x2},${y2}`);
      return this;
    }
    fillRoundedRect() { return this; }
    strokeRoundedRect() { return this; }
    fillCircle() { return this; }
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
        return {};
      },
      killTweensOf: () => {},
    };
    time = {
      delayedCall: () => {},
      addEvent: () => ({ destroy: () => {} }),
    };
    scene = {
      start: () => {},
      key: 'test',
    };
  }

  return { MockScene, MockGameObject, MockGraphics, MockContainer, storage };
});

vi.mock('phaser', () => {
  return {
    default: {
      Scene: MockScene,
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

import { TrainingScene } from '../TrainingScene.js';
import { DailyScene } from '../DailyScene.js';
import { LeagueScene } from '../LeagueScene.js';
import { KingdomScene } from '../KingdomScene.js';
import { CommanderScene } from '../CommanderScene.js';
import {
  computeTrainingLayout,
  computeDailyLayout,
  computeLeagueLayout,
  computeKingdomLayout,
  computeCommanderLayout,
} from '../../ui/HubLayouts.js';

interface TestGameObject {
  x: number;
  y: number;
  width: number;
  height: number;
  alpha: number;
  scaleX: number;
  scaleY: number;
  depth: number;
  text: string;
  color: string;
  fillColor: number;
  strokeColor: number;
  originX: number;
  originY: number;
  interactive: boolean;
  destroyed: boolean;
  visible: boolean;
  setVisible(v: boolean): this;
  setPosition(x: number, y: number): this;
  setX(x: number): this;
  setY(y: number): this;
  setSize(w: number, h: number): this;
  setText(t: string): this;
  setColor(c: string): this;
  setOrigin(x?: number, y?: number): this;
  setStrokeStyle(thickness: number, color: number, alpha?: number): this;
  setFillStyle(color: number, alpha?: number): this;
  setDepth(d: number): this;
  setAlpha(a: number): this;
  setScale(x?: number, y?: number): this;
  setInteractive(): this;
  disableInteractive(): this;
  on(event: string, fn: Function): this;
  off(event: string, fn: Function): this;
  emit(event: string, ...args: any[]): void;
  destroy(): void;
}

interface TestContainer extends TestGameObject {
  list: TestGameObject[];
  add(child: TestGameObject | TestGameObject[]): this;
  removeAll(destroy?: boolean): this;
}

describe('HubScene Live Resize Integration', () => {
  beforeEach(() => {
    storage.clear();
  });

  describe('TrainingScene', () => {
    it('initializes at 720, resizes live to 867, and returns to 720 without leaks', () => {
      const scene = new TrainingScene();
      (scene.scale as any).gameSize = { width: 400, height: 720 };
      scene.create();

      const baseLayout = computeTrainingLayout(720);
      const tallLayout = computeTrainingLayout(867);

      // Inspect scene state via private references
      const bg = (scene as any).background as TestGameObject;
      const dots = (scene as any).progressDots as TestGameObject[];
      const prevBtn = (scene as any).previousButton as TestGameObject;
      const nextBtn = (scene as any).nextButton as TestGameObject;
      const menuBg = (scene as any).menuBg as TestGameObject;
      const lessonContainer = (scene as any).lessonContainer as TestContainer;

      expect(bg.height).toBe(720);
      dots.forEach((dot) => expect(dot.y).toBe(baseLayout.dotsY));
      expect(prevBtn.y).toBe(baseLayout.navigationButtonsY);
      expect(nextBtn.y).toBe(baseLayout.navigationButtonsY);
      expect(menuBg.y).toBe(baseLayout.menuButtonY);
      expect(lessonContainer.y).toBe(baseLayout.cardOffset);

      // Verify state before resize (advance lesson from 0 to 1)
      expect((scene as any).lessonIndex).toBe(0);
      (scene as any).advance();
      expect((scene as any).lessonIndex).toBe(1);

      const childCountBefore = scene.children.list.length;
      const resizeListenerCount = scene.scale.listenerCount('resize');
      expect(resizeListenerCount).toBe(1);

      // 1. Live resize to tall phone (720 -> 867)
      (scene.scale as any).gameSize = { width: 400, height: 867 };
      scene.scale.emit('resize');

      expect(bg.height).toBe(867);
      dots.forEach((dot) => expect(dot.y).toBe(tallLayout.dotsY));
      expect(prevBtn.y).toBe(tallLayout.navigationButtonsY);
      expect(nextBtn.y).toBe(tallLayout.navigationButtonsY);
      expect(menuBg.y).toBe(tallLayout.menuButtonY);
      expect(lessonContainer.y).toBe(tallLayout.cardOffset);

      // No new objects or duplicate listeners accumulated
      expect(scene.children.list.length).toBe(childCountBefore);
      expect(scene.scale.listenerCount('resize')).toBe(1);
      // State survived
      expect((scene as any).lessonIndex).toBe(1);

      // 2. Live resize back to baseline phone (867 -> 720)
      (scene.scale as any).gameSize = { width: 400, height: 720 };
      scene.scale.emit('resize');

      expect(bg.height).toBe(720);
      dots.forEach((dot) => expect(dot.y).toBe(baseLayout.dotsY));
      expect(prevBtn.y).toBe(baseLayout.navigationButtonsY);
      expect(nextBtn.y).toBe(baseLayout.navigationButtonsY);
      expect(menuBg.y).toBe(baseLayout.menuButtonY);
      expect(lessonContainer.y).toBe(baseLayout.cardOffset);

      expect(scene.children.list.length).toBe(childCountBefore);
      expect(scene.scale.listenerCount('resize')).toBe(1);
      expect((scene as any).lessonIndex).toBe(1);
    });
  });

  describe('DailyScene', () => {
    it('initializes at 720, resizes live to 867, and returns to 720 without leaks', async () => {
      const scene = new DailyScene();
      (scene.scale as any).gameSize = { width: 400, height: 720 };
      scene.create();
      await (scene as any).loadState();

      const baseLayout = computeDailyLayout(720);
      const tallLayout = computeDailyLayout(867);

      const bg = (scene as any).background as TestGameObject;
      const resetText = (scene as any).resetText as TestGameObject;
      const statusText = (scene as any).statusText as TestGameObject;
      const missionCards = (scene as any).missionCards as TestContainer[];
      const chestCard = (scene as any).chestCard as TestContainer;
      const toastBg = (scene as any).toastBg as TestGameObject;

      expect(bg.height).toBe(720);
      expect(resetText.y).toBe(baseLayout.resetTextY);
      expect(statusText.y).toBe(baseLayout.statusTextY);
      missionCards.forEach((c, i) => expect(c.y).toBe(baseLayout.missionYs[i]));
      expect(chestCard.y).toBe(baseLayout.chestY);
      expect(toastBg.y).toBe(baseLayout.toastY);

      const childCountBefore = scene.children.list.length;
      expect(scene.scale.listenerCount('resize')).toBe(1);

      // 1. Live resize to tall phone (720 -> 867)
      (scene.scale as any).gameSize = { width: 400, height: 867 };
      scene.scale.emit('resize');

      expect(bg.height).toBe(867);
      expect(resetText.y).toBe(tallLayout.resetTextY);
      expect(statusText.y).toBe(tallLayout.statusTextY);
      missionCards.forEach((c, i) => expect(c.y).toBe(tallLayout.missionYs[i]));
      expect(chestCard.y).toBe(tallLayout.chestY);
      expect(toastBg.y).toBe(tallLayout.toastY);

      expect(scene.children.list.length).toBe(childCountBefore);
      expect(scene.scale.listenerCount('resize')).toBe(1);

      // 2. Live resize back to baseline (867 -> 720)
      (scene.scale as any).gameSize = { width: 400, height: 720 };
      scene.scale.emit('resize');

      expect(bg.height).toBe(720);
      expect(resetText.y).toBe(baseLayout.resetTextY);
      expect(statusText.y).toBe(baseLayout.statusTextY);
      missionCards.forEach((c, i) => expect(c.y).toBe(baseLayout.missionYs[i]));
      expect(chestCard.y).toBe(baseLayout.chestY);
      expect(toastBg.y).toBe(baseLayout.toastY);

      expect(scene.children.list.length).toBe(childCountBefore);
      expect(scene.scale.listenerCount('resize')).toBe(1);
    });
  });

  describe('LeagueScene', () => {
    it('initializes at 720, resizes live to 867, and returns to 720 without leaks', async () => {
      const scene = new LeagueScene();
      (scene.scale as any).gameSize = { width: 400, height: 720 };
      scene.create();
      await (scene as any).loadState();

      const baseLayout = computeLeagueLayout(720);
      const tallLayout = computeLeagueLayout(867);

      const bg = (scene as any).background as TestGameObject;
      const statusText = (scene as any).statusText as TestGameObject;
      const summaryContainer = (scene as any).summaryContainer as TestContainer;
      const tierRows = (scene as any).tierRows as TestContainer[];
      const kingdomBtnBg = (scene as any).kingdomButtonBg as TestGameObject;
      const toastBg = (scene as any).toastBg as TestGameObject;

      expect(bg.height).toBe(720);
      expect(statusText.y).toBe(baseLayout.statusTextY);
      expect(summaryContainer.y).toBe(baseLayout.summaryY);
      tierRows.forEach((r, i) => expect(r.y).toBe(baseLayout.tierYs[i]));
      expect(kingdomBtnBg.y).toBe(baseLayout.kingdomButtonY);
      expect(toastBg.y).toBe(baseLayout.toastY);

      const childCountBefore = scene.children.list.length;
      expect(scene.scale.listenerCount('resize')).toBe(1);

      // 1. Live resize to tall phone (720 -> 867)
      (scene.scale as any).gameSize = { width: 400, height: 867 };
      scene.scale.emit('resize');

      expect(bg.height).toBe(867);
      expect(statusText.y).toBe(tallLayout.statusTextY);
      expect(summaryContainer.y).toBe(tallLayout.summaryY);
      tierRows.forEach((r, i) => expect(r.y).toBe(tallLayout.tierYs[i]));
      expect(kingdomBtnBg.y).toBe(tallLayout.kingdomButtonY);
      expect(toastBg.y).toBe(tallLayout.toastY);

      expect(scene.children.list.length).toBe(childCountBefore);
      expect(scene.scale.listenerCount('resize')).toBe(1);

      // 2. Live resize back to baseline (867 -> 720)
      (scene.scale as any).gameSize = { width: 400, height: 720 };
      scene.scale.emit('resize');

      expect(bg.height).toBe(720);
      expect(statusText.y).toBe(baseLayout.statusTextY);
      expect(summaryContainer.y).toBe(baseLayout.summaryY);
      tierRows.forEach((r, i) => expect(r.y).toBe(baseLayout.tierYs[i]));
      expect(kingdomBtnBg.y).toBe(baseLayout.kingdomButtonY);
      expect(toastBg.y).toBe(baseLayout.toastY);

      expect(scene.children.list.length).toBe(childCountBefore);
      expect(scene.scale.listenerCount('resize')).toBe(1);
    });
  });

  describe('KingdomScene', () => {
    it('initializes with exact 700 toast baseline, resizes to 867, and returns to 720', () => {
      const scene = new KingdomScene();
      (scene.scale as any).gameSize = { width: 400, height: 720 };
      scene.create();

      const baseLayout = computeKingdomLayout(720);
      const tallLayout = computeKingdomLayout(867);

      // Mandatory assertion: kingdom baseline toast must equal 700 exactly
      expect(baseLayout.toastY).toBe(700);

      const bg = (scene as any).background as TestGameObject;
      const progressContainer = (scene as any).progressContainer as TestContainer;
      const toastBg = (scene as any).toastBg as TestGameObject;
      const cards = (scene as any).cards as Map<string, { container: TestContainer }>;

      expect(bg.height).toBe(720);
      expect(progressContainer.y).toBe(baseLayout.panelY - 84); // 0 at 720
      expect(toastBg.y).toBe(700);

      // Verify initial card positions
      let idx = 0;
      for (const card of cards.values()) {
        expect(card.container.x).toBe(baseLayout.cardPositions[idx].x);
        expect(card.container.y).toBe(baseLayout.cardPositions[idx].y);
        idx++;
      }

      const childCountBefore = scene.children.list.length;
      expect(scene.scale.listenerCount('resize')).toBe(1);

      // 1. Live resize to tall phone (720 -> 867)
      (scene.scale as any).gameSize = { width: 400, height: 867 };
      scene.scale.emit('resize');

      expect(bg.height).toBe(867);
      expect(progressContainer.y).toBe(tallLayout.panelY - 84);
      expect(toastBg.y).toBe(tallLayout.toastY);
      expect(tallLayout.toastY).toBe(847);

      idx = 0;
      for (const card of cards.values()) {
        expect(card.container.x).toBe(tallLayout.cardPositions[idx].x);
        expect(card.container.y).toBe(tallLayout.cardPositions[idx].y);
        idx++;
      }

      expect(scene.children.list.length).toBe(childCountBefore);
      expect(scene.scale.listenerCount('resize')).toBe(1);

      // 2. Live resize back to baseline (867 -> 720)
      (scene.scale as any).gameSize = { width: 400, height: 720 };
      scene.scale.emit('resize');

      expect(bg.height).toBe(720);
      expect(progressContainer.y).toBe(baseLayout.panelY - 84);
      expect(toastBg.y).toBe(700);

      idx = 0;
      for (const card of cards.values()) {
        expect(card.container.x).toBe(baseLayout.cardPositions[idx].x);
        expect(card.container.y).toBe(baseLayout.cardPositions[idx].y);
        idx++;
      }

      expect(scene.children.list.length).toBe(childCountBefore);
      expect(scene.scale.listenerCount('resize')).toBe(1);
    });
  });

  describe('CommanderScene', () => {
    it('initializes at 720, resizes live to 867, and returns to 720 without leaks', () => {
      const scene = new CommanderScene();
      (scene.scale as any).gameSize = { width: 400, height: 720 };
      scene.create();

      const baseLayout = computeCommanderLayout(720);
      const tallLayout = computeCommanderLayout(867);

      const bg = (scene as any).background as TestGameObject;
      const badge = (scene as any).powerBadgeText as TestGameObject;
      const cards = (scene as any).cards as TestContainer[];
      const helper = (scene as any).helperText as TestGameObject;

      expect(bg.height).toBe(720);
      expect(badge.y).toBe(baseLayout.powerBadgeY);
      cards.forEach((c, i) => expect(c.y).toBe(baseLayout.cardYs[i]));
      expect(helper.y).toBe(baseLayout.helperTextY);

      const childCountBefore = scene.children.list.length;
      expect(scene.scale.listenerCount('resize')).toBe(1);

      // 1. Live resize to tall phone (720 -> 867)
      (scene.scale as any).gameSize = { width: 400, height: 867 };
      scene.scale.emit('resize');

      expect(bg.height).toBe(867);
      expect(badge.y).toBe(tallLayout.powerBadgeY);
      cards.forEach((c, i) => expect(c.y).toBe(tallLayout.cardYs[i]));
      expect(helper.y).toBe(tallLayout.helperTextY);

      expect(scene.children.list.length).toBe(childCountBefore);
      expect(scene.scale.listenerCount('resize')).toBe(1);

      // 2. Live resize back to baseline (867 -> 720)
      (scene.scale as any).gameSize = { width: 400, height: 720 };
      scene.scale.emit('resize');

      expect(bg.height).toBe(720);
      expect(badge.y).toBe(baseLayout.powerBadgeY);
      cards.forEach((c, i) => expect(c.y).toBe(baseLayout.cardYs[i]));
      expect(helper.y).toBe(baseLayout.helperTextY);

      expect(scene.children.list.length).toBe(childCountBefore);
      expect(scene.scale.listenerCount('resize')).toBe(1);
    });
  });
});
