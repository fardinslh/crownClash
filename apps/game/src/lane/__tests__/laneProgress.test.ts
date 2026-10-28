import { describe, expect, it } from 'vitest';
import { LANE_LEVELS } from '@crown-clash/game-core';
import { LANE_PROGRESS_KEY, bestLaneLevelWon, nextLaneLevelId } from '../laneProgress.js';

const store = (value: string | null) => ({ getItem: (key: string) => (key === LANE_PROGRESS_KEY ? value : null) });

describe('lane progress', () => {
  it('starts at level 1 and moves to the first level not yet won', () => {
    expect(nextLaneLevelId(store(null))).toBe(1);
    expect(nextLaneLevelId(store('3'))).toBe(4);
  });
  it('stays on the last level once all are won and ignores bad values', () => {
    expect(nextLaneLevelId(store(String(LANE_LEVELS.length)))).toBe(LANE_LEVELS.length);
    for (const bad of ['-2', '1.5', 'abc', '99', '']) expect(bestLaneLevelWon(store(bad))).toBe(0);
  });
  it('survives a throwing storage', () => {
    expect(bestLaneLevelWon({ getItem: () => { throw new Error('blocked'); } })).toBe(0);
  });
});
