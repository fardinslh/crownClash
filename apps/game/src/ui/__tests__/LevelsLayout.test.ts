import { describe, expect, it } from 'vitest';
import { LOGICAL_WIDTH } from '@crown-clash/game-core';
import { computeLevelsLayout } from '../LevelsLayout.js';

describe('computeLevelsLayout', () => {
  it('puts level 1 at the top right and fills columns right to left', () => {
    const { cards } = computeLevelsLayout(10, 720);
    expect(cards).toHaveLength(10);
    expect(cards[0].x).toBeGreaterThan(LOGICAL_WIDTH / 2);
    expect(cards[1].x).toBeLessThan(LOGICAL_WIDTH / 2);
    expect(cards[1].y).toBe(cards[0].y);
    expect(cards[2].y).toBeGreaterThan(cards[0].y);
  });

  it('fits ten cards inside the viewport on small and tall phones', () => {
    for (const height of [640, 720, 800, 932]) {
      const layout = computeLevelsLayout(10, height);
      const last = layout.cards[layout.cards.length - 1];
      expect(last.y + layout.cardHeight / 2, `height ${height}`).toBeLessThanOrEqual(height);
      for (const card of layout.cards) {
        expect(card.x - layout.cardWidth / 2).toBeGreaterThanOrEqual(0);
        expect(card.x + layout.cardWidth / 2).toBeLessThanOrEqual(LOGICAL_WIDTH);
      }
    }
  });

  it('keeps cards large enough to tap', () => {
    expect(computeLevelsLayout(10, 640).cardHeight).toBeGreaterThanOrEqual(46);
  });

  it('never stretches rows beyond the maximum pitch', () => {
    expect(computeLevelsLayout(10, 1400).cardHeight).toBeLessThanOrEqual(96);
  });

  it('handles an empty or odd level count', () => {
    expect(computeLevelsLayout(0, 720).cards).toEqual([]);
    expect(computeLevelsLayout(3, 720).cards).toHaveLength(3);
  });
});
