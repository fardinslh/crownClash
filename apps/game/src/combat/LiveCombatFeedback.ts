import { GameState, MarchingArmy, resolveArrival, type CombatResult } from '@crown-clash/game-core';

export function armyVisualId(owner: string, id: string): string {
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
    // Unconfirmed local predicted armies must never produce simulated server arrivals
    if (army.id.startsWith('pred_')) continue;
    if (activeArmyIds.has(armyVisualId(army.owner, army.id))) continue;
    // An army only arrives when its march has finished.
    // Guard against premature resolution if an army was desynced or canceled early.
    if (army.progress < 0.65) continue;

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

/**
 * Advances marching armies forward on the local client between server updates.
 * Caps progress at 0.99 so combat arrivals are authoritatively resolved by the server.
 */
export function stepLiveArmies(
  armies: readonly MarchingArmy[],
  deltaSeconds: number
): MarchingArmy[] {
  if (armies.length === 0 || deltaSeconds <= 0) return [...armies];
  return armies.map((army) => {
    const nextProgress = army.progress + army.speed * deltaSeconds;
    return {
      ...army,
      progress: Math.min(0.99, nextProgress),
    };
  });
}

export interface LiveReconciliationResult {
  reconciledArmies: MarchingArmy[];
  matchedVisualRenames: Array<{ fromId: string; toId: string }>;
}

/**
 * Smoothly blends local dead-reckoned & predicted armies with an authoritative
 * server snapshot to avoid visual snapping or rubber-banding.
 */
export function reconcileLiveArmies(
  localArmies: readonly MarchingArmy[],
  serverArmies: readonly MarchingArmy[],
  blendWeight: number = 0.35
): LiveReconciliationResult {
  const localByKey = new Map<string, MarchingArmy>();
  const predictedArmies: MarchingArmy[] = [];

  for (const army of localArmies) {
    if (army.id.startsWith('pred_')) {
      predictedArmies.push(army);
    } else {
      localByKey.set(armyVisualId(army.owner, army.id), army);
    }
  }

  const matchedPredicted = new Set<string>();
  const renames: Array<{ fromId: string; toId: string }> = [];

  const reconciledServerArmies = serverArmies.map((serverArmy) => {
    const key = armyVisualId(serverArmy.owner, serverArmy.id);
    const existingLocal = localByKey.get(key);

    if (existingLocal) {
      // Existing tracked army: softly blend progress towards the authoritative server position
      const diff = Math.abs(existingLocal.progress - serverArmy.progress);
      if (diff > 0 && diff < 0.2) {
        return {
          ...serverArmy,
          progress: existingLocal.progress + (serverArmy.progress - existingLocal.progress) * blendWeight,
        };
      }
      return serverArmy;
    }

    // Check if this server army corresponds to a local predicted dispatch
    if (serverArmy.owner === 'player') {
      const matchIndex = predictedArmies.findIndex(
        (p) =>
          !matchedPredicted.has(p.id) &&
          p.sourceId === serverArmy.sourceId &&
          p.targetId === serverArmy.targetId
      );
      if (matchIndex !== -1) {
        const predicted = predictedArmies[matchIndex];
        matchedPredicted.add(predicted.id);
        renames.push({
          fromId: armyVisualId(predicted.owner, predicted.id),
          toId: key,
        });
        const diff = Math.abs(predicted.progress - serverArmy.progress);
        const progress =
          diff < 0.2
            ? predicted.progress + (serverArmy.progress - predicted.progress) * blendWeight
            : serverArmy.progress;
        return {
          ...serverArmy,
          progress,
        };
      }
    }

    // New army from opponent
    return serverArmy;
  });

  // Keep recently dispatched predicted armies that the server hasn't acknowledged yet
  const unconfirmedPredicted = predictedArmies.filter(
    (p) => !matchedPredicted.has(p.id) && p.progress < 0.75
  );

  return {
    reconciledArmies: [...reconciledServerArmies, ...unconfirmedPredicted],
    matchedVisualRenames: renames,
  };
}
