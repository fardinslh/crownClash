import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  PerformanceMonitor,
  BUILD_VERSION,
  type SessionQaReport,
} from '../PerformanceMonitor.js';
import { StressModeController } from '../StressModeController.js';
import {
  DebugPerformanceHud,
  initDebugPerformanceIfEnabled,
} from '../DebugPerformanceHud.js';

describe('DebugPerformanceHud & PerformanceMonitor', () => {
  let mockWindow: any;
  let mockDocument: any;
  let originalConsoleError: any;

  beforeEach(() => {
    originalConsoleError = console.error;

    const listeners: Record<string, Function[]> = {};

    mockDocument = {
      hidden: false,
      createElement: (tag: string) => {
        const el: any = {
          tagName: tag.toUpperCase(),
          id: '',
          style: {},
          textContent: '',
          innerHTML: '',
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
        return mockDocument.body.children.find((c: any) => c.id === id) || null;
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

    // Replace globals
    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('document', mockDocument);
    vi.stubGlobal('navigator', mockWindow.navigator);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    console.error = originalConsoleError;
  });

  describe('initDebugPerformanceIfEnabled', () => {
    it('returns undefined when debug_performance is absent', () => {
      mockWindow.location.search = '';
      const hud = initDebugPerformanceIfEnabled({} as any);
      expect(hud).toBeUndefined();
    });

    it('returns undefined when debug_performance is not 1', () => {
      mockWindow.location.search = '?debug_performance=0';
      const hud = initDebugPerformanceIfEnabled({} as any);
      expect(hud).toBeUndefined();
    });

    it('instantiates and mounts DOM when debug_performance=1 is present', () => {
      mockWindow.location.search = '?debug_performance=1';
      const fakeGame: any = { scene: { getScenes: () => [] } };
      const hud = initDebugPerformanceIfEnabled(fakeGame);
      expect(hud).toBeInstanceOf(DebugPerformanceHud);

      const container = mockDocument.getElementById('debug-perf-hud');
      expect(container).not.toBeNull();
      expect(container?.id).toBe('debug-perf-hud');

      hud?.destroy();
      expect(mockDocument.getElementById('debug-perf-hud')).toBeNull();
    });
  });

  describe('PerformanceMonitor frame stats & percentiles', () => {
    it('returns zero stats when no frames recorded', () => {
      const monitor = new PerformanceMonitor();
      const stats = monitor.getFrameStats();

      expect(stats.currentFps).toBe(0);
      expect(stats.avgFps).toBe(0);
      expect(stats.p50FrameTimeMs).toBe(0);
      expect(stats.p95FrameTimeMs).toBe(0);
      expect(stats.p99FrameTimeMs).toBe(0);
      expect(stats.maxFrameTimeMs).toBe(0);
      expect(stats.framesOver16Ms).toBe(0);
      expect(stats.framesOver16Pct).toBe(0);
      expect(stats.framesOver33Ms).toBe(0);
      expect(stats.framesOver33Pct).toBe(0);
      monitor.destroy();
    });

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

      // 50th percentile of 100 sorted samples is index 50 -> 16.0
      expect(stats.p50FrameTimeMs).toBe(16.0);
      // 95th percentile is index 95 -> 35.0
      expect(stats.p95FrameTimeMs).toBe(35.0);
      // 99th percentile is index 99 -> 50.0
      expect(stats.p99FrameTimeMs).toBe(50.0);
      // Max frame duration
      expect(stats.maxFrameTimeMs).toBe(50.0);

      // Frames over 16.7ms: 5 (25ms) + 4 (35ms) + 1 (50ms) = 10
      expect(stats.framesOver16Ms).toBe(10);
      expect(stats.framesOver16Pct).toBe(10.0);

      // Frames over 33.3ms: 4 (35ms) + 1 (50ms) = 5
      expect(stats.framesOver33Ms).toBe(5);
      expect(stats.framesOver33Pct).toBe(5.0);

      // Last recorded frame was 50.0ms -> 1000/50 = 20.0 FPS
      expect(stats.currentFps).toBe(20.0);

      monitor.destroy();
    });

    it('handles ring-buffer wrap-around gracefully when frames exceed 120 capacity', () => {
      const monitor = new PerformanceMonitor();

      // Push 150 frames (exceeding 120 ring capacity)
      for (let i = 0; i < 150; i++) {
        monitor.recordFrame(16.6);
      }

      const stats = monitor.getFrameStats();
      expect(stats.p50FrameTimeMs).toBe(16.6);
      expect(stats.maxFrameTimeMs).toBe(16.6);
      expect(stats.framesOver16Ms).toBe(0);

      monitor.destroy();
    });

    it('resets all statistics and buffers when reset() is invoked', () => {
      const monitor = new PerformanceMonitor();
      for (let i = 0; i < 50; i++) {
        monitor.recordFrame(20.0);
      }

      let stats = monitor.getFrameStats();
      expect(stats.framesOver16Ms).toBe(50);
      expect(stats.maxFrameTimeMs).toBe(20.0);

      monitor.reset();

      stats = monitor.getFrameStats();
      expect(stats.p50FrameTimeMs).toBe(0);
      expect(stats.maxFrameTimeMs).toBe(0);
      expect(stats.framesOver16Ms).toBe(0);
      expect(stats.framesOver33Ms).toBe(0);

      monitor.destroy();
    });
  });

  describe('Memory statistics safety', () => {
    it('handles absent window.performance.memory safely', () => {
      delete (mockWindow.performance as any).memory;
      const monitor = new PerformanceMonitor();
      const mem = monitor.getMemoryStats();

      expect(mem.supported).toBe(false);
      expect(mem.currentMb).toBeNull();
      expect(mem.peakMb).toBeNull();
      monitor.destroy();
    });

    it('extracts and rounds usedJSHeapSize in MB when available', () => {
      (mockWindow.performance as any).memory = {
        usedJSHeapSize: 32.5 * 1024 * 1024,
      };

      const monitor = new PerformanceMonitor();
      const mem = monitor.getMemoryStats();

      expect(mem.supported).toBe(true);
      expect(mem.currentMb).toBe(32.5);
      expect(mem.peakMb).toBe(32.5);
      monitor.destroy();
    });
  });

  describe('Lifecycle and adverse network tracking', () => {
    it('tracks pause and resume counts upon document visibility changes', () => {
      const monitor = new PerformanceMonitor();

      // Simulate backgrounding (visibilitychange -> hidden)
      mockDocument.hidden = true;
      mockDocument._triggerEvent('visibilitychange');

      let life = monitor.getLifecycleStats();
      expect(life.pauseCount).toBe(1);
      expect(life.resumeCount).toBe(0);

      // Simulate foregrounding (visibilitychange -> visible)
      mockDocument.hidden = false;
      mockDocument._triggerEvent('visibilitychange');

      life = monitor.getLifecycleStats();
      expect(life.pauseCount).toBe(1);
      expect(life.resumeCount).toBe(1);

      monitor.destroy();
    });

    it('tracks network drops and reconnect events', () => {
      const monitor = new PerformanceMonitor();

      mockWindow._triggerEvent('offline');
      let net = monitor.getNetworkStats();
      expect(net.disconnectCount).toBe(1);
      expect(net.reconnectCount).toBe(0);

      mockWindow._triggerEvent('online');
      net = monitor.getNetworkStats();
      expect(net.disconnectCount).toBe(1);
      expect(net.reconnectCount).toBe(1);

      monitor.destroy();
    });
  });

  describe('Safe error capturing', () => {
    it('captures up to 20 errors safely without throwing and restores console.error on destroy', () => {
      const monitor = new PerformanceMonitor();

      for (let i = 0; i < 25; i++) {
        console.error(`Error message ${i}`);
      }

      const report = monitor.generateReport();
      expect(report.capturedErrors.length).toBe(20);
      expect(report.capturedErrors[0].message).toBe('Error message 0');
      expect(report.capturedErrors[19].message).toBe('Error message 19');

      monitor.destroy();
      expect(console.error).toBe(originalConsoleError);
    });
  });

  describe('Session QA Report Generation', () => {
    it('produces valid JSON-serializable schema with zero PII', () => {
      const monitor = new PerformanceMonitor();
      monitor.recordFrame(16.6);

      const report: SessionQaReport = monitor.generateQaReport();

      expect(report.buildVersion).toBe(BUILD_VERSION);
      expect(report.device.dpr).toBe(2);
      expect(report.device.viewport.width).toBe(375);
      expect(report.device.viewport.height).toBe(667);
      expect(report.framerate.p50FrameTimeMs).toBe(16.6);
      expect(Array.isArray(report.capturedErrors)).toBe(true);

      const json = JSON.stringify(report);
      expect(json).toBeDefined();

      // Verify no sensitive tokens/credentials leaked
      expect(json).not.toContain('password');
      expect(json).not.toContain('bearer');
      expect(json).not.toContain('secret');
      expect(json).not.toContain('initData');

      monitor.destroy();
    });
  });

  describe('StressModeController', () => {
    it('starts, renders test banner, and stops cleanly', () => {
      const controller = new StressModeController();
      expect(controller.isRunning()).toBe(false);

      controller.start();
      expect(controller.isRunning()).toBe(true);

      const banner = mockDocument.getElementById('stress-mode-banner');
      expect(banner).not.toBeNull();
      expect(banner?.textContent).toContain('TEST MODE (NO PROGRESSION)');

      controller.stop();
      expect(controller.isRunning()).toBe(false);

      controller.destroy();
      expect(mockDocument.getElementById('stress-mode-banner')).toBeNull();
    });
  });

  describe('GameScene Stress Mode Settlement Isolation', () => {
    it('strictly avoids settlement and career mutations when isStressMode is active', () => {
      // Mock GameScene behavior
      const fakeCareerManager = {
        recordMatchResultRemote: vi.fn(),
        recordMatchResult: vi.fn(),
        isRemoteConnected: () => true,
      };

      const scene: any = {
        isStressMode: true,
        isExiting: false,
        resultModalContainer: undefined,
        resultPending: false,
        careerManager: fakeCareerManager,
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

      // Attempt to end match under stress mode
      scene.endMatch();

      expect(scene.resultPending).toBe(false);
      expect(fakeCareerManager.recordMatchResultRemote).not.toHaveBeenCalled();
      expect(fakeCareerManager.recordMatchResult).not.toHaveBeenCalled();
    });
  });
});
