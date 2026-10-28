import { describe, expect, it, vi } from 'vitest';
import { createInitialGameState, LANE_ENEMY_MODIFIERS, type GameState } from '@crown-clash/game-core';
import { LANE_COLORS, LaneRuntime, capturesBetween, drawLanes, drawTierDots, type LaneGraphics } from '../LaneRuntime.js';

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
    expect(runtime.cutBySwipe(state, { x: mid.x + dx, y: mid.y + dy }, { x: mid.x - dx, y: mid.y - dy })).toHaveLength(1);
    expect(runtime.freePaths(state, 'p_base')).toBe(1);
  });

  it('steps the match and lets the enemy plan lanes on its own cadence', () => {
    let state = fresh();
    let acc: Record<string, number> = {};
    const runtime = new LaneRuntime('easy');
    for (let i = 0; i < Math.round(12 / 0.02) && state.status === 'playing'; i++) {
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

describe('lane feedback helpers', () => {
  it('reports towers that changed hands as capture results, ignoring neutral and unchanged towers', () => {
    const before = fresh();
    const after = structuredClone(before);
    after.territories.n_center.owner = 'player';
    after.territories.n_center.units = 1;
    after.territories.n_bot_left.owner = 'neutral';
    const captures = capturesBetween(before, after);
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({ targetId: 'n_center', newOwner: 'player', attackerOwner: 'player', captured: true, reinforced: false });
    expect(capturesBetween(before, before)).toEqual([]);
  });

  it('step returns the captures of a tower taken by a soldier', () => {
    let state = fresh();
    state.territories.p_base.units = 40;
    state.territories.n_bot_left.owner = 'neutral';
    state.territories.n_bot_left.units = 1;
    const runtime = new LaneRuntime('easy');
    runtime.openFor(state, ['p_base'], 'n_bot_left');
    let acc: Record<string, number> = {};
    const seen: string[] = [];
    for (let i = 0; i < Math.round(8 / 0.02) && state.status === 'playing'; i++) {
      const step = runtime.step(state, acc, 0.02);
      state = step.state; acc = step.accumulators;
      for (const c of step.captures) seen.push(`${c.targetId}:${c.newOwner}`);
    }
    expect(seen).toContain('n_bot_left:player');
  });

  it('draws a bright dot per free path and a dim one per used path, none on neutral towers', () => {
    const fills: Array<{ color: number; alpha: number }> = [];
    const g: LaneGraphics = {
      lineStyle: () => g, lineBetween: () => g,
      fillStyle: (color: number, alpha: number) => { fills.push({ color, alpha }); return g; },
      fillCircle: () => g,
    };
    drawTierDots(g, [{ u: 100, v: 100, tier: 3, free: 1, owner: 'player' }, { u: 200, v: 100, tier: 2, free: 2, owner: 'neutral' }], 1);
    const inner = fills.filter((f) => f.color !== 0x020617);
    expect(inner).toHaveLength(3);
    expect(inner.filter((f) => f.color === 0xffffff)).toHaveLength(1);
    expect(inner.filter((f) => f.color === LANE_COLORS.player)).toHaveLength(2);
  });
});

describe('drawLanes flow', () => {
  const recorder = (): { graphics: LaneGraphics; circles: Array<[number, number, number]> } => {
    const circles: Array<[number, number, number]> = [];
    const graphics: LaneGraphics = {
      lineStyle: () => graphics,
      lineBetween: () => graphics,
      fillStyle: () => graphics,
      fillCircle: (x, y, r) => { circles.push([x, y, r]); return graphics; },
    };
    return { graphics, circles };
  };
  const withLane = (): { state: GameState; runtime: LaneRuntime } => {
    const state = fresh();
    state.territories.p_base.units = 30;
    const runtime = new LaneRuntime('easy');
    runtime.openFor(state, ['p_base'], 'n_bot_left');
    return { state, runtime };
  };
  const project = (x: number, y: number): { u: number; v: number } => ({ u: x, v: y });

  it('draws no flow beads unless a flow time is given', () => {
    const { state, runtime } = withLane();
    const { graphics, circles } = recorder();
    drawLanes(graphics, state, runtime.lanes, project, 1, { soldierDots: false });
    expect(circles).toHaveLength(0);
  });

  it('moves the beads along the lane as time passes', () => {
    const { state, runtime } = withLane();
    const first = recorder(), later = recorder();
    drawLanes(first.graphics, state, runtime.lanes, project, 1, { soldierDots: false, flowSeconds: 0 });
    drawLanes(later.graphics, state, runtime.lanes, project, 1, { soldierDots: false, flowSeconds: 0.2 });
    expect(first.circles.length).toBeGreaterThan(0);
    expect(later.circles.length).toBe(first.circles.length);
    expect(later.circles[0]).not.toEqual(first.circles[0]);
  });
});
