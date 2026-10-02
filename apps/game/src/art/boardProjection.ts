import type { BattlefieldId } from '@crown-clash/game-core';

/**
 * Board projection layer (Art Bible "true 2.5D diorama" direction).
 *
 * Gameplay stays authoritative in the flat top-down world space of
 * `battlefields.json` (server simulation, roads, hit radii are untouched).
 * This module maps that world onto the screen:
 *
 *  - Diorama battlefields (currently the Crown Cross vertical slice) render
 *    through a straight-on dimetric projection — the same ~45° pitch the
 *    Blender sprite rig uses — so the ground plane itself carries depth:
 *    world circles foreshorten to ellipses, roads recede, and gameplay
 *    objects sort by screen Y (painter's algorithm, Clash Royale style).
 *  - Every other battlefield keeps the legacy identity transform at the
 *    400x720 baseline (project(x, y) === (x, y)) until its ground plate is
 *    re-rendered through the dimetric rig, so un-migrated maps render
 *    pixel-identical there; on taller viewports the flat map stretches
 *    vertically to fill the portrait band (see createStretchedIdentityLayout).
 *
 * The transform is affine, which keeps the integration cheap:
 *   u = originX + (x - 200) * scale
 *   v = originY + (y - 398) * scale * foreshorten
 * Local world offsets therefore scale by (scale, scale * foreshorten) and
 * ground circles become ellipses with ry / rx = foreshorten — matching the
 * baked perspective inside the dimetric sprite renders.
 */

/** World-space center of every battlefield playfield (mirrors Blender GROUND_LOGICAL_CENTER). */
export const BOARD_WORLD_CENTER_X = 200;
export const BOARD_WORLD_CENTER_Y = 398;

/** World-space playfield rect (the ground-plate area). */
export const BOARD_WORLD_LEFT = 10;
export const BOARD_WORLD_TOP = 78;
export const BOARD_WORLD_WIDTH = 380;
export const BOARD_WORLD_HEIGHT = 640;

/** Diorama camera pitch. Must match CAMERA_PITCH_DEG in art/blender/build_battlefield_scene.py. */
export const BOARD_PITCH_DEG = 45;
/** Vertical foreshortening of the ground plane: cos(pitch). */
export const BOARD_FORESHORTEN = Math.cos((BOARD_PITCH_DEG * Math.PI) / 180);

/**
 * Battlefields rendered through the diorama projection. A battlefield joins
 * this set when its ground plate has been re-rendered through the dimetric
 * Blender rig (rollout order follows the slice plan: crown_cross first).
 */
const DIMETRIC_BATTLEFIELDS: ReadonlySet<string> = new Set(['crown_cross']);

export function isDimetricBattlefield(battlefieldId: BattlefieldId): boolean {
  return DIMETRIC_BATTLEFIELDS.has(battlefieldId);
}

export interface BoardPoint {
  u: number;
  v: number;
}

/** A point in the authoritative flat world space. */
export interface WorldPoint {
  x: number;
  y: number;
}

export type GameplayDepthKind = 'prop' | 'territory' | 'convoy' | 'dust';

/** Legacy fixed depths (identity layouts must render pixel-identical to the flat board). */
const LEGACY_DEPTH: Readonly<Record<GameplayDepthKind, number>> = Object.freeze({
  prop: 10,
  territory: 20,
  convoy: 35,
  dust: 33,
});

/**
 * Painter's depth band for the diorama board: 10 + 0.1 * screenY.
 * screenY in [76, 720] yields depths in [17.6, 82] — above the board layers
 * (0..3), below every overlay (83+) and the HUD (89+).
 */
const DEPTH_BASE = 10;
const DEPTH_PER_SCREEN_Y = 0.1;

export interface BoardLayout {
  readonly battlefieldId: BattlefieldId;
  readonly isDimetric: boolean;
  /** Screen u of world x=200 (board horizontal center). */
  readonly originX: number;
  /** Screen v of world y=398 (board vertical center). */
  readonly originY: number;
  /** Uniform world→screen scale (applies to both axes before foreshortening). */
  readonly scale: number;
  /** Vertical ground-plane foreshortening (1 = straight top-down). */
  readonly foreshorten: number;

  /** Maps a world point to screen space. */
  project(x: number, y: number): BoardPoint;
  /** Zero-allocation variant for per-frame loops. */
  projectInto(x: number, y: number, out: BoardPoint): BoardPoint;
  /** Inverse map: screen point → authoritative world point (hit testing). */
  unproject(u: number, v: number): WorldPoint;
  /** Screen-space scale factor for local world offsets (y axis). */
  verticalScale(): number;
  /** Painter's depth for a gameplay object at the given screen Y. */
  gameplayDepth(kind: GameplayDepthKind, screenY: number): number;
  /**
   * Overlay depth for the diorama layout, mapped from the legacy flat-board
   * depth so both layouts share one call site. Identity layouts return the
   * legacy value unchanged.
   */
  overlayDepth(legacyDepth: number): number;
}

