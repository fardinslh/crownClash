import { describe, expect, it } from 'vitest';
import {
  BATTLEFIELDS,
  createDefaultTerritories,
  createInitialGameState,
  normalizeBattlefieldId,
  simulatePvpBattle,
} from '../index.js';

describe('battlefields', () => {
  it('keeps stable territory IDs while producing three distinct layouts', () => {
    const layouts = BATTLEFIELDS.map(({ id }) => createDefaultTerritories(undefined, undefined, id));
    const expectedIds = Object.keys(layouts[0]).sort();

    for (const layout of layouts) {
      expect(Object.keys(layout).sort()).toEqual(expectedIds);
      expect(layout.p_base.x).toBe(layout.e_base.x);
      expect(layout.p_base.y + layout.e_base.y).toBe(720);
      expect(layout.n_bot_left.x + layout.n_bot_right.x).toBe(400);
      expect(layout.n_top_left.x + layout.n_top_right.x).toBe(400);
    }

    expect(layouts.map((layout) => layout.n_bot_left.x)).toEqual([85, 105, 140]);
    expect(layouts.map((layout) => layout.n_center.units)).toEqual([14, 20, 10]);
  });

  it('falls back to Crown Cross for missing or unknown IDs', () => {
    expect(normalizeBattlefieldId(undefined)).toBe('crown_cross');
    expect(normalizeBattlefieldId('forged_map')).toBe('crown_cross');
    expect(createInitialGameState({ battlefieldId: 'crown_cross' }).battlefieldId).toBe('crown_cross');
  });

  it('replays deterministically on each selected battlefield', () => {
    for (const { id } of BATTLEFIELDS) {
      const options = {
        actions: [
          { sequence: 0, atSeconds: 0, sourceId: 'p_base', targetId: 'n_center' },
          { sequence: 1, atSeconds: 4, sourceId: 'p_base', targetId: 'n_bot_left' },
        ],
        battlefieldId: id,
      } as const;
      const first = simulatePvpBattle(options);
      const second = simulatePvpBattle(options);

      expect(first).toEqual(second);
      expect(first.finalState.battlefieldId).toBe(id);
    }
  });
});
