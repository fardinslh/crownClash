import type { GameplayLabVariant } from './gameplay-rules.js';
export const ENGAGEMENT_VARIANTS = ['capture_recovery', 'capture_recovery_targets', 'capture_recovery_tactical', 'capture_recovery_upgrade'] as const;
export type EngagementVariant = typeof ENGAGEMENT_VARIANTS[number];
export const LAB_TICK_SECONDS = 0.02;
export const LAB_AI_INTERVAL_TICKS = 90;
export const LAB_FORECAST_TICKS = 250;
export const LAB_UPGRADE = Object.freeze({ cost: 12, multiplier: 1.5, botMinimumUnits: 24, paybackPeriods: 2 });
export const LAB_TARGET_PROFILE: Readonly<Record<string, readonly [
    number,
    number
]>> = Object.freeze({
    n_bot_left: [9, 1.4], n_top_right: [9, 1.4], n_bot_right: [6, 0.9], n_top_left: [6, 0.9],
    n_mid_left: [12, 1.1], n_mid_right: [12, 1.1], n_center: [16, 1.4],
});
export function isEngagementVariant(value: unknown): value is EngagementVariant {
    return ENGAGEMENT_VARIANTS.includes(value as EngagementVariant);
}
export function isLabUpgradeVariant(value: GameplayLabVariant): boolean { return value === 'capture_recovery_upgrade'; }
export const LAB_COMMON_CONFIG = Object.freeze({
    battlefieldId: 'crown_cross' as const, startingUnits: 20, sendFraction: 0.5, timeLimitSeconds: 90,
    captureProductionRecoveryTicks: 150, captureInitialProductionMultiplier: 0.5,
});
export const LAB_VARIANT_CONFIG: Record<EngagementVariant, {
    bot: 'baseline' | 'tactical';
    targets?: typeof LAB_TARGET_PROFILE;
    upgrade?: typeof LAB_UPGRADE;
}> = {
    capture_recovery: { bot: 'baseline' },
    capture_recovery_targets: { bot: 'baseline', targets: LAB_TARGET_PROFILE },
    capture_recovery_tactical: { bot: 'tactical' },
    capture_recovery_upgrade: { bot: 'baseline', upgrade: LAB_UPGRADE },
};
