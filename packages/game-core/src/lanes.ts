import { findDispatchRoute } from './tactical-routes.js';
import { stepSimulation } from './simulation.js';
import type { GameState, MatchStatus, Team } from './types.js';

/**
 * Lane prototype (candidate rules v5, NOT wired into any ticket or the server).
 *
 * A drag opens a lane from a source tower to a target. While the lane exists the
 * source sends single soldiers in file at a steady rate (never below 1 unit left)
 * until the lane is cut. A soldier that arrives reinforces a friendly tower (up to
 * its maxUnits) or removes one defender from a hostile one; a hostile tower with no
 * defenders left is captured by the arriving soldier. Matches the behaviour observed
 * in docs/tower-war-observed.md. Used only by scripts/lanes-sim.mjs to decide whether
 * the mechanic is worth a real rules version.
 */
export interface LaneConfig {
  /** Seconds between two soldiers leaving the same lane. */
  readonly emitSeconds: number;
  /** Soldier speed in logical pixels per second (same as armies). */
  readonly soldierSpeed: number;
}

export const LANE_CONFIG: LaneConfig = Object.freeze({ emitSeconds: 0.2, soldierSpeed: 140 });

export interface Lane {
  readonly id: string;
  readonly owner: Team;
  readonly sourceId: string;
  readonly targetId: string;
  readonly routeIds: readonly string[];
  /** Match seconds until the next soldier leaves. */
  readonly nextEmitIn: number;
}

export interface Soldier {
  readonly owner: Team;
  readonly targetId: string;
  readonly routeIds: readonly string[];
  /** Seconds of travel for the whole route, and how many are left. */
  readonly total: number;
  readonly remaining: number;
}

export interface LaneState {
  readonly lanes: readonly Lane[];
  readonly soldiers: readonly Soldier[];
  readonly nextLaneId: number;
}

export const emptyLaneState = (): LaneState => ({ lanes: [], soldiers: [], nextLaneId: 0 });