/** Screen rect the ground plate image must be displayed at. */
export function groundPlateScreenRect(layout: BoardLayout): {
  cx: number;
  cy: number;
  width: number;
  height: number;
} {
  const center = layout.project(BOARD_WORLD_CENTER_X, BOARD_WORLD_CENTER_Y);
  return {
    cx: center.u,
    cy: center.v,
    width: BOARD_WORLD_WIDTH * layout.scale,
    height: BOARD_WORLD_HEIGHT * layout.scale * layout.foreshorten,
  };
}

/**
 * Aspect (height / width) of the diorama ground-plate image. The master is
 * 1140x1440 and the runtime texture 760x960 — both exactly this ratio —
 * because the sensor covers 480 plane units over the 380-unit width (see
 * GROUND_DIORAMA_RESOLUTION / GROUND_DIORAMA_ORTHO_SCALE in
 * build_battlefield_scene.py). The image is CENTERED on the world rect:
 * stretching it to the projected world-rect width times this aspect maps
 * image rows onto world y at scale/3 per row, which reproduces the
 * project() v formula exactly. The extra height is plinth headroom above
 * the world rect's top edge and the slab skirt below its bottom edge.
 */
export const GROUND_IMAGE_ASPECT = 1440 / 1140;

/**
 * Screen rect the full ground-plate IMAGE must be displayed at. Diorama
 * plates (760x960) center on the projected world rect with the same width
 * and add the baked plinth headroom + slab skirt bands via the image
 * aspect; identity plates (760x1280) map the world rect 1:1, so their
 * image rect IS the plane rect.
 */
export function groundPlateImageRect(layout: BoardLayout): {
  cx: number;
  cy: number;
  width: number;
  height: number;
} {
  const plane = groundPlateScreenRect(layout);
  if (!layout.isDimetric) {
    return plane;
  }
  return {
    cx: plane.cx,
    cy: plane.cy,
    width: plane.width,
    height: plane.width * GROUND_IMAGE_ASPECT,
  };
}

/**
 * Height (world px) of the raised stone plinth under every territory socket
 * on diorama boards — the proud lip rim's top. Must track
 * DIORAMA_PLINTH_HEIGHT - DIORAMA_PLINTH_SINK + DIORAMA_PLINTH_LIP_RISE in
 * art/blender/crown_cross_kit.py (6.0 - 0.5 + 0.7). Territory visuals anchor
 * at the plinth TOP so their bases sit on the raised platform the ground
 * plate bakes under them instead of sinking into it.
 */
export const PLINTH_TOP_LIFT = 6.2;

/**
 * Projects a world point lifted `z` world px above the ground plane (e.g.
 * onto a plinth top). At the canonical 45° pitch a unit of height shifts
 * the screen exactly like a unit of world y (sin(45°) == cos(45°) ==
 * foreshorten), so the lift is z * verticalScale() on v. Identity layouts
 * have no plinths and ignore the lift.
 */
export function projectLifted(
  layout: BoardLayout,
  x: number,
  y: number,
  z: number,
): BoardPoint {
  const p = layout.project(x, y);
  if (!layout.isDimetric || z === 0) {
    return p;
  }
  return { u: p.u, v: p.v - z * layout.verticalScale() };
}

/**
 * Height-adaptive identity ("stretched flat") layout for un-migrated
 * battlefields. The whole flat map stretches vertically to fill the visible
 * portrait band instead of leaving dead space under the authored 400x720
 * board: the ground plane (terrain, roads, sockets, rings, shadows) and the
 * plate image stretch together, while buildings and other sprites keep their
 * authored proportions.
 *
 * At the 400x720 baseline (and any shorter viewport) the transform is the
 * exact identity — project(x, y) === (x, y) — so un-migrated maps render
 * pixel-identical to the flat board. On taller viewports the plane stretches
 * by band / world-height (foreshorten >= 1) and centers on the band.
 * unproject always maps screen points back onto the authoritative flat
 * world, so hit radii, gameplay and the server simulation are untouched.
 */
function createStretchedIdentityLayout(
  battlefieldId: BattlefieldId,
  visibleHeight: number
): BoardLayout {
  const bandHeight = Math.max(120, visibleHeight - BAND_TOP - BAND_BOTTOM_MARGIN);
  const stretch = Math.max(1, bandHeight / BOARD_WORLD_HEIGHT);
  // The identity baseline keeps the authored world center (exact identity);
  // taller viewports center the stretched board on the band.
  const originY = Math.max(BOARD_WORLD_CENTER_Y, BAND_TOP + bandHeight / 2);

  const layout: BoardLayout = {
    battlefieldId,
    isDimetric: false,
    originX: BOARD_WORLD_CENTER_X,
    originY,
    scale: 1,
    foreshorten: stretch,
    project(x, y) {
      return { u: x, v: originY + (y - BOARD_WORLD_CENTER_Y) * stretch };
    },
    projectInto(x, y, out) {
      out.u = x;
      out.v = originY + (y - BOARD_WORLD_CENTER_Y) * stretch;
      return out;
    },
    unproject(u, v) {
      return {
        x: u,
        y: BOARD_WORLD_CENTER_Y + (v - originY) / stretch,
      };
    },
    verticalScale() {
      return stretch;
    },
    gameplayDepth(kind) {
      return LEGACY_DEPTH[kind];
    },
    overlayDepth(legacyDepth) {
      return legacyDepth;
    },
  };
  return layout;
}

