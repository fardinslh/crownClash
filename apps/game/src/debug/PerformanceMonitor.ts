import type Phaser from 'phaser';

declare const __BUILD_VERSION__: string | undefined;
export const BUILD_VERSION =
  typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'v0.1.0-dev';

type ErrorSubscriber = (msg: string) => void;
const errorSubscribers = new Set<ErrorSubscriber>();
let nativeConsoleError: typeof console.error | null = null;

export function getErrorSubscriberCountForTesting(): number {
  return errorSubscribers.size;
}

function subscribeConsoleError(subscriber: ErrorSubscriber): () => void {
  if (typeof console === 'undefined') return () => {};
  if (nativeConsoleError === null) {
    nativeConsoleError = console.error;
    console.error = function (...args: any[]) {
      if (errorSubscribers.size > 0) {
        const msg = args
          .map((a) => (typeof a === 'string' ? a : a?.message || JSON.stringify(a) || String(a)))
          .join(' ')
          .slice(0, 200);
        for (const sub of Array.from(errorSubscribers)) {
          try {
            sub(msg);
          } catch {
            // ignore subscriber errors
          }
        }
      }
      nativeConsoleError?.apply(console, args);
    };
  }

  errorSubscribers.add(subscriber);

  return () => {
    errorSubscribers.delete(subscriber);
    if (errorSubscribers.size === 0 && nativeConsoleError !== null) {
      console.error = nativeConsoleError;
      nativeConsoleError = null;
    }
  };
}

const ROLLING_BUFFER_CAPACITY = 120; // 2 seconds of 60 FPS frames

export interface FrameStats {
  currentFps: number;
  avgFps: number;
  p50FrameTimeMs: number;
  p95FrameTimeMs: number;
  p99FrameTimeMs: number;
  maxFrameTimeMs: number;
  framesOver16Ms: number;
  framesOver16Pct: number;
  framesOver33Ms: number;
  framesOver33Pct: number;
}

export interface MemoryStats {
  supported: boolean;
  startMb: number | null;
  currentMb: number | null;
  peakMb: number | null;
}

export interface LifecycleStats {
  pauseCount: number;
  resumeCount: number;
  totalBackgroundSeconds: number;
}

export interface NetworkStats {
  disconnectCount: number;
  reconnectCount: number;
  currentStatus: 'online' | 'offline';
}

export interface CapturedError {
  timestamp: number;
  message: string;
}

export interface SessionQaReport {
  buildVersion: string;
  device: {
    userAgent: string;
    platform: string;
    dpr: number;
    viewport: { width: number; height: number };
    language: string;
    hardwareConcurrency: number;
  };
  renderer: 'WebGL' | 'Canvas' | 'Unknown';
  session: {
    startTime: number;
    durationSeconds: number;
  };
  framerate: FrameStats;
  peaks: {
    peakObjects: number;
    peakArmies: number;
    peakTweens: number;
  };
  memory: MemoryStats;
  lifecycle: LifecycleStats;
  network: NetworkStats;
  capturedErrors: CapturedError[];
}

export class PerformanceMonitor {
  private game: Phaser.Game | null = null;
  private sessionStartTime: number = Date.now();
  private startPerfTime: number = performance.now();
  private lastFrameTimestamp: number = performance.now();

  // Circular sample buffer
  private buffer = new Float64Array(ROLLING_BUFFER_CAPACITY);
  private bufferIndex = 0;
  private bufferCount = 0;
  private sortedScratch = new Float64Array(ROLLING_BUFFER_CAPACITY);

  // Cumulative frame counters
  private totalFrameCount = 0;
  private totalFrameDurationMs = 0;
  private framesOver16Count = 0;
  private framesOver33Count = 0;
  private maxFrameDurationMs = 0;

  // Peaks
  private peakObjects = 0;
  private peakArmies = 0;
  private peakTweens = 0;

  // Memory
  private startHeapMb: number | null = null;
  private peakHeapMb: number | null = null;

  // Lifecycle
  private pauseCount = 0;
  private resumeCount = 0;
  private backgroundStartTime: number | null = null;
  private totalBackgroundMs = 0;

  // Network
  private disconnectCount = 0;
  private reconnectCount = 0;

  // Error capture
  private capturedErrors: CapturedError[] = [];

  // Event cleanup
  private cleanupListeners: Array<() => void> = [];

  constructor(game?: Phaser.Game) {
    if (game) this.attachGame(game);
    this.initEnvironmentTracking();
  }

  public attachGame(game: Phaser.Game): void {
    this.game = game;
  }

