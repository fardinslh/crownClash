import { GameState, resolveArrival, type CombatResult } from '@crown-clash/game-core';

function armyVisualId(owner: string, id: string): string {
  return `${owner}:${id}`;
}

/**
 * Reconstructs authoritative arrival outcomes from consecutive live snapshots.
 * This only drives presentation; the received server state remains the source of truth.
 */
export function deriveLiveCombatArrivals(
  previous: GameState,
  current: GameState
): CombatResult[] {
  const activeArmyIds = new Set(
    current.armies.map((army) => armyVisualId(army.owner, army.id))
  );
  const projectedTargets = { ...previous.territories };
  const arrivals: CombatResult[] = [];

  for (const army of previous.armies) {
    if (activeArmyIds.has(armyVisualId(army.owner, army.id))) continue;
    const target = projectedTargets[army.targetId];
    if (!target) continue;

    const arrival = resolveArrival(target, army.units, army.owner);
    arrivals.push(arrival);
    projectedTargets[army.targetId] = {
      ...target,
      owner: arrival.newOwner,
      units: arrival.remainingUnits,
    };
  }

  return arrivals;
}
