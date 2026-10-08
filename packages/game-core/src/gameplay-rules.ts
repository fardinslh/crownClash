import { getBattlefield, type BattlefieldId } from './battlefields.js';
import { LAB_COMMON_CONFIG, LAB_VARIANT_CONFIG, isEngagementVariant } from './gameplay-lab-config.js';

export type GameplayLabVariant = 'baseline' | 'roads' | 'capture_recovery' | 'capture_recovery_targets' | 'capture_recovery_tactical' | 'capture_recovery_upgrade';

export const LAB_RULES_VERSION = 3 as const;

export interface GameplayRules {
  readonly roadSpeedMultiplier: number;
  readonly captureProductionRecoveryTicks: number;
  readonly captureInitialProductionMultiplier: number;
  readonly productionUpgrade?: { readonly cost: number; readonly multiplier: number };
}

export interface DispatchContext {
  readonly rules?: GameplayRules;
  readonly battlefieldId?: BattlefieldId;
}

export function gameplayLabRules(variant: GameplayLabVariant): GameplayRules | undefined {
  if (variant === 'baseline') return undefined;
  const profile = isEngagementVariant(variant) ? LAB_VARIANT_CONFIG[variant] : undefined;
  return {
    roadSpeedMultiplier: variant === 'roads' ? 1.25 : 1,
    captureProductionRecoveryTicks: profile ? LAB_COMMON_CONFIG.captureProductionRecoveryTicks : 0,
    captureInitialProductionMultiplier: profile ? LAB_COMMON_CONFIG.captureInitialProductionMultiplier : 1,
    ...(profile?.upgrade ? { productionUpgrade: profile.upgrade } : {}),
  };
}

/** A road bonus applies only to a direct edge; every other target remains reachable. */
export function isDirectRoadConnection(sourceId: string, targetId: string, context?: DispatchContext): boolean {
  return getBattlefield(context?.battlefieldId).roads.some(([a, b]) =>
    (a === sourceId && b === targetId) || (b === sourceId && a === targetId));
}

export function getDispatchRoadSpeedMultiplier(sourceId: string, targetId: string, context?: DispatchContext): number {
  const multiplier = context?.rules?.roadSpeedMultiplier ?? 1;
  return multiplier > 1 && isDirectRoadConnection(sourceId, targetId, context) ? multiplier : 1;
}

export function getCaptureProductionMultiplier(rules: GameplayRules | undefined, tick: number, readyTick = 0): number {
  const recovery = rules?.captureProductionRecoveryTicks ?? 0;
  if (recovery <= 0 || readyTick <= tick) return 1;
  const remainingFraction = Math.min(1, (readyTick - tick) / recovery);
  return 1 - (1 - rules!.captureInitialProductionMultiplier) * remainingFraction;
}
