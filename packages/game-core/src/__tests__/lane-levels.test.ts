import { describe, expect, it } from 'vitest';
import { LANE_LEVELS, getLaneLevel } from '../lane-levels.js';

describe('LANE_LEVELS', () => {
  it('has nine levels, three per difficulty, each map once per difficulty', () => {
    expect(LANE_LEVELS).toHaveLength(9);
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const maps = LANE_LEVELS.filter((l) => l.botDifficulty === difficulty).map((l) => l.battlefieldId).sort();
      expect(maps).toEqual(['crown_cross', 'royal_ring', 'twin_passes']);
    }
    expect(LANE_LEVELS.map((l) => l.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it('gets harder along the list', () => {
    const rank = { easy: 0, normal: 1, hard: 2 } as const;
    for (let i = 1; i < LANE_LEVELS.length; i++) expect(rank[LANE_LEVELS[i].botDifficulty]).toBeGreaterThanOrEqual(rank[LANE_LEVELS[i - 1].botDifficulty]);
    expect(getLaneLevel(5)?.botDifficulty).toBe('normal');
    expect(getLaneLevel(10)).toBeUndefined();
  });
});
