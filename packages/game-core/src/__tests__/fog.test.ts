import { describe, expect, it } from 'vitest';
import { computeVisibleTerritoryIds, createInitialGameState, dispatchArmy, findDispatchRoute, getBattlefield, isArmyCountVisible } from '../index.js';

describe('v4 fog of war', () => {
  it.each(['crown_cross', 'twin_passes', 'royal_ring'] as const)('shows own towers and road neighbours only on %s', battlefieldId => {
    const state = createInitialGameState({ gameplayRulesVersion: 4, battlefieldId });
    const visible = computeVisibleTerritoryIds(state);
    expect(visible.has('p_base')).toBe(true);
    expect(visible.has('e_base')).toBe(false);
    for (const [a, b] of getBattlefield(battlefieldId).roads) {
      if (state.territories[a].owner === 'player') expect(visible.has(b)).toBe(true);
      if (state.territories[b].owner === 'player') expect(visible.has(a)).toBe(true);
    }
  });

  it('keeps every legal attack target visible', () => {
    const state = createInitialGameState({ gameplayRulesVersion: 4 });
    const visible = computeVisibleTerritoryIds(state);
    for (const source of Object.values(state.territories).filter(t => t.owner === 'player')) {
      for (const target of Object.values(state.territories).filter(t => t.owner !== 'player')) {
        if (findDispatchRoute(state, source.id, target.id, 'player')) expect(visible.has(target.id)).toBe(true);
      }
    }
  });

  it('hides enemy army counts away from vision and always shows own armies', () => {
    const state = createInitialGameState({ gameplayRulesVersion: 4 });
    const visible = computeVisibleTerritoryIds(state);
    const enemyOnly = Object.values(state.territories).filter(t => t.owner === 'enemy');
    const hidden = enemyOnly.find(t => !visible.has(t.id));
    expect(hidden).toBeDefined();
    const deepRoad = getBattlefield('crown_cross').roads.find(([a, b]) => !visible.has(a) && !visible.has(b))!;
    const enemyArmy = { id: 'e', sourceId: deepRoad[0], targetId: deepRoad[1], owner: 'enemy' as const, units: 5, startX: 0, startY: 0, targetX: 0, targetY: 0, progress: .5, speed: 1, distance: 1 };
    expect(isArmyCountVisible(enemyArmy, visible)).toBe(false);
    expect(isArmyCountVisible({ ...enemyArmy, owner: 'player' }, visible)).toBe(true);
    const send = dispatchArmy(state.territories.p_base, state.territories.n_bot_left, 'player', .5, () => 'a', 1, state);
    expect(isArmyCountVisible({ ...send.army!, owner: 'enemy' }, visible)).toBe(true);
  });
});
