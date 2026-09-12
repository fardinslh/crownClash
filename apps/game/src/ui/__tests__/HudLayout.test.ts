import { describe, expect, it } from 'vitest';
import {
  computeHudLayout,
  fitTextToWidth,
  formatCompactNumber,
  formatDominancePercentages,
  formatHudCoins,
  formatHudName,
  formatHudTrophies,
  getPillMaxContentWidth,
  measureHudTextWidth,
  rectanglesIntersect,
  type Rect,
} from '../HudLayout.js';

describe('HudLayout', () => {
  const TEST_PORTRAIT_WIDTHS = [360, 375, 390, 400, 412, 430];

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

  describe('Text measurement and truncation helpers', () => {
    it('measures text width with proportional metrics', () => {
      expect(measureHudTextWidth('')).toBe(0);
      const shortWidth = measureHudTextWidth('ABC');
      const longWidth = measureHudTextWidth('ABCDEFGHIJKLM');
      expect(shortWidth).toBeGreaterThan(0);
      expect(longWidth).toBeGreaterThan(shortWidth);
    });

    it('fitTextToWidth preserves text when within maxWidth', () => {
      const text = 'Short';
      const fitted = fitTextToWidth(text, 100);
      expect(fitted).toBe(text);
    });

    it('fitTextToWidth truncates and appends ellipsis when exceeding maxWidth', () => {
      const text = 'A Very Long Commander Name That Definitely Exceeds Pill';
      const maxWidth = 50;
      const fitted = fitTextToWidth(text, maxWidth);
      expect(fitted.endsWith('…')).toBe(true);
      expect(measureHudTextWidth(fitted)).toBeLessThanOrEqual(maxWidth);
    });

    it('fitTextToWidth handles Unicode multi-byte characters safely without corruption', () => {
      const text = '👑⚔️🛡️🔥🌟💫⚡️✨';
      const maxWidth = 45;
      const fitted = fitTextToWidth(text, maxWidth);
      expect(measureHudTextWidth(fitted)).toBeLessThanOrEqual(maxWidth);
      expect(fitted.endsWith('…')).toBe(true);
    });

    it('formatCompactNumber formats values correctly', () => {
      expect(formatCompactNumber(0)).toBe('0');
      expect(formatCompactNumber(175)).toBe('175');
      expect(formatCompactNumber(9999)).toBe('9999');
      expect(formatCompactNumber(12500)).toBe('12.5k');
      expect(formatCompactNumber(250000)).toBe('250k');
      expect(formatCompactNumber(1500000)).toBe('1.5M');
    });
  });

  describe('HUD Label Formatting and Content Containment', () => {
    it('formats Commander_9960 with 🔴 prefix to fit inside opponent pill content width', () => {
      // 68px pill has 58px content width; 72px pill has 62px content width
      const maxContentWidth = 58;
      const formatted = formatHudName('Commander_9960', maxContentWidth, '🔴 ');

      expect(formatted.startsWith('🔴 Cmdr')).toBe(true);
      expect(formatted.endsWith('…')).toBe(true);
      const measured = measureHudTextWidth(formatted);
      expect(measured).toBeLessThanOrEqual(maxContentWidth);
    });

    it('handles empty or whitespace names gracefully', () => {
      const playerFallback = formatHudName('', 80, '🔵 ');
      expect(playerFallback).toBe('🔵 Player');
      expect(measureHudTextWidth(playerFallback)).toBeLessThanOrEqual(80);

      const opponentFallback = formatHudName('   ', 80, '🔴 ');
      expect(opponentFallback).toBe('🔴 Opponent');
      expect(measureHudTextWidth(opponentFallback)).toBeLessThanOrEqual(80);

      const constrainedOpponent = formatHudName('   ', 58, '🔴 ');
      expect(constrainedOpponent.startsWith('🔴 Opp')).toBe(true);
      expect(constrainedOpponent.endsWith('…')).toBe(true);
      expect(measureHudTextWidth(constrainedOpponent)).toBeLessThanOrEqual(58);
    });

    it('formats Persian names within content bounds', () => {
      const maxContentWidth = 58;
      const persianName = 'علیرضا رضایی پور';
      const formatted = formatHudName(persianName, maxContentWidth, '🔵 ');
      expect(measureHudTextWidth(formatted)).toBeLessThanOrEqual(maxContentWidth);
      expect(formatted.endsWith('…')).toBe(true);
    });

    it('formats CJK names within content bounds', () => {
      const maxContentWidth = 58;
      const cjkName = '征服者王最高司令官';
      const formatted = formatHudName(cjkName, maxContentWidth, '🔴 ');
      expect(measureHudTextWidth(formatted)).toBeLessThanOrEqual(maxContentWidth);
      expect(formatted.endsWith('…')).toBe(true);
    });

    it('formats coin counts within coin pill content bounds', () => {
      const maxContentWidth = 58;
      expect(measureHudTextWidth(formatHudCoins(175, maxContentWidth))).toBeLessThanOrEqual(maxContentWidth);
      expect(measureHudTextWidth(formatHudCoins(12500, maxContentWidth))).toBeLessThanOrEqual(maxContentWidth);
      expect(measureHudTextWidth(formatHudCoins(1500000, maxContentWidth))).toBeLessThanOrEqual(maxContentWidth);
    });

    it('formats trophy counts within trophy pill content bounds', () => {
      const maxContentWidth = 46; // 56px pill - 10px padding = 46px
      expect(measureHudTextWidth(formatHudTrophies(18, maxContentWidth))).toBeLessThanOrEqual(maxContentWidth);
      expect(measureHudTextWidth(formatHudTrophies(4500, maxContentWidth))).toBeLessThanOrEqual(maxContentWidth);
      expect(measureHudTextWidth(formatHudTrophies(99999, maxContentWidth))).toBeLessThanOrEqual(maxContentWidth);
    });
  });

  describe('Mobile Portrait Viewports HUD Geometry and Containment', () => {
    TEST_PORTRAIT_WIDTHS.forEach((width) => {
      ['Bot Match' as const, 'Live PvP' as const].forEach((modeName) => {
        const isLiveMode = modeName === 'Live PvP';

        describe(`Viewport width: ${width}px (${modeName})`, () => {
          it('asserts the visible menu rectangle does NOT intersect the dominance bar', () => {
            const layout = computeHudLayout(width, 50, { isLiveMode });

            const menuVis = layout.menuButton.visibleBounds;
            const domBounds = layout.dominanceBar.bounds;

            const intersects = rectanglesIntersect(menuVis, domBounds);
            expect(intersects).toBe(false);

            const verticalClearance = domBounds.y - (menuVis.y + menuVis.height);
            expect(verticalClearance).toBeGreaterThanOrEqual(10);
          });

          it('preserves a minimum 44x44 interactive touch target', () => {
            const layout = computeHudLayout(width, 50, { isLiveMode });
            const hitBounds = layout.menuButton.hitBounds;

            expect(hitBounds.width).toBeGreaterThanOrEqual(44);
            expect(hitBounds.height).toBeGreaterThanOrEqual(44);
          });

          it('asserts the 44x44 interactive touch target does NOT intersect the dominance bar', () => {
            const layout = computeHudLayout(width, 50, { isLiveMode });

            const menuHit = layout.menuButton.hitBounds;
            const domBounds = layout.dominanceBar.bounds;

            const intersects = rectanglesIntersect(menuHit, domBounds);
            expect(intersects).toBe(false);

            const clearance = domBounds.y - (menuHit.y + menuHit.height);
            expect(clearance).toBeGreaterThanOrEqual(1);
          });

          it('keeps icon and hit target strictly centered and aligned', () => {
            const layout = computeHudLayout(width, 50, { isLiveMode });

            const center = layout.menuButton.center;
            const vis = layout.menuButton.visibleBounds;
            const hit = layout.menuButton.hitBounds;

            expect(vis.x + vis.width / 2).toBeCloseTo(center.x);
            expect(vis.y + vis.height / 2).toBeCloseTo(center.y);

            expect(hit.x + hit.width / 2).toBeCloseTo(center.x);
            expect(hit.y + hit.height / 2).toBeCloseTo(center.y);
          });

          it('asserts Row 1 pills do not collide with each other or the menu hit area', () => {
            const layout = computeHudLayout(width, 50, { isLiveMode });

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
              expect(next.x - (current.x + current.width)).toBeGreaterThanOrEqual(5);
            }

            // Clock pill must not intersect menu hit zone
            const clockPill = layout.clockPill.visibleBounds;
            const menuHit = layout.menuButton.hitBounds;
            expect(rectanglesIntersect(clockPill, menuHit)).toBe(false);
            expect(menuHit.x).toBeGreaterThanOrEqual(clockPill.x + clockPill.width);
          });

          it('asserts all 4 HUD labels fit strictly inside their respective pill content bounds', () => {
            const layout = computeHudLayout(width, 60, { isLiveMode });

            // 1. Player label
            const playerContentWidth = getPillMaxContentWidth(layout.playerPill.visibleBounds.width);
            const playerLabel = formatHudName('Commander_1234', playerContentWidth, '🔵 ');
            const playerMeasured = measureHudTextWidth(playerLabel);
            expect(playerMeasured).toBeLessThanOrEqual(playerContentWidth);

            // 2. Trophy label
            const trophyContentWidth = getPillMaxContentWidth(layout.trophyPill.visibleBounds.width);
            const trophyLabel = formatHudTrophies(1850, trophyContentWidth);
            const trophyMeasured = measureHudTextWidth(trophyLabel);
            expect(trophyMeasured).toBeLessThanOrEqual(trophyContentWidth);

            // 3. Coin / Opponent label
            const coinContentWidth = getPillMaxContentWidth(layout.coinPill.visibleBounds.width);
            const coinOrOpponentLabel = isLiveMode
              ? formatHudName('Commander_9960', coinContentWidth, '🔴 ')
              : formatHudCoins(50000, coinContentWidth);
            const coinMeasured = measureHudTextWidth(coinOrOpponentLabel);
            expect(coinMeasured).toBeLessThanOrEqual(coinContentWidth);

            // 4. Timer label (⏱ 01:30)
            const clockContentWidth = getPillMaxContentWidth(layout.clockPill.visibleBounds.width);
            const timerMeasured = measureHudTextWidth('⏱ 01:30', { fontSize: 12, mono: true });
            expect(timerMeasured).toBeLessThanOrEqual(clockContentWidth);
          });
        });
      });
    });
  });

  describe('formatDominancePercentages', () => {
    it('never displays plain 0% for enemy while enemy armies remain', () => {
      const result = formatDominancePercentages({
        playerStrength: 250,
        enemyStrength: 2,
        neutralStrength: 0,
        playerArmiesCount: 0,
        enemyArmiesCount: 1,
        enemyTerritoriesCount: 0,
      });

      expect(result.enemyDomText).not.toBe('0%');
      expect(result.enemyDomText).toMatch(/^<?1%$/);
      expect(result.enemyPct).toBeGreaterThanOrEqual(1);
      expect(result.playerPct).toBeLessThanOrEqual(99);
      expect(result.isLastEnemyArmy).toBe(true);
    });

    it('identifies last enemy army state only when enemy has 0 territories and >0 armies', () => {
      const withTerritories = formatDominancePercentages({
        playerStrength: 100,
        enemyStrength: 30,
        neutralStrength: 20,
        playerArmiesCount: 0,
        enemyArmiesCount: 1,
        enemyTerritoriesCount: 1,
      });
      expect(withTerritories.isLastEnemyArmy).toBe(false);

      const lastArmy = formatDominancePercentages({
        playerStrength: 150,
        enemyStrength: 5,
        neutralStrength: 0,
        playerArmiesCount: 0,
        enemyArmiesCount: 1,
        enemyTerritoriesCount: 0,
      });
      expect(lastArmy.isLastEnemyArmy).toBe(true);
    });

    it('reports 0% for enemy when all enemy presence is completely eliminated', () => {
      const result = formatDominancePercentages({
        playerStrength: 200,
        enemyStrength: 0,
        neutralStrength: 0,
        playerArmiesCount: 0,
        enemyArmiesCount: 0,
        enemyTerritoriesCount: 0,
      });

      expect(result.enemyDomText).toBe('0%');
      expect(result.enemyPct).toBe(0);
      expect(result.playerDomText).toBe('100%');
      expect(result.playerPct).toBe(100);
      expect(result.isLastEnemyArmy).toBe(false);
    });

    it('formats normal mid-match dominance accurately', () => {
      const result = formatDominancePercentages({
        playerStrength: 100,
        enemyStrength: 100,
        neutralStrength: 100,
        playerArmiesCount: 1,
        enemyArmiesCount: 1,
        enemyTerritoriesCount: 2,
      });

      expect(result.playerDomText).toBe('33%');
      expect(result.enemyDomText).toBe('33%');
      expect(result.neutralPct).toBe(34);
      expect(result.isLastEnemyArmy).toBe(false);
    });
  });
});
