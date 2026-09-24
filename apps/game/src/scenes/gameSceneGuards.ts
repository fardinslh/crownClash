import type { LiveMatchResult, LiveMatchResult2v2 } from '../api/LiveMatchClient.js';
import type { MatchSettlement, MatchStats, TwoVTwoParticipantResult } from '@crown-clash/game-core';
import { trackTerminalMatchEvent, trackEvent } from '../analytics/Analytics.js';

export interface StressActivationOptions {
  isDebugPerformance: boolean;
  requestedQaStress: boolean;
  liveMode: boolean;
}

/**
 * Pure calculation for GameScene stress mode activation.
 * Stress mode strictly requires:
 * 1. debug_performance=1
 * 2. Requested QA stress (param, registry, or launch payload)
 * 3. !liveMode (Live matches must NEVER activate stress mode)
 */
export function shouldActivateStressMode(options: StressActivationOptions): boolean {
  return Boolean(options.isDebugPerformance && options.requestedQaStress && !options.liveMode);
}

export interface SettlementGateOptions {
  isExiting: boolean;
  hasResultModal: boolean;
  resultPending: boolean;
  isStressMode: boolean;
  liveMode: boolean;
}

/**
 * Pure gate for initiating bot match settlement (endMatch).
 * Blocks if already exiting, result modal is present, settlement is pending,
 * or during isolated bot QA stress mode.
 */
export function canInitiateBotSettlement(options: SettlementGateOptions): boolean {
  if (options.isExiting || options.hasResultModal || options.resultPending) {
    return false;
  }
  if (options.isStressMode && !options.liveMode) {
    return false;
  }
  return true;
}

/**
 * Pure gate for finalizing bot match settlement (finalizeMatch).
 * Blocks during isolated bot QA stress mode.
 */
export function canFinalizeBotSettlement(
  options: Pick<SettlementGateOptions, 'isStressMode' | 'liveMode'>
): boolean {
  if (options.isStressMode && !options.liveMode) {
    return false;
  }
  return true;
}

export interface LiveSettlementGateOptions {
  isExiting: boolean;
  hasResultModal: boolean;
  isStressMode?: boolean;
}

/**
 * Pure gate for handling live PvP match results.
 * Live matches must ALWAYS permit normal result handling and settlement.
 */
export function canHandleLiveSettlement(options: LiveSettlementGateOptions): boolean {
  if (options.isExiting || options.hasResultModal) {
    return false;
  }
  return true;
}

export interface LiveMatchResultConsumerContext {
  isExiting: boolean;
  hasResultModal: boolean;
  isStressMode?: boolean;
  settledMatchId?: string;
  applySettlement: (settlement: MatchSettlement) => void;
  renderModal: (status: 'victory' | 'defeat' | 'draw', stats: MatchStats, settlement: MatchSettlement) => void;
  closeClient?: () => void;
}

/**
 * Idempotent consumer for live match results.
 * Ensures career application, result presentation, analytics, and settlement handling occur exactly once.
 * Returns true if processed, or false if rejected as a duplicate or blocked by lifecycle.
 */
export function processLiveMatchResult(
  result: LiveMatchResult,
  context: LiveMatchResultConsumerContext
): boolean {
  if (!result || !result.matchId) {
    return false;
  }

  // Deduplicate: do not process the same match ID multiple times
  if (context.settledMatchId === result.matchId) {
    return false;
  }

  if (!canHandleLiveSettlement({
    isExiting: context.isExiting,
    hasResultModal: context.hasResultModal,
    isStressMode: context.isStressMode,
  })) {
    return false;
  }

  const terminalEventRecorded = trackTerminalMatchEvent({
    name: 'match_end',
    matchId: result.matchId,
    mode: 'live',
    result: result.status,
    durationSeconds: result.stats.matchDurationSeconds,
  });

  context.applySettlement(result.settlement);

  if (terminalEventRecorded) {
    trackEvent({
      name: 'match_reward_received',
      matchId: result.matchId,
      mode: 'live',
    });
    if (result.settlement.rankPromoted) {
      trackEvent({ name: 'rank_promoted', matchId: result.matchId });
    }
    trackEvent({
      name: 'live_match_ended',
      matchId: result.matchId,
      status: result.status,
    });
  }

  context.renderModal(result.status, result.stats, result.settlement);
  context.closeClient?.();
  return true;
}

