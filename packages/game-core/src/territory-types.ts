import type { Territory, TerritoryType } from './types.js';

export const FORTRESS_DEFENSE_MULTIPLIER = 1.25;
export const BARRACKS_PRODUCTION_MULTIPLIER = 1.25;
export const STABLE_ARMY_SPEED_MULTIPLIER = 1.25;

export interface TerritoryTypePresentation {
  label: 'DEF' | 'PROD' | 'SPD';
  color: number;
}

export const TERRITORY_TYPE_PRESENTATION: Record<TerritoryType, TerritoryTypePresentation> = {
  fortress: { label: 'DEF', color: 0xf59e0b },
  barracks: { label: 'PROD', color: 0x34d399 },
  stable: { label: 'SPD', color: 0x38bdf8 },
};

export function getTerritoryDefenseMultiplier(type: TerritoryType): number {
  return type === 'fortress' ? FORTRESS_DEFENSE_MULTIPLIER : 1;
}

/** `bonus` is an extra defence multiplier (the v4 royal shield); 1 keeps the base rule. */
export function getTerritoryDefenseStrength(territory: Territory, bonus = 1): number {
  return Math.ceil(territory.units * (getTerritoryDefenseMultiplier(territory.type) * bonus));
}

export function getRemainingDefenders(type: TerritoryType, effectiveUnits: number, bonus = 1): number {
  return Math.ceil(effectiveUnits / (getTerritoryDefenseMultiplier(type) * bonus));
}

export function getTerritoryProductionMultiplier(type: TerritoryType): number {
  return type === 'barracks' ? BARRACKS_PRODUCTION_MULTIPLIER : 1;
}

export function getTerritoryArmySpeedMultiplier(type: TerritoryType): number {
  return type === 'stable' ? STABLE_ARMY_SPEED_MULTIPLIER : 1;
}
