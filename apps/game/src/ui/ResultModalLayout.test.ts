import { describe, expect, it } from 'vitest';
import {
  computeResultRankPresentation,
  computeTwoVTwoResultGrid,
  TWO_V_TWO_RESULT_CELL_WIDTH,
} from './ResultModalLayout.js';

describe('result modal rank presentation', () => {
  it('shows only the normal rank summary without a promotion', () => {
    expect(computeResultRankPresentation(false)).toEqual({
      rankY: -208,
      showRankSummary: true,
      showPromotion: false,
    });
  });

  it('replaces the normal rank summary with the promotion banner', () => {
    expect(computeResultRankPresentation(true)).toEqual({
      rankY: -208,
      showRankSummary: false,
      showPromotion: true,
    });
  });
});

describe('2v2 result grid', () => {
  it('lays out two rows of two cells inside the 330px card', () => {
    const grid = computeTwoVTwoResultGrid();
    expect(grid.myTeamRow).toHaveLength(2);
    expect(grid.otherTeamRow).toHaveLength(2);

    for (const cell of [...grid.myTeamRow, ...grid.otherTeamRow]) {
      expect(cell.width).toBe(TWO_V_TWO_RESULT_CELL_WIDTH);
      // Cells stay inside the card's inner width (330 - 2*10 margin).
      expect(Math.abs(cell.center.x) + cell.width / 2).toBeLessThanOrEqual(165);
      // Cells stay between the headline block and the action buttons.
      expect(cell.center.y).toBeGreaterThan(-190);
      expect(cell.center.y).toBeLessThan(120);
    }

    // Rows are separated and ordered (my team on top).
    expect(grid.myTeamRow[0].center.y).toBeLessThan(grid.separatorY);
    expect(grid.otherTeamRow[0].center.y).toBeGreaterThan(grid.separatorY);
    expect(grid.rowLabels.myTeamY).toBeLessThan(grid.myTeamRow[0].center.y);
    expect(grid.rowLabels.otherTeamY).toBeLessThan(grid.otherTeamRow[0].center.y);
  });

  it('is deterministic across calls', () => {
    expect(computeTwoVTwoResultGrid()).toEqual(computeTwoVTwoResultGrid());
  });
});
