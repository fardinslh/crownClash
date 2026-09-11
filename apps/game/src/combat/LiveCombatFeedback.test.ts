import { describe, expect, it } from 'vitest';
import { createInitialGameState, type GameState, type MarchingArmy } from '@crown-clash/game-core';
import {
  deriveLiveCombatArrivals,
  reconcileLiveArmies,
  stepLiveArmies,
} from './LiveCombatFeedback.js';

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

describe('stepLiveArmies', () => {
  it('advances army progress smoothly based on speed and delta', () => {
    const initial = [army({ progress: 0.1, speed: 0.5 })];
    const stepped = stepLiveArmies(initial, 0.1);

    expect(stepped[0].progress).toBeCloseTo(0.15, 4);
  });

  it('caps progress at 0.99 to let the server resolve arrival', () => {
    const initial = [army({ progress: 0.98, speed: 1.0 })];
    const stepped = stepLiveArmies(initial, 0.1);

    expect(stepped[0].progress).toBe(0.99);
  });
});

describe('reconcileLiveArmies', () => {
  it('softly blends existing army progress towards the server position', () => {
    const local = [army({ id: 'live-1', progress: 0.5 })];
    const server = [army({ id: 'live-1', progress: 0.44 })];

    const result = reconcileLiveArmies(local, server, 0.5);
    expect(result.reconciledArmies[0].progress).toBeCloseTo(0.47, 4);
    expect(result.matchedVisualRenames).toEqual([]);
  });

  it('matches predicted player army with incoming server army and produces rename', () => {
    const local = [
      army({
        id: 'pred_123',
        owner: 'player',
        sourceId: 'p_base',
        targetId: 'n_center',
        progress: 0.08,
      }),
    ];
    const server = [
      army({
        id: 'live_server_player_0',
        owner: 'player',
        sourceId: 'p_base',
        targetId: 'n_center',
        progress: 0.05,
      }),
    ];

    const result = reconcileLiveArmies(local, server, 0.5);
    expect(result.reconciledArmies).toHaveLength(1);
    expect(result.reconciledArmies[0].id).toBe('live_server_player_0');
    expect(result.reconciledArmies[0].progress).toBeCloseTo(0.065, 4);
    expect(result.matchedVisualRenames).toEqual([
      { fromId: 'player:pred_123', toId: 'player:live_server_player_0' },
    ]);
  });

  it('preserves unacknowledged recent predicted dispatches', () => {
    const local = [
      army({
        id: 'pred_recent',
        owner: 'player',
        sourceId: 'p_base',
        targetId: 'n_bot_left',
        progress: 0.03,
      }),
    ];
    const server: MarchingArmy[] = [];

    const result = reconcileLiveArmies(local, server);
    expect(result.reconciledArmies).toHaveLength(1);
    expect(result.reconciledArmies[0].id).toBe('pred_recent');
  });
});