/** Width cap: the projected plate may not overflow the 400-logical-px screen. */
const SCALE_MAX = 1.04;
/** Headroom above the projected plane for the tallest citadel sprite. */
const CONTENT_HEADROOM = 46;
/** Visible slab skirt depth below the projected plane's bottom edge. */
const CONTENT_SKIRT = 18;
/** Usable vertical band (top HUD strip / bottom margin). */
const BAND_TOP = 76;
const BAND_BOTTOM_MARGIN = 40;

function createDimetricLayout(battlefieldId: BattlefieldId, visibleHeight: number): BoardLayout {
  const bandHeight = Math.max(120, visibleHeight - BAND_TOP - BAND_BOTTOM_MARGIN);
  const projectedPlaneHeight = BOARD_WORLD_HEIGHT * BOARD_FORESHORTEN;
  const contentHeight = projectedPlaneHeight + CONTENT_HEADROOM + CONTENT_SKIRT;
  // Fill the band but never exceed the width cap (portrait first).
  const scale = Math.min(SCALE_MAX, Math.max(1, bandHeight / contentHeight));
  const projectedHeight = projectedPlaneHeight * scale;
  const topMargin = (bandHeight - (projectedHeight + CONTENT_HEADROOM + CONTENT_SKIRT)) / 2;
  const planeTopV = BAND_TOP + topMargin + CONTENT_HEADROOM;
  const originY = planeTopV + (BOARD_WORLD_HEIGHT / 2) * scale * BOARD_FORESHORTEN;

  const layout: BoardLayout = {
    battlefieldId,
    isDimetric: true,
    originX: BOARD_WORLD_CENTER_X,
    originY,
    scale,
    foreshorten: BOARD_FORESHORTEN,
    project(x, y) {
      return {
        u: BOARD_WORLD_CENTER_X + (x - BOARD_WORLD_CENTER_X) * scale,
        v: originY + (y - BOARD_WORLD_CENTER_Y) * scale * BOARD_FORESHORTEN,
      };
    },
    projectInto(x, y, out) {
      out.u = BOARD_WORLD_CENTER_X + (x - BOARD_WORLD_CENTER_X) * scale;
      out.v = originY + (y - BOARD_WORLD_CENTER_Y) * scale * BOARD_FORESHORTEN;
      return out;
    },
    unproject(u, v) {
      return {
        x: BOARD_WORLD_CENTER_X + (u - BOARD_WORLD_CENTER_X) / scale,
        y: BOARD_WORLD_CENTER_Y + (v - originY) / (scale * BOARD_FORESHORTEN),
      };
    },
    verticalScale() {
      return scale * BOARD_FORESHORTEN;
    },
    gameplayDepth(kind, screenY) {
      // Environment props frame the board BEHIND every territory platform:
      // their curated placements (BattlefieldArt) only clear the territory
      // RADII, while the rendered building sprites tower far wider/taller,
      // so a south-side tree interleaved through the painter band would cover
      // its tower. Props keep the flat legacy depth below the whole territory
      // band; territory/convoy/dust still sort by screen Y (painter's).
      if (kind === 'prop') {
        return LEGACY_DEPTH.prop;
      }
      return DEPTH_BASE + screenY * DEPTH_PER_SCREEN_Y;
    },
    overlayDepth(legacyDepth) {
      const mapped = OVERLAY_DEPTH_MAP[legacyDepth];
      return mapped === undefined ? legacyDepth : mapped;
    },
  };
  // The horizontal origin is fixed at the board's world center.
  return layout;
}

/** Legacy overlay depth → diorama overlay depth (above the whole gameplay band). */
const OVERLAY_DEPTH_MAP: Readonly<Record<number, number>> = Object.freeze({
  30: 83, // capture flash
  31: 83, // impact rings
  32: 83, // capture burst
  45: 85, // selection rings
  50: 86, // drag trajectory
  55: 87, // drag badge
  60: 88, // floating text
});

/**
 * Resolves the board layout for a battlefield. Both layout styles depend on
 * the visible height and are built per scene instance: dimetric boards fill
 * the portrait band up to the width cap, identity (un-migrated) boards
 * stretch the flat map to fill the band (exact identity at the 720
 * baseline).
 */
export function createBoardLayout(battlefieldId: BattlefieldId, visibleHeight: number): BoardLayout {
  if (!isDimetricBattlefield(battlefieldId)) {
    return createStretchedIdentityLayout(battlefieldId, visibleHeight);
  }
  return createDimetricLayout(battlefieldId, visibleHeight);
}