function routeSeconds(state: GameState, routeIds: readonly string[], config: LaneConfig): number {
  let length = 0;
  for (let i = 0; i < routeIds.length - 1; i++) {
    const a = state.territories[routeIds[i]], b = state.territories[routeIds[i + 1]];
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length / config.soldierSpeed;
}

/** A tower can run as many lanes at once as its tier (1 to 3), like the dots under Tower War's garrison count. */
export const maxLanes = (state: GameState, towerId: string): number => state.territories[towerId]?.tier ?? 1;

/**
 * Opens a lane if the order is legal and the source has a free path; an existing lane between the
 * same towers is kept.
 */
export function openLane(state: GameState, lanes: LaneState, owner: Team, sourceId: string, targetId: string): LaneState {
  if (lanes.lanes.some((l) => l.owner === owner && l.sourceId === sourceId && l.targetId === targetId)) return lanes;
  if (lanes.lanes.filter((l) => l.owner === owner && l.sourceId === sourceId).length >= maxLanes(state, sourceId)) return lanes;
  const route = findDispatchRoute(state, sourceId, targetId, owner);
  if (!route) return lanes;
  const lane: Lane = { id: `lane_${lanes.nextLaneId}`, owner, sourceId, targetId, routeIds: route, nextEmitIn: 0 };
  return { ...lanes, lanes: [...lanes.lanes, lane], nextLaneId: lanes.nextLaneId + 1 };
}

export function cutLane(lanes: LaneState, owner: Team, sourceId: string, targetId: string): LaneState {
  const kept = lanes.lanes.filter((l) => !(l.owner === owner && l.sourceId === sourceId && l.targetId === targetId));
  return kept.length === lanes.lanes.length ? lanes : { ...lanes, lanes: kept };
}

/** Lanes whose finger-swipe segment crossed them are cut by the caller; this drops lanes that can no longer run. */
function pruneDeadLanes(state: GameState, lanes: readonly Lane[]): Lane[] {
  return lanes.filter((l) => state.territories[l.sourceId]?.owner === l.owner);
}

/** Advances the base simulation, then the lanes by the same step. */
export function stepLaneSimulation(
  state: GameState, accumulators: Record<string, number>, lanes: LaneState, deltaSeconds: number,
  config: LaneConfig = LANE_CONFIG,
): { state: GameState; accumulators: Record<string, number>; lanes: LaneState } {
  const step = stepSimulation(state, accumulators, deltaSeconds);
  if (step.state.status !== 'playing') return { state: step.state, accumulators: step.accumulators, lanes };
  const territories = Object.fromEntries(Object.entries(step.state.territories).map(([id, t]) => [id, { ...t }]));
  const stats = { ...step.state.stats };

  // Soldiers in flight.
  const flying: Soldier[] = [];
  for (const soldier of lanes.soldiers) {
    const remaining = soldier.remaining - deltaSeconds;
    if (remaining > 1e-9) { flying.push({ ...soldier, remaining }); continue; }
    const target = territories[soldier.targetId];
    if (!target) continue;
    if (target.owner === soldier.owner) target.units = Math.min(target.maxUnits, target.units + 1);
    else if (target.units > 0) target.units -= 1;
    else {
      target.owner = soldier.owner;
      target.units = 1;
      if (soldier.owner === 'player') stats.territoriesCapturedByPlayer++; else stats.territoriesCapturedByEnemy++;
    }
  }

  // Lanes emit.
  const live = pruneDeadLanes({ ...step.state, territories }, lanes.lanes);
  const emitted: Soldier[] = [];
  const nextLanes: Lane[] = [];
  for (const lane of live) {
    let wait = lane.nextEmitIn - deltaSeconds;
    const source = territories[lane.sourceId];
    while (wait <= 1e-9) {
      if (source.units > 1) {
        source.units -= 1;
        const total = routeSeconds(step.state, lane.routeIds, config);
        emitted.push({ owner: lane.owner, targetId: lane.targetId, routeIds: lane.routeIds, total, remaining: total });
        if (lane.owner === 'player') stats.playerUnitsDispatched++; else stats.enemyUnitsDispatched++;
      }
      wait += config.emitSeconds;
      if (source.units <= 1) { wait = Math.max(wait, config.emitSeconds); break; }
    }
    nextLanes.push({ ...lane, nextEmitIn: wait });
  }

  // A side with no towers and no soldiers left has lost; the base step already handled time limits.
  const towers = (team: Team): number => Object.values(territories).filter((t) => t.owner === team).length;
  const inFlight = (team: Team): number => [...flying, ...emitted].filter((s) => s.owner === team).length;
  let status: MatchStatus = step.state.status;
  if (towers('enemy') === 0 && inFlight('enemy') === 0) status = 'victory';
  else if (towers('player') === 0 && inFlight('player') === 0) status = 'defeat';

  return {
    state: { ...step.state, territories, stats, status },
    accumulators: step.accumulators,
    lanes: { ...lanes, lanes: nextLanes, soldiers: [...flying, ...emitted] },
  };
}

/** Where a soldier is on the board (flat world coordinates), walking its route at constant speed. */
export function soldierPosition(state: GameState, soldier: Soldier): { x: number; y: number } {
  const points = soldier.routeIds.map((id) => state.territories[id]).filter(Boolean);
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1 || soldier.total <= 0) return { x: points[0].x, y: points[0].y };
  const lengths: number[] = [];
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) { const d = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y); lengths.push(d); sum += d; }
  let travelled = sum * Math.min(1, Math.max(0, 1 - soldier.remaining / soldier.total));
  for (let i = 0; i < lengths.length; i++) {
    if (travelled <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] === 0 ? 1 : Math.min(1, travelled / lengths[i]);
      return { x: points[i].x + (points[i + 1].x - points[i].x) * f, y: points[i].y + (points[i + 1].y - points[i].y) * f };
    }
    travelled -= lengths[i];
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y };
}

/** Unit direction of the route leg a soldier is on (flat world coordinates); (0, -1) when it has no leg. */
export function soldierHeading(state: GameState, soldier: Soldier): { x: number; y: number } {
  const points = soldier.routeIds.map((id) => state.territories[id]).filter(Boolean);
  if (points.length < 2 || soldier.total <= 0) return { x: 0, y: -1 };
  const lengths: number[] = [];
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) { const d = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y); lengths.push(d); sum += d; }
  let travelled = sum * Math.min(1, Math.max(0, 1 - soldier.remaining / soldier.total));
  let leg = lengths.length - 1;
  for (let i = 0; i < lengths.length; i++) {
    if (travelled <= lengths[i]) { leg = i; break; }
    travelled -= lengths[i];
  }
  const dx = points[leg + 1].x - points[leg].x, dy = points[leg + 1].y - points[leg].y;
  const length = Math.hypot(dx, dy);
  return length === 0 ? { x: 0, y: -1 } : { x: dx / length, y: dy / length };
}

/** Lanes whose drawn route a swipe segment crosses (flat world coordinates), nearest to the swipe start first. */
export function lanesCrossedBySegment(
  state: GameState, lanes: LaneState, owner: Team, from: { x: number; y: number }, to: { x: number; y: number },
): Lane[] {
  const crosses = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => {
    const d = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const d1 = d(from, to, a), d2 = d(from, to, b), d3 = d(a, b, from), d4 = d(a, b, to);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  return lanes.lanes.filter((lane) => lane.owner === owner && lane.routeIds.slice(0, -1).some((id, i) => {
    const a = state.territories[id], b = state.territories[lane.routeIds[i + 1]];
    return a && b && crosses(a, b);
  }));
}
