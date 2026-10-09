import type { BattlefieldId } from './battlefields.js';
import { LAB_COMMON_CONFIG, isEngagementVariant } from './gameplay-lab-config.js';

export type GameplayLabVariant = 'capture_recovery';

export const LAB_RULES_VERSION = 4 as const;

export interface GameplayRules {
  readonly captureProductionRecoveryTicks: number;
  readonly captureInitialProductionMultiplier: number;
}

export interface DispatchContext {
  readonly rules?: GameplayRules;
  readonly battlefieldId?: BattlefieldId;
}

export function gameplayLabRules(variant: GameplayLabVariant): GameplayRules {
  if (!isEngagementVariant(variant)) throw new Error('invalid_lab_variant');
  return {
    captureProductionRecoveryTicks: LAB_COMMON_CONFIG.captureProductionRecoveryTicks,
    captureInitialProductionMultiplier: LAB_COMMON_CONFIG.captureInitialProductionMultiplier,
  };
}

export function getCaptureProductionMultiplier(rules: GameplayRules | undefined, tick: number, readyTick = 0): number {
  const recovery = rules?.captureProductionRecoveryTicks ?? 0;
  if (recovery <= 0 || readyTick <= tick) return 1;
  const remainingFraction = Math.min(1, (readyTick - tick) / recovery);
  return 1 - (1 - rules!.captureInitialProductionMultiplier) * remainingFraction;
}
