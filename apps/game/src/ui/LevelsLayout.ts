import { LOGICAL_WIDTH } from '@crown-clash/game-core';

export interface LevelCardLayout {
  readonly x: number;
  readonly y: number;
}

export interface LevelsLayout {
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly cards: readonly LevelCardLayout[];
  readonly progressY: number;
  /** Centre of the Weekly Challenge entry button under the grid. */
  readonly weeklyY: number;
  readonly weeklyHeight: number;
  readonly statusY: number;
  readonly toastY: number;
}

const COLUMNS = 2;
const CARD_WIDTH = 168;
const COLUMN_GAP = 12;
const HEADER_BOTTOM = 96;
const WEEKLY_HEIGHT = 48;
/** Progress line (28) plus the weekly button and its gaps. */
const BOTTOM_MARGIN = 28 + WEEKLY_HEIGHT + 32;
const MAX_ROW_PITCH = 96;
const MIN_CARD_HEIGHT = 56;
const ROW_GAP = 10;

/**
 * Two columns, level 1 at the top right (RTL reading order). Rows share the
 * height between the header and the bottom margin, so ten cards fit without
 * scrolling on a 640px-tall viewport and spread out on taller phones. The
 * Weekly Challenge button sits in the bottom margin, below the progress line.
 */
export function computeLevelsLayout(levelCount: number, visibleHeight: number): LevelsLayout {
  const rows = Math.max(1, Math.ceil(levelCount / COLUMNS));
  const available = Math.max(0, visibleHeight - HEADER_BOTTOM - BOTTOM_MARGIN);
  const pitch = Math.min(MAX_ROW_PITCH, Math.max(MIN_CARD_HEIGHT + ROW_GAP, available / rows));
  const cardHeight = pitch - ROW_GAP;
  const columnOffset = (CARD_WIDTH + COLUMN_GAP) / 2;
  const cards: LevelCardLayout[] = [];
  for (let index = 0; index < levelCount; index++) {
    const row = Math.floor(index / COLUMNS);
    const column = index % COLUMNS;
    cards.push({
      // RTL: column 0 is the right-hand one.
      x: LOGICAL_WIDTH / 2 + (column === 0 ? columnOffset : -columnOffset),
      y: HEADER_BOTTOM + row * pitch + cardHeight / 2,
    });
  }
  const gridBottom = HEADER_BOTTOM + rows * pitch;
  return {
    cardWidth: CARD_WIDTH,
    cardHeight,
    cards,
    progressY: Math.min(visibleHeight - WEEKLY_HEIGHT - 44, gridBottom + 14),
    weeklyY: visibleHeight - 20 - WEEKLY_HEIGHT / 2,
    weeklyHeight: WEEKLY_HEIGHT,
    statusY: HEADER_BOTTOM + available / 2,
    toastY: visibleHeight - WEEKLY_HEIGHT - 60,
  };
}
