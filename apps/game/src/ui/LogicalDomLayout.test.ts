import { describe, expect, it } from 'vitest';
import { getLogicalDomLayout } from './LogicalDomLayout.js';

const INPUT = { x: 200, y: 237, width: 230, height: 46 };
const LOGICAL_SIZE = { width: 400, height: 720 };

describe('getLogicalDomLayout', () => {
  it('keeps the input centered in an unscaled canvas', () => {
    expect(getLogicalDomLayout(
      { left: 0, top: 0, width: 400, height: 720 },
      LOGICAL_SIZE,
      INPUT
    )).toEqual({
      centerX: 200,
      centerY: 237,
      width: 230,
      height: 46,
      scale: 1,
    });
  });

  it('accounts for a centered and uniformly scaled canvas', () => {
    const layout = getLogicalDomLayout(
      { left: 144, top: 82, width: 440, height: 792 },
      LOGICAL_SIZE,
      INPUT
    );

    expect(layout.centerX).toBeCloseTo(364);
    expect(layout.centerY).toBeCloseTo(342.7);
    expect(layout.width).toBeCloseTo(253);
    expect(layout.height).toBeCloseTo(50.6);
    expect(layout.scale).toBeCloseTo(1.1);
  });

  it('tracks non-uniform canvas bounds without drifting', () => {
    expect(getLogicalDomLayout(
      { left: 10, top: 20, width: 360, height: 640 },
      LOGICAL_SIZE,
      INPUT
    )).toEqual({
      centerX: 190,
      centerY: 230.66666666666666,
      width: 207,
      height: 40.888888888888886,
      scale: 0.8888888888888888,
    });
  });
});
