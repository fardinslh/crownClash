import {
  LANE_BOT_TICK_SECONDS,
  LANE_CONFIG,
  cutLane,
  emptyLaneState,
  lanesCrossedBySegment,
  maxLanes,
  openLane,
  planLanes,
  soldierPosition,
  stepLaneSimulation,
  type BotDifficulty,
  type CombatResult,
  type GameState,
  type LaneConfig,
  type LaneState,
  type Team,
} from '@crown-clash/game-core';

export interface LaneOpenResult {
  readonly opened: string[];
  /** Sources that could not open a lane: no road to the target, or every path of the tower is in use. */
  readonly blocked: string[];
}

/**
 * Lane battle state kept beside the shared GameState (candidate rules v5): a client-local match,
 * not an authoritative one. No Phaser here, so the rules stay testable and the scene only draws.
 */
export class LaneRuntime {
  lanes: LaneState = emptyLaneState();
  nextBotSeconds: number;

  constructor(readonly difficulty: BotDifficulty, private readonly config: LaneConfig = LANE_CONFIG) {
    this.nextBotSeconds = LANE_BOT_TICK_SECONDS[difficulty];
  }

  /** One fixed simulation step; the enemy plans its lanes on its own cadence. */
  step(state: GameState, accumulators: Record<string, number>, deltaSeconds: number): { state: GameState; accumulators: Record<string, number>; captures: CombatResult[] } {
    const result = stepLaneSimulation(state, accumulators, this.lanes, deltaSeconds, this.config);
    this.lanes = result.lanes;
    const captures = capturesBetween(state, result.state);
    if (result.state.status === 'playing' && result.state.elapsedTimeSeconds >= this.nextBotSeconds - 1e-9) {
      this.nextBotSeconds += LANE_BOT_TICK_SECONDS[this.difficulty];
      this.plan(result.state, 'enemy');
    }
    return { state: result.state, accumulators: result.accumulators, captures };
  }

  private plan(state: GameState, team: Team): void {
    const plan = planLanes(state, this.lanes, team, { config: this.config });
    for (const o of plan.cut) this.lanes = cutLane(this.lanes, team, o.from, o.to);
    for (const o of plan.open) this.lanes = openLane(state, this.lanes, team, o.from, o.to);
  }

  /** The player drags from one or more of their towers onto a target. */
  openFor(state: GameState, sourceIds: readonly string[], targetId: string): LaneOpenResult {
    const result: LaneOpenResult = { opened: [], blocked: [] };
    for (const id of sourceIds) {
      const source = state.territories[id];
      if (!source || source.owner !== 'player' || id === targetId) { result.blocked.push(id); continue; }
      const before = this.lanes;
      this.lanes = openLane(state, this.lanes, 'player', id, targetId);
      const exists = this.lanes.lanes.some((l) => l.owner === 'player' && l.sourceId === id && l.targetId === targetId);
      if (exists && (this.lanes !== before || before.lanes.some((l) => l.owner === 'player' && l.sourceId === id && l.targetId === targetId))) result.opened.push(id);
      else result.blocked.push(id);
    }
    return result;
  }

  /** A swipe (flat world coordinates) cuts every player lane it crosses. Returns how many were cut. */
  cutBySwipe(state: GameState, from: { x: number; y: number }, to: { x: number; y: number }): number {
    const crossed = lanesCrossedBySegment(state, this.lanes, 'player', from, to);
    for (const lane of crossed) this.lanes = cutLane(this.lanes, 'player', lane.sourceId, lane.targetId);
    return crossed.length;
  }

  /** Free paths left on a tower (tier minus running lanes). */
  freePaths(state: GameState, towerId: string, owner: Team = 'player'): number {
    return Math.max(0, maxLanes(state, towerId) - this.lanes.lanes.filter((l) => l.owner === owner && l.sourceId === towerId).length);
  }
}

/** Towers that changed hands between two states, as the arrival results the capture effects expect. */
export function capturesBetween(before: GameState, after: GameState): CombatResult[] {
  const captures: CombatResult[] = [];
  for (const [id, now] of Object.entries(after.territories)) {
    const was = before.territories[id];
    if (!was || was.owner === now.owner || now.owner === 'neutral') continue;
    captures.push({
      targetId: id, attackerOwner: now.owner, previousOwner: was.owner, newOwner: now.owner,
      previousUnits: was.units, incomingUnits: 1, remainingUnits: now.units, captured: true, reinforced: false,
    });
  }
  return captures;
}

/** One tower's path slots: its tier, and how many of them are free. */
export interface TierDots { readonly u: number; readonly v: number; readonly tier: number; readonly free: number; readonly owner: Team }

/** A column of dots beside a tower's count: a bright dot is a free path, a dim one a path with a lane running. */
export function drawTierDots(graphics: LaneGraphics, dots: readonly TierDots[], scale: number): void {
  for (const dot of dots) {
    if (dot.owner === 'neutral') continue;
    const gap = 10 * scale;
    for (let i = 0; i < dot.tier; i++) {
      const y = dot.v + (i - (dot.tier - 1) / 2) * gap;
      const free = i < dot.free;
      graphics.fillStyle(0x020617, 0.92).fillCircle(dot.u, y, 5.4 * scale);
      graphics.fillStyle(free ? 0xffffff : LANE_COLORS[dot.owner], free ? 1 : 0.6).fillCircle(dot.u, y, free ? 3.8 * scale : 2.6 * scale);
    }
  }
}

/** The few Phaser Graphics calls the lane drawing needs, so it can be tested with a fake. */
export interface LaneGraphics {
  lineStyle(width: number, color: number, alpha: number): LaneGraphics;
  lineBetween(x1: number, y1: number, x2: number, y2: number): LaneGraphics;
  fillStyle(color: number, alpha: number): LaneGraphics;
  fillCircle(x: number, y: number, radius: number): LaneGraphics;
}

export const LANE_COLORS: Readonly<Record<Team, number>> = Object.freeze({ player: 0x60a5fa, enemy: 0xf87171, neutral: 0x94a3b8 });

/** Draws every lane as a translucent beam along its road and every soldier as a dot in file. */
export function drawLanes(
  graphics: LaneGraphics, state: GameState, lanes: LaneState,
  project: (x: number, y: number) => { u: number; v: number }, scale: number,
): void {
  for (const lane of lanes.lanes) {
    const color = LANE_COLORS[lane.owner];
    for (let i = 0; i < lane.routeIds.length - 1; i++) {
      const a = state.territories[lane.routeIds[i]], b = state.territories[lane.routeIds[i + 1]];
      if (!a || !b) continue;
      const p = project(a.x, a.y), q = project(b.x, b.y);
      graphics.lineStyle(15 * scale, color, 0.28).lineBetween(p.u, p.v, q.u, q.v);
      graphics.lineStyle(5 * scale, color, 0.85).lineBetween(p.u, p.v, q.u, q.v);
    }
  }
  for (const soldier of lanes.soldiers) {
    const at = soldierPosition(state, soldier);
    const p = project(at.x, at.y);
    graphics.fillStyle(0xffffff, 0.95).fillCircle(p.u, p.v, 6.4 * scale);
    graphics.fillStyle(LANE_COLORS[soldier.owner], 1).fillCircle(p.u, p.v, 4.8 * scale);
  }
}
