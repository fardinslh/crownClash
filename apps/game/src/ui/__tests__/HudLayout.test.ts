import { describe, expect, it } from 'vitest';
import {
  computeHudLayout,
  rectanglesIntersect,
  type Rect,
} from '../HudLayout.js';

describe('HudLayout', () => {
  const TEST_PORTRAIT_WIDTHS = [360, 390, 400, 412, 430];

  describe('rectanglesIntersect helper', () => {
    it('detects intersecting rectangles', () => {
      const a: Rect = { x: 10, y: 10, width: 50, height: 50 };
      const b: Rect = { x: 30, y: 30, width: 50, height: 50 };
      expect(rectanglesIntersect(a, b)).toBe(true);
    });

    it('detects disjoint rectangles separated horizontally', () => {
      const a: Rect = { x: 10, y: 10, width: 20, height: 20 };
      const b: Rect = { x: 35, y: 10, width: 20, height: 20 };
      expect(rectanglesIntersect(a, b)).toBe(false);
    });

    it('detects disjoint rectangles separated vertically', () => {
      const a: Rect = { x: 10, y: 10, width: 20, height: 20 };
      const b: Rect = { x: 10, y: 35, width: 20, height: 20 };
      expect(rectanglesIntersect(a, b)).toBe(false);
    });

    it('detects touching edges as non-intersecting', () => {
      const a: Rect = { x: 0, y: 0, width: 20, height: 20 };
      const b: Rect = { x: 20, y: 0, width: 20, height: 20 };
      expect(rectanglesIntersect(a, b)).toBe(false);
    });
  });

  describe('Mobile Portrait Viewports HUD Geometry', () => {
    TEST_PORTRAIT_WIDTHS.forEach((width) => {
      describe(`Viewport width: ${width}px`, () => {
        it('asserts the visible menu rectangle does NOT intersect the dominance bar', () => {
          const layout = computeHudLayout(width);

          const menuVis = layout.menuButton.visibleBounds;
          const domBounds = layout.dominanceBar.bounds;

          // Mandatory assertion: visible menu button does not intersect dominance bar
          const intersects = rectanglesIntersect(menuVis, domBounds);
          expect(intersects).toBe(false);

          // Assert positive vertical clearance between visible menu and dominance bar
          const verticalClearance = domBounds.y - (menuVis.y + menuVis.height);
          expect(verticalClearance).toBeGreaterThanOrEqual(10);
        });

        it('preserves a minimum 44x44 interactive touch target', () => {
          const layout = computeHudLayout(width);
          const hitBounds = layout.menuButton.hitBounds;

          expect(hitBounds.width).toBeGreaterThanOrEqual(44);
          expect(hitBounds.height).toBeGreaterThanOrEqual(44);
        });

        it('asserts the 44x44 interactive touch target does NOT intersect the dominance bar', () => {
          const layout = computeHudLayout(width);

          const menuHit = layout.menuButton.hitBounds;
          const domBounds = layout.dominanceBar.bounds;

          const intersects = rectanglesIntersect(menuHit, domBounds);
          expect(intersects).toBe(false);

          const clearance = domBounds.y - (menuHit.y + menuHit.height);
          expect(clearance).toBeGreaterThanOrEqual(1);
        });

        it('keeps icon and hit target strictly centered and aligned', () => {
          const layout = computeHudLayout(width);

          const center = layout.menuButton.center;
          const vis = layout.menuButton.visibleBounds;
          const hit = layout.menuButton.hitBounds;

          expect(vis.x + vis.width / 2).toBeCloseTo(center.x);
          expect(vis.y + vis.height / 2).toBeCloseTo(center.y);

          expect(hit.x + hit.width / 2).toBeCloseTo(center.x);
          expect(hit.y + hit.height / 2).toBeCloseTo(center.y);
        });

        it('asserts Row 1 pills do not collide with each other or the menu hit area', () => {
          const layout = computeHudLayout(width);

          const pills = [
            layout.playerPill.visibleBounds,
            layout.trophyPill.visibleBounds,
            layout.coinPill.visibleBounds,
            layout.clockPill.visibleBounds,
          ];

          for (let i = 0; i < pills.length - 1; i++) {
            const current = pills[i];
            const next = pills[i + 1];
            expect(rectanglesIntersect(current, next)).toBe(false);
            expect(next.x).toBeGreaterThan(current.x + current.width);
          }

          // Clock pill must not intersect menu hit zone
          const clockPill = layout.clockPill.visibleBounds;
          const menuHit = layout.menuButton.hitBounds;
          expect(rectanglesIntersect(clockPill, menuHit)).toBe(false);
          expect(menuHit.x).toBeGreaterThanOrEqual(clockPill.x + clockPill.width);
        });
      });
    });
  });
});
