import { describe, expect, it } from 'vitest';
import { createInitialGameState, dispatchArmy, stepSimulation, type GameState, type Team } from '@crown-clash/game-core';
import {
  CROWN_CONFIG, createCrownProgress, createPrototypeState, evaluateCrownAiMoves,
  resolvePrototypeMode, stepCrownMatch, type CrownProgress,
} from './CrownMatch.js';

function ownedCrown(owner: Team = 'player'): GameState {
  const state = createPrototypeState('crown');
  state.territories.n_center.owner = owner;
  state.territories.n_center.units = 10;
  return state;
}

function arrival(state: GameState, owner: 'player' | 'enemy', units: number): void {
  const source = { ...state.territories[owner === 'player' ? 'p_base' : 'e_base'], units: units * 2 };
  const result = dispatchArmy(source, state.territories.n_center, owner);
  expect(result.success).toBe(true);
  expect(result.army).toBeDefined();
  state.armies.push({ ...result.army!, progress: 1 });
}

function advance(state: GameState, progress: CrownProgress, ticks: number) {
  let accumulators: Record<string, number> = {};
  for (let i = 0; i < ticks; i++) {
    const next = stepCrownMatch(state, accumulators, progress, .02);
    state = next.state; progress = next.crown; accumulators = next.accumulators;
  }
  return { state, progress };
}

describe('local Crown Hold rules', () => {
  it('starts symmetric, ready to contest, without modifying shared map templates or classic rules', () => {
    const crown = createPrototypeState('crown');
    expect(crown.battlefieldId).toBe('crown_cross');
    expect(Object.values(crown.territories).filter(t => t.owner === 'player')).toHaveLength(2);
    expect(Object.values(crown.territories).filter(t => t.owner === 'enemy')).toHaveLength(2);
    const own = crown.territories.n_bot_left;
    const opposing = crown.territories.n_top_right;
    expect([own.x + opposing.x, own.y + opposing.y]).toEqual([400, 720]);
    expect(own.units).toBe(opposing.units);
    expect(crown.territories.p_base.units).toBe(crown.territories.e_base.units);
    expect(crown.territories.n_center.productionRate).toBe(0);
    const attack = dispatchArmy(crown.territories.p_base, crown.territories.n_center, 'player');
    expect(attack.success).toBe(true);
    expect(attack.army!.units).toBeGreaterThan(Math.ceil(crown.territories.n_center.units * 1.25));
    expect(1 / attack.army!.speed).toBeLessThan(3);
    expect(createPrototypeState('classic')).toEqual(createInitialGameState({ battlefieldId: 'crown_cross' }));
    expect(createInitialGameState().territories.n_center.productionRate).toBe(1.1);
  });

  it.each(['player', 'enemy'] as const)('requires all 12 continuous seconds for %s; crown never produces', owner => {
    const state = ownedCrown(owner);
    const before = advance(state, { ...createCrownProgress(), holder: owner }, 599);
    expect(before.progress.heldMs).toBe(11980);
    expect(before.state.status).toBe('playing');
    expect(before.state.territories.n_center.units).toBe(10);
    const winner = advance(before.state, before.progress, 1);
    expect(winner.progress.heldMs).toBe(12000);
    expect(winner.state.status).toBe(owner === 'player' ? 'victory' : 'defeat');
    const frozen = advance(winner.state, winner.progress, 10);
    expect(frozen).toEqual(winner);
  });

  it('resolves a last-tick capture before awarding the win and resets the new owner to zero', () => {
    const state = ownedCrown();
    arrival(state, 'enemy', 20);
    const result = stepCrownMatch(state, {}, { ...createCrownProgress(), holder: 'player', heldMs: 11980 }, .02);
    expect(result.state.status).toBe('playing');
    expect(result.crown).toEqual({ holder: 'enemy', heldMs: 0, captures: 1, firstCaptureSeconds: .02 });
    expect(state.territories.n_center.owner).toBe('player');
    const resumed = advance(result.state, result.crown, 599);
    expect(resumed.state.status).toBe('playing');
    expect(advance(resumed.state, resumed.progress, 1).state.status).toBe('defeat');
  });

  it('even a capture and recapture within one tick breaks the old streak', () => {
    const state = ownedCrown();
    arrival(state, 'enemy', 20);
    arrival(state, 'player', 30);
    const result = stepCrownMatch(state, {}, { ...createCrownProgress(), holder: 'player', heldMs: 11980 }, .02);
    expect(result.state.territories.n_center.owner).toBe('player');
    expect(result.crown.heldMs).toBe(0);
    expect(result.crown.captures).toBe(2);
    expect(result.state.status).toBe('playing');
  });

  it('reinforcement and a repelled attack preserve a continuous hold', () => {
    const state = ownedCrown();
    arrival(state, 'enemy', 1);
    arrival(state, 'player', 4);
    const result = stepCrownMatch(state, {}, { ...createCrownProgress(), holder: 'player', heldMs: 3000 }, .02);
    expect(result.resolvedArrivals).toHaveLength(2);
    expect(result.crown.heldMs).toBe(3020);
    expect(result.crown.captures).toBe(0);
  });

  it('times out as a draw regardless of territory majority; classic keeps its winner', () => {
    const state = createPrototypeState('crown');
    state.elapsedTimeSeconds = 89.98;
    state.territories.n_mid_left.owner = 'player';
    expect(stepSimulation(state, {}, .02).state.status).toBe('victory');
    const result = stepCrownMatch(state, {}, createCrownProgress(), .2);
    expect(result.state.elapsedTimeSeconds).toBe(90);
    expect(result.state.status).toBe('draw');
    expect(result.crown.heldMs).toBe(0);
  });

  it('awards a completed hold exactly at the deadline', () => {
    const state = ownedCrown();
    state.elapsedTimeSeconds = 89.98;
    const result = stepCrownMatch(state, {}, { ...createCrownProgress(), holder: 'player', heldMs: 11980 }, .02);
    expect(result.state.status).toBe('victory');
    expect(result.state.elapsedTimeSeconds).toBe(90);
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid simulation delta %s', dt => {
    expect(() => stepCrownMatch(ownedCrown(), {}, createCrownProgress(), dt)).toThrow('invalid_crown_delta');
  });

  it('fails explicitly when the selected map lacks a crown', () => {
    const state = createInitialGameState({ battlefieldId: 'royal_ring' });
    expect(() => stepCrownMatch(state, {}, createCrownProgress(), .02)).toThrow('missing_crown');
  });

  it('never accepts a prototype alongside live, training or a settlement ticket', () => {
    expect(resolvePrototypeMode({ prototypeMode: 'crown' })).toBe('crown');
    expect(resolvePrototypeMode({ prototypeMode: 'classic' })).toBe('classic');
    for (const incompatible of [{ mode: 'live' }, { training: true }, { botMatch: {} }, { liveMatch: {} }, { liveMatch2v2: {} }, { liveClient: {} }]) {
      expect(resolvePrototypeMode({ prototypeMode: 'crown', ...incompatible })).toBeNull();
    }
    expect(resolvePrototypeMode({ prototypeMode: 'unknown' })).toBeNull();
    expect(resolvePrototypeMode(undefined)).toBeNull();
  });
});

