import { Territory } from './types.js';
import type { PlayerUpgradeModifiers } from './upgrades.js';

export const LOGICAL_WIDTH = 400;
export const LOGICAL_HEIGHT = 720;

/**
 * Creates the initial default map for Prototype v0.1.
 * 9 territories arranged in a 3-tier mobile-friendly portrait battlefield.
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
  }
): Record<string, Territory> {
  return {
    'p_base': {
      id: 'p_base',
      name: 'Player Fortress',
      x: 200,
      y: 610,
      radius: 36,
      owner: 'player',
      units: playerModifiers.startingUnits,
      maxUnits: 65,
      productionRate: 1.2 * playerModifiers.productionRateMultiplier,
      tier: 3,
    },
    'e_base': {
      id: 'e_base',
      name: 'Enemy Citadel',
      x: 200,
      y: 110,
      radius: 36,
      owner: 'enemy',
      units: enemyModifiers.startingUnits,
      maxUnits: 65,
      productionRate: 1.2 * enemyModifiers.productionRateMultiplier,
      tier: 3,
    },
    'n_bot_left': {
      id: 'n_bot_left',
      name: 'Southwest Outpost',
      x: 85,
      y: 485,
      radius: 27,
      owner: 'neutral',
      units: 8,
      maxUnits: 40,
      productionRate: 0.9,
      tier: 1,
    },
    'n_bot_right': {
      id: 'n_bot_right',
      name: 'Southeast Outpost',
      x: 315,
      y: 485,
      radius: 27,
      owner: 'neutral',
      units: 8,
      maxUnits: 40,
      productionRate: 0.9,
      tier: 1,
    },
    'n_center': {
      id: 'n_center',
      name: 'Crown Keep',
      x: 200,
      y: 360,
      radius: 32,
      owner: 'neutral',
      units: 14,
      maxUnits: 55,
      productionRate: 1.1,
      tier: 2,
    },
    'n_mid_left': {
      id: 'n_mid_left',
      name: 'West Watchtower',
      x: 75,
      y: 360,
      radius: 26,
      owner: 'neutral',
      units: 10,
      maxUnits: 40,
      productionRate: 0.85,
      tier: 1,
    },
    'n_mid_right': {
      id: 'n_mid_right',
      name: 'East Watchtower',
      x: 325,
      y: 360,
      radius: 26,
      owner: 'neutral',
      units: 10,
      maxUnits: 40,
      productionRate: 0.85,
      tier: 1,
    },
    'n_top_left': {
      id: 'n_top_left',
      name: 'Northwest Outpost',
      x: 85,
      y: 235,
      radius: 27,
      owner: 'neutral',
      units: 8,
      maxUnits: 40,
      productionRate: 0.9,
      tier: 1,
    },
    'n_top_right': {
      id: 'n_top_right',
      name: 'Northeast Outpost',
      x: 315,
      y: 235,
      radius: 27,
      owner: 'neutral',
      units: 8,
      maxUnits: 40,
      productionRate: 0.9,
      tier: 1,
    },
  };
}
