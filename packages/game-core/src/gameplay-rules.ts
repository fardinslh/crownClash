/** Version 1 remains available only to replay matches issued before C shipped. */
export type GameplayRulesVersion = 1 | 2 | 3 | 4;
/** Live matches retain v2; async tickets negotiate the highest shared version (v3 or v4). */
export const GAMEPLAY_RULES_VERSION = 2 as const;
export const TACTICAL_RULES_VERSION = 3 as const;
/** v3 tactics plus commander abilities and fog of war (async/bot only). */
export const TACTICAL_V4_RULES_VERSION = 4 as const;
export const TACTICAL_CONFIG = Object.freeze({ baseBonus: 8, supportUnits: 14, minLegSeconds: 2 });
export const hasCaptureRecovery = (version: number | undefined): boolean => version === 2 || version === 3 || version === 4;
/** Road-routed supply, one-road attacks and the tactical opening (v3 and later). */
export const usesTacticalRules = (version: number | undefined): boolean => version === 3 || version === 4;
export const hasCommanderAbilities = (version: number | undefined): boolean => version === 4;
export const hasFogOfWar = (version: number | undefined): boolean => version === 4;
export const CAPTURE_RECOVERY_MS = 3000;
export const CAPTURE_INITIAL_PRODUCTION_MULTIPLIER = 0.5;

export function validateGameplayRulesVersion(value: number): GameplayRulesVersion {
  if (value !== 1 && value !== 2 && value !== 3 && value !== 4) throw new Error('unsupported_gameplay_rules_version');
  return value;
}

/** Integer deadlines keep authoritative snapshots and replay hashes stable across engines. */
export function getCaptureProductionMultiplier(elapsedSeconds: number, readyAtMs = 0): number {
  const remaining = Math.max(0, readyAtMs - Math.round(elapsedSeconds * 1000));
  return 1 - (1 - CAPTURE_INITIAL_PRODUCTION_MULTIPLIER) * Math.min(1, remaining / CAPTURE_RECOVERY_MS);
}
