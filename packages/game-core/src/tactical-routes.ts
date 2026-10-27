import { getBattlefield } from './battlefields.js';
import { TACTICAL_CONFIG, usesTacticalRules } from './gameplay-rules.js';
import type { GameState, MarchingArmy, Team, Territory } from './types.js';

export const TACTICAL_SUPPORTS = {
  crown_cross: ['n_bot_left', 'n_top_right'],
  twin_passes: ['n_west_gate_s', 'n_east_gate_n'],
  royal_ring: ['n_ring_sw', 'n_ring_ne'],
} as const;

export function tacticalNeighbors(state: GameState, id: string): string[] {
  return getBattlefield(state.battlefieldId).roads.flatMap(([a, b]) => a === id ? [b] : b === id ? [a] : []).sort();
}

const legCost = (from: Territory, to: Territory): number => Math.round(Math.hypot(to.x - from.x, to.y - from.y) * 1000);

/** Cheapest all-friendly path from the source to every friendly tower it can reach (ties broken by path text). */
function friendlyPaths(state: GameState, sourceId: string, owner: Team): Map<string, { cost: number; path: string[] }> {
  const best = new Map<string, { cost: number; path: string[] }>();
  const queue = [{ id: sourceId, cost: 0, path: [sourceId] }];
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost || comparePath(a.path, b.path));
    const next = queue.shift()!;
    if (best.has(next.id)) continue;
    best.set(next.id, { cost: next.cost, path: next.path });
    for (const id of tacticalNeighbors(state, next.id)) {
      const t = state.territories[id];
      if (!t || t.owner !== owner || best.has(id)) continue;
      queue.push({ id, cost: next.cost + legCost(state.territories[next.id], t), path: [...next.path, id] });
    }
  }
  return best;
}

/**
 * Orders follow the roads. An attack on a tower with a road from the source is
 * one leg. Otherwise the army marches through the player's own towers (a fixed
 * cheapest all-friendly path) and the last leg crosses the road into the
 * target, so a friendly tower standing between source and enemy is a stepping
 * stone, not a wall. Reinforcements use the same fixed all-friendly path.
 */
export function findDispatchRoute(state: GameState, sourceId: string, targetId: string, owner: Team): string[] | null {
  const source = state.territories[sourceId], target = state.territories[targetId];
  if (!source || !target || sourceId === targetId || source.owner !== owner) return null;
  if (!usesTacticalRules(state.gameplayRulesVersion)) return [sourceId, targetId];
  if (target.owner !== owner) {
    if (tacticalNeighbors(state, sourceId).includes(targetId)) return [sourceId, targetId];
    const reachable = friendlyPaths(state, sourceId, owner);
    let chosen: { cost: number; path: string[] } | null = null;
    for (const entryId of tacticalNeighbors(state, targetId)) {
      const entry = reachable.get(entryId);
      if (!entry) continue;
      const candidate = { cost: entry.cost + legCost(state.territories[entryId], target), path: [...entry.path, targetId] };
      if (!chosen || candidate.cost < chosen.cost || (candidate.cost === chosen.cost && comparePath(candidate.path, chosen.path) < 0)) chosen = candidate;
    }
    return chosen?.path ?? null;
  }
  return friendlyPaths(state, sourceId, owner).get(targetId)?.path ?? null;
}

function comparePath(a: string[], b: string[]): number {
  const x = a.join('|'), y = b.join('|');
  return x < y ? -1 : x > y ? 1 : 0;
}

export function setArmyLeg(army: MarchingArmy, from: Territory, to: Territory, leg: number): MarchingArmy {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return { ...army, routeLeg: leg, targetId: to.id, startX: from.x, startY: from.y,
    targetX: to.x, targetY: to.y, distance, progress: 0,
    speed: 1 / Math.max(TACTICAL_CONFIG.minLegSeconds, distance / (140 * (army.routeSpeedMultiplier ?? 1))) };
}

/** Passing a friendly waypoint is transit, not combat/reinforcement or another dispatch. */
export function advanceRoutedArmy(army: MarchingArmy, territories: Record<string, Territory>, delta: number): { army: MarchingArmy; arrived: boolean } {
  let moving = { ...army };
  let remaining = delta;
  for (;;) {
    const progress = moving.progress + moving.speed * remaining;
    if (progress < 1) return { army: { ...moving, progress }, arrived: false };
    const waypoint = territories[moving.targetId];
    const nextLeg = (moving.routeLeg ?? 0) + 1;
    if (!waypoint || waypoint.owner !== moving.owner || !moving.routeIds || nextLeg >= moving.routeIds.length - 1) {
      return { army: { ...moving, progress: 1 }, arrived: true };
    }
    remaining = (progress - 1) / moving.speed;
    moving = setArmyLeg(moving, waypoint, territories[moving.routeIds[nextLeg + 1]], nextLeg);
  }
}

export function armyDestination(army: MarchingArmy, state?: GameState): string {
  if (state && army.routeIds) {
    for (const id of army.routeIds.slice((army.routeLeg ?? 0) + 1)) {
      if (state.territories[id]?.owner !== army.owner) return id;
    }
  }
  return army.routeIds?.[army.routeIds.length - 1] ?? army.targetId;
}

export function armyArrivalSeconds(army: MarchingArmy, state: GameState): number {
  let seconds = (1 - army.progress) / army.speed;
  const destination = armyDestination(army, state);
  if (army.routeIds) for (let i = (army.routeLeg ?? 0) + 1; i < army.routeIds.length - 1; i++) {
    if (army.routeIds[i] === destination) break;
    seconds += 1 / setArmyLeg(army, state.territories[army.routeIds[i]], state.territories[army.routeIds[i + 1]], i).speed;
  }
  return seconds;
}