describe('crown opponent', () => {
  it('coordinates an immediate crown capture with both starting towers', () => {
    const state = createPrototypeState('crown');
    const moves = evaluateCrownAiMoves(state);
    expect(moves).toHaveLength(2);
    expect(new Set(moves.map(m => m.fromId))).toEqual(new Set(['e_base', 'n_top_right']));
    expect(moves.every(m => m.toId === CROWN_CONFIG.territoryId)).toBe(true);
  });

  it('retakes a held crown and reinforces its own, without dispatching the crown garrison', () => {
    const state = ownedCrown();
    expect(evaluateCrownAiMoves(state).map(m => m.toId)).toEqual(['n_center', 'n_center']);
    state.territories.n_center.owner = 'enemy';
    state.territories.n_center.units = 2;
    const moves = evaluateCrownAiMoves(state);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every(m => m.toId === 'n_center' && m.fromId !== 'n_center')).toBe(true);
  });

  it('accounts for troops in transit instead of pouring every army into a secure crown', () => {
    const state = ownedCrown('enemy');
    arrival(state, 'enemy', 30);
    expect(evaluateCrownAiMoves(state).some(m => m.toId === 'n_center')).toBe(false);
    state.status = 'defeat';
    expect(evaluateCrownAiMoves(state)).toEqual([]);
  });

  it('an untouched player loses to a real simulated capture and hold, not a scripted result', () => {
    let state = createPrototypeState('crown');
    let progress = createCrownProgress();
    let accumulators: Record<string, number> = {};
    let nextAi = CROWN_CONFIG.aiTickSeconds;
    while (state.status === 'playing' && state.elapsedTimeSeconds < 90) {
      const result = stepCrownMatch(state, accumulators, progress, .02);
      state = result.state; progress = result.crown; accumulators = result.accumulators;
      if (state.elapsedTimeSeconds >= nextAi) {
        nextAi += CROWN_CONFIG.aiTickSeconds;
        for (const move of evaluateCrownAiMoves(state)) {
          const dispatch = dispatchArmy(state.territories[move.fromId], state.territories[move.toId], 'enemy');
          expect(dispatch.success).toBe(true);
          state.territories[move.fromId] = dispatch.sourceTerritory!;
          state.armies.push(dispatch.army!);
        }
      }
    }
    expect(state.status).toBe('defeat');
    expect(progress.captures).toBeGreaterThan(0);
    expect(progress.firstCaptureSeconds).toBeGreaterThan(0);
    expect(progress.firstCaptureSeconds).toBeLessThan(5);
    expect(progress.heldMs).toBe(12000);
    expect(state.elapsedTimeSeconds).toBeLessThan(20);
  });
});
