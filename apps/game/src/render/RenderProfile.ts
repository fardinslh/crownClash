import type { PlatformType } from '@crown-clash/platform';

export type RenderTier = 'low' | 'mid' | 'high';

export interface RenderEnvironment {
  platform: PlatformType;
  devicePixelRatio: number;
  userAgent: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  /** Highest tier a past session proved this device can hold (see FpsGuard). */
  tierCap?: RenderTier;
}

export interface RenderProfile {
  renderer: 'auto' | 'canvas';
  renderScale: number;
  reducedEffects: boolean;
  tier: RenderTier;
  /** 'hd' asks for the large art set; only the high tier downloads it. */
  assetTier: 'sd' | 'hd';
}

/** The canvas never renders above this multiple of the 400x720 logical size. */
export const HIGH_TIER_MAX_SCALE = 3;
/** Minimum device pixel ratio, memory (GB) and cores for the high tier. */
const HIGH_TIER_MIN_DPR = 2.5;
const HIGH_TIER_MIN_MEMORY_GB = 6;
const HIGH_TIER_MIN_CORES = 6;
const HIGH_TIER_MIN_ANDROID = 10;

const TIER_ORDER: readonly RenderTier[] = ['low', 'mid', 'high'];

const getAndroidMajorVersion = (userAgent: string): number | undefined => {
  const match = /Android\s+(\d+)/i.exec(userAgent);
  return match ? Number.parseInt(match[1], 10) : undefined;
};

/** One step down the ladder; `low` stays `low`. */
export const lowerRenderTier = (tier: RenderTier): RenderTier => TIER_ORDER[Math.max(0, TIER_ORDER.indexOf(tier) - 1)];

const isRenderTier = (value: unknown): value is RenderTier => typeof value === 'string' && TIER_ORDER.includes(value as RenderTier);
export const parseRenderTier = (value: unknown): RenderTier | undefined => (isRenderTier(value) ? value : undefined);

const profileFor = (tier: RenderTier, environment: RenderEnvironment): RenderProfile => {
  const dpr = Math.max(environment.devicePixelRatio || 1, 1);
  if (tier === 'low') return { renderer: 'auto', renderScale: 1, reducedEffects: true, tier, assetTier: 'sd' };
  if (tier === 'mid') return { renderer: 'auto', renderScale: Math.min(dpr, 2), reducedEffects: false, tier, assetTier: 'sd' };
  return { renderer: 'auto', renderScale: Math.min(dpr, HIGH_TIER_MAX_SCALE), reducedEffects: false, tier, assetTier: 'hd' };
};

export const selectRenderProfile = (environment: RenderEnvironment): RenderProfile => {
  const androidMajor = getAndroidMajorVersion(environment.userAgent);
  const lowMemory =
    typeof environment.deviceMemory === 'number' && environment.deviceMemory <= 2;
  const legacyBaleAndroid =
    environment.platform === 'bale' &&
    ((androidMajor !== undefined && androidMajor <= 9) || lowMemory);

  if (legacyBaleAndroid) {
    // The measured Bale WebGL compositor stall: Canvas at 1x, never upgraded by a cap.
    return { renderer: 'canvas', renderScale: 1, reducedEffects: true, tier: 'low', assetTier: 'sd' };
  }

  const dpr = Math.max(environment.devicePixelRatio || 1, 1);
  const capable =
    dpr >= HIGH_TIER_MIN_DPR &&
    (environment.deviceMemory === undefined || environment.deviceMemory >= HIGH_TIER_MIN_MEMORY_GB) &&
    (environment.hardwareConcurrency === undefined || environment.hardwareConcurrency >= HIGH_TIER_MIN_CORES) &&
    (androidMajor === undefined || androidMajor >= HIGH_TIER_MIN_ANDROID);
  let tier: RenderTier = capable ? 'high' : 'mid';
  const cap = environment.tierCap;
  if (cap && TIER_ORDER.indexOf(cap) < TIER_ORDER.indexOf(tier)) tier = cap;
  return profileFor(tier, environment);
};
