import { getBattlefield, type BattlefieldId } from '@crown-clash/game-core';
import { territoryArtFootprint } from './BattlefieldArt.js';
import arenaLayout from '../../../../art/arena-layout.json' with { type: 'json' };

/**
 * Board projection layer (Art Bible "true 2.5D diorama" direction).
 *
 * Gameplay stays authoritative in the flat top-down world space of
 * `battlefields.json` (server simulation, roads, hit radii are untouched).
 * This module maps that world onto the screen:
 *
 *  - Every battlefield renders through a straight-on dimetric projection —
 *    the same ~45° pitch the Blender sprite rig uses — so the ground plane
 *    itself carries depth: world circles foreshorten to ellipses, roads
 *    recede, and gameplay objects sort by screen Y (painter's algorithm,
 *    Clash Royale style).
 *  - Boards without a dimetric plate (grounds pack inactive, or a future
 *    flat-shipped map) fall back to the legacy identity transform at the
 *    400x720 baseline (project(x, y) === (x, y)); on taller viewports that
 *    fallback stretches vertically to fill the portrait band (see
 *    createStretchedIdentityLayout).
 *
 * The transform is affine, which keeps the integration cheap:
 *   u = originX + (x - 200) * scale
 *   v = originY + (y - 398) * scale * foreshorten * verticalSpacing
 * Spacing expands positions before projection, keeping server travel unchanged.
 * Local object offsets still scale by (scale, scale * foreshorten) and
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

/** Art-only row spacing, shared with Blender; leaves buildings and plinths unscaled. */
export const BOARD_VERTICAL_SPACING = arenaLayout.verticalSpacing;
if (arenaLayout.version !== 1 || !Number.isFinite(BOARD_VERTICAL_SPACING) ||
    BOARD_VERTICAL_SPACING < 1 || BOARD_VERTICAL_SPACING > 1.3) {
  throw new Error('Invalid arena-layout vertical spacing');
}

/**
 * Battlefields rendered through the diorama projection: every battlefield's
 * ground plate is now re-rendered through the dimetric Blender rig (rollout
 * order followed the slice plan: crown_cross first). A battlefield leaves
 * this set only if its plate reverts to the flat top-down rig.
 */
const DIMETRIC_BATTLEFIELDS: ReadonlySet<string> = new Set([
  'crown_cross',
  'twin_passes',
  'royal_ring',
  'quad_citadel',
]);

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
 * Painter's depth band for the diorama board: 10 + 0.1 * normalizedY.
 * Normalize tall viewports onto [76, 720], yielding depths in [17.6, 82] — above the board layers
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
  /** Object/world-X scale; world-Y positions also apply art-only row spacing. */
  readonly scale: number;
  /** Vertical ground-plane foreshortening (1 = straight top-down). */
  readonly foreshorten: number;

  /** Maps a world point to screen space. */
  project(x: number, y: number): BoardPoint;
  /** Zero-allocation variant for per-frame loops. */
  projectInto(x: number, y: number, out: BoardPoint): BoardPoint;
  /** Inverse map: screen point → authoritative world point (hit testing). */
  unproject(u: number, v: number): WorldPoint;
  /** Local object Y scale, excluding row spacing (plinths retain their shape). */
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
    height: BOARD_WORLD_HEIGHT * layout.scale * layout.foreshorten * (layout.isDimetric ? BOARD_VERTICAL_SPACING : 1),
  };
}

/**
 * Aspect (height / width) of the diorama ground-plate image. The master is
 * 1140x2502 and the runtime texture 760x1668 — both exactly this ratio —
 * because the sensor covers 834 view units over the 380-unit width (see
 * GROUND_DIORAMA_RESOLUTION / GROUND_DIORAMA_ORTHO_SCALE in
 * build_battlefield_scene.py). The image is CENTERED on the world rect:
 * stretching it to the projected world-rect width times this aspect maps
 * image rows onto world y at scale/3 per row, which reproduces the
 * project() v formula using the shared pre-projection row spacing. The plate
 * retains its meadow fringe around the expanded world rect, so it is taller than
 * any phone band: tall viewports fill with board while shorter ones crop
 * the fringe symmetrically around the projected world-rect center.
 */
export const GROUND_IMAGE_ASPECT = 2502 / 1140;

/**
 * Screen rect the full ground-plate IMAGE must be displayed at. Diorama
 * plates (760x1668) center on the projected world rect with the same width
 * and extend past it by the baked meadow fringe (plus plinth headroom and
 * the slab skirt) via the image aspect; identity plates (760x1280) map the
 * world rect 1:1, so their image rect IS the plane rect.
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
 * the screen exactly like a unit of local ground-plane Y (sin(45°) == cos(45°) ==
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
 * Height-adaptive identity ("stretched flat") layout for boards without a
 * dimetric ground plate — the fallback while every shipped battlefield's
 * plate renders through the dimetric rig, and for any future map that ships
 * with a flat top-down plate (or no plate at all, when the grounds pack is
 * inactive). The whole flat map stretches vertically to fill the visible
 * portrait band instead of leaving dead space under the authored 400x720
 * board: the ground plane (terrain, roads, sockets, rings, shadows) and the
 * plate image stretch together, while buildings and other sprites keep their
 * authored proportions.
 *
 * At the 400x720 baseline (and any shorter viewport) the transform is the
 * exact identity — project(x, y) === (x, y) — so the fallback renders
 * pixel-identical to the flat board. On taller viewports the plane stretches
 * by band / world-height (foreshorten >= 1) and centers on the band.
 * unproject always maps screen points back onto the authoritative flat
 * world, so hit radii, gameplay and the server simulation are untouched.
 */
