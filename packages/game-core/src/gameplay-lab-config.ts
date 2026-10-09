export const ENGAGEMENT_VARIANTS = ['capture_recovery'] as const;
export type EngagementVariant = typeof ENGAGEMENT_VARIANTS[number];
export const LAB_TICK_SECONDS = 0.02;
export const LAB_AI_INTERVAL_TICKS = 90;
export const LAB_COMMON_CONFIG = Object.freeze({
  battlefieldId: 'crown_cross' as const, startingUnits: 20, sendFraction: 0.5, timeLimitSeconds: 90,
  captureProductionRecoveryTicks: 150, captureInitialProductionMultiplier: 0.5,
});
export function isEngagementVariant(value: unknown): value is EngagementVariant {
  return value === 'capture_recovery';
}
