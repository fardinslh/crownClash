import { describe, expect, it } from 'vitest';
import { createInitialGameState, type GameState, type MarchingArmy } from '@crown-clash/game-core';
import { deriveLiveCombatArrivals } from './LiveCombatFeedback.js';

function withArmy(state: GameState, army: MarchingArmy): GameState {
  return { ...state, armies: [army] };
}

function army(overrides: Partial<MarchingArmy> = {}): MarchingArmy {
  return {
    id: 'live-army',
    sourceId: 'p_base',
    targetId: 'n_center',
    owner: 'player',
    units: 20,
    progress: 0.99,
    speed: 1,
    distance: 100,
    startX: 200,
    startY: 600,
    targetX: 200,
    targetY: 360,
    ...overrides,
  };
}

describe('deriveLiveCombatArrivals', () => {
  it('emits no feedback while an army remains active', () => {
    const previous = withArmy(createInitialGameState(), army());
    const current = withArmy(createInitialGameState(), army({ progress: 1 }));

    expect(deriveLiveCombatArrivals(previous, current)).toEqual([]);
  });

  it('reconstructs a capture when an army disappears', () => {
    const base = createInitialGameState();
    base.territories.n_center = { ...base.territories.n_center, units: 5 };
    const previous = withArmy(base, army({ units: 20 }));
    const current = { ...base, armies: [] };

    expect(deriveLiveCombatArrivals(previous, current)).toEqual([
      expect.objectContaining({
        targetId: 'n_center',
        attackerOwner: 'player',
        newOwner: 'player',
        captured: true,
        remainingUnits: 13,
      }),
    ]);
  });

  it('uses fortress defense when reconstructing a defended arrival', () => {
    const base = createInitialGameState();
    base.territories.n_center = {
      ...base.territories.n_center,
      type: 'fortress',
      owner: 'enemy',
      units: 10,
    };
    const previous = withArmy(base, army({ units: 11 }));
    const current = { ...base, armies: [] };

    expect(deriveLiveCombatArrivals(previous, current)).toEqual([
      expect.objectContaining({
        captured: false,
        newOwner: 'enemy',
        remainingUnits: 2,
      }),
    ]);
  });
});
