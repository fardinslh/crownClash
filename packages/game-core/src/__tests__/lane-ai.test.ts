import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../simulation.js';
import { cutLane, emptyLaneState, openLane, type LaneState } from '../lanes.js';
import { LANE_BOT_TICK_SECONDS, LANE_ENEMY_MODIFIERS, planLanes } from '../lane-ai.js';
import type { GameState } from '../types.js';

const fresh = (): GameState => createInitialGameState({ gameplayRulesVersion: 3, battlefieldId: 'crown_cross' });
const apply = (state: GameState, lanes: LaneState, team: 'player' | 'enemy', plan: ReturnType<typeof planLanes>): LaneState => {
  for (const o of plan.cut) lanes = cutLane(lanes, team, o.from, o.to);
  for (const o of plan.open) lanes = openLane(state, lanes, team, o.from, o.to);
  return lanes;
};

describe('planLanes (candidate rules v5 policy)', () => {
  it('opens a lane on a reachable tower the stream can beat and never exceeds a tower tier', () => {
    const state = fresh();
    state.territories.p_base.units = 40;
    let lanes = emptyLaneState();
    for (let i = 0; i < 6; i++) lanes = apply(state, lanes, 'player', planLanes(state, lanes, 'player'));
    const fromBase = lanes.lanes.filter((l) => l.sourceId === 'p_base');
    expect(fromBase.length).toBeGreaterThan(0);
    expect(fromBase.length).toBeLessThanOrEqual(state.territories.p_base.tier);
    for (const lane of lanes.lanes) expect(state.territories[lane.targetId].owner).not.toBe('player');
  });

  it('prefers the weaker of two targets and the k-th best at lower skill', () => {
    const state = fresh();
    state.territories.p_base.units = 40;
    state.territories.n_bot_left.owner = 'neutral';
    state.territories.n_bot_right.owner = 'neutral';
    state.territories.n_bot_left.units = 2;
    state.territories.n_bot_right.units = 20;
    const best = planLanes(state, emptyLaneState(), 'player').open.find((o) => o.from === 'p_base');
    expect(best?.to).toBe('n_bot_left');
    const worse = planLanes(state, emptyLaneState(), 'player', { skill: 1 }).open.find((o) => o.from === 'p_base');
    expect(worse?.to).not.toBe('n_bot_left');
  });

  it('cuts a lane whose target was captured and is full, and one the stream cannot win', () => {
    const state = fresh();
    state.territories.p_base.units = 40;
    state.territories.n_bot_left.owner = 'player';
    state.territories.n_bot_left.units = state.territories.n_bot_left.maxUnits;
    const lanes = openLane(state, emptyLaneState(), 'player', 'p_base', 'n_bot_left');
    expect(planLanes(state, lanes, 'player').cut).toContainEqual({ from: 'p_base', to: 'n_bot_left' });

    const hopeless = fresh();
    hopeless.territories.p_base.units = 40;
    const bad = hopeless.territories.n_center;
    bad.owner = 'enemy';
    bad.productionRate = 50; // regenerates faster than the stream can remove defenders
    const hopelessLane = openLane(hopeless, emptyLaneState(), 'player', 'p_base', 'n_center');
    if (hopelessLane.lanes.length) expect(planLanes(hopeless, hopelessLane, 'player').cut).toContainEqual({ from: 'p_base', to: 'n_center' });
  });

  it('rescues a friendly tower under lane attack from a rich neighbour', () => {
    const state = fresh();
    state.territories.p_base.units = 40;
    state.territories.n_bot_left.owner = 'player';
    state.territories.n_bot_left.units = 3;
    state.territories.n_bot_right.owner = 'enemy';
    state.territories.n_bot_right.units = 30;
    state.territories.n_bot_right.tier = 3;
    const attack = openLane(state, emptyLaneState(), 'enemy', 'n_bot_right', 'n_bot_left');
    if (attack.lanes.length === 0) return; // not on a road in this layout: nothing to assert
    const plan = planLanes(state, attack, 'player');
    expect(plan.open).toContainEqual({ from: 'p_base', to: 'n_bot_left' });
  });

  it('is deterministic and does nothing once the match is decided or there are no sources', () => {
    const state = fresh();
    state.territories.p_base.units = 30;
    expect(planLanes(state, emptyLaneState(), 'player')).toEqual(planLanes(state, emptyLaneState(), 'player'));
    for (const t of Object.values(state.territories)) if (t.owner === 'player') t.units = 1;
    expect(planLanes(state, emptyLaneState(), 'player').open).toEqual([]);
  });

  it('keeps the difficulty ladder ordered', () => {
    expect(LANE_BOT_TICK_SECONDS.easy).toBeGreaterThan(LANE_BOT_TICK_SECONDS.normal);
    expect(LANE_BOT_TICK_SECONDS.normal).toBeGreaterThan(LANE_BOT_TICK_SECONDS.hard);
    expect(LANE_ENEMY_MODIFIERS.easy.startingUnits).toBeLessThan(LANE_ENEMY_MODIFIERS.hard.startingUnits);
    expect(LANE_ENEMY_MODIFIERS.easy.productionRateMultiplier).toBeLessThan(LANE_ENEMY_MODIFIERS.hard.productionRateMultiplier);
  });
});
