import { describe, expect, it } from 'vitest';
import { iconRasterScale } from '../icons.js';

describe('iconRasterScale', () => {
  it('rasterises at 2x up to the mid tier and 3x on the high tier', () => {
    expect(iconRasterScale(1)).toBe(2);
    expect(iconRasterScale(2)).toBe(2);
    expect(iconRasterScale(2.75)).toBe(3);
    expect(iconRasterScale(3)).toBe(3);
  });

  it('never exceeds 3x and ignores a missing or bad render scale', () => {
    expect(iconRasterScale(4)).toBe(3);
    expect(iconRasterScale(undefined)).toBe(2);
    expect(iconRasterScale(Number.NaN)).toBe(2);
  });
});