export function createStretchedIdentityLayout(
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
// The authored top bases sit 32 world units inside the plane; together with
// this margin they retain room for the full citadel and its selection feedback.
const CONTENT_HEADROOM = 22;
/** Visible slab skirt depth below the projected plane's bottom edge. */
const CONTENT_SKIRT = 18;
/** Usable vertical band (top HUD strip / bottom margin). */
const BAND_TOP = 76;
const BAND_BOTTOM_MARGIN = 40;

function createDimetricLayout(battlefieldId: BattlefieldId, visibleHeight: number): BoardLayout {
  const bandHeight = Math.max(120, visibleHeight - BAND_TOP - BAND_BOTTOM_MARGIN);
  const projectedPlaneHeight = BOARD_WORLD_HEIGHT * BOARD_FORESHORTEN * BOARD_VERTICAL_SPACING;
  const contentHeight = projectedPlaneHeight + CONTENT_HEADROOM + CONTENT_SKIRT;
  // Fill the band but never exceed the width cap (portrait first).
  let scale = Math.min(SCALE_MAX, Math.max(1, bandHeight / contentHeight));
  const territories = getBattlefield(battlefieldId).territories;
  const extents = territories.map((territory) => {
    const art = territoryArtFootprint(battlefieldId, territory);
    const centerY = (territory.y - BOARD_WORLD_CENTER_Y) * BOARD_FORESHORTEN * BOARD_VERTICAL_SPACING
      - PLINTH_TOP_LIFT * BOARD_FORESHORTEN;
    return {
      top: centerY + art.spriteY - art.spriteSize * 0.54,
      bottom: centerY + Math.max(art.spriteY + art.spriteSize * 0.54,
        art.badgeY + 12, art.roleIconY + 9),
    };
  });
  const contentTop = Math.min(-projectedPlaneHeight / 2 - CONTENT_HEADROOM,
    ...extents.map((bounds) => bounds.top));
  const contentBottom = Math.max(projectedPlaneHeight / 2 + CONTENT_SKIRT,
    ...extents.map((bounds) => bounds.bottom));
  const fittedScale = Math.min(scale, (bandHeight - 16) / (contentBottom - contentTop));
  scale = fittedScale;
  // Balance the actual gameplay silhouettes, rather than the empty meadow
  // fringe. The board image and every anchor share this translated origin.
  const desiredOriginY = BAND_TOP + bandHeight / 2 - (contentTop + contentBottom) * scale / 2;
  const imageHalfHeight = BOARD_WORLD_WIDTH * scale * GROUND_IMAGE_ASPECT / 2;
  const minOriginY = Math.max(BAND_TOP + 8 - contentTop * scale,
    visibleHeight - BAND_BOTTOM_MARGIN - imageHalfHeight);
  const maxOriginY = Math.min(visibleHeight - BAND_BOTTOM_MARGIN - 8 - contentBottom * scale,
    BAND_TOP + imageHalfHeight);
  const originY = minOriginY <= maxOriginY
    ? Math.max(minOriginY, Math.min(maxOriginY, desiredOriginY)) : desiredOriginY;

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
        v: originY + (y - BOARD_WORLD_CENTER_Y) * scale * BOARD_FORESHORTEN * BOARD_VERTICAL_SPACING,
      };
    },
    projectInto(x, y, out) {
      out.u = BOARD_WORLD_CENTER_X + (x - BOARD_WORLD_CENTER_X) * scale;
      out.v = originY + (y - BOARD_WORLD_CENTER_Y) * scale * BOARD_FORESHORTEN * BOARD_VERTICAL_SPACING;
      return out;
    },
    unproject(u, v) {
      return {
        x: BOARD_WORLD_CENTER_X + (u - BOARD_WORLD_CENTER_X) / scale,
        y: BOARD_WORLD_CENTER_Y + (v - originY) / (scale * BOARD_FORESHORTEN * BOARD_VERTICAL_SPACING),
      };
    },
    verticalScale() {
      return scale * BOARD_FORESHORTEN;
    },
    gameplayDepth(kind, screenY) {
      // Props frame the board below the gameplay band. Normalize the same
      // painter ordering to the baseline height so bodies on tall phones
      // cannot rise above the fixed annotation/selection/HUD depths.
      if (kind === 'prop') {
        return LEGACY_DEPTH.prop;
      }
      const normalizedY = BAND_TOP + (screenY - BAND_TOP) * (720 - BAND_TOP) / (visibleHeight - BAND_TOP);
      return DEPTH_BASE + normalizedY * DEPTH_PER_SCREEN_Y;
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
