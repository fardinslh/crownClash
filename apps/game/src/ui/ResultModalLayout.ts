export interface ResultRankPresentation {
  rankY: number;
  showRankSummary: boolean;
  showPromotion: boolean;
}

export function computeResultRankPresentation(rankPromoted: boolean): ResultRankPresentation {
  return {
    rankY: -208,
    showRankSummary: !rankPromoted,
    showPromotion: rankPromoted,
  };
}

// ── 2v2 results grid (docs/2v2-architecture.md Phase 5) ───────────────────
// Pure geometry for the two-team participant grid inside the 330px result
// card. Two rows (one per team) of two participant cards. Deterministic so
// every viewport renders identically in logical coordinates.

export interface TwoVTwoResultCellLayout {
  center: { x: number; y: number };
  width: number;
  height: number;
}

export interface TwoVTwoResultGridLayout {
  /** Row for the local player's team (my team always renders first). */
  myTeamRow: readonly [TwoVTwoResultCellLayout, TwoVTwoResultCellLayout];
  /** Row for the opposing team. */
  otherTeamRow: readonly [TwoVTwoResultCellLayout, TwoVTwoResultCellLayout];
  /** Y of the thin team separator line between the rows. */
  separatorY: number;
  rowLabels: { myTeamY: number; otherTeamY: number };
}

export const TWO_V_TWO_RESULT_CARD_WIDTH = 330;
export const TWO_V_TWO_RESULT_CELL_WIDTH = 140;
export const TWO_V_TWO_RESULT_CELL_HEIGHT = 74;
export const TWO_V_TWO_RESULT_CELL_GAP_X = 10;

/**
 * Computes the 2×2 participant grid for the 2v2 results card.
 *
 * The card is 330x640 centered at (0,0) in modal space. Rows sit between
 * the headline block (ends ~y=-190) and the action buttons (start ~y=120):
 * row 1 centers at y=-140, separator at y=-95, row 2 at y=-44. Cells never
 * exceed the card's inner width (140*2 + 10 = 290 <= 310 inner).
 */
export function computeTwoVTwoResultGrid(): TwoVTwoResultGridLayout {
  const cellOffsetX = TWO_V_TWO_RESULT_CELL_WIDTH / 2 + TWO_V_TWO_RESULT_CELL_GAP_X;
  const makeCell = (x: number, y: number): TwoVTwoResultCellLayout => ({
    center: { x, y },
    width: TWO_V_TWO_RESULT_CELL_WIDTH,
    height: TWO_V_TWO_RESULT_CELL_HEIGHT,
  });

  const myTeamRow: [TwoVTwoResultCellLayout, TwoVTwoResultCellLayout] = [
    makeCell(-cellOffsetX, -140),
    makeCell(cellOffsetX, -140),
  ];
  const otherTeamRow: [TwoVTwoResultCellLayout, TwoVTwoResultCellLayout] = [
    makeCell(-cellOffsetX, -44),
    makeCell(cellOffsetX, -44),
  ];

  return {
    myTeamRow,
    otherTeamRow,
    separatorY: -95,
    rowLabels: { myTeamY: -184, otherTeamY: -88 },
  };
}
