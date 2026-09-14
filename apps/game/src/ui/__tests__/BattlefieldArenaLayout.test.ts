import { describe, expect, it } from 'vitest';
import { createBattlefieldDecorations } from '../BattlefieldArenaLayout.js';

describe('battlefield arena visual layouts', () => {
  it('gives every battlefield a distinct static motif', () => {
    const crown = createBattlefieldDecorations('crown_cross', 720);
    const passes = createBattlefieldDecorations('twin_passes', 720);
    const ring = createBattlefieldDecorations('royal_ring', 720);

    expect(crown).not.toEqual(passes);
    expect(passes).not.toEqual(ring);
    expect(ring).not.toEqual(crown);
    expect(crown.some((shape) => shape.kind === 'ellipse')).toBe(true);
    expect(passes.some((shape) => shape.kind === 'triangle')).toBe(true);
    expect(ring.filter((shape) => shape.kind === 'ellipse')).toHaveLength(2);
  });

  it.each(['crown_cross', 'twin_passes', 'royal_ring'] as const)(
    'keeps %s decoration geometry inside the 400x720 arena',
    (motif) => {
      for (const shape of createBattlefieldDecorations(motif, 720)) {
        if (shape.kind === 'line') {
          expect([shape.x1, shape.x2]).toEqual(
            expect.arrayContaining([expect.any(Number), expect.any(Number)])
          );
          expect(Math.min(shape.x1, shape.x2)).toBeGreaterThanOrEqual(0);
          expect(Math.max(shape.x1, shape.x2)).toBeLessThanOrEqual(400);
          expect(Math.min(shape.y1, shape.y2)).toBeGreaterThanOrEqual(78);
          expect(Math.max(shape.y1, shape.y2)).toBeLessThanOrEqual(690);
        } else if (shape.kind === 'ellipse') {
          expect(shape.x - shape.width / 2).toBeGreaterThanOrEqual(0);
          expect(shape.x + shape.width / 2).toBeLessThanOrEqual(400);
          expect(shape.y - shape.height / 2).toBeGreaterThanOrEqual(78);
          expect(shape.y + shape.height / 2).toBeLessThanOrEqual(690);
        } else {
          expect(Math.min(shape.x1, shape.x2, shape.x3)).toBeGreaterThanOrEqual(0);
          expect(Math.max(shape.x1, shape.x2, shape.x3)).toBeLessThanOrEqual(400);
          expect(Math.min(shape.y1, shape.y2, shape.y3)).toBeGreaterThanOrEqual(78);
          expect(Math.max(shape.y1, shape.y2, shape.y3)).toBeLessThanOrEqual(690);
        }
      }
    }
  );

  it('does not extend baseline gameplay art when the viewport becomes taller', () => {
    for (const motif of ['crown_cross', 'twin_passes', 'royal_ring'] as const) {
      const tall = createBattlefieldDecorations(motif, 867);
      const maxY = Math.max(
        ...tall.flatMap((shape) =>
          shape.kind === 'ellipse'
            ? [shape.y + shape.height / 2]
            : shape.kind === 'line'
              ? [shape.y1, shape.y2]
              : [shape.y1, shape.y2, shape.y3]
        )
      );
      expect(maxY).toBeLessThanOrEqual(664);
    }
  });
});
