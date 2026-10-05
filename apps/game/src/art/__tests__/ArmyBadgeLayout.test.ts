import { describe, expect, it } from 'vitest';
import { anchoredArmyBadge, planArmyBadgeOffset } from '../ArmyBadgeLayout.js';
import { rectanglesIntersect } from '../../ui/HudLayout.js';

const bounds = { x: 10, y: 84, width: 380, height: 588 };

describe('marching army badge placement', () => {
  it('chooses a fixed side before reaching a territory annotation along the route', () => {
    const blocker = { x: 170, y: 321, width: 60, height: 26 };
    const start = { x: 200, y: 200 }, end = { x: 200, y: 500 };
    const offset = planArmyBadgeOffset(start, end, 34, 84, [blocker], bounds);
    for (let y = start.y; y <= end.y; y++) {
      const badge = anchoredArmyBadge(start.x, y, offset, 42, bounds);
      expect(rectanglesIntersect(badge, blocker)).toBe(false);
      expect(badge.x + 21 - start.x).toBe(offset.x);
      expect(badge.y + 9 - y).toBe(offset.y);
    }
  });

  it('clamps edges continuously instead of jumping between candidates', () => {
    let previous;
    for (let t = 0; t <= 100; t++) {
      const badge = anchoredArmyBadge(24 + t * 3.56, 100 + t * 5.46,
        { x: 62, y: 34 }, 63, bounds);
      expect(badge.x).toBeGreaterThanOrEqual(bounds.x);
      expect(badge.y).toBeGreaterThanOrEqual(bounds.y);
      expect(badge.x + badge.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(badge.y + badge.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      if (previous) {
        expect(Math.abs(badge.x - previous.x)).toBeLessThanOrEqual(3.560001);
        expect(Math.abs(badge.y - previous.y)).toBeLessThanOrEqual(5.460001);
      }
      previous = badge;
    }
  });

  it('reserves separation for simultaneously departing squads along their full routes', () => {
    const start = { x: 200, y: 550 };
    const leftEnd = { x: 100, y: 250 }, rightEnd = { x: 300, y: 250 };
    const left = planArmyBadgeOffset(start, leftEnd, -33, 84, [], bounds);
    const right = planArmyBadgeOffset(start, rightEnd, -33, 84, [], bounds,
      [{ start, end: leftEnd, offset: left, width: 63, progressOffset: 0 }]);
    for (let step = 0; step <= 100; step++) {
      const t = step / 100;
      const a = anchoredArmyBadge(200 - 100 * t, 550 - 300 * t, left, 63, bounds);
      const b = anchoredArmyBadge(200 + 100 * t, 550 - 300 * t, right, 63, bounds);
      expect(rectanglesIntersect(a, b)).toBe(false);
    }
  });
});
