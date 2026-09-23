import { describe, expect, it } from 'vitest';
import {
  computeTwoVTwoHudLayout,
  computeTwoVTwoSlotBadges,
  formatTeammateBanner,
  formatTwoVTwoSlotBadge,
  slotFromTwoVTwoArmyId,
  slotLabel,
  TWO_V_TWO_BADGE_GAP,
  TWO_V_TWO_BADGE_HEIGHT,
  TWO_V_TWO_BADGE_WIDTH,
  TWO_V_TWO_SLOT_SHAPES,
} from '../TwoVTwoHudLayout.js';
import { computeHudLayout } from '../HudLayout.js';

/** Menu hit zone exactly as computeHudLayout emits it (44x44 at right). */
function menuHitFor(screenWidth: number, originX = 0) {
  return computeHudLayout(screenWidth, 50, { originX }).menuButton.hitBounds;
}

describe('2v2 slot identity', () => {
  it('labels slots A1/A2/B1/B2', () => {
    expect(slotLabel(0)).toBe('A1');
    expect(slotLabel(1)).toBe('A2');
    expect(slotLabel(2)).toBe('B1');
    expect(slotLabel(3)).toBe('B2');
  });

  it('gives every slot a distinct shape glyph', () => {
    const shapes = Object.values(TWO_V_TWO_SLOT_SHAPES);
    expect(new Set(shapes).size).toBe(4);
  });

  it('marks you and ally relative to the local slot', () => {
    for (const mySlot of [0, 1, 2, 3] as const) {
      const badges = computeTwoVTwoSlotBadges(mySlot);
      expect(badges).toHaveLength(4);
      const you = badges.filter((badge) => badge.isYou);
      const ally = badges.filter((badge) => badge.isAlly);
      expect(you).toHaveLength(1);
      expect(ally).toHaveLength(1);
      expect(you[0].slot).toBe(mySlot);
      // Same team, different slot.
      expect(ally[0].slot < 2).toBe(mySlot < 2);
      expect(ally[0].slot).not.toBe(mySlot);
      // Two teams of two.
      expect(badges.filter((badge) => badge.teamId === 'a')).toHaveLength(2);
      expect(badges.filter((badge) => badge.teamId === 'b')).toHaveLength(2);
    }
  });

  it('keeps the YOU marker on a compact second line', () => {
    const badges = computeTwoVTwoSlotBadges(1);
    expect(formatTwoVTwoSlotBadge(badges[0])).toBe('A1 ●');
    expect(formatTwoVTwoSlotBadge(badges[1])).toBe('A2 ▲\n★ YOU');
  });
});

describe('2v2 HUD layout invariants', () => {
  for (const width of [360, 390, 430]) {
    it(`fits at ${width}px width: badges clear clock and menu hit`, () => {
      const menuHit = menuHitFor(width);
      const layout = computeTwoVTwoHudLayout(width, menuHit);

      expect(layout.badges).toHaveLength(4);
      for (const badge of layout.badges) {
        expect(badge.bounds.width).toBe(TWO_V_TWO_BADGE_WIDTH);
        expect(badge.bounds.height).toBe(TWO_V_TWO_BADGE_HEIGHT);
        expect(badge.bounds.x + badge.bounds.width).toBeLessThanOrEqual(menuHit.x - 2);
        expect(badge.bounds.y).toBeGreaterThanOrEqual(0);
        expect(badge.bounds.y + badge.bounds.height).toBeLessThanOrEqual(43);
      }

      // Positive gap between consecutive badges.
      for (let i = 1; i < layout.badges.length; i++) {
        const gap = layout.badges[i].bounds.x - (layout.badges[i - 1].bounds.x + TWO_V_TWO_BADGE_WIDTH);
        expect(gap).toBe(TWO_V_TWO_BADGE_GAP);
      }

      // Clock pill right-aligned with clearance to the menu hit zone.
      expect(layout.clockPill.bounds.x + layout.clockPill.bounds.width).toBeLessThanOrEqual(menuHit.x - 2);
      // Clock never overlaps the badge strip.
      expect(layout.clockPill.bounds.x).toBeGreaterThan(
        layout.badges[3].bounds.x + layout.badges[3].bounds.width
      );

      // Banner sits between dominance bar (ends 57) and border (~69).
      expect(layout.teammateBanner.bounds.y).toBeGreaterThanOrEqual(57);
      expect(layout.teammateBanner.bounds.y + layout.teammateBanner.bounds.height).toBeLessThanOrEqual(69);
    });
  }

  it('throws on a width too narrow to hold the strip', () => {
    // A 200px screen cannot fit badges + clock + menu without overlap.
    const menuHit = menuHitFor(200);
    expect(() => computeTwoVTwoHudLayout(200, menuHit)).toThrow();
  });
});

describe('teammate banner copy', () => {
  it('formats shape, label, name and shared-base note', () => {
    const badges = computeTwoVTwoSlotBadges(1);
    const ally = badges.find((badge) => badge.isAlly)!;
    expect(formatTeammateBanner(ally, 'Commander_1234', 'Cmdr 1234')).toBe(
      '● A1 · Ally: Cmdr 1234 · shared bases'
    );
  });

  it('falls back to Ally when the name is blank', () => {
    const badges = computeTwoVTwoSlotBadges(0);
    const ally = badges.find((badge) => badge.isAlly)!;
    expect(formatTeammateBanner(ally, '', '')).toContain('Ally: Ally');
  });
});

describe('slot attribution from army ids', () => {
  it('parses the slot from version-2 army ids', () => {
    expect(slotFromTwoVTwoArmyId('2v2_12_34_0_5')).toBe(0);
    expect(slotFromTwoVTwoArmyId('2v2_12_34_1_0')).toBe(1);
    expect(slotFromTwoVTwoArmyId('2v2_12_34_2_9')).toBe(2);
    expect(slotFromTwoVTwoArmyId('2v2_12_34_3_1')).toBe(3);
  });

  it('rejects 1v1 ids, predictions and malformed ids', () => {
    expect(slotFromTwoVTwoArmyId('pred_0')).toBeNull();
    expect(slotFromTwoVTwoArmyId('army_1_2')).toBeNull();
    expect(slotFromTwoVTwoArmyId('2v2_1_2_7_3')).toBeNull(); // slot out of range
    expect(slotFromTwoVTwoArmyId('2v2_1_2_x_3')).toBeNull(); // not an integer
    expect(slotFromTwoVTwoArmyId('2v2_1_2_3')).toBeNull(); // wrong arity
    expect(slotFromTwoVTwoArmyId('2v2_1_2_3_4_5')).toBeNull();
    expect(slotFromTwoVTwoArmyId('')).toBeNull();
  });
});
