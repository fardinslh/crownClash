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
