import { describe, expect, it } from 'vitest';
import { wholeMatchSeconds } from './MatchPresentation.js';

describe('wholeMatchSeconds', () => {
  it('removes simulation floating-point noise', () => {
    expect(wholeMatchSeconds(27.00000000000007)).toBe(27);
  });

  it('rounds partial seconds and rejects invalid display values', () => {
    expect(wholeMatchSeconds(27.6)).toBe(28);
    expect(wholeMatchSeconds(-1)).toBe(0);
    expect(wholeMatchSeconds(Number.NaN)).toBe(0);
  });
});
