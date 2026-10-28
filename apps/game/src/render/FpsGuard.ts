import { lowerRenderTier, parseRenderTier, type RenderTier } from './RenderProfile.js';

/** localStorage key holding the highest tier this device may use after a measured slow session. */
export const RENDER_TIER_CAP_KEY = 'cc_render_tier_cap';

export interface TierStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const readRenderTierCap = (storage: TierStorage | undefined): RenderTier | undefined => {
  try {
    return parseRenderTier(storage?.getItem(RENDER_TIER_CAP_KEY));
  } catch {
    return undefined;
  }
};

export const writeRenderTierCap = (storage: TierStorage | undefined, tier: RenderTier): void => {
  try {
    storage?.setItem(RENDER_TIER_CAP_KEY, tier);
  } catch {
    // Private mode or blocked storage: the guard simply cannot remember.
  }
};

export interface FpsGuardOptions {
  tier: RenderTier;
  /** Seconds of battle to average before judging. */
  windowSeconds?: number;
  /** Average FPS under this lowers the tier for the next launch. */
  minFps?: number;
  onDowngrade: (from: RenderTier, to: RenderTier, averageFps: number) => void;
}

export interface FpsGuard {
  /** Feed one sample while a battle is on screen; `seconds` is the time since the previous sample. */
  sample(fps: number, seconds: number): void;
  readonly judged: boolean;
}

/**
 * Judges the first stretch of a battle once. Samples with a hidden tab, zero fps or a stall of more than
 * a second are ignored so a backgrounded WebView never counts as slow. The result applies on the next
 * launch (textures and text bake the render scale, so there is no mid-session resolution jump).
 */
export function createFpsGuard(options: FpsGuardOptions): FpsGuard {
  const windowSeconds = options.windowSeconds ?? 20;
  const minFps = options.minFps ?? 40;
  let elapsed = 0;
  let weighted = 0;
  let judged = options.tier === 'low';
  return {
    get judged() {
      return judged;
    },
    sample(fps, seconds) {
      if (judged || !(fps > 0) || !(seconds > 0) || seconds > 1) return;
      elapsed += seconds;
      weighted += fps * seconds;
      if (elapsed < windowSeconds) return;
      judged = true;
      const average = weighted / elapsed;
      if (average < minFps) options.onDowngrade(options.tier, lowerRenderTier(options.tier), Math.round(average));
    },
  };
}
