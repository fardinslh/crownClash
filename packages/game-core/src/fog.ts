import { DEFAULT_BATTLEFIELD_ID, getBattlefield } from './battlefields.js';
import type { GameState, MarchingArmy, Team } from './types.js';

/**
 * v4 fog of war (presentation only: neither engine's simulation reads it).
 * A side sees a tower's garrison when it owns the tower or owns a tower
 * one road away. Ownership and tower type are always visible. Because
 * hostile orders already need one direct road, every legal attack target
 * stays visible.
 */
export function computeVisibleTerritoryIds(state: GameState, owner: Team = 'player'): Set<string> {
  const visible = new Set<string>();
  for (const territory of Object.values(state.territories)) {
    if (territory.owner === owner) visible.add(territory.id);
  }
  const roads = getBattlefield(state.battlefieldId ?? DEFAULT_BATTLEFIELD_ID).roads;
  for (const [a, b] of roads) {
    if (state.territories[a]?.owner === owner) visible.add(b);
    if (state.territories[b]?.owner === owner) visible.add(a);
  }
  return visible;
}

/** Own armies always show their count; others only on a leg touching vision. */
export function isArmyCountVisible(army: MarchingArmy, visible: ReadonlySet<string>, owner: Team = 'player'): boolean {
  if (army.owner === owner) return true;
  const leg = army.routeIds ? army.routeLeg ?? 0 : 0;
  const from = army.routeIds ? army.routeIds[leg] : army.sourceId;
  const to = army.routeIds ? army.routeIds[leg + 1] ?? army.targetId : army.targetId;
  return visible.has(from) || visible.has(to);
}
