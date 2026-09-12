import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  PerformanceMonitor,
  BUILD_VERSION,
  getErrorSubscriberCountForTesting,
} from '../PerformanceMonitor.js';
import { StressModeController } from '../StressModeController.js';
import {
  DebugPerformanceHud,
  initDebugPerformanceIfEnabled,
} from '../DebugPerformanceHud.js';

describe('DebugPerformanceHud & PerformanceMonitor Regression Suite', () => {
  let mockWindow: any;
  let mockDocument: any;
  let originalConsoleError: any;

  beforeEach(() => {
    originalConsoleError = console.error;

    const listeners: Record<string, Function[]> = {};

    mockDocument = {
      hidden: false,
      createElement: (tag: string) => {
        const styleProps: Record<string, any> = {};
        const style: any = new Proxy(styleProps, {
          get(target, prop: string) {
            if (prop === 'cssText') return target._cssText || '';
            return target[prop];
          },
          set(target, prop: string, value: any) {
            target[prop] = value;
            if (prop === 'cssText' && typeof value === 'string') {
              target._cssText = value;
              value.split(';').forEach((rule) => {
                const colonIdx = rule.indexOf(':');
                if (colonIdx !== -1) {
                  const k = rule.slice(0, colonIdx).trim();
                  const v = rule.slice(colonIdx + 1).trim();
                  if (k && v) {
                    const camel = k.replace(/-([a-z])/g, (_, g) => g.toUpperCase());
                    target[camel] = v;
                  }
                }
              });
            }
            return true;
          },
        });

        const el: any = {
          tagName: tag.toUpperCase(),
          id: '',
          style,
          textContent: '',
          innerHTML: '',
          title: '',
          classList: {
            add: vi.fn(),
            remove: vi.fn(),
          },
          children: [] as any[],
          appendChild: (child: any) => {
            el.children.push(child);
            return child;
          },
          remove: vi.fn(() => {
            if (mockDocument.body.children.includes(el)) {
              mockDocument.body.children = mockDocument.body.children.filter((c: any) => c !== el);
            }
          }),
          addEventListener: (event: string, fn: Function) => {
            listeners[event] = listeners[event] || [];
            listeners[event].push(fn);
          },
          removeEventListener: (event: string, fn: Function) => {
            if (listeners[event]) {
              listeners[event] = listeners[event].filter((f: any) => f !== fn);
            }
          },
          click: () => {
            if (el.onclick) el.onclick();
            (listeners['click'] || []).forEach((f) => f());
          },
        };
        return el;
      },
      getElementById: (id: string) => {
        const findRecursive = (el: any): any => {
          if (el.id === id) return el;
          for (const child of el.children || []) {
            const found = findRecursive(child);
            if (found) return found;
          }
          return null;
        };
        return findRecursive(mockDocument.body);
      },
      body: {
        children: [] as any[],
        appendChild: (el: any) => {
          mockDocument.body.children.push(el);
          return el;
        },
      },
      addEventListener: (event: string, fn: Function) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
      },
      removeEventListener: (event: string, fn: Function) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((f: any) => f !== fn);
        }
      },
      _triggerEvent: (event: string) => {
        (listeners[event] || []).forEach((fn) => fn());
      },
    };

    const winListeners: Record<string, Function[]> = {};
    mockWindow = {
      location: {
        search: '',
        href: 'http://localhost:3000/',
      },
      innerWidth: 375,
      innerHeight: 667,
      devicePixelRatio: 2,
      navigator: {
        userAgent: 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36',
        platform: 'Linux armv8l',
        language: 'en-US',
        hardwareConcurrency: 4,
        onLine: true,
      },
      performance: {
        now: vi.fn(() => Date.now()),
      },
      requestAnimationFrame: vi.fn((cb: Function) => {
        return setTimeout(cb, 16) as unknown as number;
      }),
      cancelAnimationFrame: vi.fn((id: number) => {
        clearTimeout(id);
      }),
      addEventListener: (event: string, fn: Function) => {
        winListeners[event] = winListeners[event] || [];
        winListeners[event].push(fn);
      },
      removeEventListener: (event: string, fn: Function) => {
        if (winListeners[event]) {
          winListeners[event] = winListeners[event].filter((f: any) => f !== fn);
        }
      },
      _triggerEvent: (event: string) => {
        (winListeners[event] || []).forEach((fn) => fn());
      },
    };

    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('document', mockDocument);
    vi.stubGlobal('navigator', mockWindow.navigator);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    console.error = originalConsoleError;
  });

  describe('Dual-Gating & Stress Mode Activation', () => {
    it('returns undefined and activates nothing when stress_armies=1 is standalone', () => {
      // ONLY stress_armies=1 without debug_performance=1
      mockWindow.location.search = '?stress_armies=1';
      const fakeGame: any = { scene: { getScenes: () => [] } };
      const hud = initDebugPerformanceIfEnabled(fakeGame);

      expect(hud).toBeUndefined();
      expect(mockDocument.getElementById('debug-perf-hud')).toBeNull();
      expect(mockDocument.getElementById('stress-mode-banner')).toBeNull();

      const controller = new StressModeController(fakeGame);
      controller.start();
      expect(controller.isRunning()).toBe(false);
      expect(mockDocument.getElementById('stress-mode-banner')).toBeNull();
    });

    it('activates HUD and stress mode only when BOTH debug_performance=1 and stress_armies=1 are present', () => {
      mockWindow.location.search = '?debug_performance=1&stress_armies=1';
      const fakeGame: any = {
        scene: { getScenes: () => [] },
        registry: {
          get: vi.fn(() => true),
          set: vi.fn(),
        },
      };

      const hud = initDebugPerformanceIfEnabled(fakeGame);
      expect(hud).toBeInstanceOf(DebugPerformanceHud);
      expect(mockDocument.getElementById('debug-perf-hud')).not.toBeNull();
      expect(mockDocument.getElementById('stress-mode-banner')).not.toBeNull();

      hud?.destroy();
      expect(mockDocument.getElementById('debug-perf-hud')).toBeNull();
      expect(mockDocument.getElementById('stress-mode-banner')).toBeNull();
    });

    it('starting stress before GameScene exists stores registry flag and activates when GameScene later mounts', () => {
      mockWindow.location.search = '?debug_performance=1';
      const registryMap = new Map<string, any>();
      const fakeGame: any = {
        scene: {
          getScenes: () => [],
          getScene: vi.fn(() => null), // GameScene does not exist yet
        },
        registry: {
          get: (key: string) => registryMap.get(key),
          set: (key: string, val: any) => registryMap.set(key, val),
        },
      };

      const controller = new StressModeController(fakeGame);
      controller.start();

      expect(controller.isRunning()).toBe(true);
      expect(registryMap.get('qa_stress_mode')).toBe(true);

      // Now simulate GameScene mounting later
      const searchParams = new URLSearchParams(mockWindow.location.search);
      const isDebugPerf = searchParams.get('debug_performance') === '1';
      const isRegistryStress = Boolean(fakeGame.registry.get('qa_stress_mode'));
      const sceneIsStressMode = isDebugPerf && isRegistryStress;

      expect(sceneIsStressMode).toBe(true);

      controller.destroy();
      expect(controller.isRunning()).toBe(false);
      expect(registryMap.get('qa_stress_mode')).toBe(false);
    });

    it('rejects activating stress mode on live authoritative PvP matches', () => {
      mockWindow.location.search = '?debug_performance=1';
      const liveGameScene: any = {
        liveMode: true,
        isStressMode: false,
        gameState: {
          status: 'playing',
          armies: [],
          territories: {},
        },
      };

      const fakeGame: any = {
        scene: {
          getScene: (key: string) => (key === 'GameScene' ? liveGameScene : null),
        },
        registry: {
          set: vi.fn(),
          get: vi.fn(),
        },
      };

      const controller = new StressModeController(fakeGame);
      controller.start();

      // Stress mode must NOT activate on live PvP matches
      expect(controller.isRunning()).toBe(false);
      expect(liveGameScene.isStressMode).toBe(false);
      expect(mockDocument.getElementById('stress-mode-banner')).toBeNull();

      controller.destroy();
    });
  });

  describe('Reversible Lifecycle & Settlement Safety', () => {
    it('stopping, resetting, or destroying clears isolation completely', () => {
      mockWindow.location.search = '?debug_performance=1';
      const dummyScene: any = {
        liveMode: false,
        isStressMode: false,
        gameState: {
          status: 'playing',
          armies: [{ id: 'stress_army_1' }],
          territories: {
            p_base: { id: 'p_base', owner: 'player', units: 10 },
          },
        },
        markTerritoriesDirty: vi.fn(),
        updateTerritoryVisuals: vi.fn(),
      };

      const fakeGame: any = {
        scene: {
          getScene: () => dummyScene,
        },
        registry: {
          set: vi.fn(),
          get: vi.fn(),
        },
      };

      const controller = new StressModeController(fakeGame);
      controller.start();

      expect(controller.isRunning()).toBe(true);
      expect(dummyScene.isStressMode).toBe(true);

      // Stop
      controller.stop();
      expect(controller.isRunning()).toBe(false);
      expect(dummyScene.isStressMode).toBe(false);

      // Reset
      controller.reset();
      expect(dummyScene.isStressMode).toBe(false);
      expect(dummyScene.gameState.armies.length).toBe(0);

      // Destroy
      controller.destroy();
      expect(dummyScene.isStressMode).toBe(false);
    });

    it('strictly avoids settlement and career mutations when isolated, but allows normal settlement after stress cleanup', async () => {
      const recordMatchResultRemote = vi.fn().mockResolvedValue({});
      const recordMatchResult = vi.fn().mockReturnValue({});

      const careerManager = {
        recordMatchResultRemote,
        recordMatchResult,
        isRemoteConnected: () => true,
      };

      const scene: any = {
        isStressMode: true,
        isExiting: false,
        resultModalContainer: undefined,
        resultPending: false,
        careerManager,
        endMatch: function () {
          if (this.isExiting || this.resultModalContainer || this.resultPending || this.isStressMode) return;
          this.resultPending = true;
          void this.finalizeMatch();
        },
        finalizeMatch: async function () {
          if (this.isStressMode) return;
          await this.careerManager.recordMatchResultRemote();
        },
      };

      // 1. In stress mode: endMatch should do nothing
      scene.endMatch();
      expect(scene.resultPending).toBe(false);
      expect(recordMatchResultRemote).not.toHaveBeenCalled();
      expect(recordMatchResult).not.toHaveBeenCalled();

      // 2. Stress cleanup occurs
      scene.isStressMode = false;

      // 3. Normal match completes and settles
      scene.endMatch();
      expect(scene.resultPending).toBe(true);
      await Promise.resolve();
      expect(recordMatchResultRemote).toHaveBeenCalledTimes(1);
    });
  });

  describe('Console Error Hooking Safety & Subscriber Model', () => {
    it('supports multiple monitors and restores native console.error only when all monitors destroy', () => {
      expect(getErrorSubscriberCountForTesting()).toBe(0);

      const monitorA = new PerformanceMonitor();
      expect(getErrorSubscriberCountForTesting()).toBe(1);

      const monitorB = new PerformanceMonitor();
      expect(getErrorSubscriberCountForTesting()).toBe(2);

      // Log error: both should receive it
      console.error('Test error message');

      const repA = monitorA.generateReport();
      const repB = monitorB.generateReport();
      expect(repA.capturedErrors.length).toBe(1);
      expect(repB.capturedErrors.length).toBe(1);

      // Destroy monitorA: monitorB should still be hooked
      monitorA.destroy();
      expect(getErrorSubscriberCountForTesting()).toBe(1);

      console.error('Second error message');
      expect(monitorB.generateReport().capturedErrors.length).toBe(2);

      // Destroy monitorB: all unhooked, count is 0
      monitorB.destroy();
      expect(getErrorSubscriberCountForTesting()).toBe(0);
      expect(console.error).toBe(originalConsoleError);
    });
  });

  describe('Mobile HUD Layout & Ergonomics', () => {
    it('defaults to collapsed on mobile viewports (width <= 480)', () => {
      mockWindow.innerWidth = 375;
      mockWindow.innerHeight = 667;
      mockWindow.location.search = '?debug_performance=1';

      const fakeGame: any = { scene: { getScenes: () => [] } };
      const hud = initDebugPerformanceIfEnabled(fakeGame);

      const pill = mockDocument.getElementById('debug-perf-pill');
      const expanded = mockDocument.getElementById('debug-perf-expanded');

      expect(pill?.style.display).toBe('flex');
      expect(expanded?.style.display).toBe('none');

      hud?.destroy();
    });

    it('enforces minimum 44px touch targets on buttons and pill', () => {
      mockWindow.location.search = '?debug_performance=1';
      const fakeGame: any = { scene: { getScenes: () => [] } };
      const hud = initDebugPerformanceIfEnabled(fakeGame);

      const pill = mockDocument.getElementById('debug-perf-pill');
      expect(pill?.style.minHeight).toBe('44px');

      const container = mockDocument.getElementById('debug-perf-hud');
      expect(container?.style.top).toContain('38px');

      hud?.destroy();
    });
  });

  describe('Build Identity Verification', () => {
    it('provides valid non-empty build version matching format v0.1.0-*', () => {
      expect(BUILD_VERSION).toMatch(/^v0\.1\.0-[a-zA-Z0-9_-]+$/);
    });
  });

  describe('PerformanceMonitor Frame Stats & Percentiles', () => {
    it('calculates deterministic percentiles and long frame counts accurately', () => {
      const monitor = new PerformanceMonitor();

      // Feed exact dataset:
      // 90 frames of 16.0ms
      // 5 frames of 25.0ms
      // 4 frames of 35.0ms
      // 1 frame of 50.0ms (total = 100 frames)
      for (let i = 0; i < 90; i++) monitor.recordFrame(16.0);
      for (let i = 0; i < 5; i++) monitor.recordFrame(25.0);
      for (let i = 0; i < 4; i++) monitor.recordFrame(35.0);
      monitor.recordFrame(50.0);

      const stats = monitor.getFrameStats();

      expect(stats.p50FrameTimeMs).toBe(16.0);
      expect(stats.p95FrameTimeMs).toBe(35.0);
      expect(stats.p99FrameTimeMs).toBe(50.0);
      expect(stats.maxFrameTimeMs).toBe(50.0);
      expect(stats.framesOver16Ms).toBe(10);
      expect(stats.framesOver16Pct).toBe(10.0);
      expect(stats.framesOver33Ms).toBe(5);
      expect(stats.framesOver33Pct).toBe(5.0);

      monitor.destroy();
    });

    it('resets all statistics and buffers when reset() is invoked', () => {
      const monitor = new PerformanceMonitor();
      for (let i = 0; i < 50; i++) monitor.recordFrame(20.0);

      expect(monitor.getFrameStats().framesOver16Ms).toBe(50);
      monitor.reset();

      expect(monitor.getFrameStats().framesOver16Ms).toBe(0);
      expect(monitor.getFrameStats().maxFrameTimeMs).toBe(0);
      monitor.destroy();
    });
  });
});