export interface TwoVTwoResultAnalyticsInput {
  matchId: string;
  cancelled: boolean;
  myStatus: 'victory' | 'defeat' | 'draw' | 'unknown';
  durationSeconds: number;
  slot: number;
  teamId: 'a' | 'b';
}

/**
 * Terminal 2v2 result analytics (casual mode). The terminal match_end is
 * recorded at most once per match (shared dedup with match_quit); reward and
 * live-match events follow only when the terminal event was recorded.
 * Cancelled matches never settle, so they emit nothing. Result and duration
 * are re-normalized server-side from the stored per-participant settlement;
 * these client values are attribution hints only.
 * Returns true when the terminal event was recorded.
 */
export function track2v2ResultAnalytics(input: TwoVTwoResultAnalyticsInput): boolean {
  if (input.cancelled || input.myStatus === 'unknown') return false;
  const terminalEventRecorded = trackTerminalMatchEvent({
    name: 'match_end',
    matchId: input.matchId,
    mode: '2v2',
    result: input.myStatus,
    durationSeconds: input.durationSeconds,
    slot: input.slot,
    teamId: input.teamId,
  });
  if (!terminalEventRecorded) return false;
  trackEvent({
    name: 'match_reward_received',
    matchId: input.matchId,
    mode: '2v2',
  });
  trackEvent({
    name: 'live_match_ended',
    matchId: input.matchId,
    status: input.myStatus,
  });
  return true;
}

export interface TwoVTwoResultGuardInput {
  result: Pick<LiveMatchResult2v2, 'matchId' | 'participants' | 'outcome'>;
  activeMatchId: string;
  mySlot: number;
  myTeamId: 'a' | 'b' | null;
}

/**
 * Pure guard for consuming a 2v2 match result. A result may only be
 * processed when:
 * 1. it names the CURRENTLY ACTIVE 2v2 match (a delayed result from a
 *    previous match after a rematch must never touch the new match);
 * 2. for settled results, the participant set is well-formed (four unique
 *    slots 0-3) and the local slot appears exactly once;
 * 3. the local participant's team matches the authenticated session's
 *    team (a conflicting slot/team pair must never drive the career cache).
 * Cancelled results carry no participants and only need the match id.
 */
export function isCurrent2v2MatchResult(input: TwoVTwoResultGuardInput): boolean {
  if (!input.result?.matchId || input.result.matchId !== input.activeMatchId) {
    return false;
  }
  if (input.result.outcome === 'cancelled') return true;
  const participants = input.result.participants;
  if (!participants || participants.length !== 4) return false;
  const seen = new Set<number>();
  for (const participant of participants) {
    const slot = participant?.slot;
    if (typeof slot !== 'number' || slot < 0 || slot > 3 || seen.has(slot)) {
      return false;
    }
    seen.add(slot);
  }
  const mine = participants.filter((participant) => participant.slot === input.mySlot);
  if (mine.length !== 1) return false;
  if (input.myTeamId !== null && mine[0].teamId !== input.myTeamId) return false;
  return true;
}

/**
 * Pure selection of the local participant's settlement by the
 * authenticated active slot. Never selects by array position: the local
 * slot must match exactly one participant.
 */
export function selectLocal2v2Participant(
  result: Pick<LiveMatchResult2v2, 'participants'>,
  mySlot: number
): TwoVTwoParticipantResult | null {
  const participants = result?.participants;
  if (!participants) return null;
  const mine = participants.filter((participant) => participant.slot === mySlot);
  if (mine.length !== 1) return null;
  return mine[0];
}