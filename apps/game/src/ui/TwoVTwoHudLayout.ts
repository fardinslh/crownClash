import type { Slot, TeamId } from '@crown-clash/game-core';
import { TWO_V_TWO_SLOTS } from '@crown-clash/game-core';
import type { Rect } from './HudLayout.js';
import { rectanglesIntersect } from './HudLayout.js';

// ── 2v2 HUD layout (docs/2v2-architecture.md Phase 5) ─────────────────────
// Pure, deterministic geometry for the compact 2v2 header additions:
// four slot badges (A1/A2/B1/B2) and the teammate banner strip.
//
// Identity is never color-only: every slot owns a distinct shape glyph plus
// its A/B slot label, so the HUD stays readable for color-blind players and
// on any palette. Team colors (existing palette) only reinforce the labels.

/** Distinct shape glyph per slot — the non-color identity anchor. */
export const TWO_V_TWO_SLOT_SHAPES: Readonly<Record<Slot, string>> = {
  0: '●',
  1: '▲',
  2: '■',
  3: '◆',
};

/** Canonical slot labels. Team A = slots 0/1, team B = slots 2/3. */
export function slotLabel(slot: Slot): string {
  return slot < 2 ? `A${slot + 1}` : `B${slot - 1}`;
}

export interface TwoVTwoSlotBadge {
  readonly slot: Slot;
  readonly teamId: TeamId;
  /** 'A1' | 'A2' | 'B1' | 'B2' */
  readonly label: string;
  /** Distinct shape glyph — never the only identity signal (labels exist). */
  readonly shape: string;
  readonly isYou: boolean;
  readonly isAlly: boolean;
}

/**
 * Builds the four slot badge view models relative to the local player.
 * The local slot shows the YOU marker; the same-team slot is flagged ally.
 */
export function computeTwoVTwoSlotBadges(mySlot: Slot): readonly TwoVTwoSlotBadge[] {
  const myTeamId: TeamId = mySlot < 2 ? 'a' : 'b';
  return TWO_V_TWO_SLOTS.map((slot) => {
    const teamId: TeamId = slot < 2 ? 'a' : 'b';
    return {
      slot,
      teamId,
      label: slotLabel(slot),
      shape: TWO_V_TWO_SLOT_SHAPES[slot],
      isYou: slot === mySlot,
      isAlly: teamId === myTeamId && slot !== mySlot,
    };
  });
}

/** Compact badge copy that cannot spill into the adjacent 46px badge. */
export function formatTwoVTwoSlotBadge(badge: TwoVTwoSlotBadge): string {
  return badge.isYou
    ? `${badge.label} ${badge.shape}\n★ YOU`
    : `${badge.label} ${badge.shape}`;
}

export interface TwoVTwoBadgeLayout {
  center: { x: number; y: number };
  bounds: Rect;
}

export interface TwoVTwoHudLayoutResult {
  /** Four slot badges ordered A1, A2, B1, B2 (left to right). */
  badges: readonly TwoVTwoBadgeLayout[];
  /** Right-aligned clock pill, cleared of the menu hit zone. */
  clockPill: TwoVTwoBadgeLayout;
  /** Compact teammate banner strip below the dominance bar. */
  teammateBanner: { center: { x: number; y: number }; bounds: Rect };
  /** Max characters of name the banner can hold; caller truncates. */
  teammateBannerMaxChars: number;
}

// Geometry constants. The header is 70px tall: pills occupy y 8..32, the
// dominance bar y 43..57, and the bottom border line starts at y ~69. The
// banner strip lives in the 58..68 band so it touches neither.
export const TWO_V_TWO_BADGE_Y = 20;
export const TWO_V_TWO_BADGE_HEIGHT = 24;
export const TWO_V_TWO_BADGE_WIDTH = 46;
export const TWO_V_TWO_BADGE_GAP = 4;
export const TWO_V_TWO_CLOCK_WIDTH = 68;
export const TWO_V_TWO_BANNER_Y = 63;
export const TWO_V_TWO_BANNER_HEIGHT = 10;

/**
 * Computes the 2v2 header geometry: the four slot badges (left-aligned
 * where the trophy/coin pills used to be — casual matches never stake
 * them), a right-aligned clock pill, and the teammate banner strip.
 *
 * Structural invariants (checked, not assumed): badges never intersect the
 * 44x44 menu hit zone or the clock pill, stay >= 40x20, and the banner
 * stays clear of the dominance bar band. At 360px the strip ends at x=206
 * and the clock starts at x=244, so the tightest supported viewport passes.
 */
