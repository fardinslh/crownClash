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
  CommanderId,
  CommanderSelectionResult,
  BotMatchTicket,
} from '@crown-clash/game-core';
import type { PlatformAdapter } from '@crown-clash/platform';
import type { LiveMatchClient } from './LiveMatchClient.js';
import type { AnalyticsEvent } from '../analytics/Analytics.js';

export type TrackedAnalyticsEvent = AnalyticsEvent;

/**
 * Outcome of reporting a won campaign level. `success` is false when the server
 * could not verify the win (replay mismatch) or the level is locked; `reward` is
 * the server-paid first-clear coins (0 for a repeat clear).
 */
export interface LevelClearResult {
  readonly success: boolean;
  readonly reason?: string;
  readonly levelsCompleted: number;
  readonly reward: number;
  readonly claimId: string;
  readonly newCareer?: PlayerCareer;
  readonly ledgerEntry?: EconomyLedgerEntry;
}

/**
 * Client-observed match status sent with a bot settlement request.
 * Diagnostic-only and untrusted: the server always derives the
 * authoritative status and rewards independently.
 */
export type ClientObservedStatus = 'victory' | 'defeat' | 'draw';

/**
 * Career and economy API surface consumed by CareerManager.
 *
 * Async PvP raid methods were removed when the project moved to live-only
 * PvP. Single-player bot matches are still settled via settleMatch.
 */
export interface CareerApi {
  pilotRequest?<T>(method: string, payload?: unknown): Promise<T>;
  login(platform: PlatformAdapter): Promise<PlayerCareer>;
  getCareer(): Promise<PlayerCareer>;
  getLedger(limit?: number): Promise<EconomyLedgerEntry[]>;
  startBotMatch(difficulty?: import('@crown-clash/game-core').BotDifficulty): Promise<BotMatchTicket>;
  settleMatch(
    matchId: string,
    actions: readonly PvpAction[],
    clientObservedStatus?: ClientObservedStatus
  ): Promise<MatchSettlement>;
  purchaseUpgrade(type: UpgradeType, purchaseId: string): Promise<UpgradePurchaseResult>;
  selectCommander(commanderId: CommanderId): Promise<CommanderSelectionResult>;
  getDailyState(): Promise<DailyState>;
  claimDailyReward(type: DailyRewardType, claimId: string): Promise<DailyClaimResult>;
  getLeagueState(): Promise<LeagueState>;
  claimLeagueReward(rankId: string, claimId: string): Promise<LeagueClaimResult>;
  trackEvents(events: readonly TrackedAnalyticsEvent[]): Promise<void>;
  openLiveMatch(): LiveMatchClient;
  isAuthenticated(): boolean;
  /**
   * Marks the account-wide tutorial complete on the server (idempotent)
   * and resolves with the fresh career (tutorialCompleted: true).
   */
  completeTutorial(): Promise<PlayerCareer>;
  /** Campaign progress: how many levels in a row the player has completed. */
  getLevelsCompleted?(): Promise<number>;
  /**
   * Reports a won level with the recorded dispatches. The server replays them,
   * advances progress and pays the first-clear reward once (idempotent by claimId).
   */
  completeLevel?(levelId: number, claimId: string, actions: readonly PvpAction[]): Promise<LevelClearResult>;
}

export class GameApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export class StaleSocketError extends Error {
  readonly isStaleSocket = true;
  constructor(message = 'stale_socket_connection', public readonly cause?: unknown) {
    super(message);
    this.name = 'StaleSocketError';
    Object.setPrototypeOf(this, StaleSocketError.prototype);
  }
}

export function isLocalCareerFallbackAllowed(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_ALLOW_LOCAL_FALLBACK !== 'false';
}
