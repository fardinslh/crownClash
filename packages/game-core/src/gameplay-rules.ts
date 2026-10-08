import { getBattlefield, type BattlefieldId } from './battlefields.js';

export type GameplayLabVariant = 'baseline' | 'roads' | 'capture_recovery';

export const LAB_RULES_VERSION = 2 as const;

export interface GameplayRules {
  readonly roadSpeedMultiplier: number;
  readonly captureProductionRecoveryTicks: number;
  readonly captureInitialProductionMultiplier: number;
}

export interface DispatchContext {
  readonly rules?: GameplayRules;
  readonly battlefieldId?: BattlefieldId;
}

export function gameplayLabRules(variant: GameplayLabVariant): GameplayRules | undefined {
  if (variant === 'baseline') return undefined;
  return {
    roadSpeedMultiplier: variant === 'roads' ? 1.25 : 1,
    captureProductionRecoveryTicks: variant === 'capture_recovery' ? 150 : 0,
    captureInitialProductionMultiplier: variant === 'capture_recovery' ? 0.5 : 1,
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
