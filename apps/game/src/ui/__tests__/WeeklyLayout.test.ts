import { describe, expect, it } from 'vitest';
import { LOGICAL_WIDTH } from '@crown-clash/game-core';
import { computeWeeklyLayout, splitTimeLeft } from '../WeeklyLayout.js';

describe('computeWeeklyLayout', () => {
  it('stacks three cards top to bottom without overlap, inside the viewport', () => {
    for (const height of [640, 720, 800, 932]) {
      const layout = computeWeeklyLayout(3, height);
      expect(layout.cardYs).toHaveLength(3);
      for (let i = 1; i < 3; i++) expect(layout.cardYs[i] - layout.cardYs[i - 1], `height ${height}`).toBeGreaterThan(layout.cardHeight);
      expect(layout.cardYs[2] + layout.cardHeight / 2, `height ${height}`).toBeLessThanOrEqual(height);
      expect(layout.cardYs[0] - layout.cardHeight / 2).toBeGreaterThan(layout.countdownY);
      expect(layout.cardWidth).toBeLessThanOrEqual(LOGICAL_WIDTH - 16);
    }
  });
  it('keeps cards tall enough to tap and never stretches them past the maximum', () => {
    expect(computeWeeklyLayout(3, 640).cardHeight).toBeGreaterThanOrEqual(60);
    expect(computeWeeklyLayout(3, 1400).cardHeight).toBeLessThanOrEqual(128);
  });
});

describe('splitTimeLeft', () => {
  it('splits into days, hours and minutes', () => {
    expect(splitTimeLeft(((2 * 24 + 5) * 60 + 7) * 60_000)).toEqual({ days: 2, hours: 5, minutes: 7 });
  });
  it('never goes negative', () => {
    expect(splitTimeLeft(-5000)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });
});
