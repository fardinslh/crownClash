/** Version 1 remains available only to replay matches issued before C shipped. */
export type GameplayRulesVersion = 1 | 2;
export const GAMEPLAY_RULES_VERSION = 2 as const;
export const CAPTURE_RECOVERY_MS = 3000;
export const CAPTURE_INITIAL_PRODUCTION_MULTIPLIER = 0.5;

export function validateGameplayRulesVersion(value: number): GameplayRulesVersion {
  if (value !== 1 && value !== GAMEPLAY_RULES_VERSION) throw new Error('unsupported_gameplay_rules_version');
  return value;
}

/** Integer deadlines keep authoritative snapshots and replay hashes stable across engines. */
export function getCaptureProductionMultiplier(elapsedSeconds: number, readyAtMs = 0): number {
  const remaining = Math.max(0, readyAtMs - Math.round(elapsedSeconds * 1000));
  return 1 - (1 - CAPTURE_INITIAL_PRODUCTION_MULTIPLIER) * Math.min(1, remaining / CAPTURE_RECOVERY_MS);
}
