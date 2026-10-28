import { LANE_LEVELS } from '@crown-clash/game-core';

/** Best lane battle won on this device (client-local beta). */
export const LANE_PROGRESS_KEY = 'crown_clash_lane_progress';

export function bestLaneLevelWon(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): number {
  try {
    const value = Number(storage?.getItem(LANE_PROGRESS_KEY));
    return Number.isInteger(value) && value >= 0 && value <= LANE_LEVELS.length ? value : 0;
  } catch {
    return 0;
  }
}

/** The first lane battle not yet won, or the last one once all are won. */
export function nextLaneLevelId(storage?: Pick<Storage, 'getItem'>): number {
  return Math.min(LANE_LEVELS.length, bestLaneLevelWon(storage) + 1);
}

function safeStorage(): Storage | undefined {
  try { return typeof window !== 'undefined' ? window.localStorage : undefined; } catch { return undefined; }
}
