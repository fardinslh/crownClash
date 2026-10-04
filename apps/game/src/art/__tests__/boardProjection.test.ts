import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BATTLEFIELDS, type BattlefieldId } from '@crown-clash/game-core';
import { territoryArtFootprint } from '../BattlefieldArt.js';
import {
  BOARD_FORESHORTEN,
  BOARD_WORLD_CENTER_X,
  BOARD_WORLD_CENTER_Y,
  BOARD_WORLD_HEIGHT,
  BOARD_WORLD_TOP,
  BOARD_WORLD_WIDTH,
  BOARD_VERTICAL_SPACING,
  createBoardLayout,
  createStretchedIdentityLayout,
  GROUND_IMAGE_ASPECT,
  groundPlateImageRect,
  groundPlateScreenRect,
  isDimetricBattlefield,
  PLINTH_TOP_LIFT,
  projectLifted,
} from '../boardProjection.js';

const DIMETRIC_IDS: readonly BattlefieldId[] = BATTLEFIELDS.filter((b) =>
  isDimetricBattlefield(b.id)
).map((b) => b.id);

describe('boardProjection diorama layouts', () => {
  it('every battlefield renders as a dimetric diorama', () => {
    // The vertical slice rolled out past crown_cross: all four battlefields
    // ship diorama ground plates through the dimetric rig.
    expect([...DIMETRIC_IDS].sort()).toEqual(['crown_cross', 'quad_citadel', 'royal_ring', 'twin_passes']);
  });

  it('opens vertical placement while keeping the 45deg camera and local object scale', () => {
    for (const id of DIMETRIC_IDS) {
      const layout = createBoardLayout(id, 720);
      expect(layout.isDimetric, id).toBe(true);
      expect(layout.foreshorten, id).toBeCloseTo(BOARD_FORESHORTEN, 10);

      const center = layout.project(BOARD_WORLD_CENTER_X, BOARD_WORLD_CENTER_Y);
      expect(center.u, id).toBe(200);
      expect(center.v, id).toBe(layout.originY);

      // A 100-unit horizontal step maps to scale px; the same step vertically
      // also applies row spacing. Objects themselves retain the 45deg shape.
      const east = layout.project(BOARD_WORLD_CENTER_X + 100, BOARD_WORLD_CENTER_Y);
      const south = layout.project(BOARD_WORLD_CENTER_X, BOARD_WORLD_CENTER_Y + 100);
      expect(east.u - center.u, id).toBeCloseTo(100 * layout.scale, 10);
      expect(south.v - center.v, id).toBeCloseTo(100 * layout.scale * layout.foreshorten * BOARD_VERTICAL_SPACING, 10);
      expect(BOARD_VERTICAL_SPACING).toBe(1.22);
      expect(layout.verticalScale()).toBeCloseTo(layout.scale * BOARD_FORESHORTEN, 10);
    }
  });

  it('round-trips every projection through unproject (hit-test correctness)', () => {
    for (const id of DIMETRIC_IDS) {
      const layout = createBoardLayout(id, 720);
      for (const [x, y] of [
        [10, 78],
        [390, 718],
        [200, 360],
        [85, 485],
        [315, 235],
      ] as const) {
        const point = layout.project(x, y);
        const roundTrip = layout.unproject(point.u, point.v);
        expect(roundTrip.x, `${id} x=${x}`).toBeCloseTo(x, 9);
        expect(roundTrip.y, `${id} y=${y}`).toBeCloseTo(y, 9);
      }
    }
  });

  it('keeps every projected board inside the portrait screen and the HUD band', () => {
    for (const id of DIMETRIC_IDS) {
      for (const visibleHeight of [720, 800, 844, 932, 1024]) {
        const layout = createBoardLayout(id, visibleHeight);
        const rect = groundPlateScreenRect(layout);
        expect(rect.cx, id).toBe(200);
        expect(rect.width, id).toBeLessThanOrEqual(396); // 400 logical width, 2px side margins
        const planeTopV = layout.project(BOARD_WORLD_CENTER_X, BOARD_WORLD_TOP).v;
        const planeBottomV = layout.project(
          BOARD_WORLD_CENTER_X,
          BOARD_WORLD_TOP + BOARD_WORLD_HEIGHT
        ).v;
        // Headroom for the enemy citadel sprite above the projected plane top.
        expect(planeTopV, `${id} ${visibleHeight}`).toBeGreaterThanOrEqual(98);
        // Slab skirt bottom stays clear of the bottom margin band.
        expect(planeBottomV + 18 * layout.scale, `${id} ${visibleHeight}`).toBeLessThanOrEqual(
          visibleHeight - 40
        );
      }
    }
  });

  it('scales monotonically with viewport height up to the width cap', () => {
    for (const id of DIMETRIC_IDS) {
      const tall = createBoardLayout(id, 1200);
      const short = createBoardLayout(id, 720);
      expect(tall.scale, id).toBeGreaterThanOrEqual(short.scale);
      expect(tall.scale, id).toBeLessThanOrEqual(1.04);
    }
  });

  it('gameplay depths form a painter band below overlays and the HUD', () => {
    const layout = createBoardLayout('crown_cross', 720);
    const topTerritory = layout.gameplayDepth('territory', 140);
    const bottomTerritory = layout.gameplayDepth('territory', 640);
    expect(topTerritory).toBeGreaterThan(3); // above plate/lanes/border
    expect(bottomTerritory).toBeLessThan(layout.overlayDepth(45)); // below selection rings
    expect(layout.overlayDepth(60)).toBeGreaterThan(bottomTerritory); // floating text on top
    expect(layout.overlayDepth(60)).toBeLessThan(89); // below the HUD strip
    expect(topTerritory).toBeLessThan(bottomTerritory); // north sorts behind south
    // Environment props frame the board flat-behind EVERY platform: their
    // curated placements only clear the territory radii, while the rendered
    // building sprites tower far wider, so interleaving them through the
    // painter band would let south-side trees cover buildings.
    const northProp = layout.gameplayDepth('prop', 120);
    const southProp = layout.gameplayDepth('prop', 700);
    expect(northProp).toBe(southProp);
    expect(southProp).toBeLessThan(topTerritory);
  });

  it('projectInto reuses the caller buffer without allocation', () => {
    for (const id of DIMETRIC_IDS) {
      const layout = createBoardLayout(id, 720);
      const buffer = { u: 0, v: 0 };
      const out = layout.projectInto(85, 485, buffer);
      expect(out, id).toBe(buffer);
      expect(out.u, id).toBeCloseTo(layout.project(85, 485).u, 10);
      expect(out.v, id).toBeCloseTo(layout.project(85, 485).v, 10);
    }
  });

  it('ground plate image rect is centered on the world rect with the baked aspect', () => {
    // The diorama plate image (1140x2502 master, 760x1668 runtime) is
    // centered on the projected world rect; its height adds the baked
    // retained meadow fringe beyond each end of the expanded world rect (plus the
    // plinth headroom and slab skirt zones at the very ends).
    for (const id of DIMETRIC_IDS) {
      for (const visibleHeight of [720, 800, 844, 932, 950]) {
        const layout = createBoardLayout(id, visibleHeight);
        const plane = groundPlateScreenRect(layout);
        const image = groundPlateImageRect(layout);
        expect(image.cx, id).toBe(plane.cx);
        expect(image.cy, id).toBe(plane.cy);
        expect(image.width, id).toBe(plane.width);
        expect(image.height, id).toBeCloseTo(plane.width * GROUND_IMAGE_ASPECT, 10);
        // Image rows map world y at scale/3 per row (2502px / 834 units ==
        // 1140px / 380 units), so the image reproduces project()'s v formula:
        // the world rect's projected height equals its image-row span * scale/3.
        const worldRectRows = BOARD_WORLD_HEIGHT * BOARD_VERTICAL_SPACING * 3 * Math.SQRT1_2;
        expect(plane.height, `${id} ${visibleHeight}`).toBeCloseTo(
          worldRectRows * (plane.width / 1140),
          6
        );
        // The baked meadow fringe makes the image TALLER than any phone
        // band: tall viewports fill with board (the image covers the full
        // band, top HUD strip to bottom margin) while shorter ones crop the
        // fringe symmetrically around the projected world-rect center.
        expect(image.cy - image.height / 2, `${id} ${visibleHeight} top`).toBeLessThanOrEqual(76);
        expect(image.cy + image.height / 2, `${id} ${visibleHeight} bottom`).toBeGreaterThanOrEqual(
          visibleHeight - 40
        );
      }
    }
    expect(BOARD_WORLD_WIDTH).toBe(380);
  });

  it('projectLifted lifts sockets onto the plinth top on diorama boards only', () => {
    for (const id of DIMETRIC_IDS) {
      const layout = createBoardLayout(id, 720);
      const ground = layout.project(200, 398);
      const lifted = projectLifted(layout, 200, 398, PLINTH_TOP_LIFT);
      expect(lifted.u, id).toBe(ground.u);
      // At the canonical 45deg pitch a unit of height shifts v exactly like a
      // unit of local ground-plane Y: z * scale * foreshorten.
      expect(lifted.v, id).toBeCloseTo(ground.v - PLINTH_TOP_LIFT * layout.verticalScale(), 10);
      // Zero lift is the ground projection.
      expect(projectLifted(layout, 85, 485, 0), id).toEqual(layout.project(85, 485));
      // The lift must track the Blender kit's plinth stack height:
      // 6.0 (height) - 0.5 (sink) + 0.7 (lip rise) in crown_cross_kit.py.
      expect(PLINTH_TOP_LIFT).toBe(6.2);
    }
    // The stretched identity fallback ignores lifts (no baked plinths).
    const fallback = createStretchedIdentityLayout('twin_passes', 720);
    expect(projectLifted(fallback, 85, 485, PLINTH_TOP_LIFT)).toEqual(fallback.project(85, 485));
    // The fallback never carries the baked skirt: the image rect IS the
    // plane rect (a flat plate maps the world rect 1:1).
    expect(groundPlateImageRect(fallback).height).toBe(groundPlateScreenRect(fallback).height);
  });

  it('keeps full building sprites, count pills and role icons inside the mobile play band', () => {
    for (const battlefield of BATTLEFIELDS) {
      for (const height of [720, 800, 866, 950]) {
        const layout = createBoardLayout(battlefield.id, height);
        for (const territory of battlefield.territories) {
          const art = territoryArtFootprint(battlefield.id, territory);
          const anchor = projectLifted(layout, territory.x, territory.y, PLINTH_TOP_LIFT);
          const top = anchor.v + (art.spriteY - art.spriteSize / 2 - 2) * layout.scale;
          const bottom = anchor.v + Math.max(art.spriteY + art.spriteSize / 2,
            art.badgeY + 11, art.roleIconY + 8) * layout.scale;
          expect(top, `${battlefield.id}/${territory.id} sprite above HUD at ${height}`).toBeGreaterThan(76);
          expect(bottom, `${battlefield.id}/${territory.id} labels below play band at ${height}`).toBeLessThan(height - 40);
        }
      }
    }
  });

  it('registers the actual Blender ground positions with the client projection', () => {
    const kitPath = fileURLToPath(new URL('../../../../../art/blender/crown_cross_kit.py', import.meta.url));
    const points = [[200, 398], [200, 110], [200, 610], [60, 540], [340, 180]];
    const script = `import importlib.util,json,sys,types
sys.dont_write_bytecode=True
sys.modules['bpy']=types.ModuleType('bpy')
spec=importlib.util.spec_from_file_location('kit',sys.argv[1])
kit=importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)
print(json.dumps([kit._to_plane(x,y) for x,y in json.loads(sys.argv[2])]))`;
    const bakedPoints: [number, number][] = JSON.parse(execFileSync('python3',
      ['-c', script, kitPath, JSON.stringify(points)], { encoding: 'utf8', timeout: 5000 }));
    expect(bakedPoints).toHaveLength(points.length);
    for (const id of DIMETRIC_IDS) {
      const layout = createBoardLayout(id, 720);
      for (let i = 0; i < points.length; i++) {
        const [x, y] = points[i];
        const [planeX, planeY] = bakedPoints[i];
        const projected = layout.project(x, y);
        expect(projected.u).toBeCloseTo(layout.originX + planeX * layout.scale, 9);
        expect(projected.v).toBeCloseTo(layout.originY - planeY * layout.scale * BOARD_FORESHORTEN, 9);
      }
    }
  });
});

