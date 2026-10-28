import { describe, expect, it, vi } from 'vitest';
import { createInitialGameState, LANE_ENEMY_MODIFIERS, type GameState } from '@crown-clash/game-core';
import { LANE_COLORS, LaneRuntime, drawLanes, type LaneGraphics } from '../LaneRuntime.js';

const fresh = (): GameState => createInitialGameState({ gameplayRulesVersion: 3, battlefieldId: 'crown_cross', enemyModifiers: { ...LANE_ENEMY_MODIFIERS.easy } });

describe('LaneRuntime', () => {
  it('opens player lanes, reports blocked sources and never opens from a tower the player does not hold', () => {
    const state = fresh();
    state.territories.p_base.units = 30;
    const runtime = new LaneRuntime('easy');
    const result = runtime.openFor(state, ['p_base', 'n_top_left'], 'n_bot_left');
    expect(runtime.lanes.lanes.some((l) => l.sourceId === 'p_base')).toBe(true);
    expect(result.blocked).toContain('n_top_left');
    expect(runtime.openFor(state, ['p_base'], 'p_base').blocked).toEqual(['p_base']);
  });

  it('blocks a source whose tier paths are all in use and frees one after a cut', () => {
    const state = fresh();
    state.territories.p_base.units = 40;
    state.territories.p_base.tier = 1;
    for (const id of ['n_bot_left', 'n_bot_right']) state.territories[id].owner = 'neutral';
    const runtime = new LaneRuntime('easy');
    expect(runtime.openFor(state, ['p_base'], 'n_bot_left').opened).toEqual(['p_base']);
    expect(runtime.freePaths(state, 'p_base')).toBe(0);
    expect(runtime.openFor(state, ['p_base'], 'n_bot_right').blocked).toEqual(['p_base']);
    const a = state.territories.p_base, b = state.territories.n_bot_left;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dx = (b.y - a.y) * 0.3, dy = -(b.x - a.x) * 0.3;
    expect(runtime.cutBySwipe(state, { x: mid.x + dx, y: mid.y + dy }, { x: mid.x - dx, y: mid.y - dy })).toBe(1);
    expect(runtime.freePaths(state, 'p_base')).toBe(1);
  });

  it('steps the match and lets the enemy plan lanes on its own cadence', () => {
    let state = fresh();
    let acc: Record<string, number> = {};
    const runtime = new LaneRuntime('easy');
    for (let i = 0; i < Math.round(8 / 0.02) && state.status === 'playing'; i++) {
      const step = runtime.step(state, acc, 0.02);
      state = step.state; acc = step.accumulators;
    }
    expect(runtime.lanes.lanes.some((l) => l.owner === 'enemy')).toBe(true);
    expect(runtime.lanes.lanes.every((l) => l.owner === 'enemy')).toBe(true);
  });

  it('draws beams and soldiers in team colours through the projection', () => {
    const state = fresh();
    state.territories.p_base.units = 30;
    const runtime = new LaneRuntime('easy');
    runtime.openFor(state, ['p_base'], 'n_bot_left');
    let acc: Record<string, number> = {};
    let s = state;
    for (let i = 0; i < 40; i++) { const step = runtime.step(s, acc, 0.02); s = step.state; acc = step.accumulators; }
    const calls: string[] = [];
    const g: LaneGraphics = {
      lineStyle: vi.fn((_w: number, color: number) => { calls.push(`line:${color}`); return g; }),
      lineBetween: vi.fn(() => g),
      fillStyle: vi.fn((color: number) => { calls.push(`fill:${color}`); return g; }),
      fillCircle: vi.fn(() => g),
    };
    drawLanes(g, s, runtime.lanes, (x, y) => ({ u: x, v: y }), 1);
    expect(calls).toContain(`line:${LANE_COLORS.player}`);
    expect(calls).toContain(`fill:${LANE_COLORS.player}`);
    expect(g.fillCircle).toHaveBeenCalled();
  });
});
