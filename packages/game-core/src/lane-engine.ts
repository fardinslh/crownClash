import { LANE_BOT_TICK_SECONDS, planLanes } from './lane-ai.js';
import {
  LANE_CONFIG,
  cutLane,
  emptyLaneState,
  lanesCrossedBySegment,
  maxLanes,
  openLane,
  stepLaneSimulation,
  type Lane,
  type LaneConfig,
  type LaneState,
} from './lanes.js';
import type { BotDifficulty } from './bot-difficulty.js';
import type { CombatResult, GameState, Team, Territory } from './types.js';

/** Towers that changed hands between two states, as the arrival results capture effects expect. */
export function capturesBetween(before: GameState, after: GameState): CombatResult[] {
  const captures: CombatResult[] = [];
  for (const [id, now] of Object.entries(after.territories) as Array<[string, Territory]>) {
    const was = before.territories[id];
    if (!was || was.owner === now.owner || now.owner === 'neutral') continue;
    captures.push({
      targetId: id, attackerOwner: now.owner, previousOwner: was.owner, newOwner: now.owner,
      previousUnits: was.units, incomingUnits: 1, remainingUnits: now.units, captured: true, reinforced: false,
    });
  }
  return captures;
}

/**
 * Lane battle rules in one place (candidate rules v5): the live client and the replay both
 * drive this class, so they cannot disagree. One fixed step; the enemy plans its lanes on its
 * own cadence; the player opens and cuts lanes between steps. No rendering here.
 */
export class LaneEngine {
  lanes: LaneState = emptyLaneState();
  nextBotSeconds: number;

  constructor(readonly difficulty: BotDifficulty, private readonly config: LaneConfig = LANE_CONFIG) {
    this.nextBotSeconds = LANE_BOT_TICK_SECONDS[difficulty];
  }

  step(
    state: GameState, accumulators: Record<string, number>, deltaSeconds: number,
  ): { state: GameState; accumulators: Record<string, number>; captures: CombatResult[] } {
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

  /** The player opens one lane. True when a player lane from `sourceId` to `targetId` is running afterwards. */
  open(state: GameState, sourceId: string, targetId: string): boolean {
    const source = state.territories[sourceId];
    if (!source || source.owner !== 'player' || sourceId === targetId) return false;
    this.lanes = openLane(state, this.lanes, 'player', sourceId, targetId);
    return this.lanes.lanes.some((l) => l.owner === 'player' && l.sourceId === sourceId && l.targetId === targetId);
  }

  /** The player cuts one lane. True when a lane was removed. */
  cut(sourceId: string, targetId: string): boolean {
    const next = cutLane(this.lanes, 'player', sourceId, targetId);
    const removed = next !== this.lanes;
    this.lanes = next;
    return removed;
  }

  /** A drag from one or more towers onto a target. `opened` lists sources that now run a lane. */
  openFor(state: GameState, sourceIds: readonly string[], targetId: string): { opened: string[]; blocked: string[] } {
    const result = { opened: [] as string[], blocked: [] as string[] };
    for (const id of sourceIds) (this.open(state, id, targetId) ? result.opened : result.blocked).push(id);
    return result;
  }

  /** A swipe (flat world coordinates) cuts every player lane it crosses and returns them. */
  cutBySwipe(state: GameState, from: { x: number; y: number }, to: { x: number; y: number }): Lane[] {
    const crossed = lanesCrossedBySegment(state, this.lanes, 'player', from, to);
    for (const lane of crossed) this.cut(lane.sourceId, lane.targetId);
    return crossed;
  }

  /** Free paths left on a tower (tier minus running lanes). */
  freePaths(state: GameState, towerId: string, owner: Team = 'player'): number {
    return Math.max(0, maxLanes(state, towerId) - this.lanes.lanes.filter((l) => l.owner === owner && l.sourceId === towerId).length);
  }
}
