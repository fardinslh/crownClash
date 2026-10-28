export interface WeeklyLayout {
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly cardYs: readonly number[];
  readonly countdownY: number;
  readonly statusY: number;
  readonly toastY: number;
}

const CARD_WIDTH = 344;
const COUNTDOWN_Y = 104;
const CARDS_TOP = 132;
const BOTTOM_MARGIN = 48;
const MAX_CARD_HEIGHT = 128;
const MIN_CARD_HEIGHT = 84;
const GAP = 14;

/** Cards stack top to bottom (Bronze, Silver, Gold) and share the height below the countdown. */
export function computeWeeklyLayout(slotCount: number, visibleHeight: number): WeeklyLayout {
  const rows = Math.max(1, slotCount);
  const available = Math.max(0, visibleHeight - CARDS_TOP - BOTTOM_MARGIN);
  const cardHeight = Math.min(MAX_CARD_HEIGHT, Math.max(MIN_CARD_HEIGHT, (available - GAP * (rows - 1)) / rows));
  const cardYs: number[] = [];
  for (let index = 0; index < slotCount; index++) cardYs.push(CARDS_TOP + index * (cardHeight + GAP) + cardHeight / 2);
  return { cardWidth: CARD_WIDTH, cardHeight, cardYs, countdownY: COUNTDOWN_Y, statusY: CARDS_TOP + available / 2, toastY: visibleHeight - 40 };
}

/** Whole days, hours and minutes left, never negative. */
export function splitTimeLeft(ms: number): { days: number; hours: number; minutes: number } {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  return { days: Math.floor(totalMinutes / 1440), hours: Math.floor((totalMinutes % 1440) / 60), minutes: totalMinutes % 60 };
}
