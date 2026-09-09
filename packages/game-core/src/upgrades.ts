import type { EconomyLedgerEntry, PlayerCareer } from './progression.js';

export type UpgradeType = 'starting_garrison' | 'production' | 'army_speed' | 'treasury';

export interface UpgradeDefinition {
  readonly maxLevel: number;
  readonly costs: readonly number[];
}

export interface PlayerUpgradeModifiers {
  startingUnits: number;
  productionRateMultiplier: number;
  armySpeedMultiplier: number;
}

const UPGRADE_COSTS = [
  50, 100, 175, 275, 400,
  500, 625, 775, 950, 1150,
  1375, 1625, 1900, 2200, 2525,
  2875, 3250, 3650, 4100, 4600,
] as const;

export type UpgradeFailureReason = 'insufficient_coins' | 'max_level';

interface UpgradePurchaseBase {
  previousCareer: PlayerCareer;
  newCareer: PlayerCareer;
}

export type UpgradePurchaseResult =
  | (UpgradePurchaseBase & {
      success: true;
      cost: number;
      ledgerEntry: EconomyLedgerEntry;
    })
  | (UpgradePurchaseBase & {
      success: false;
      reason: UpgradeFailureReason;
      cost: number | null;
    });

export const UPGRADE_DEFINITIONS: Readonly<Record<UpgradeType, UpgradeDefinition>> = {
  starting_garrison: {
    maxLevel: 20,
    costs: UPGRADE_COSTS,
  },
  production: {
    maxLevel: 20,
    costs: UPGRADE_COSTS,
  },
  army_speed: {
    maxLevel: 20,
    costs: UPGRADE_COSTS,
  },
  treasury: {
    maxLevel: 20,
    costs: UPGRADE_COSTS,
  },
};

export function normalizeUpgradeLevel(value: unknown, type: UpgradeType): number {
  const maxLevel = UPGRADE_DEFINITIONS[type].maxLevel;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(maxLevel, Math.max(0, Math.floor(value)));
}

export function getUpgradeLevel(career: PlayerCareer, type: UpgradeType): number {
  if (type === 'starting_garrison') {
    return normalizeUpgradeLevel(career.startingGarrisonLevel, type);
  }
  if (type === 'production') {
    return normalizeUpgradeLevel(career.productionLevel, type);
  }
  if (type === 'treasury') {
    return normalizeUpgradeLevel(career.treasuryLevel, type);
  }
  return normalizeUpgradeLevel(career.armySpeedLevel, type);
}

export function getNextUpgradeCost(career: PlayerCareer, type: UpgradeType): number | null {
  const level = getUpgradeLevel(career, type);
  return UPGRADE_DEFINITIONS[type].costs[level] ?? null;
}

export function getPlayerUpgradeModifiers(career: PlayerCareer): PlayerUpgradeModifiers {
  const garrisonLevel = getUpgradeLevel(career, 'starting_garrison');
  const productionLevel = getUpgradeLevel(career, 'production');
  const armySpeedLevel = getUpgradeLevel(career, 'army_speed');
  return {
    startingUnits: getStartingUnits(garrisonLevel),
    productionRateMultiplier: getProductionRateMultiplier(productionLevel),
    armySpeedMultiplier: getArmySpeedMultiplier(armySpeedLevel),
  };
}

export function getTreasuryCoinBonusRate(level: number): number {
  const safeLevel = normalizeUpgradeLevel(level, 'treasury');
  return Math.min(safeLevel, 5) * 0.05 + Math.max(safeLevel - 5, 0) * 0.02;
}

export function getUpgradeEffectLabel(type: UpgradeType, level: number): string {
  const safeLevel = normalizeUpgradeLevel(level, type);
  if (type === 'starting_garrison') {
    return `+${getStartingUnits(safeLevel) - 20} troops`;
  }
  if (type === 'production') {
    return `+${formatPercent((getProductionRateMultiplier(safeLevel) - 1) * 100)}% production`;
  }
  if (type === 'army_speed') {
    return `+${formatPercent((getArmySpeedMultiplier(safeLevel) - 1) * 100)}% march`;
  }
  return `+${formatPercent(getTreasuryCoinBonusRate(safeLevel) * 100)}% coins`;
}

export function getUpgradeMilestoneTier(level: number): number {
  const safeLevel = Math.min(20, Math.max(0, Math.floor(level)));
  return safeLevel === 20 ? 4 : Math.floor(safeLevel / 5);
}

export function getUpgradeMilestoneLabel(level: number): string {
  const safeLevel = Math.min(20, Math.max(0, Math.floor(level)));
  if (safeLevel === 20) return 'M20 ✓';
  const completed = Math.floor(safeLevel / 5) * 5;
  return completed > 0 && safeLevel === completed
    ? `M${completed} ✓`
    : `M${completed}→${completed + 5}`;
}

