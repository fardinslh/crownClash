import type { DailyRewardType, DailyState } from './types.js';
import type { EconomyLedgerEntry, PlayerCareer } from './progression.js';

export type DailyClaimFailureReason = 'not_complete' | 'already_claimed' | 'chest_locked';

export interface DailyClaimResult {
  claimId: string;
  success: boolean;
  reason?: DailyClaimFailureReason;
  rewardType: DailyRewardType;
  reward: number;
  replayed: boolean;
  state: DailyState;
  newCareer: PlayerCareer;
  ledgerEntry?: EconomyLedgerEntry;
}

export function formatDailyReset(resetsAt: number, now = Date.now()): string {
  const remainingSeconds = Math.max(0, Math.ceil((resetsAt - now) / 1000));
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