  private initEnvironmentTracking(): void {
    // Initial memory sample
    const initialMem = this.readCurrentHeapMb();
    if (initialMem !== null) {
      this.startHeapMb = initialMem;
      this.peakHeapMb = initialMem;
    }

    if (typeof window !== 'undefined') {
      // Visibility tracking
      const onVisibilityChange = () => {
        if (document.hidden) {
          this.pauseCount++;
          this.backgroundStartTime = performance.now();
        } else {
          this.resumeCount++;
          if (this.backgroundStartTime !== null) {
            this.totalBackgroundMs += Math.max(0, performance.now() - this.backgroundStartTime);
            this.backgroundStartTime = null;
          }
        }
      };
      document.addEventListener('visibilitychange', onVisibilityChange);
      this.cleanupListeners.push(() => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      });

      // Network online/offline tracking
      const onOffline = () => {
        this.disconnectCount++;
      };
      const onOnline = () => {
        this.reconnectCount++;
      };
      window.addEventListener('offline', onOffline);
      window.addEventListener('online', onOnline);
      this.cleanupListeners.push(() => {
        window.removeEventListener('offline', onOffline);
        window.removeEventListener('online', onOnline);
      });

      // Console error capture via shared subscriber (max 20, no private data)
      const unsubError = subscribeConsoleError((msg) => {
        if (this.capturedErrors.length < 20) {
          this.capturedErrors.push({ timestamp: Date.now(), message: msg });
        }
      });
      this.cleanupListeners.push(unsubError);
    }
  }

  public recordFrame(deltaMs?: number): void {
    const now = performance.now();
    const frameDuration = deltaMs !== undefined ? deltaMs : Math.max(0.1, now - this.lastFrameTimestamp);
    this.lastFrameTimestamp = now;

    // Push into circular buffer
    this.buffer[this.bufferIndex] = frameDuration;
    this.bufferIndex = (this.bufferIndex + 1) % ROLLING_BUFFER_CAPACITY;
    if (this.bufferCount < ROLLING_BUFFER_CAPACITY) {
      this.bufferCount++;
    }

    // Cumulative tallies
    this.totalFrameCount++;
    this.totalFrameDurationMs += frameDuration;
    if (frameDuration > 16.7) this.framesOver16Count++;
    if (frameDuration > 33.3) this.framesOver33Count++;
    if (frameDuration > this.maxFrameDurationMs) {
      this.maxFrameDurationMs = frameDuration;
    }

    // Inspect peaks periodically
    this.sampleScenePeaks();
  }

  private sampleScenePeaks(): void {
    if (!this.game) return;
    try {
      const activeScene = this.getActiveScene();
      if (activeScene) {
        const objs = activeScene.children?.list?.length ?? 0;
        if (objs > this.peakObjects) this.peakObjects = objs;

        const tweens = activeScene.tweens?.getTweens?.()?.length ?? 0;
        if (tweens > this.peakTweens) this.peakTweens = tweens;

        const armies = (activeScene as any).gameState?.armies?.length ?? 0;
        if (armies > this.peakArmies) this.peakArmies = armies;
      }

      const heap = this.readCurrentHeapMb();
      if (heap !== null && (this.peakHeapMb === null || heap > this.peakHeapMb)) {
        this.peakHeapMb = heap;
      }
    } catch {
      // Avoid profiling crashes
    }
  }

  public getActiveScene(): Phaser.Scene | null {
    if (!this.game?.scene) return null;
    const scenes = this.game.scene.getScenes(true);
    return scenes.length > 0 ? scenes[0] : null;
  }

  private readCurrentHeapMb(): number | null {
    if (typeof window === 'undefined') return null;
    const mem = (window.performance as any)?.memory;
    if (mem && typeof mem.usedJSHeapSize === 'number') {
      return Math.round((mem.usedJSHeapSize / (1024 * 1024)) * 10) / 10;
    }
    return null;
  }

  public getFrameStats(): FrameStats {
    if (this.bufferCount === 0) {
      return {
        currentFps: 0,
        avgFps: 0,
        p50FrameTimeMs: 0,
        p95FrameTimeMs: 0,
        p99FrameTimeMs: 0,
        maxFrameTimeMs: 0,
        framesOver16Ms: 0,
        framesOver16Pct: 0,
        framesOver33Ms: 0,
        framesOver33Pct: 0,
      };
    }

    // Copy active samples into scratch buffer for sorting
    const n = this.bufferCount;
    for (let i = 0; i < n; i++) {
      this.sortedScratch[i] = this.buffer[i];
    }
    const view = this.sortedScratch.subarray(0, n);
    view.sort();

    const p50 = view[Math.min(n - 1, Math.floor(n * 0.5))];
    const p95 = view[Math.min(n - 1, Math.floor(n * 0.95))];
    const p99 = view[Math.min(n - 1, Math.floor(n * 0.99))];

    // Current FPS from most recent frame in ring buffer
    const lastIdx = (this.bufferIndex - 1 + ROLLING_BUFFER_CAPACITY) % ROLLING_BUFFER_CAPACITY;
    const lastDuration = this.buffer[lastIdx];
    const currentFps = lastDuration > 0 ? Math.min(120, Math.round((1000 / lastDuration) * 10) / 10) : 0;

    // Rolling average duration over active samples in ring buffer
    let sumRecent = 0;
    for (let i = 0; i < n; i++) sumRecent += view[i];
    const avgRecentDuration = sumRecent / n;
    const avgFps = avgRecentDuration > 0 ? Math.min(120, Math.round((1000 / avgRecentDuration) * 10) / 10) : 0;

    const framesOver16Pct =
      this.totalFrameCount > 0
        ? Math.round((this.framesOver16Count / this.totalFrameCount) * 1000) / 10
        : 0;
    const framesOver33Pct =
      this.totalFrameCount > 0
        ? Math.round((this.framesOver33Count / this.totalFrameCount) * 1000) / 10
        : 0;

    return {
      currentFps,
      avgFps,
      p50FrameTimeMs: Math.round(p50 * 10) / 10,
      p95FrameTimeMs: Math.round(p95 * 10) / 10,
      p99FrameTimeMs: Math.round(p99 * 10) / 10,
      maxFrameTimeMs: Math.round(this.maxFrameDurationMs * 10) / 10,
      framesOver16Ms: this.framesOver16Count,
      framesOver16Pct,
      framesOver33Ms: this.framesOver33Count,
      framesOver33Pct,
    };
  }

  public getMemoryStats(): MemoryStats {
    const currentMb = this.readCurrentHeapMb();
    if (currentMb !== null && (this.peakHeapMb === null || currentMb > this.peakHeapMb)) {
      this.peakHeapMb = currentMb;
    }
    return {
      supported: currentMb !== null,
      startMb: this.startHeapMb,
      currentMb,
      peakMb: this.peakHeapMb,
    };
  }

  public getLifecycleStats(): LifecycleStats {
    return {
      pauseCount: this.pauseCount,
      resumeCount: this.resumeCount,
      totalBackgroundSeconds: Math.round(this.totalBackgroundMs / 1000),
    };
  }

  public getNetworkStats(): NetworkStats {
    return {
      disconnectCount: this.disconnectCount,
      reconnectCount: this.reconnectCount,
      currentStatus:
        typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online',
    };
  }

  public getPeaks(): { peakObjects: number; peakArmies: number; peakTweens: number } {
    this.sampleScenePeaks();
    return {
      peakObjects: this.peakObjects,
      peakArmies: this.peakArmies,
      peakTweens: this.peakTweens,
    };
  }

  public reset(): void {
    this.buffer.fill(0);
    this.bufferIndex = 0;
    this.bufferCount = 0;
    this.totalFrameCount = 0;
    this.totalFrameDurationMs = 0;
    this.framesOver16Count = 0;
    this.framesOver33Count = 0;
    this.maxFrameDurationMs = 0;
    this.peakObjects = 0;
    this.peakArmies = 0;
    this.peakTweens = 0;
    const currentMem = this.readCurrentHeapMb();
    this.startHeapMb = currentMem;
    this.peakHeapMb = currentMem;
    this.sessionStartTime = Date.now();
    this.startPerfTime = performance.now();
    this.lastFrameTimestamp = performance.now();
    this.capturedErrors = [];
  }

  public generateReport(): SessionQaReport {
    this.sampleScenePeaks();
    const frameStats = this.getFrameStats();
    const memStats = this.getMemoryStats();
    const lifeStats = this.getLifecycleStats();
    const netStats = this.getNetworkStats();
    const peaks = this.getPeaks();

    let renderer: 'WebGL' | 'Canvas' | 'Unknown' = 'Unknown';
    if (this.game) {
      renderer = this.game.renderer?.type === 1 ? 'Canvas' : 'WebGL';
    }

    return {
      buildVersion: BUILD_VERSION,
      device: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Node/Unknown',
        platform: typeof navigator !== 'undefined' ? (navigator as any).userAgentData?.platform || navigator.platform || 'Unknown' : 'Unknown',
        dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
        viewport: {
          width: typeof window !== 'undefined' ? window.innerWidth : 0,
          height: typeof window !== 'undefined' ? window.innerHeight : 0,
        },
        language: typeof navigator !== 'undefined' ? navigator.language : 'en',
        hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1,
      },
      renderer,
      session: {
        startTime: this.sessionStartTime,
        durationSeconds: Math.round((performance.now() - this.startPerfTime) / 1000),
      },
      framerate: frameStats,
      peaks,
      memory: memStats,
      lifecycle: lifeStats,
      network: netStats,
      capturedErrors: [...this.capturedErrors],
    };
  }

  public generateQaReport(): SessionQaReport {
    return this.generateReport();
  }

  public destroy(): void {
    for (const unsub of this.cleanupListeners) {
      unsub();
    }
    this.cleanupListeners = [];
  }
}
