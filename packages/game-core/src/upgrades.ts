import type { EconomyLedgerEntry, PlayerCareer } from './progression.js';

export type UpgradeType = 'starting_garrison' | 'production' | 'army_speed';

export interface UpgradeDefinition {
  readonly maxLevel: number;
  readonly costs: readonly number[];
}

export interface PlayerUpgradeModifiers {
  startingUnits: number;
  productionRateMultiplier: number;
  armySpeedMultiplier: number;
}

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
    maxLevel: 5,
    costs: [50, 100, 175, 275, 400],
  },
  production: {
    maxLevel: 5,
    costs: [50, 100, 175, 275, 400],
  },
  army_speed: {
    maxLevel: 5,
    costs: [50, 100, 175, 275, 400],
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
  return normalizeUpgradeLevel(career.armySpeedLevel, type);
}

export function getNextUpgradeCost(career: PlayerCareer, type: UpgradeType): number | null {
  const level = getUpgradeLevel(career, type);
  return UPGRADE_DEFINITIONS[type].costs[level] ?? null;
}

export function getPlayerUpgradeModifiers(career: PlayerCareer): PlayerUpgradeModifiers {
  return {
    startingUnits: 20 + getUpgradeLevel(career, 'starting_garrison') * 3,
    productionRateMultiplier: 1 + getUpgradeLevel(career, 'production') * 0.08,
    armySpeedMultiplier: 1 + getUpgradeLevel(career, 'army_speed') * 0.06,
  };
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
