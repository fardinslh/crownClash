import { describe, expect, it } from 'vitest';
import { placeArmyBadge } from '../ArmyBadgeLayout.js';
import { rectanglesIntersect } from '../../ui/HudLayout.js';

const bounds = { x: 10, y: 84, width: 380, height: 588 };

describe('marching army badge placement', () => {
  it('moves a blocked badge clear of the territory count while staying close to its squad', () => {
    const blocker = { x: 170, y: 321, width: 60, height: 26 };
    const badge = placeArmyBadge(200, 300, 34, 42, [blocker], bounds);
    expect(rectanglesIntersect(badge, blocker)).toBe(false);
    expect(Math.abs(badge.x + 21 - 200)).toBeLessThanOrEqual(62);
    expect(badge.height).toBe(18);
  });

  it('separates badges for simultaneous arrivals and keeps every edge inside the visible band', () => {
    const placed = [];
    for (const [x, y] of [[24, 100], [24, 100], [380, 646], [380, 646], [200, 350]]) {
      const badge = placeArmyBadge(x, y, 34, 63, placed, bounds);
      expect(badge.x).toBeGreaterThanOrEqual(bounds.x);
      expect(badge.y).toBeGreaterThanOrEqual(bounds.y);
      expect(badge.x + badge.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(badge.y + badge.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      for (const previous of placed) expect(rectanglesIntersect(badge, previous)).toBe(false);
      placed.push(badge);
    }
  });
});
