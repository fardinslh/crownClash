import { Territory } from './types.js';
import { getTerritoryProductionMultiplier } from './territory-types.js';

/**
 * Accumulator values within this epsilon of an integer are snapped to it so
 * client and server grant units on the same tick. The Go runtime may fuse
 * `acc + rate*delta` into one FMA instruction (single rounding) while
 * JavaScript rounds each operation separately; the numerical audit reproduced
 * the two engines straddling the integer grant boundary at tick 800 for the
 * production rate 1.1*1.5 with the barracks multiplier (client
 * 1.0000000000000033 vs server 0.9999999999999999), shifting a territory's
 * unit count between client prediction and authoritative replay. The epsilon
 * is far below the smallest per-tick production increment (0.85*0.02) and far
 * above accumulated FMA drift (<1e-11 over a full 90s match), so snapping is
 * invisible except where the engines would otherwise disagree.
 */
const ACCUMULATOR_SNAP_EPSILON = 1e-9;

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
    const rawAcc = (updatedAccumulators[id] ?? 0) + productionRate * deltaSeconds;
    const nearestInteger = Math.round(rawAcc);
    const currentAcc =
      Math.abs(rawAcc - nearestInteger) < ACCUMULATOR_SNAP_EPSILON ? nearestInteger : rawAcc;
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
