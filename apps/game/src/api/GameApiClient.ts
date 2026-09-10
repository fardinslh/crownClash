import type {
  DailyClaimResult,
  DailyRewardType,
  DailyState,
  EconomyLedgerEntry,
  LeagueClaimResult,
  LeagueState,
  MatchSettlement,
  PlayerCareer,
  PvpAction,
  UpgradePurchaseResult,
  UpgradeType,
} from '@crown-clash/game-core';
import type { PlatformAdapter } from '@crown-clash/platform';
import type { LiveMatchClient } from './LiveMatchClient.js';
import type { AnalyticsEvent } from '../analytics/Analytics.js';

export type TrackedAnalyticsEvent = AnalyticsEvent;

/**
 * Career and economy API surface consumed by CareerManager.
 *
 * Async PvP raid methods were removed when the project moved to live-only
 * PvP. Single-player bot matches are still settled via settleMatch.
 */
export interface CareerApi {
  login(platform: PlatformAdapter): Promise<PlayerCareer>;
  getCareer(): Promise<PlayerCareer>;
  getLedger(limit?: number): Promise<EconomyLedgerEntry[]>;
  settleMatch(matchId: string, actions: readonly PvpAction[]): Promise<MatchSettlement>;
  purchaseUpgrade(type: UpgradeType, purchaseId: string): Promise<UpgradePurchaseResult>;
  getDailyState(): Promise<DailyState>;
  claimDailyReward(type: DailyRewardType, claimId: string): Promise<DailyClaimResult>;
  getLeagueState(): Promise<LeagueState>;
  claimLeagueReward(rankId: string, claimId: string): Promise<LeagueClaimResult>;
  trackEvents(events: readonly TrackedAnalyticsEvent[]): Promise<void>;
  openLiveMatch(): LiveMatchClient;
  isAuthenticated(): boolean;
}

export class GameApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export function isLocalCareerFallbackAllowed(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_ALLOW_LOCAL_FALLBACK !== 'false';
}
