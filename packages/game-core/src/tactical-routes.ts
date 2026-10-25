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

/** Hostile orders are one edge. Reinforcements use a fixed shortest all-friendly path. */
export function findDispatchRoute(state: GameState, sourceId: string, targetId: string, owner: Team): string[] | null {
  const source = state.territories[sourceId], target = state.territories[targetId];
  if (!source || !target || sourceId === targetId || source.owner !== owner) return null;
  if (!usesTacticalRules(state.gameplayRulesVersion)) return [sourceId, targetId];
  if (target.owner !== owner) return tacticalNeighbors(state, sourceId).includes(targetId) ? [sourceId, targetId] : null;
  const queue = [{ id: sourceId, cost: 0, path: [sourceId] }];
  const visited = new Set<string>();
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost || comparePath(a.path, b.path));
    const next = queue.shift()!;
    if (visited.has(next.id)) continue;
    if (next.id === targetId) return next.path;
    visited.add(next.id);
    for (const id of tacticalNeighbors(state, next.id)) {
      const t = state.territories[id];
      if (!t || t.owner !== owner || visited.has(id)) continue;
      const from = state.territories[next.id];
      queue.push({ id, cost: next.cost + Math.round(Math.hypot(t.x - from.x, t.y - from.y) * 1000), path: [...next.path, id] });
    }
  }
  return null;
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
