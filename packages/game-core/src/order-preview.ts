import { dispatchArmy } from './dispatch.js';
import { resolveArrival } from './combat.js';
import { armyArrivalSeconds } from './tactical-routes.js';
import type { GameState, Team } from './types.js';

/** Static-board estimate only: other orders and future production can change the outcome. */
export function previewOrder(state: GameState, sources: readonly string[], targetId: string, owner: Team, multiplier = 1, unitMultiplier = 1) {
  const target = state.territories[targetId];
  const orders = sources.flatMap(id => {
    const source = state.territories[id];
    if (!source || !target) return [];
    const d = dispatchArmy(source, target, owner, .5, () => `preview_${id}`, multiplier, state);
    return d.army && d.sourceTerritory
      ? [{ army: { ...d.army, units: Math.floor(d.army.units * unitMultiplier) }, source: d.sourceTerritory }]
      : [];
  });
  const arrivals = orders.map((order, index) => ({ ...order, index, eta: armyArrivalSeconds(order.army, state) }))
    .sort((a, b) => a.eta - b.eta || a.index - b.index);
  let projected = target ? { ...target } : undefined;
  if (projected) for (const { army } of arrivals) {
    const r = resolveArrival(projected, army.units, owner);
    projected = { ...projected, owner: r.newOwner, units: r.remainingUnits };
  }
  return { orders, projected, sent: orders.reduce((n, d) => n + d.army.units, 0),
    left: orders.reduce((n, d) => n + d.source.units, 0),
    reason: orders.length ? '' : target?.owner === owner ? 'No friendly route' : 'Attack an adjacent tower' };
}
