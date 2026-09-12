import type { LiveMatchResult } from '../api/LiveMatchClient.js';
import type { MatchSettlement, MatchStats } from '@crown-clash/game-core';
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