export function computeTwoVTwoHudLayout(
  screenWidth: number,
  menuHitBounds: Rect,
  originX: number = 0
): TwoVTwoHudLayoutResult {
  const badgeCount = TWO_V_TWO_SLOTS.length;
  const stripStartX = originX + 10;
  const badges: TwoVTwoBadgeLayout[] = [];
  for (let index = 0; index < badgeCount; index++) {
    const x = stripStartX + index * (TWO_V_TWO_BADGE_WIDTH + TWO_V_TWO_BADGE_GAP);
    badges.push({
      center: { x: x + TWO_V_TWO_BADGE_WIDTH / 2, y: TWO_V_TWO_BADGE_Y },
      bounds: {
        x,
        y: TWO_V_TWO_BADGE_Y - TWO_V_TWO_BADGE_HEIGHT / 2,
        width: TWO_V_TWO_BADGE_WIDTH,
        height: TWO_V_TWO_BADGE_HEIGHT,
      },
    });
  }

  // Clock pill right-aligned against the menu hit zone (2px clearance).
  const clockStartX = menuHitBounds.x - 2 - TWO_V_TWO_CLOCK_WIDTH;
  const clockPill: TwoVTwoBadgeLayout = {
    center: { x: clockStartX + TWO_V_TWO_CLOCK_WIDTH / 2, y: TWO_V_TWO_BADGE_Y },
    bounds: {
      x: clockStartX,
      y: TWO_V_TWO_BADGE_Y - TWO_V_TWO_BADGE_HEIGHT / 2,
      width: TWO_V_TWO_CLOCK_WIDTH,
      height: TWO_V_TWO_BADGE_HEIGHT,
    },
  };

  const bannerBounds: Rect = {
    x: originX,
    y: TWO_V_TWO_BANNER_Y - TWO_V_TWO_BANNER_HEIGHT / 2,
    width: screenWidth,
    height: TWO_V_TWO_BANNER_HEIGHT,
  };

  // Structural invariants. These are cheap deterministic checks so a bad
  // viewport can never produce overlapping HUD elements in production.
  for (const badge of badges) {
    if (rectanglesIntersect(badge.bounds, menuHitBounds)) {
      throw new Error('2v2_hud_layout_invalid:badge_overlaps_menu_hit');
    }
    if (rectanglesIntersect(badge.bounds, clockPill.bounds)) {
      throw new Error('2v2_hud_layout_invalid:badge_overlaps_clock');
    }
    if (badge.bounds.width < 40 || badge.bounds.height < 20) {
      throw new Error('2v2_hud_layout_invalid:badge_too_small');
    }
  }
  if (
    rectanglesIntersect(bannerBounds, {
      x: originX,
      y: 43,
      width: screenWidth,
      height: 14,
    })
  ) {
    throw new Error('2v2_hud_layout_invalid:banner_overlaps_dominance_bar');
  }

  return {
    badges,
    clockPill,
    teammateBanner: {
      center: { x: originX + screenWidth / 2, y: TWO_V_TWO_BANNER_Y },
      bounds: bannerBounds,
    },
    teammateBannerMaxChars: 24,
  };
}

/**
 * Teammate banner copy: shape glyph + ally slot label + name + shared-base
 * note. The name is truncated by the caller; this function only formats.
 */
export function formatTeammateBanner(
  ally: TwoVTwoSlotBadge,
  allyName: string,
  formattedName: string
): string {
  const name = (formattedName || allyName || 'Ally').trim() || 'Ally';
  return `${ally.shape} ${ally.label} · Ally: ${name} · shared bases`;
}

/** The shared-territory cue glyph drawn on team-owned fortresses. */
export const TWO_V_TWO_SHARED_CUE_GLYPH = '⧉';

/**
 * Extracts the slot from a version-2 marching-army id
 * (`2v2_<tick>_<serverSeq>_<slot>_<clientSeq>`). Returns null for anything
 * that is not exactly that shape, so 1v1 army ids and predictions never
 * attribute to a slot.
 */
export function slotFromTwoVTwoArmyId(armyId: string): Slot | null {
  if (!armyId.startsWith('2v2_')) return null;
  const parts = armyId.split('_');
  if (parts.length !== 5) return null;
  const slot = Number(parts[3]);
  if (!Number.isSafeInteger(slot) || !TWO_V_TWO_SLOTS.includes(slot as Slot)) return null;
  return slot as Slot;
}
