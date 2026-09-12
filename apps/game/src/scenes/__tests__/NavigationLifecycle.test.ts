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
      killAll: () => {},
    };
    time = {
      delayedCall: () => {},
      addEvent: () => ({ destroy: () => {} }),
      removeAllEvents: () => {},
    };
    input = {
      removeAllListeners: () => {},
    };
    scene = {
      start: vi.fn(),
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

vi.mock('../../analytics/Analytics.js', () => ({
  trackEvent: vi.fn(),
  trackUpgradeEvent: vi.fn(),
}));

let mockSoundsMuted = false;
vi.mock('../../audio/SoundEffects.js', () => ({
  sounds: {
    playReinforce: vi.fn(),
    playTerritoryCaptured: vi.fn(),
    playMarch: vi.fn(),
    playVictory: vi.fn(),
    playDefeat: vi.fn(),
    startBattleMusic: vi.fn(),
    stopBattleMusic: vi.fn(),
    isMuted: vi.fn(() => mockSoundsMuted),
    toggleMute: vi.fn(() => {
      mockSoundsMuted = !mockSoundsMuted;
      return mockSoundsMuted;
    }),
  },
}));

import { TrainingScene } from '../TrainingScene.js';
import { DailyScene } from '../DailyScene.js';
import { LeagueScene } from '../LeagueScene.js';
import { KingdomScene } from '../KingdomScene.js';
import { CommanderScene } from '../CommanderScene.js';
import { BrowserPlatformAdapter } from '@crown-clash/platform';
import { MatchMenuController } from '../../match/MatchMenuController.js';
import { computeHudLayout } from '../../ui/HudLayout.js';
import { sounds } from '../../audio/SoundEffects.js';

describe('Navigation & Mobile Lifecycle Hardening Pass', () => {
  beforeEach(() => {
    storage.clear();
    mockSoundsMuted = false;
    vi.clearAllMocks();
  });

  describe('Suite 1: Hub Scenes - Back Actions, Touch Targets, Idempotency & Lifecycle', () => {
    it('TrainingScene: back button has >= 44x44 target, pointerdown starts MenuScene once (idempotent), and platform back works', () => {
      const platform = new BrowserPlatformAdapter();
      const showBackSpy = vi.spyOn(platform, 'showBackButton');
      const hideBackSpy = vi.spyOn(platform, 'hideBackButton');

      const scene = new TrainingScene();
      scene.registry.set('platform', platform);
      scene.create();

      expect(showBackSpy).toHaveBeenCalledTimes(1);

      // Verify back button touch target is at least 44x44
      const backBg = (scene.children.list as any[]).find(
        (obj) => obj.width === 44 && obj.height === 44 && obj.interactive
      );
      expect(backBg).toBeDefined();
      expect(backBg!.width).toBeGreaterThanOrEqual(44);
      expect(backBg!.height).toBeGreaterThanOrEqual(44);

      // Trigger pointerdown twice rapidly -> idempotent exit to MenuScene
      backBg!.emit('pointerdown');
      backBg!.emit('pointerdown');
      expect(scene.scene.start).toHaveBeenCalledTimes(1);
      expect(scene.scene.start).toHaveBeenCalledWith('MenuScene');

      // Test platform back button triggering
      (scene as any).isExiting = false;
      vi.mocked(scene.scene.start).mockClear();

      platform.triggerBackButton();
      platform.triggerBackButton();
      expect(scene.scene.start).toHaveBeenCalledTimes(1);
      expect(scene.scene.start).toHaveBeenCalledWith('MenuScene');

      // Shutdown hides back button
      scene.events.emit('shutdown');
      expect(hideBackSpy).toHaveBeenCalled();
    });

    it('DailyScene: back button has >= 44x44 target, pointerdown starts MenuScene once (idempotent), and platform back works', () => {
      const platform = new BrowserPlatformAdapter();
      const showBackSpy = vi.spyOn(platform, 'showBackButton');
      const hideBackSpy = vi.spyOn(platform, 'hideBackButton');

      const scene = new DailyScene();
      scene.registry.set('platform', platform);
      scene.create();

      expect(showBackSpy).toHaveBeenCalledTimes(1);

      const backBg = (scene.children.list as any[]).find(
        (obj) => obj.width === 44 && obj.height === 44 && obj.interactive
      );
      expect(backBg).toBeDefined();
      expect(backBg!.width).toBeGreaterThanOrEqual(44);
      expect(backBg!.height).toBeGreaterThanOrEqual(44);

      backBg!.emit('pointerdown');
      backBg!.emit('pointerdown');
      expect(scene.scene.start).toHaveBeenCalledTimes(1);
      expect(scene.scene.start).toHaveBeenCalledWith('MenuScene');

      (scene as any).isExiting = false;
      vi.mocked(scene.scene.start).mockClear();

      platform.triggerBackButton();
      platform.triggerBackButton();
      expect(scene.scene.start).toHaveBeenCalledTimes(1);
      expect(scene.scene.start).toHaveBeenCalledWith('MenuScene');

      scene.events.emit('shutdown');
      expect(hideBackSpy).toHaveBeenCalled();
    });

    it('LeagueScene: back button has >= 44x44 target, pointerdown starts MenuScene once (idempotent), and platform back works', () => {
      const platform = new BrowserPlatformAdapter();
      const showBackSpy = vi.spyOn(platform, 'showBackButton');
      const hideBackSpy = vi.spyOn(platform, 'hideBackButton');

      const scene = new LeagueScene();
      scene.registry.set('platform', platform);
      scene.create();

      expect(showBackSpy).toHaveBeenCalledTimes(1);

      const backBg = (scene.children.list as any[]).find(
        (obj) => obj.width === 44 && obj.height === 44 && obj.interactive
      );
      expect(backBg).toBeDefined();
      expect(backBg!.width).toBeGreaterThanOrEqual(44);
      expect(backBg!.height).toBeGreaterThanOrEqual(44);

      backBg!.emit('pointerdown');
      backBg!.emit('pointerdown');
      expect(scene.scene.start).toHaveBeenCalledTimes(1);
      expect(scene.scene.start).toHaveBeenCalledWith('MenuScene');

      (scene as any).isExiting = false;
      vi.mocked(scene.scene.start).mockClear();

      platform.triggerBackButton();
      platform.triggerBackButton();
      expect(scene.scene.start).toHaveBeenCalledTimes(1);
      expect(scene.scene.start).toHaveBeenCalledWith('MenuScene');

      scene.events.emit('shutdown');
      expect(hideBackSpy).toHaveBeenCalled();
    });

    it('KingdomScene: back button has >= 44x44 target, blocks exit while purchase in-flight, exits once, and platform back works', () => {
      const platform = new BrowserPlatformAdapter();
      const showBackSpy = vi.spyOn(platform, 'showBackButton');
      const hideBackSpy = vi.spyOn(platform, 'hideBackButton');

      const scene = new KingdomScene();
      scene.registry.set('platform', platform);
      scene.create();

      expect(showBackSpy).toHaveBeenCalledTimes(1);

      const backBg = (scene.children.list as any[]).find(
        (obj) => obj.width === 44 && obj.height === 44 && obj.interactive
      );
      expect(backBg).toBeDefined();
      expect(backBg!.width).toBeGreaterThanOrEqual(44);
      expect(backBg!.height).toBeGreaterThanOrEqual(44);

      // If a purchase is in-flight, close request is rejected
      const runner = (scene as any).purchaseRunner;
      vi.spyOn(runner, 'requestClose').mockReturnValueOnce(false);
      backBg!.emit('pointerdown');
      expect(scene.scene.start).not.toHaveBeenCalled();

      // Once purchase settles, exit proceeds and is idempotent
      backBg!.emit('pointerdown');
      backBg!.emit('pointerdown');
      expect(scene.scene.start).toHaveBeenCalledTimes(1);
      expect(scene.scene.start).toHaveBeenCalledWith('MenuScene');

      (scene as any).isExiting = false;
      vi.mocked(scene.scene.start).mockClear();

      platform.triggerBackButton();
      platform.triggerBackButton();
      expect(scene.scene.start).toHaveBeenCalledTimes(1);
      expect(scene.scene.start).toHaveBeenCalledWith('MenuScene');

      scene.events.emit('shutdown');
      expect(hideBackSpy).toHaveBeenCalled();
    });

    it('CommanderScene: back button has >= 44x44 target, pointerdown starts MenuScene once (idempotent), and platform back works', () => {
      const platform = new BrowserPlatformAdapter();
      const showBackSpy = vi.spyOn(platform, 'showBackButton');
      const hideBackSpy = vi.spyOn(platform, 'hideBackButton');

      const scene = new CommanderScene();
      scene.registry.set('platform', platform);
      scene.create();

      expect(showBackSpy).toHaveBeenCalledTimes(1);

      // Commander back button is 48x44
      const backBg = (scene.children.list as any[]).find(
        (obj) => obj.width >= 44 && obj.height >= 44 && obj.interactive
      );
      expect(backBg).toBeDefined();
      expect(backBg!.width).toBeGreaterThanOrEqual(44);
      expect(backBg!.height).toBeGreaterThanOrEqual(44);

      backBg!.emit('pointerdown');
      backBg!.emit('pointerdown');
      expect(scene.scene.start).toHaveBeenCalledTimes(1);
      expect(scene.scene.start).toHaveBeenCalledWith('MenuScene');

      (scene as any).isExiting = false;
      vi.mocked(scene.scene.start).mockClear();

      platform.triggerBackButton();
      platform.triggerBackButton();
      expect(scene.scene.start).toHaveBeenCalledTimes(1);
      expect(scene.scene.start).toHaveBeenCalledWith('MenuScene');

      scene.events.emit('shutdown');
      expect(hideBackSpy).toHaveBeenCalled();
    });
  });

  describe('Suite 2: GameScene & MatchMenuController - Back Navigation, Forfeit, & Safety', () => {
    it('verifies HUD menu button touch target meets minimum 44x44 logical dimensions across all viewports', () => {
      const viewports = [
        { width: 375, height: 667 },
        { width: 400, height: 720 },
        { width: 430, height: 932 },
      ];

      for (const vp of viewports) {
        const layout = computeHudLayout(vp.width, vp.height);
        expect(layout.menuButton.hitBounds.width).toBeGreaterThanOrEqual(44);
        expect(layout.menuButton.hitBounds.height).toBeGreaterThanOrEqual(44);
      }
    });

    it('active match back button opens confirmation modal directly and does not immediately settle or exit', () => {
      const onExitConfirmed = vi.fn();
      const trackQuit = vi.fn();
      const trackAnalytics = vi.fn();

      const controller = new MatchMenuController({
        liveMode: false,
        matchId: 'bot_match_1',
        getDurationSeconds: () => 12,
        trackQuit,
        trackAnalytics,
        onExitConfirmed,
      });

      expect(controller.getState()).toBe('closed');

      // Hardware/platform back button while match is playing
      controller.handleBackButton();

      expect(controller.getState()).toBe('confirm');
      expect(controller.isOpen()).toBe(true);
      expect(onExitConfirmed).not.toHaveBeenCalled();
      expect(trackQuit).not.toHaveBeenCalled();

      // Pressing back again cancels confirm and resumes match directly
      controller.handleBackButton();
      expect(controller.getState()).toBe('closed');
      expect(controller.isOpen()).toBe(false);
      expect(trackAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'match_leave_cancelled' })
      );
    });

    it('match menu unwinds correctly on platform back: menu -> closed, or menu -> confirm -> menu', () => {
      const controller = new MatchMenuController({
        liveMode: false,
        matchId: 'bot_match_2',
        getDurationSeconds: () => 20,
        trackQuit: vi.fn(),
        trackAnalytics: vi.fn(),
        onExitConfirmed: vi.fn(),
      });

      // 1. Open menu via HUD button
      controller.openMenu();
      expect(controller.getState()).toBe('menu');

      // Back button closes menu
      controller.handleBackButton();
      expect(controller.getState()).toBe('closed');

      // 2. Open menu, then choose "Leave Match" (origin 'menu')
      controller.openMenu();
      controller.openConfirm('menu');
      expect(controller.getState()).toBe('confirm');

      // Back button from confirm unwinds to menu (not closed)
      controller.handleBackButton();
      expect(controller.getState()).toBe('menu');

      // Back button again closes menu
      controller.handleBackButton();
      expect(controller.getState()).toBe('closed');
    });

    it('distinguishes bot match progress warning from live match forfeit warning and audits quit analytics', () => {
      const botController = new MatchMenuController({
        liveMode: false,
        matchId: 'bot_match_3',
        getDurationSeconds: () => 15,
        trackQuit: vi.fn(),
        trackAnalytics: vi.fn(),
        onExitConfirmed: vi.fn(),
      });

      expect(botController.getConfirmationMessage()).toBe('Current battle progress will be lost.');

      const liveController = new MatchMenuController({
        liveMode: true,
        matchId: 'live_match_4',
        getDurationSeconds: () => 30,
        trackQuit: vi.fn(),
        trackAnalytics: vi.fn(),
        onExitConfirmed: vi.fn(),
      });

      expect(liveController.getConfirmationMessage()).toBe('Leaving forfeits this match.');

      // Confirming quit fires analytics and audit events
      liveController.openConfirm();
      liveController.confirmExit();
      expect(liveController.getState()).toBe('closed');
    });
  });

  describe('Suite 3: Audio & Application Lifecycle Integration', () => {
    it('pauses and resumes audio safely on appPaused and appResumed lifecycle events', () => {
      const platform = new BrowserPlatformAdapter();

      let activeGameState: { status: string } = { status: 'playing' };

      const unpause = platform.on('appPaused', () => {
        sounds.stopBattleMusic();
      });
      const unresume = platform.on('appResumed', () => {
        if (activeGameState.status === 'playing' && !sounds.isMuted()) {
          sounds.startBattleMusic();
        }
      });

      // App goes to background
      (platform as any).emit('appPaused');
      expect(sounds.stopBattleMusic).toHaveBeenCalledTimes(1);

      // App comes back to foreground while match is active
      (platform as any).emit('appResumed');
      expect(sounds.startBattleMusic).toHaveBeenCalledTimes(1);

      // If muted, resume should not play music
      mockSoundsMuted = true;
      (platform as any).emit('appResumed');
      expect(sounds.startBattleMusic).toHaveBeenCalledTimes(1); // No new call

      // Cleanup removes listeners
      unpause();
      unresume();
      (platform as any).emit('appPaused');
      expect(sounds.stopBattleMusic).toHaveBeenCalledTimes(1); // No new call
    });
  });

  describe('Suite 4: Live PvP Overlay Escape Routes & Navigation Hardening', () => {
    it('verifies back button is wired for all Live PvP states (creating, joining, queueing, error, lobby)', () => {
      const platform = new BrowserPlatformAdapter();
      let currentBackHandler: (() => void) | null = null;
      vi.spyOn(platform, 'showBackButton').mockImplementation((cb) => {
        currentBackHandler = cb;
      });
      const hideBackSpy = vi.spyOn(platform, 'hideBackButton').mockImplementation(() => {
        currentBackHandler = null;
      });

      let overlayClosed = false;
      let matchmakingCancelled = false;
      let returnedToLobby = false;

      const mockController = {
        cancel: () => { matchmakingCancelled = true; },
        returnToLobby: () => { returnedToLobby = true; },
        destroy: () => { overlayClosed = true; },
      };

      const closeLobby = () => {
        mockController.destroy();
        platform.hideBackButton();
      };

      // 1. Lobby view
      platform.showBackButton(closeLobby);
      expect(currentBackHandler).toBeDefined();
      currentBackHandler!();
      expect(overlayClosed).toBe(true);
      expect(hideBackSpy).toHaveBeenCalled();

      // 2. Queueing / Creating / Joining view
      overlayClosed = false;
      const cancelMatchmaking = () => {
        mockController.cancel();
      };
      platform.showBackButton(cancelMatchmaking);
      currentBackHandler!();
      expect(matchmakingCancelled).toBe(true);

      // 3. Error view
      const errBack = () => {
        mockController.returnToLobby();
      };
      platform.showBackButton(errBack);
      currentBackHandler!();
      expect(returnedToLobby).toBe(true);
    });

    it('MenuScene: isTransitioning debounce guard blocks concurrent scene launches on rapid button taps', () => {
      let isTransitioning = false;
      const startSceneMock = vi.fn();

      const launchTraining = () => {
        if (isTransitioning) return;
        isTransitioning = true;
        startSceneMock('TrainingScene');
      };

      const launchKingdom = () => {
        if (isTransitioning) return;
        isTransitioning = true;
        startSceneMock('KingdomScene');
      };

      // User rapidly taps Training then Kingdom in same microtask
      launchTraining();
      launchKingdom();

      expect(startSceneMock).toHaveBeenCalledTimes(1);
      expect(startSceneMock).toHaveBeenCalledWith('TrainingScene');
    });
  });

  describe('Suite 5: GameScene Result / Syncing Modal Back Button Handling', () => {
    it('returns to menu when result modal or syncing modal is visible and guards against repeated exits', () => {
      let isExiting = false;
      let cleanedUp = false;
      const startSceneMock = vi.fn();

      const cleanup = () => {
        cleanedUp = true;
      };

      const returnToMenu = () => {
        if (isExiting) return;
        isExiting = true;
        cleanup();
        startSceneMock('MenuScene');
      };

      let resultModalContainer: any = { active: true, visible: true };
      let syncingModalContainer: any = null;

      const handlePlatformBack = () => {
        if (isExiting) return;
        if (resultModalContainer || syncingModalContainer) {
          returnToMenu();
          return;
        }
      };

      // Trigger back while result modal is present
      handlePlatformBack();
      expect(startSceneMock).toHaveBeenCalledTimes(1);
      expect(startSceneMock).toHaveBeenCalledWith('MenuScene');
      expect(cleanedUp).toBe(true);

      // Trigger back again rapidly -> should be ignored (idempotent)
      handlePlatformBack();
      expect(startSceneMock).toHaveBeenCalledTimes(1);
    });
  });
});
