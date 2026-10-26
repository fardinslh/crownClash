import { calculateDispatchUnits, dispatchArmy } from './dispatch.js';
import { resolveArrival } from './combat.js';
import { getTerritoryDefenseStrength, getTerritoryProductionMultiplier } from './territory-types.js';
import { armyArrivalSeconds, armyDestination, tacticalNeighbors } from './tactical-routes.js';
import type { AiMove } from './ai.js';
import type { GameState, Territory } from './types.js';

/** Armies heading for `id`, soonest first (ties keep army order). */
export function tacticalIncoming(state: GameState, id: string) {
  return state.armies.filter(a => armyDestination(a, state) === id)
    .map((army, index) => ({ army, index, eta: armyArrivalSeconds(army, state) }))
    .sort((a, b) => a.eta - b.eta || a.index - b.index);
}

/** The tower as it will stand once every army due within `seconds` has resolved. */
export function tacticalForecast(state: GameState, t: Territory, seconds: number, units = t.units, defenseMultiplier = 1): Territory {
  let projected = { ...t, units };
  for (const { army, eta } of tacticalIncoming(state, t.id)) if (eta <= seconds + 1e-9) {
    const r = resolveArrival(projected, army.units, army.owner, defenseMultiplier);
    projected = { ...projected, owner: r.newOwner, units: r.remainingUnits };
  }
  return projected;
}

/** Deterministic v3 policy. Uses visible armies only; the same policy runs on the server. */
export function evaluateTacticalMoves(state: GameState, team: 'player' | 'enemy' = 'enemy', speedMultiplier = 1): AiMove[] {
  if (state.status !== 'playing') return [];
  const towers = Object.values(state.territories).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const incoming = (id: string) => tacticalIncoming(state, id);
  const forecast = (t: Territory, seconds: number, units = t.units): Territory => tacticalForecast(state, t, seconds, units);
  const candidates = (target: Territory) => towers.filter(s => s.owner === team && s.units >= 4 && s.id !== target.id)
    .flatMap(source => {
      const d = dispatchArmy(source, target, team, .5, () => 'candidate', speedMultiplier, state);
      if (!d.army || !d.sourceTerritory) return [];
      const hostile = incoming(source.id).filter(a => a.army.owner !== team);
      if (hostile.length && forecast(source, hostile[hostile.length - 1].eta, d.sourceTerritory.units).owner !== team) return [];
      return [{ source, army: d.army, eta: armyArrivalSeconds(d.army, state) }];
    }).sort((a, b) => a.eta - b.eta || (a.source.id < b.source.id ? -1 : 1));
  // Rescue a threatened friendly tower before the first hostile wave reaches it.
  for (const target of towers.filter(t => t.owner === team)) {
    const hostile = incoming(target.id).filter(a => a.army.owner !== team);
    if (!hostile.length) continue;
    const horizon = hostile[hostile.length - 1].eta;
    if (forecast(target, horizon).owner === team) continue;
    let units = target.units;
    const moves: AiMove[] = [];
    for (const c of candidates(target).filter(c => c.eta < hostile[0].eta - 1e-9)) {
      units += c.army.units; moves.push({ fromId: c.source.id, toId: target.id });
      if (forecast(target, horizon, units).owner === team) return moves;
    }
  }
  // Coordinate a capturable adjacent target, accounting for committed waves.
  let best: AiMove[] = [], bestScore = -Infinity;
  for (const target of towers.filter(t => t.owner !== team)) {
    const options = candidates(target);
    if (!options.length) continue;
    const lastEta = options[options.length - 1].eta;
    const projected = forecast(target, lastEta);
    if (projected.owner === team) continue;
    const growth = target.owner === 'neutral' ? 0 : Math.ceil(lastEta * target.productionRate * getTerritoryProductionMultiplier(target.type));
    let remaining = { ...projected, units: projected.units + growth };
    const moves: AiMove[] = [];
    for (const c of options) {
      const result = resolveArrival(remaining, c.army.units, team);
      remaining = { ...remaining, units: result.remainingUnits, owner: result.newOwner };
      moves.push({ fromId: c.source.id, toId: target.id });
      if (remaining.owner === team) {
        const role = target.type === 'barracks' ? 18 : target.type === 'stable' ? 14 : 10;
        const score = (target.owner === 'neutral' ? 500 : 1000) + role * 10 + Math.min(remaining.units, 50) - Math.round(c.eta * 10);
        if (score > bestScore) { bestScore = score; best = moves; }
        break;
      }
    }
  }
  if (best.length) return best;
  // Rear supply goes to a frontier, never in a friendly reinforcement loop.
  const frontier = (t: Territory) => tacticalNeighbors(state, t.id).some(id => state.territories[id].owner !== team);
  for (const target of towers.filter(t => t.owner === team && frontier(t))) {
    const committed = incoming(target.id).filter(a => a.army.owner === team).reduce((n, a) => n + a.army.units, 0);
    const strongest = Math.max(...tacticalNeighbors(state, target.id).filter(id => state.territories[id].owner !== team)
      .map(id => getTerritoryDefenseStrength(state.territories[id])));
    if (calculateDispatchUnits(target.units + committed) > strongest) continue;
    const source = candidates(target).find(c => !frontier(c.source));
    if (source) return [{ fromId: source.source.id, toId: target.id }];
  }
  return [];
}
