import { describe, expect, it } from 'vitest';
import { BATTLEFIELDS, type BattlefieldId } from '@crown-clash/game-core';
import {
  BOARD_FORESHORTEN,
  BOARD_WORLD_CENTER_X,
  BOARD_WORLD_CENTER_Y,
  BOARD_WORLD_HEIGHT,
  BOARD_WORLD_TOP,
  BOARD_WORLD_WIDTH,
  createBoardLayout,
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

describe('boardProjection identity layouts', () => {
  it('crown_cross is the only diorama battlefield during the vertical slice', () => {
    expect(DIMETRIC_IDS).toEqual(['crown_cross']);
  });

  it('non-diorama battlefields project identity (pixel-identical flat board)', () => {
    for (const battlefield of BATTLEFIELDS.filter((b) => !isDimetricBattlefield(b.id))) {
      const layout = createBoardLayout(battlefield.id, 720);
      expect(layout.isDimetric).toBe(false);
      expect(layout.project(battlefield.territories[0].x, 777).v).toBe(777);
      const point = layout.project(123, 456);
      expect(point.u).toBe(123);
      expect(point.v).toBe(456);
      const roundTrip = layout.unproject(point.u, point.v);
      expect(roundTrip.x).toBeCloseTo(123, 10);
      expect(roundTrip.y).toBeCloseTo(456, 10);
    }
  });

  it('identity layouts keep the legacy gameplay depth bands', () => {
    const layout = createBoardLayout('twin_passes', 720);
    expect(layout.gameplayDepth('prop', 500)).toBe(10);
    expect(layout.gameplayDepth('territory', 500)).toBe(20);
    expect(layout.gameplayDepth('convoy', 500)).toBe(35);
    expect(layout.gameplayDepth('dust', 500)).toBe(33);
    expect(layout.overlayDepth(31)).toBe(31);
  });

  it('identity layout instances are cached per battlefield', () => {
    expect(createBoardLayout('royal_ring', 720)).toBe(createBoardLayout('royal_ring', 840));
  });
});

describe('boardProjection dimetric layout (crown_cross slice)', () => {
  it('projects the board foreshortened by cos(45deg) with a uniform scale', () => {
    const layout = createBoardLayout('crown_cross', 720);
    expect(layout.isDimetric).toBe(true);
    expect(layout.foreshorten).toBeCloseTo(BOARD_FORESHORTEN, 10);

    const center = layout.project(BOARD_WORLD_CENTER_X, BOARD_WORLD_CENTER_Y);
    expect(center.u).toBe(200);
    expect(center.v).toBe(layout.originY);

    // A 100-unit horizontal step maps to scale px; the same step vertically
    // maps to scale * foreshorten (the ground plane foreshortens, sprites do not).
    const east = layout.project(BOARD_WORLD_CENTER_X + 100, BOARD_WORLD_CENTER_Y);
    const south = layout.project(BOARD_WORLD_CENTER_X, BOARD_WORLD_CENTER_Y + 100);
    expect(east.u - center.u).toBeCloseTo(100 * layout.scale, 10);
    expect(south.v - center.v).toBeCloseTo(100 * layout.scale * layout.foreshorten, 10);
  });

  it('round-trips every projection through unproject (hit-test correctness)', () => {
    const layout = createBoardLayout('crown_cross', 720);
    for (const [x, y] of [
      [10, 78],
      [390, 718],
      [200, 360],
      [85, 485],
      [315, 235],
    ] as const) {
      const point = layout.project(x, y);
      const roundTrip = layout.unproject(point.u, point.v);
      expect(roundTrip.x).toBeCloseTo(x, 9);
      expect(roundTrip.y).toBeCloseTo(y, 9);
    }
  });

  it('keeps the projected board inside the portrait screen and the HUD band', () => {
    for (const visibleHeight of [720, 800, 844, 932, 1024]) {
      const layout = createBoardLayout('crown_cross', visibleHeight);
      const rect = groundPlateScreenRect(layout);
      expect(rect.cx).toBe(200);
      expect(rect.width).toBeLessThanOrEqual(396); // 400 logical width, 2px side margins
      const planeTopV = layout.project(BOARD_WORLD_CENTER_X, BOARD_WORLD_TOP).v;
      const planeBottomV = layout.project(BOARD_WORLD_CENTER_X, BOARD_WORLD_TOP + BOARD_WORLD_HEIGHT).v;
      // Headroom for the enemy citadel sprite above the projected plane top.
      expect(planeTopV).toBeGreaterThanOrEqual(122);
      // Slab skirt bottom stays clear of the bottom margin band.
      expect(planeBottomV + 18 * layout.scale).toBeLessThanOrEqual(visibleHeight - 40);
    }
  });

  it('scales monotonically with viewport height up to the width cap', () => {
    const tall = createBoardLayout('crown_cross', 1200);
    const short = createBoardLayout('crown_cross', 720);
    expect(tall.scale).toBeGreaterThanOrEqual(short.scale);
    expect(tall.scale).toBeLessThanOrEqual(1.04);
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
    const layout = createBoardLayout('crown_cross', 720);
    const buffer = { u: 0, v: 0 };
    const out = layout.projectInto(85, 485, buffer);
    expect(out).toBe(buffer);
    expect(out.u).toBeCloseTo(layout.project(85, 485).u, 10);
    expect(out.v).toBeCloseTo(layout.project(85, 485).v, 10);
  });

  it('ground plate image rect is centered on the world rect with the baked aspect', () => {
    // The diorama plate image (1140x1440 master, 760x960 runtime) is
    // centered on the projected world rect; its height adds the baked
    // plinth headroom above and the slab skirt below.
    for (const visibleHeight of [720, 800, 844, 932]) {
      const layout = createBoardLayout('crown_cross', visibleHeight);
      const plane = groundPlateScreenRect(layout);
      const image = groundPlateImageRect(layout);
      expect(image.cx).toBe(plane.cx);
      expect(image.cy).toBe(plane.cy);
      expect(image.width).toBe(plane.width);
      expect(image.height).toBeCloseTo(plane.width * GROUND_IMAGE_ASPECT, 10);
      // Image rows map world y at scale/3 per row (1440px / 480 units ==
      // 1140px / 380 units), so the image reproduces project()'s v formula:
      // the world rect's projected height equals its image-row span * scale/3.
      const worldRectRows = BOARD_WORLD_HEIGHT * 3 * Math.SQRT1_2; // 640 * 3 * cos(45deg)
      expect(plane.height).toBeCloseTo(worldRectRows * (plane.width / 1140), 6);
    }
    // Identity layouts never carry the baked skirt: the image rect IS the
    // plane rect (the legacy 760x1280 plate maps the world rect 1:1).
    const identity = createBoardLayout('twin_passes', 720);
    const identityImage = groundPlateImageRect(identity);
    const identityPlane = groundPlateScreenRect(identity);
    expect(identityImage.height).toBe(identityPlane.height);
    expect(BOARD_WORLD_WIDTH).toBe(380);
  });

  it('projectLifted lifts sockets onto the plinth top on diorama boards only', () => {
    const layout = createBoardLayout('crown_cross', 720);
    const ground = layout.project(200, 398);
    const lifted = projectLifted(layout, 200, 398, PLINTH_TOP_LIFT);
    expect(lifted.u).toBe(ground.u);
    // At the canonical 45deg pitch a unit of height shifts v exactly like a
    // unit of world y: z * scale * foreshorten.
    expect(lifted.v).toBeCloseTo(ground.v - PLINTH_TOP_LIFT * layout.verticalScale(), 10);
    // Zero lift is the ground projection; identity layouts ignore lifts.
    expect(projectLifted(layout, 85, 485, 0)).toEqual(layout.project(85, 485));
    const identity = createBoardLayout('twin_passes', 720);
    expect(projectLifted(identity, 85, 485, PLINTH_TOP_LIFT)).toEqual(identity.project(85, 485));
    // The lift must track the Blender kit's plinth stack height:
    // 6.0 (height) - 0.5 (sink) + 0.7 (lip rise) in crown_cross_kit.py.
    expect(PLINTH_TOP_LIFT).toBe(6.2);
  });
});