export function isUpgradeMilestoneLevel(level: number): boolean {
  const safeLevel = Math.min(20, Math.max(0, Math.floor(level)));
  return safeLevel > 0 && safeLevel % 5 === 0;
}

/**
 * Fraction (0..1) of progress through the current 5-level milestone tier.
 * 1 once the upgrade is fully maxed at level 20.
 */
export function getUpgradeMilestoneProgress(level: number): number {
  const safeLevel = Math.min(20, Math.max(0, Math.floor(level)));
  // A level that just landed on a multiple of 5 reads as "complete" (see
  // getUpgradeMilestoneLabel's "✓" marker), so its bar is full rather than
  // the start of the next tier.
  if (safeLevel > 0 && safeLevel % 5 === 0) return 1;
  const tierStart = Math.floor(safeLevel / 5) * 5;
  return (safeLevel - tierStart) / 5;
}

export interface UpgradeCardViewModel {
  readonly type: UpgradeType;
  readonly level: number;
  readonly maxLevel: number;
  readonly isMaxLevel: boolean;
  readonly currentEffectLabel: string;
  /** Null once the upgrade is at max level; there is no further effect. */
  readonly nextEffectLabel: string | null;
  readonly nextCost: number | null;
  readonly canAfford: boolean;
  readonly milestoneLabel: string;
  readonly milestoneProgress: number;
}

/**
 * Single source of truth for rendering an upgrade as a card, so every
 * surface (result panel, Kingdom hub) shows identical level/cost/effect
 * figures derived from the same shared math instead of duplicating it.
 */
export function getUpgradeCardViewModel(
  career: PlayerCareer,
  type: UpgradeType
): UpgradeCardViewModel {
  const level = getUpgradeLevel(career, type);
  const maxLevel = UPGRADE_DEFINITIONS[type].maxLevel;
  const isMaxLevel = level >= maxLevel;
  const nextCost = getNextUpgradeCost(career, type);

  return {
    type,
    level,
    maxLevel,
    isMaxLevel,
    currentEffectLabel: getUpgradeEffectLabel(type, level),
    nextEffectLabel: isMaxLevel ? null : getUpgradeEffectLabel(type, level + 1),
    nextCost,
    canAfford: nextCost !== null && career.coins >= nextCost,
    milestoneLabel: getUpgradeMilestoneLabel(level),
    milestoneProgress: getUpgradeMilestoneProgress(level),
  };
}

function getStartingUnits(level: number): number {
  return 20 + Math.min(level, 5) * 3 + Math.max(level - 5, 0);
}

function getProductionRateMultiplier(level: number): number {
  return roundMultiplier(1 + Math.min(level, 5) * 0.08 + Math.max(level - 5, 0) * 0.02);
}

function getArmySpeedMultiplier(level: number): number {
  return roundMultiplier(1 + Math.min(level, 5) * 0.06 + Math.max(level - 5, 0) * 0.015);
}

function formatPercent(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, '');
}

function roundMultiplier(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function purchaseUpgrade(
  career: PlayerCareer,
  type: UpgradeType,
  purchaseId: string,
  timestamp = Date.now()
): UpgradePurchaseResult {
  const previousCareer = { ...career };
  const level = getUpgradeLevel(previousCareer, type);
  const cost = getNextUpgradeCost(previousCareer, type);

  if (cost === null) {
    return {
      success: false,
      reason: 'max_level',
      cost,
      previousCareer,
      newCareer: previousCareer,
    };
  }

  if (previousCareer.coins < cost) {
    return {
      success: false,
      reason: 'insufficient_coins',
      cost,
      previousCareer,
      newCareer: previousCareer,
    };
  }

  const newCareer: PlayerCareer = {
    ...previousCareer,
    coins: previousCareer.coins - cost,
    startingGarrisonLevel:
      type === 'starting_garrison' ? level + 1 : previousCareer.startingGarrisonLevel,
    productionLevel: type === 'production' ? level + 1 : previousCareer.productionLevel,
    armySpeedLevel: type === 'army_speed' ? level + 1 : previousCareer.armySpeedLevel,
    treasuryLevel: type === 'treasury' ? level + 1 : previousCareer.treasuryLevel,
  };

  return {
    success: true,
    cost,
    previousCareer,
    newCareer,
    ledgerEntry: {
      id: purchaseId,
      player: previousCareer.playerId,
      currency: 'coins',
      amount: -cost,
      reason: `upgrade_${type}`,
      source: 'upgrade_purchase',
      previousBalance: previousCareer.coins,
      resultingBalance: newCareer.coins,
      timestamp,
    },
  };
}
