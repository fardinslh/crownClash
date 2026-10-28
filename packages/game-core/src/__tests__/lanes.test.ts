import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../simulation.js';
import { LANE_CONFIG, cutLane, emptyLaneState, maxLanes, openLane, stepLaneSimulation, type LaneState } from '../lanes.js';
import type { GameState } from '../types.js';

const fresh = (): GameState => {
  const state = createInitialGameState({ gameplayRulesVersion: 3, battlefieldId: 'crown_cross' });
  for (const t of Object.values(state.territories)) t.productionRate = 0; // isolate lane behaviour from production
  return state;
};

function run(state: GameState, lanes: LaneState, seconds: number): { state: GameState; lanes: LaneState } {
  let acc: Record<string, number> = {};
  for (let i = 0; i < Math.round(seconds / 0.02); i++) {
    const step = stepLaneSimulation(state, acc, lanes, 0.02);
    state = step.state; acc = step.accumulators; lanes = step.lanes;
  }
  return { state, lanes };
}

describe('lanes (candidate rules v5 prototype)', () => {
  it('opens a lane only for a legal road order and keeps one lane per source/target pair', () => {
    const state = fresh();
    const opened = openLane(state, emptyLaneState(), 'player', 'p_base', 'n_bot_left');
    expect(opened.lanes).toHaveLength(1);
    expect(openLane(state, opened, 'player', 'p_base', 'n_bot_left')).toBe(opened);
    // The enemy base is not reachable from p_base over friendly towers or one road.
    expect(openLane(state, emptyLaneState(), 'player', 'p_base', 'e_base').lanes).toHaveLength(0);
    // A source the owner does not hold cannot open a lane.
    expect(openLane(state, emptyLaneState(), 'enemy', 'p_base', 'n_bot_left').lanes).toHaveLength(0);
  });

  it('limits a tower to as many simultaneous lanes as its tier and frees a slot when one is cut', () => {
    const state = fresh();
    const source = state.territories.p_base;
    source.tier = 2;
    for (const id of ['n_bot_left', 'n_bot_right', 'n_center']) state.territories[id].owner = 'neutral';
    expect(maxLanes(state, 'p_base')).toBe(2);
    let lanes = openLane(state, emptyLaneState(), 'player', 'p_base', 'n_bot_left');
    lanes = openLane(state, lanes, 'player', 'p_base', 'n_bot_right');
    expect(lanes.lanes).toHaveLength(2);
    expect(openLane(state, lanes, 'player', 'p_base', 'n_center')).toBe(lanes);
    lanes = cutLane(lanes, 'player', 'p_base', 'n_bot_left');
    expect(openLane(state, lanes, 'player', 'p_base', 'n_center').lanes).toHaveLength(2);
  });

  it('streams single soldiers at a steady rate and never empties the source', () => {
    const state = fresh();
    state.territories.p_base.units = 5;
    state.territories.n_bot_left.owner = 'player';
    state.territories.n_bot_left.units = 0;
    const lanes = openLane(state, emptyLaneState(), 'player', 'p_base', 'n_bot_left');
    const after = run(state, lanes, 3);
    expect(after.state.territories.p_base.units).toBe(1);
    expect(after.state.territories.n_bot_left.units).toBe(4);
    expect(after.state.stats.playerUnitsDispatched).toBe(4);
  });

  it('emits one soldier per interval', () => {
    const state = fresh();
    state.territories.p_base.units = 30;
    const lanes = openLane(state, emptyLaneState(), 'player', 'p_base', 'n_bot_left');
    const after = run(state, lanes, 1);
    // Soldiers leave at 0, 0.2, 0.4, 0.6, 0.8 s (and again at 1.0 s).
    expect(30 - after.state.territories.p_base.units).toBeGreaterThanOrEqual(5);
    expect(30 - after.state.territories.p_base.units).toBeLessThanOrEqual(6);
    expect(LANE_CONFIG.emitSeconds).toBe(0.2);
  });

  it('removes one defender per arriving soldier and captures at zero', () => {
    const state = fresh();
    state.territories.p_base.units = 30;
    state.territories.n_bot_left.owner = 'neutral';
    state.territories.n_bot_left.units = 3;
    const lanes = openLane(state, emptyLaneState(), 'player', 'p_base', 'n_bot_left');
    const after = run(state, lanes, 6);
    const tower = after.state.territories.n_bot_left;
    expect(after.state.stats.territoriesCapturedByPlayer).toBe(1);
    expect(tower.owner).toBe('player');
    expect(tower.units).toBeGreaterThanOrEqual(1);
    expect(after.state.stats.territoriesCapturedByPlayer).toBe(1);
  });

  it('caps a friendly tower at maxUnits', () => {
    const state = fresh();
    state.territories.p_base.units = 60;
    state.territories.n_bot_left.owner = 'player';
    state.territories.n_bot_left.units = state.territories.n_bot_left.maxUnits - 1;
    const lanes = openLane(state, emptyLaneState(), 'player', 'p_base', 'n_bot_left');
    const after = run(state, lanes, 8);
    expect(after.state.territories.n_bot_left.units).toBe(after.state.territories.n_bot_left.maxUnits);
  });

  it('stops streaming the moment the lane is cut', () => {
    const state = fresh();
    state.territories.p_base.units = 40;
    let lanes = openLane(state, emptyLaneState(), 'player', 'p_base', 'n_bot_left');
    const first = run(state, lanes, 1);
    lanes = cutLane(first.lanes, 'player', 'p_base', 'n_bot_left');
    expect(lanes.lanes).toHaveLength(0);
    const sentSoFar = 40 - first.state.territories.p_base.units;
    const later = run(first.state, lanes, 2);
    expect(40 - later.state.territories.p_base.units).toBe(sentSoFar);
    expect(cutLane(lanes, 'player', 'p_base', 'n_bot_left')).toBe(lanes);
  });

  it('drops a lane whose source tower was lost', () => {
    const state = fresh();
    state.territories.p_base.units = 30;
    const lanes = openLane(state, emptyLaneState(), 'player', 'p_base', 'n_bot_left');
    state.territories.p_base.owner = 'enemy';
    expect(run(state, lanes, 0.1).lanes.lanes).toHaveLength(0);
  });

  it('is deterministic: the same orders give the same outcome', () => {
    const play = () => {
      const state = fresh();
      state.territories.p_base.units = 25;
      return run(state, openLane(state, emptyLaneState(), 'player', 'p_base', 'n_bot_left'), 5).state;
    };
    expect(play()).toEqual(play());
  });
});

