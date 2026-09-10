import type { PlayerCareer } from './progression.js';
import { getUpgradeLevel, UPGRADE_DEFINITIONS, type UpgradeType } from './upgrades.js';

export type KingdomTierId =
  | 'war_camp'
  | 'stone_fort'
  | 'royal_keep'
  | 'grand_citadel'
  | 'crown_capital';

export interface KingdomTier {
  readonly id: KingdomTierId;
  readonly name: string;
  readonly minLevel: number;
  readonly color: number;
}

export const KINGDOM_TIERS: readonly KingdomTier[] = [
  { id: 'war_camp', name: 'War Camp', minLevel: 0, color: 0x94a3b8 },
  { id: 'stone_fort', name: 'Stone Fort', minLevel: 10, color: 0x60a5fa },
  { id: 'royal_keep', name: 'Royal Keep', minLevel: 25, color: 0x818cf8 },
  { id: 'grand_citadel', name: 'Grand Citadel', minLevel: 45, color: 0xc084fc },
  { id: 'crown_capital', name: 'Crown Capital', minLevel: 65, color: 0xfbbf24 },
] as const;

const KINGDOM_UPGRADES: readonly UpgradeType[] = [
  'starting_garrison',
  'production',
  'army_speed',
  'treasury',
];

export const MAX_KINGDOM_LEVEL = KINGDOM_UPGRADES.reduce(
  (total, type) => total + UPGRADE_DEFINITIONS[type].maxLevel,
  0
);

export interface KingdomProgress {
  readonly totalLevel: number;
  readonly maxLevel: number;
  readonly tier: KingdomTier;
  readonly tierIndex: number;
  readonly nextTier: KingdomTier | null;
  readonly levelsToNextTier: number;
  readonly tierProgress: number;
}

export function getKingdomLevel(career: PlayerCareer): number {
  return KINGDOM_UPGRADES.reduce((total, type) => total + getUpgradeLevel(career, type), 0);
}

export function getKingdomProgress(career: PlayerCareer): KingdomProgress {
  const totalLevel = getKingdomLevel(career);
  let tierIndex = 0;
  for (let index = KINGDOM_TIERS.length - 1; index >= 0; index -= 1) {
    if (totalLevel >= KINGDOM_TIERS[index].minLevel) {
      tierIndex = index;
      break;
    }
  }

  const tier = KINGDOM_TIERS[tierIndex];
  const nextTier = KINGDOM_TIERS[tierIndex + 1] ?? null;
  const tierProgress = nextTier
    ? (totalLevel - tier.minLevel) / (nextTier.minLevel - tier.minLevel)
    : 1;

  return {
    totalLevel,
    maxLevel: MAX_KINGDOM_LEVEL,
    tier,
    tierIndex,
    nextTier,
    levelsToNextTier: nextTier ? nextTier.minLevel - totalLevel : 0,
    tierProgress,
  };
}
