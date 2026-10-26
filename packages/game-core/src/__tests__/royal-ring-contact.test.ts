import { describe, expect, it } from 'vitest';
import {
  createInitialGameState, dispatchArmy, evaluateTacticalMoves, findDispatchRoute, getBattlefield,
  getBotAiTickSeconds, stepSimulation, tacticalNeighbors, type BotDifficulty, type GameState,
} from '../index.js';

/**
 * Royal Ring used to be a pure ring: each frontier tower had exactly one hostile
 * road, so a 50% send (at most 20 from a 40-unit tower) could never break a full
 * 40-unit tower and both halves froze with no clash (rules-v4.md, Balance probe).
 * The two centre diagonals give each frontier tower a second attacking source.
 */
function playUntilFirstClash(map: 'royal_ring' | 'crown_cross' | 'twin_passes', difficulty: BotDifficulty, playerCadence: number): number | null {
  let state: GameState = createInitialGameState({ gameplayRulesVersion: 4, battlefieldId: map });
  let accumulators: Record<string, number> = {};
  let id = 0;
  const every = { enemy: Math.round(getBotAiTickSeconds(difficulty) / 0.02), player: Math.round(playerCadence / 0.02) };
  const next = { ...every };
  for (let tick = 1; tick <= 4500 && state.status === 'playing'; tick++) {
    const step = stepSimulation(state, accumulators, 0.02);
    state = step.state; accumulators = step.accumulators;
    if (step.resolvedArrivals.some(r => r.previousOwner !== 'neutral' && r.attackerOwner !== r.previousOwner)) return state.elapsedTimeSeconds;
    for (const team of ['enemy', 'player'] as const) {
      if (state.status !== 'playing' || tick < next[team]) continue;
      next[team] += every[team];
      for (const move of evaluateTacticalMoves(state, team)) {
        const d = dispatchArmy(state.territories[move.fromId], state.territories[move.toId], team, 0.5, () => `r${id++}`, 1, state);
        if (!d.success || !d.sourceTerritory || !d.army) continue;
        state.territories[move.fromId] = d.sourceTerritory;
        state.armies.push(d.army);
      }
    }
  }
  return null;
}

describe('Royal Ring contact pacing', () => {
  it('gives each frontier tower a second hostile road (centre diagonals)', () => {
    const ring = getBattlefield('royal_ring');
    expect(ring.roads).toHaveLength(14);
    const state = createInitialGameState({ gameplayRulesVersion: 4, battlefieldId: 'royal_ring' });
    expect(tacticalNeighbors(state, 'n_ring_w_n')).toEqual(['n_ring_e_s', 'n_ring_nw', 'n_ring_w_s']);
    expect(tacticalNeighbors(state, 'n_ring_e_n')).toEqual(['n_ring_e_s', 'n_ring_ne', 'n_ring_w_s']);
    // Mirror image for the player side.
    expect(tacticalNeighbors(state, 'n_ring_w_s')).toContain('n_ring_e_n');
    expect(tacticalNeighbors(state, 'n_ring_e_s')).toContain('n_ring_w_n');
    // Legal hostile order across the diagonal (one direct road).
    state.territories.n_ring_e_s.owner = 'player';
    state.territories.n_ring_w_n.owner = 'enemy';
    expect(findDispatchRoute(state, 'n_ring_e_s', 'n_ring_w_n', 'player')).toEqual(['n_ring_e_s', 'n_ring_w_n']);
  });

  it('leaves the road sets of the other maps alone', () => {
    expect(getBattlefield('crown_cross').roads).toHaveLength(16);
    expect(getBattlefield('twin_passes').roads).toHaveLength(9);
  });

  // These two scripted duels reached the time limit with no tower attacked before the fix.
  it.each([
    ['easy', 2.7],
    ['easy', 3.6],
  ] as const)('a scripted %s duel at cadence %s clashes before the time limit', (difficulty, cadence) => {
    const contact = playUntilFirstClash('royal_ring', difficulty, cadence);
    expect(contact).not.toBeNull();
    expect(contact!).toBeLessThan(45);
  });
});