describe('lane geometry helpers', () => {
  it('places a soldier along its route and clamps at the ends', async () => {
    const { soldierPosition } = await import('../lanes.js');
    const state = fresh();
    const a = state.territories.p_base, b = state.territories.n_bot_left;
    const soldier = { owner: 'player' as const, targetId: 'n_bot_left', routeIds: ['p_base', 'n_bot_left'], total: 4, remaining: 4 };
    expect(soldierPosition(state, soldier)).toEqual({ x: a.x, y: a.y });
    expect(soldierPosition(state, { ...soldier, remaining: 0 })).toEqual({ x: b.x, y: b.y });
    const half = soldierPosition(state, { ...soldier, remaining: 2 });
    expect(half.x).toBeCloseTo((a.x + b.x) / 2, 6);
    expect(half.y).toBeCloseTo((a.y + b.y) / 2, 6);
  });

  it('points a soldier along the leg it is on, switching legs on multi-hop routes', async () => {
    const { soldierHeading } = await import('../lanes.js');
    const state = fresh();
    const a = state.territories.p_base, b = state.territories.n_bot_left, c = state.territories.n_mid_left;
    const soldier = { owner: 'player' as const, targetId: 'n_mid_left', routeIds: ['p_base', 'n_bot_left', 'n_mid_left'], total: 6, remaining: 6 };
    const first = soldierHeading(state, soldier);
    const firstLength = Math.hypot(b.x - a.x, b.y - a.y);
    expect(first.x).toBeCloseTo((b.x - a.x) / firstLength, 6);
    expect(first.y).toBeCloseTo((b.y - a.y) / firstLength, 6);
    const last = soldierHeading(state, { ...soldier, remaining: 0.01 });
    const lastLength = Math.hypot(c.x - b.x, c.y - b.y);
    expect(last.x).toBeCloseTo((c.x - b.x) / lastLength, 6);
    expect(last.y).toBeCloseTo((c.y - b.y) / lastLength, 6);
    expect(Math.hypot(first.x, first.y)).toBeCloseTo(1, 6);
  });

  it('falls back to facing up when a soldier has no leg', async () => {
    const { soldierHeading } = await import('../lanes.js');
    expect(soldierHeading(fresh(), { owner: 'player', targetId: 'p_base', routeIds: ['p_base'], total: 0, remaining: 0 })).toEqual({ x: 0, y: -1 });
  });

  it('finds the owner\'s lanes a swipe segment crosses', async () => {
    const { lanesCrossedBySegment } = await import('../lanes.js');
    const state = fresh();
    state.territories.p_base.units = 30;
    const lanes = openLane(state, emptyLaneState(), 'player', 'p_base', 'n_bot_left');
    const a = state.territories.p_base, b = state.territories.n_bot_left;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const across = { x: mid.x + (b.y - a.y) * 0.3, y: mid.y - (b.x - a.x) * 0.3 };
    const other = { x: mid.x - (b.y - a.y) * 0.3, y: mid.y + (b.x - a.x) * 0.3 };
    expect(lanesCrossedBySegment(state, lanes, 'player', across, other)).toHaveLength(1);
    expect(lanesCrossedBySegment(state, lanes, 'enemy', across, other)).toHaveLength(0);
    expect(lanesCrossedBySegment(state, lanes, 'player', { x: 0, y: 0 }, { x: 5, y: 5 })).toHaveLength(0);
  });
});
