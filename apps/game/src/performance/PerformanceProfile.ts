/**
 * Performance Profile & Device Capability Rules
 *
 * Provides documented capability detection for low-end mobile/WebView devices
 * and adaptive runtime performance degradation to ensure sustained 60 FPS gameplay
 * without compromising deterministic combat simulation or server-authoritative PvP.
 */

export interface DeviceCapabilities {
  hardwareConcurrency: number;
  deviceMemoryGb?: number;
  prefersReducedMotion: boolean;
  isLowEnd: boolean;
  recommendedRenderScale: number;
}

/**
 * Detects device hardware capability based on CPU cores, RAM, and motion preferences.
 * Low-end mobile devices (e.g. entry Android inside Bale/Eitaa WebViews):
 * - <= 4 CPU cores, OR
 * - <= 2 GB device memory, OR
 * - prefers-reduced-motion active.
 */
export function detectDeviceCapabilities(
  nav?: Partial<Navigator & { deviceMemory?: number }>,
  customDpr?: number
): DeviceCapabilities {
  const n = nav ?? (typeof navigator !== 'undefined' ? (navigator as Partial<Navigator & { deviceMemory?: number }>) : undefined);
  const hardwareConcurrency = n?.hardwareConcurrency ?? 4;
  const deviceMemoryGb = n?.deviceMemory;

  let prefersReducedMotion = false;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      prefersReducedMotion = false;
    }
  }

  const isLowEnd =
    hardwareConcurrency <= 4 ||
    (deviceMemoryGb !== undefined && deviceMemoryGb <= 2) ||
    prefersReducedMotion;

  const dpr = customDpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  // Clamping render scale on low-end devices avoids excessive fill-rate and fragment processing
  // on high-DPI screens without causing visible pixelation.
  const recommendedRenderScale = isLowEnd ? Math.min(dpr, 1.25) : Math.min(dpr, 2);

  return {
    hardwareConcurrency,
    deviceMemoryGb,
    prefersReducedMotion,
    isLowEnd,
    recommendedRenderScale,
  };
}

export interface AdaptivePerformanceOptions {
  initialReducedEffects?: boolean;
  degradeFpsThreshold?: number; // default 30 fps (33.3ms)
  recoverFpsThreshold?: number; // default 52 fps (19.2ms)
  degradeSampleCount?: number;  // consecutive frames below threshold to trigger degradation (default 120 ~2-3s)
  recoverSampleCount?: number;  // consecutive frames above threshold to restore effects (default 300 ~5s)
}

/**
 * Monitors frame rendering deltas in real-time and dynamically selects reduced-effects
 * when low-end hardware exhibits frame drops during intensive combat.
 */
export class AdaptivePerformanceController {
  private reducedEffects: boolean;
  private readonly baselineReducedEffects: boolean;
  private readonly degradeFpsThreshold: number;
  private readonly recoverFpsThreshold: number;
  private readonly degradeSampleCount: number;
  private readonly recoverSampleCount: number;

  private slowFrameCounter = 0;
  private fastFrameCounter = 0;
  private listeners: Array<(reduced: boolean) => void> = [];

  constructor(options: AdaptivePerformanceOptions = {}) {
    this.baselineReducedEffects = options.initialReducedEffects ?? false;
    this.reducedEffects = this.baselineReducedEffects;
    this.degradeFpsThreshold = options.degradeFpsThreshold ?? 30;
    this.recoverFpsThreshold = options.recoverFpsThreshold ?? 52;
    this.degradeSampleCount = options.degradeSampleCount ?? 120;
    this.recoverSampleCount = options.recoverSampleCount ?? 300;
  }

  public isReducedEffects(): boolean {
    return this.reducedEffects;
  }

  public setReducedEffects(enabled: boolean): void {
    if (this.reducedEffects === enabled) return;
    this.reducedEffects = enabled;
    for (const listener of this.listeners) {
      listener(enabled);
    }
  }

  public onChange(listener: (reduced: boolean) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Records a frame delta (in ms) and adjusts performance profile if sustained drops occur.
   */
  public recordFrameDelta(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    const instantFps = 1000 / deltaMs;

    if (!this.reducedEffects) {
      if (instantFps < this.degradeFpsThreshold) {
        this.slowFrameCounter++;
        if (this.slowFrameCounter >= this.degradeSampleCount) {
          this.setReducedEffects(true);
          this.slowFrameCounter = 0;
          this.fastFrameCounter = 0;
        }
      } else {
        this.slowFrameCounter = Math.max(0, this.slowFrameCounter - 1);
      }
    } else if (!this.baselineReducedEffects) {
      // Only auto-recover if the device wasn't initially configured as low-end / reduced motion
      if (instantFps >= this.recoverFpsThreshold) {
        this.fastFrameCounter++;
        if (this.fastFrameCounter >= this.recoverSampleCount) {
          this.setReducedEffects(false);
          this.fastFrameCounter = 0;
          this.slowFrameCounter = 0;
        }
      } else {
        this.fastFrameCounter = Math.max(0, this.fastFrameCounter - 1);
      }
    }
  }

  public reset(): void {
    this.slowFrameCounter = 0;
    this.fastFrameCounter = 0;
    this.reducedEffects = this.baselineReducedEffects;
  }
}
