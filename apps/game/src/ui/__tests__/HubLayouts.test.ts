import { describe, expect, it } from 'vitest';
import {
  computeCommanderLayout,
  computeDailyLayout,
  computeKingdomLayout,
  computeLeagueLayout,
  computeTrainingLayout,
} from '../HubLayouts.js';

describe('HubLayouts', () => {
  describe('TrainingLayout', () => {
    it('preserves exact baseline coordinates at 720 logical height', () => {
      const layout = computeTrainingLayout(720);
      expect(layout.cardY).toBe(88);
      expect(layout.cardOffset).toBe(0);
      expect(layout.dotsY).toBe(554);
      expect(layout.navigationButtonsY).toBe(598);
      expect(layout.menuButtonY).toBe(666);
    });

    it('does not compress below 720 logical height', () => {
      expect(computeTrainingLayout(667)).toEqual(computeTrainingLayout(720));
    });

    it('distributes surplus height intentionally and anchors menu button at 867', () => {
      const layout = computeTrainingLayout(867);

      // Card shifts down moderately
      expect(layout.cardY).toBeGreaterThan(88);
      expect(layout.cardOffset).toBe(layout.cardY - 88);

      // Card bottom = cardY + 438
      const cardBottom = layout.cardY + 438;
      expect(layout.dotsY).toBeGreaterThan(cardBottom);

      // Navigation buttons (height 46, center layout.navigationButtonsY)
      const navTop = layout.navigationButtonsY - 23;
      expect(navTop).toBeGreaterThan(layout.dotsY);

      // Menu button (height 44, center layout.menuButtonY)
      const menuTop = layout.menuButtonY - 22;
      const navBottom = layout.navigationButtonsY + 23;
      expect(menuTop).toBeGreaterThan(navBottom);

      // Anchored to bottom: 867 - (menuButtonY + 22) === 32px (matching 720 - 688)
      const menuBottom = layout.menuButtonY + 22;
      expect(867 - menuBottom).toBe(32);
      expect(menuBottom).toBeLessThan(867);
    });
  });

  describe('DailyLayout', () => {
    it('preserves exact baseline coordinates at 720 logical height', () => {
      const layout = computeDailyLayout(720);
      expect(layout.resetTextY).toBe(101);
      expect(layout.statusTextY).toBe(340);
      expect(layout.retryY).toBe(392);
      expect(layout.missionYs).toEqual([174, 291, 408]);
      expect(layout.chestY).toBe(566);
      expect(layout.toastY).toBe(690);
    });

    it('does not compress below 720 logical height', () => {
      expect(computeDailyLayout(667)).toEqual(computeDailyLayout(720));
    });

    it('expands mission card gaps and anchors toast at 867', () => {
      const layout = computeDailyLayout(867);

      expect(layout.resetTextY).toBeGreaterThanOrEqual(101);

      // Mission cards (height 104)
      const mission0Bottom = layout.missionYs[0] + 52;
      const mission1Top = layout.missionYs[1] - 52;
      expect(mission1Top).toBeGreaterThan(mission0Bottom);

      const mission1Bottom = layout.missionYs[1] + 52;
      const mission2Top = layout.missionYs[2] - 52;
      expect(mission2Top).toBeGreaterThan(mission1Bottom);

      // Chest card (height 118)
      const mission2Bottom = layout.missionYs[2] + 52;
      const chestTop = layout.chestY - 59;
      expect(chestTop).toBeGreaterThan(mission2Bottom);

      // Toast (height 42, center layout.toastY)
      const chestBottom = layout.chestY + 59;
      const toastTop = layout.toastY - 21;
      expect(toastTop).toBeGreaterThan(chestBottom);

      // Anchored relative to bottom: 867 - (toastY + 21) === 9px (matching 720 - 711)
      const toastBottom = layout.toastY + 21;
      expect(867 - toastBottom).toBe(9);
      expect(toastBottom).toBeLessThan(867);
    });
  });

  describe('LeagueLayout', () => {
    it('preserves exact baseline coordinates at 720 logical height', () => {
      const layout = computeLeagueLayout(720);
      expect(layout.summaryY).toBe(130);
      expect(layout.roadStartY).toBe(213);
      expect(layout.roadEndY).toBe(554);
      expect(layout.tierYs).toEqual([214, 282, 350, 418, 486, 554]);
      expect(layout.kingdomButtonY).toBe(643);
      expect(layout.toastY).toBe(690);
      expect(layout.statusTextY).toBe(350);
      expect(layout.retryY).toBe(398);
    });

    it('does not compress below 720 logical height', () => {
      expect(computeLeagueLayout(667)).toEqual(computeLeagueLayout(720));
    });

    it('expands tier spacing monotonically and anchors action button at 867', () => {
      const layout = computeLeagueLayout(867);

      // Summary card (height 88)
      const summaryBottom = layout.summaryY + 44;
      const tier0Top = layout.tierYs[0] - 29;
      expect(tier0Top).toBeGreaterThan(summaryBottom);

      // All 6 tiers must be monotonically increasing without overlap
      for (let i = 0; i < 5; i++) {
        const currentBottom = layout.tierYs[i] + 29;
        const nextTop = layout.tierYs[i + 1] - 29;
        expect(nextTop).toBeGreaterThan(currentBottom);
      }

      // Road spans from tier 0 to tier 5
      expect(layout.roadStartY).toBe(layout.tierYs[0] - 1);
      expect(layout.roadEndY).toBe(layout.tierYs[5]);

      // Kingdom button (height 42)
      const tier5Bottom = layout.tierYs[5] + 29;
      const buttonTop = layout.kingdomButtonY - 21;
      expect(buttonTop).toBeGreaterThan(tier5Bottom);

      // Toast (height 42)
      const buttonBottom = layout.kingdomButtonY + 21;
      const toastTop = layout.toastY - 21;
      expect(toastTop).toBeGreaterThan(buttonBottom);

      const toastBottom = layout.toastY + 21;
      expect(867 - toastBottom).toBe(9);
      expect(toastBottom).toBeLessThan(867);
    });
  });

  describe('KingdomLayout', () => {
    it('preserves exact baseline coordinates at 720 logical height', () => {
      const layout = computeKingdomLayout(720);
      expect(layout.panelY).toBe(84);
      expect(layout.gridTop).toBe(166);
      expect(layout.rowGap).toBe(16);
      expect(layout.cardPositions).toEqual([
        { x: 103, y: 290 },
        { x: 297, y: 290 },
        { x: 103, y: 554 },
        { x: 297, y: 554 },
      ]);
      expect(layout.toastY).toBe(690);
    });

    it('does not compress below 720 logical height', () => {
      expect(computeKingdomLayout(667)).toEqual(computeKingdomLayout(720));
    });

    it('expands row gap and anchors toast at 867', () => {
      const layout = computeKingdomLayout(867);

      // Panel (height 70)
      const panelBottom = layout.panelY + 70;
      expect(layout.gridTop).toBeGreaterThan(panelBottom);

      // Row 0 cards (height 248)
      const row0Top = layout.cardPositions[0].y - 124;
      expect(row0Top).toBe(layout.gridTop);
      const row0Bottom = layout.cardPositions[0].y + 124;

      // Row 1 cards (height 248)
      const row1Top = layout.cardPositions[2].y - 124;
      expect(row1Top - row0Bottom).toBe(layout.rowGap);
      expect(layout.rowGap).toBeGreaterThan(16);

      const row1Bottom = layout.cardPositions[2].y + 124;
      const toastTop = layout.toastY - 21;
      expect(toastTop).toBeGreaterThan(row1Bottom);

      const toastBottom = layout.toastY + 21;
      expect(867 - toastBottom).toBe(9);
      expect(toastBottom).toBeLessThan(867);
    });
  });

  describe('CommanderLayout', () => {
    it('preserves exact baseline coordinates at 720 logical height', () => {
      const layout = computeCommanderLayout(720);
      expect(layout.powerBadgeY).toBe(98);
      expect(layout.cardYs).toEqual([188, 345, 502]);
      expect(layout.helperTextY).toBe(681);
      expect(layout.toastY).toBe(650);
    });

    it('does not compress below 720 logical height', () => {
      expect(computeCommanderLayout(667)).toEqual(computeCommanderLayout(720));
    });

    it('spreads cards and anchors helper text and toast at 867', () => {
      const layout = computeCommanderLayout(867);

      expect(layout.powerBadgeY).toBeGreaterThanOrEqual(98);

      // Cards (height 138)
      const card0Top = layout.cardYs[0] - 69;
      expect(card0Top).toBeGreaterThan(layout.powerBadgeY);

      const card0Bottom = layout.cardYs[0] + 69;
      const card1Top = layout.cardYs[1] - 69;
      expect(card1Top).toBeGreaterThan(card0Bottom);

      const card1Bottom = layout.cardYs[1] + 69;
      const card2Top = layout.cardYs[2] - 69;
      expect(card2Top).toBeGreaterThan(card1Bottom);

      // Helper text is anchored 39px from bottom
      expect(867 - layout.helperTextY).toBe(39);

      // Toast sits above helper text
      expect(layout.toastY).toBeLessThan(layout.helperTextY);
      const card2Bottom = layout.cardYs[2] + 69;
      expect(layout.toastY).toBeGreaterThan(card2Bottom);
    });
  });
});
