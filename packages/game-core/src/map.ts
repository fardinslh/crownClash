import { Territory } from './types.js';
import type { PlayerUpgradeModifiers } from './upgrades.js';
import { getBattlefield, type BattlefieldId } from './battlefields.js';

export const LOGICAL_WIDTH = 400;
export const LOGICAL_HEIGHT = 720;

/**
 * Creates the initial territories for the selected battlefield.
 * Clones templates from the data-driven battlefield definition and applies player/enemy modifiers.
 */
export function createDefaultTerritories(
  playerModifiers: PlayerUpgradeModifiers = {
    startingUnits: 20,
    productionRateMultiplier: 1,
    armySpeedMultiplier: 1,
  },
  enemyModifiers: PlayerUpgradeModifiers = {
    startingUnits: 20,
    productionRateMultiplier: 1,
    armySpeedMultiplier: 1,
  },
  battlefieldId: BattlefieldId = 'crown_cross'
): Record<string, Territory> {
  const battlefield = getBattlefield(battlefieldId);
  const territories: Record<string, Territory> = {};

  for (const template of battlefield.territories) {
    let units = template.units;
    let productionRate = template.productionRate;

    if (template.id === 'p_base' || template.owner === 'player') {
      units = playerModifiers.startingUnits;
      productionRate = template.productionRate * playerModifiers.productionRateMultiplier;
    } else if (template.id === 'e_base' || template.owner === 'enemy') {
      units = enemyModifiers.startingUnits;
      productionRate = template.productionRate * enemyModifiers.productionRateMultiplier;
    }

    territories[template.id] = {
      id: template.id,
      name: template.name,
      x: template.x,
      y: template.y,
      radius: template.radius,
      owner: template.owner,
      units,
      maxUnits: template.maxUnits,
      productionRate,
      tier: template.tier,
      type: template.type,
    };
  }

  return territories;
}

