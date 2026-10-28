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
  LaneAction,
  BattlefieldId,
  BotDifficulty,
  PlayerUpgradeModifiers,
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
/** One Weekly Challenge battle as the server defines it for the current week. */
export interface WeeklySlotState {
  readonly slot: number;
  readonly battlefieldId: BattlefieldId;
  readonly botDifficulty: BotDifficulty;
  readonly enemy: PlayerUpgradeModifiers;
  readonly coinReward: number;
  readonly claimed: boolean;
}

export interface WeeklyState {
  readonly weekIndex: number;
  /** Unix milliseconds when this week's challenges are replaced. */
  readonly endsAt: number;
  readonly slots: readonly WeeklySlotState[];
}

/** What GameScene needs to play one Weekly Challenge battle. */
export interface WeeklyLaunch {
  readonly weekIndex: number;
  readonly slot: number;
  readonly battlefieldId: BattlefieldId;
  readonly botDifficulty: BotDifficulty;
  readonly enemy: PlayerUpgradeModifiers;
  readonly coinReward: number;
}

/**
 * Outcome of reporting a won Weekly Challenge. `success` is false when the
 * server could not verify the win or the week is over; `reward` is the
 * server-paid coins (0 when the slot was already paid this week).
 */
export interface WeeklyClearResult {
  readonly success: boolean;
  readonly reason?: string;
  readonly reward: number;
  readonly claimId: string;
  readonly newCareer?: PlayerCareer;
  readonly ledgerEntry?: EconomyLedgerEntry;
}

/** Outcome of reporting a won lane battle: the server replays it and pays the first clear once per level. */
export interface LaneClearResult {
  readonly success: boolean;
  readonly reason?: string;
  readonly reward: number;
  readonly claimId: string;
  readonly newCareer?: PlayerCareer;
  readonly ledgerEntry?: EconomyLedgerEntry;
}

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
  /** Reports a won lane battle with the recorded orders; the server replays it and pays once per level. */
  completeLane?(levelId: number, claimId: string, actions: readonly LaneAction[]): Promise<LaneClearResult>;
  /** This week's Weekly Challenge battles and which of them are already paid. */
  getWeekly?(): Promise<WeeklyState>;
  /** Reports a won Weekly Challenge; the server replays it and pays once per slot per week. */
  completeWeekly?(weekIndex: number, slot: number, claimId: string, actions: readonly PvpAction[]): Promise<WeeklyClearResult>;
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