describe('boardProjection stretched identity fallback (no rendered plate)', () => {
  it('is exact at the 720 baseline and stretches to fill taller viewports', () => {
    // Baseline (and any shorter viewport): the exact identity transform — the
    // fallback renders pixel-identical to the flat board.
    const base = createStretchedIdentityLayout('royal_ring', 720);
    expect(base.scale).toBe(1);
    expect(base.verticalScale()).toBe(1);
    expect(base.project(123, 456)).toEqual({ u: 123, v: 456 });
    expect(createStretchedIdentityLayout('twin_passes', 700).project(123, 456)).toEqual({
      u: 123,
      v: 456,
    });

    // Taller viewport: the whole flat map stretches vertically to fill the
    // portrait band — u is untouched, v spreads, and unproject round-trips
    // onto the authoritative flat world (hit radii stay correct).
    const tall = createStretchedIdentityLayout('royal_ring', 866);
    expect(tall.scale).toBe(1);
    expect(tall.verticalScale()).toBeGreaterThan(1);
    for (const [x, y] of [
      [10, 78],
      [390, 718],
      [200, 110],
      [200, 610],
    ] as const) {
      const point = tall.project(x, y);
      expect(point.u).toBe(x);
      const roundTrip = tall.unproject(point.u, point.v);
      expect(roundTrip.x).toBeCloseTo(x, 9);
      expect(roundTrip.y).toBeCloseTo(y, 9);
    }

    // The stretched world rect fills the visible portrait band (the whole
    // map spans the height instead of leaving dead space under the board).
    const bandTop = tall.project(BOARD_WORLD_CENTER_X, BOARD_WORLD_TOP).v;
    const bandBottom = tall.project(
      BOARD_WORLD_CENTER_X,
      BOARD_WORLD_TOP + BOARD_WORLD_HEIGHT
    ).v;
    expect(bandTop).toBeGreaterThanOrEqual(76);
    expect(bandBottom).toBeLessThanOrEqual(866 - 40);
    expect(bandBottom - bandTop).toBeGreaterThan(BOARD_WORLD_HEIGHT);
  });

  it('keeps the legacy gameplay depth bands', () => {
    const layout = createStretchedIdentityLayout('twin_passes', 720);
    expect(layout.gameplayDepth('prop', 500)).toBe(10);
    expect(layout.gameplayDepth('territory', 500)).toBe(20);
    expect(layout.gameplayDepth('convoy', 500)).toBe(35);
    expect(layout.gameplayDepth('dust', 500)).toBe(33);
    expect(layout.overlayDepth(31)).toBe(31);
  });
});
