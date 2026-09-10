import { MarchingArmy, Team, Territory } from './types.js';
import { getTerritoryArmySpeedMultiplier } from './territory-types.js';

export interface DispatchResult {
  success: boolean;
  reason?: string;
  sourceTerritory?: Territory;
  army?: MarchingArmy;
}

export interface MultiDispatchResult {
  successes: DispatchResult[];
  armies: MarchingArmy[];
  updatedSources: Record<string, Territory>;
  totalUnitsDispatched: number;
}

export const BASE_ARMY_TRAVEL_SPEED = 140; // logical pixels per second

/**
 * Calculates dispatch unit counts.
 * Defaults to 50% of available units (minimum 1 sent, keeping at least 1 defender).
 */
export function calculateDispatchUnits(currentUnits: number, ratio: number = 0.5): number {
  if (currentUnits <= 1) return 0;
  const dispatchCount = Math.floor(currentUnits * ratio);
  return Math.max(1, dispatchCount);
}

/**
 * Attempts to dispatch an army from a single source to a target.
 */
export function dispatchArmy(
  source: Territory,
  target: Territory,
  expectedOwner: Team,
  dispatchRatio: number = 0.5,
  armyIdGenerator: () => string = () => `army_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  travelSpeedMultiplier: number = 1
): DispatchResult {
  if (source.id === target.id) {
    return { success: false, reason: 'Cannot dispatch to the same territory' };
  }

  if (source.owner !== expectedOwner) {
    return { success: false, reason: 'Source territory is not owned by the dispatcher' };
  }

  const unitsToSend = calculateDispatchUnits(source.units, dispatchRatio);
  if (unitsToSend <= 0) {
    return { success: false, reason: 'Not enough units in source territory' };
  }

  const updatedSource: Territory = {
    ...source,
    units: source.units - unitsToSend,
  };

  const distance = Math.hypot(target.x - source.x, target.y - source.y);
  // Journey duration in seconds
  const safeSpeedMultiplier =
    Number.isFinite(travelSpeedMultiplier) && travelSpeedMultiplier > 0 ? travelSpeedMultiplier : 1;
  const sourceSpeedMultiplier = getTerritoryArmySpeedMultiplier(source.type);
  const durationSeconds = Math.max(
    1.0,
    distance / (BASE_ARMY_TRAVEL_SPEED * safeSpeedMultiplier * sourceSpeedMultiplier)
  );
  const speed = 1 / durationSeconds; // progress increase per second

  const army: MarchingArmy = {
    id: armyIdGenerator(),
    sourceId: source.id,
    targetId: target.id,
    owner: expectedOwner,
    units: unitsToSend,
    startX: source.x,
    startY: source.y,
    targetX: target.x,
    targetY: target.y,
    progress: 0,
    speed,
    distance,
  };

  return {
    success: true,
    sourceTerritory: updatedSource,
    army,
  };
}

/**
 * Dispatches armies from multiple source territories toward a single target (Coordinated Attack).
 */
export function dispatchMultipleArmies(
  sources: Territory[],
  target: Territory,
  expectedOwner: Team,
  dispatchRatio: number = 0.5,
  travelSpeedMultiplier: number = 1
): MultiDispatchResult {
  const successes: DispatchResult[] = [];
  const armies: MarchingArmy[] = [];
  const updatedSources: Record<string, Territory> = {};
  let totalUnitsDispatched = 0;

  for (const source of sources) {
    if (source.id === target.id) continue;
    const res = dispatchArmy(
      source,
      target,
      expectedOwner,
      dispatchRatio,
      undefined,
      travelSpeedMultiplier
    );
    if (res.success && res.army && res.sourceTerritory) {
      successes.push(res);
      armies.push(res.army);
      updatedSources[source.id] = res.sourceTerritory;
      totalUnitsDispatched += res.army.units;
    }
  }

  return {
    successes,
    armies,
    updatedSources,
    totalUnitsDispatched,
  };
}
