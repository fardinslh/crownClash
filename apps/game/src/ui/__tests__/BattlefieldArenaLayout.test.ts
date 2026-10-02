import { describe, expect, it } from 'vitest';
import {
  createBattlefieldDecorations,
  createBattlefieldTerrainLayers,
  trainingOverlayPanelY,
} from '../BattlefieldArenaLayout.js';

function shapeBounds(shape: ReturnType<typeof createBattlefieldDecorations>[number]) {
  if (shape.kind === 'line') {
    return {
      minX: Math.min(shape.x1, shape.x2),
      maxX: Math.max(shape.x1, shape.x2),
      minY: Math.min(shape.y1, shape.y2),
      maxY: Math.max(shape.y1, shape.y2),
    };
  }
  if (shape.kind === 'ellipse' || shape.kind === 'zone') {
    return {
      minX: shape.x - shape.width / 2,
      maxX: shape.x + shape.width / 2,
      minY: shape.y - shape.height / 2,
      maxY: shape.y + shape.height / 2,
    };
  }
  return {
    minX: Math.min(shape.x1, shape.x2, shape.x3),
    maxX: Math.max(shape.x1, shape.x2, shape.x3),
    minY: Math.min(shape.y1, shape.y2, shape.y3),
    maxY: Math.max(shape.y1, shape.y2, shape.y3),
  };
}

function terrainBounds(shape: ReturnType<typeof createBattlefieldTerrainLayers>[number]) {
  if (shape.kind === 'roundedRect' || shape.kind === 'ellipse') {
    return {
      minX: shape.x - shape.width / 2,
      maxX: shape.x + shape.width / 2,
      minY: shape.y - shape.height / 2,
      maxY: shape.y + shape.height / 2,
    };
  }
  return {
    minX: Math.min(shape.x1, shape.x2, shape.x3),
    maxX: Math.max(shape.x1, shape.x2, shape.x3),
    minY: Math.min(shape.y1, shape.y2, shape.y3),
    maxY: Math.max(shape.y1, shape.y2, shape.y3),
  };
}

describe('battlefield arena visual layouts', () => {
  it('places the training strip in the tower-free bottom band on every viewport', () => {
    // Tall phones: the strip parks fully below the board, clear of the
    // player base's spotlight glow (bottom edge 666) and the ordinary
    // bottom hint bar (which training hides anyway).
    for (const visibleHeight of [867, 889]) {
      const y = trainingOverlayPanelY(visibleHeight);
      const bottomBarY = Math.max(691, visibleHeight - 28);
      expect(y - 23).toBeGreaterThan(666);
      expect(y + 23).toBeLessThan(bottomBarY - 20);
    }
    // Board-fitted viewports (720): the strip replaces the bottom hint
    // bar. Its top edge (y-23) must sit fully BELOW the enemy castle's
    // spotlight glow (bottom edge 166) — the old top placement covered the
    // enemy castle, which is the finale's guided target.
    const y = trainingOverlayPanelY(720);
    expect(y).toBe(692);
    expect(y - 23).toBeGreaterThan(166);
    expect(y + 23).toBeLessThanOrEqual(720);
  });
  it('gives every battlefield a distinct static motif', () => {
    const crown = createBattlefieldDecorations('crown_cross', 720);
    const passes = createBattlefieldDecorations('twin_passes', 720);
    const ring = createBattlefieldDecorations('royal_ring', 720);
    const quad = createBattlefieldDecorations('quad_citadel', 720);

    expect(crown).not.toEqual(passes);
    expect(passes).not.toEqual(ring);
    expect(ring).not.toEqual(crown);
    expect(quad).not.toEqual(crown);
    expect(crown.some((shape) => shape.kind === 'ellipse')).toBe(true);
    expect(passes.some((shape) => shape.kind === 'triangle')).toBe(true);
    // The ring court and the citadel quadrants are built from layered floor zones.
    expect(ring.filter((shape) => shape.kind === 'zone')).toHaveLength(3);
    expect(quad.filter((shape) => shape.kind === 'zone')).toHaveLength(5);
  });

  it('gives every battlefield a distinct hand-composed terrain layer', () => {
    const crown = createBattlefieldTerrainLayers('crown_cross', 720);
    const passes = createBattlefieldTerrainLayers('twin_passes', 720);
    const ring = createBattlefieldTerrainLayers('royal_ring', 720);
    const quad = createBattlefieldTerrainLayers('quad_citadel', 720);

    expect(crown).not.toEqual(passes);
    expect(passes).not.toEqual(ring);
    expect(ring).not.toEqual(quad);
    // Crown keeps a central court and removes the four boxed flank gardens.
    expect(crown.some((layer) => layer.kind === 'ellipse' && layer.x === 200 && layer.y === 360)).toBe(true);
    expect(crown.filter((layer) => layer.kind === 'roundedRect' && layer.width < 300)).toEqual([]);
    expect(passes.some((layer) => layer.kind === 'triangle')).toBe(true);
    expect(ring.filter((layer) => layer.kind === 'ellipse')).toHaveLength(4);
    expect(quad.filter((layer) => layer.kind === 'roundedRect')).toHaveLength(5);
  });

  it.each(['crown_cross', 'twin_passes', 'royal_ring', 'quad_citadel'] as const)(
    'keeps %s decoration geometry inside the 400x720 arena',
    (motif) => {
      for (const shape of createBattlefieldDecorations(motif, 720)) {
        const { minX, maxX, minY, maxY } = shapeBounds(shape);
        expect(minX).toBeGreaterThanOrEqual(0);
        expect(maxX).toBeLessThanOrEqual(400);
        expect(minY).toBeGreaterThanOrEqual(78);
        expect(maxY).toBeLessThanOrEqual(690);
      }
    }
  );

  it.each(['crown_cross', 'twin_passes', 'royal_ring', 'quad_citadel'] as const)(
    'keeps %s terrain paint inside the 400x720 tactical board',
    (motif) => {
      for (const layer of createBattlefieldTerrainLayers(motif, 720)) {
        const { minX, maxX, minY, maxY } = terrainBounds(layer);
        expect(minX).toBeGreaterThanOrEqual(0);
        expect(maxX).toBeLessThanOrEqual(400);
        expect(minY).toBeGreaterThanOrEqual(78);
        expect(maxY).toBeLessThanOrEqual(664);
      }
    }
  );

  it('keeps baseline gameplay art authored when the viewport becomes taller', () => {
    // Taller viewports stretch the whole map through the board projection
    // (see boardProjection.createStretchedIdentityLayout) — the authored
    // dressing never extends past the 400x720 arena on its own.
    for (const motif of ['crown_cross', 'twin_passes', 'royal_ring', 'quad_citadel'] as const) {
      const tallDecorations = createBattlefieldDecorations(motif, 867);
      const decorationMaxY = Math.max(
        ...tallDecorations.map((shape) => shapeBounds(shape).maxY)
      );
      expect(decorationMaxY).toBeLessThanOrEqual(664);

      const tallTerrain = createBattlefieldTerrainLayers(motif, 867);
      const baseTerrain = createBattlefieldTerrainLayers(motif, 720);
      expect(tallTerrain).toEqual(baseTerrain);
    }
  });
});
