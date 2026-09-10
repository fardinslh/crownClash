import { Territory } from './types.js';
import { getTerritoryProductionMultiplier } from './territory-types.js';

export interface GenerationUpdateResult {
  territories: Record<string, Territory>;
  accumulators: Record<string, number>;
  generatedCounts: Record<string, number>;
}

/**
 * Updates unit production across all territories.
 * Only owned territories (player, enemy) generate units up to their capacity.
 */
export function tickUnitGeneration(
  territories: Record<string, Territory>,
  accumulators: Record<string, number>,
  deltaSeconds: number
): GenerationUpdateResult {
  const updatedTerritories: Record<string, Territory> = {};
  const updatedAccumulators: Record<string, number> = { ...accumulators };
  const generatedCounts: Record<string, number> = {};

  for (const [id, territory] of Object.entries(territories)) {
    // Neutral territories do not generate units
    if (territory.owner === 'neutral' || territory.productionRate <= 0) {
      updatedTerritories[id] = { ...territory };
      updatedAccumulators[id] = 0;
      generatedCounts[id] = 0;
      continue;
    }

    // Already at or above max capacity: do not generate further
    if (territory.units >= territory.maxUnits) {
      updatedTerritories[id] = { ...territory };
      updatedAccumulators[id] = 0;
      generatedCounts[id] = 0;
      continue;
    }

    const productionRate =
      territory.productionRate * getTerritoryProductionMultiplier(territory.type);
    const currentAcc = (updatedAccumulators[id] ?? 0) + productionRate * deltaSeconds;
    const wholeUnits = Math.floor(currentAcc);

    if (wholeUnits > 0) {
      const allowedIncrease = Math.max(0, territory.maxUnits - territory.units);
      const actualIncrease = Math.min(wholeUnits, allowedIncrease);

      updatedTerritories[id] = {
        ...territory,
        units: territory.units + actualIncrease,
      };
      updatedAccumulators[id] = currentAcc - wholeUnits;
      generatedCounts[id] = actualIncrease;
    } else {
      updatedTerritories[id] = { ...territory };
      updatedAccumulators[id] = currentAcc;
      generatedCounts[id] = 0;
    }
  }

  return {
    territories: updatedTerritories,
    accumulators: updatedAccumulators,
    generatedCounts,
  };
}
