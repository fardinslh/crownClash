/**
 * Battle feedback tiers. Low-end devices (reducedEffects) used to share the
 * prefers-reduced-motion switch and lost every pop and ring, which made
 * battles feel lifeless on exactly the phones most players use. Tweens on
 * existing objects are cheap; particles, camera shake and full-screen
 * flashes are what cost frames, so only those are dropped on `lite`.
 */
export type FeelTier = 'full' | 'lite' | 'still';

export interface FeelProfile {
  readonly tier: FeelTier;
  /** Scale pops / squash on towers and badges. */
  readonly pops: boolean;
  readonly shake: boolean;
  readonly particles: boolean;
  /** Additive flash circles and camera flashes. */
  readonly flash: boolean;
  /** Counter text steps through intermediate values instead of jumping. */
  readonly rollCounts: boolean;
  /** Impact rings expand (a still ring only fades). */
  readonly expandingRings: boolean;
}

/** Largest pop allowed when the player asked the OS to reduce motion. */
const STILL_MAX_POP = 1.05;

export function resolveFeelProfile(input: { reducedEffects: boolean; prefersReducedMotion: boolean }): FeelProfile {
  if (input.prefersReducedMotion) {
    return { tier: 'still', pops: true, shake: false, particles: false, flash: false, rollCounts: false, expandingRings: false };
  }
  if (input.reducedEffects) {
    return { tier: 'lite', pops: true, shake: false, particles: false, flash: false, rollCounts: false, expandingRings: true };
  }
  return { tier: 'full', pops: true, shake: true, particles: true, flash: true, rollCounts: true, expandingRings: true };
}

/** Clamps a pop scale to what the profile allows (1 = no pop). */
export function popScale(profile: FeelProfile, scale: number): number {
  if (!profile.pops) return 1;
  if (profile.tier === 'still') return Math.min(scale, STILL_MAX_POP);
  return scale;
}
