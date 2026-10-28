import { describe, expect, it } from 'vitest';
import type { Territory } from '@crown-clash/game-core';
import { territoriesCrossedBySegment } from '../TerritorySweep.js';

const tower = (id: string, x: number, y: number, radius = 27) => ({ id, x, y, radius }) as Territory;
const A = tower('a', 85, 485), B = tower('b', 75, 360), C = tower('c', 85, 235), FAR = tower('far', 300, 360);

describe('territoriesCrossedBySegment', () => {
  it('finds a tower the finger jumped over between two samples', () => {
    expect(territoriesCrossedBySegment([A, B, C, FAR], A, C, 18).map(t => t.id)).toEqual(['a', 'b', 'c']);
  });
  it('returns crossed towers in the order they were crossed, whatever the input order', () => {
    expect(territoriesCrossedBySegment([C, B, A], C, A, 18).map(t => t.id)).toEqual(['c', 'b', 'a']);
  });
  it('ignores towers outside the hit circle plus padding', () => {
    // 62 px from the line: radius 27 + padding 18 = 45 is not enough.
    expect(territoriesCrossedBySegment([tower('x', 147, 360)], A, C, 18)).toEqual([]);
    expect(territoriesCrossedBySegment([tower('x', 120, 360)], A, C, 18).map(t => t.id)).toEqual(['x']);
  });
  it('does not extend past either end of the segment', () => {
    expect(territoriesCrossedBySegment([tower('past', 85, 100)], A, C, 18)).toEqual([]);
  });
  it('treats a stationary pointer as a plain point hit', () => {
    expect(territoriesCrossedBySegment([A, B], A, A, 18).map(t => t.id)).toEqual(['a']);
  });
});
