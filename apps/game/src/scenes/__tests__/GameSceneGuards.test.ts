import { describe, it, expect, vi } from 'vitest';
import {
  shouldActivateStressMode,
  canInitiateBotSettlement,
  canFinalizeBotSettlement,
  canHandleLiveSettlement,
  processLiveMatchResult,
} from '../gameSceneGuards.js';
import type { LiveMatchResult } from '../../api/LiveMatchClient.js';

describe('GameScene Stress Activation & Settlement Guards', () => {
  describe('shouldActivateStressMode', () => {
    it('activates stress mode for bot QA when both debug_performance and stress are requested', () => {
      const active = shouldActivateStressMode({
        isDebugPerformance: true,
        requestedQaStress: true,
        liveMode: false,
      });
      expect(active).toBe(true);
    });

    it('does not activate stress mode for normal bot matches', () => {
      const active = shouldActivateStressMode({
        isDebugPerformance: false,
        requestedQaStress: false,
        liveMode: false,
      });
      expect(active).toBe(false);
    });

    it('does not activate stress mode when stress_armies is standalone without debug_performance', () => {
      const active = shouldActivateStressMode({
        isDebugPerformance: false,
        requestedQaStress: true,
        liveMode: false,
      });
      expect(active).toBe(false);
    });

    it('NEVER activates stress mode in live PvP matches even with both debug_performance and stress flags', () => {
      const active = shouldActivateStressMode({
        isDebugPerformance: true,
        requestedQaStress: true,
        liveMode: true,
      });
      expect(active).toBe(false);
    });

    it('does not activate stress mode for normal live PvP matches', () => {
      const active = shouldActivateStressMode({
        isDebugPerformance: false,
        requestedQaStress: false,
        liveMode: true,
      });
      expect(active).toBe(false);
    });
  });

  describe('canInitiateBotSettlement & canFinalizeBotSettlement', () => {
    it('blocks bot settlement initiation during isolated bot QA stress mode', () => {
      const canInitiate = canInitiateBotSettlement({
        isExiting: false,
        hasResultModal: false,
        resultPending: false,
        isStressMode: true,
        liveMode: false,
      });
      expect(canInitiate).toBe(false);
    });

    it('blocks bot settlement finalization during isolated bot QA stress mode', () => {
      const canFinalize = canFinalizeBotSettlement({
        isStressMode: true,
        liveMode: false,
      });
      expect(canFinalize).toBe(false);
    });

    it('permits bot settlement initiation during normal bot matches and after stress cleanup', () => {
      const canInitiate = canInitiateBotSettlement({
        isExiting: false,
        hasResultModal: false,
        resultPending: false,
        isStressMode: false,
        liveMode: false,
      });
      expect(canInitiate).toBe(true);
    });

    it('permits bot settlement finalization during normal bot matches and after stress cleanup', () => {
      const canFinalize = canFinalizeBotSettlement({
        isStressMode: false,
        liveMode: false,
      });
      expect(canFinalize).toBe(true);
    });

    it('blocks bot settlement when exiting, modal present, or already pending', () => {
      expect(
        canInitiateBotSettlement({
          isExiting: true,
          hasResultModal: false,
          resultPending: false,
          isStressMode: false,
          liveMode: false,
        })
      ).toBe(false);

      expect(
        canInitiateBotSettlement({
          isExiting: false,
          hasResultModal: true,
          resultPending: false,
          isStressMode: false,
          liveMode: false,
        })
      ).toBe(false);

      expect(
        canInitiateBotSettlement({
          isExiting: false,
          hasResultModal: false,
          resultPending: true,
          isStressMode: false,
          liveMode: false,
        })
      ).toBe(false);
    });
  });

  describe('canHandleLiveSettlement & processLiveMatchResult', () => {
    const dummyResult: LiveMatchResult = {
      matchId: 'live_pvp_match_100',
      status: 'victory',
      stats: {
        matchDurationSeconds: 40,
        playerUnitsDispatched: 25,
        enemyUnitsDispatched: 15,
        territoriesCapturedByPlayer: 3,
        territoriesCapturedByEnemy: 1,
      },
      settlement: {
        matchId: 'live_pvp_match_100',
        status: 'victory',
        breakdown: {
          baseCoins: 30,
          speedBonus: 10,
          dominationBonus: 0,
          streakBonus: 0,
          treasuryBonus: 0,
          totalCoins: 40,
          trophyDelta: 20,
        },
        stats: {
          matchDurationSeconds: 40,
          playerUnitsDispatched: 25,
          enemyUnitsDispatched: 15,
          territoriesCapturedByPlayer: 3,
          territoriesCapturedByEnemy: 1,
        },
        previousCareer: {} as any,
        newCareer: {} as any,
        previousRank: {} as any,
        newRank: {} as any,
        rankPromoted: false,
        ledgerEntries: [],
      },
    };

    it('asserts live PvP always permits normal result handling and settlement', () => {
      // Even if stress mode was erroneously true, live PvP must permit settlement
      const canHandle = canHandleLiveSettlement({
        isExiting: false,
        hasResultModal: false,
        isStressMode: false,
      });
      expect(canHandle).toBe(true);
    });

    it('blocks live settlement only when exiting or result modal is already rendered', () => {
      expect(
        canHandleLiveSettlement({
          isExiting: true,
          hasResultModal: false,
        })
      ).toBe(false);

      expect(
        canHandleLiveSettlement({
          isExiting: false,
          hasResultModal: true,
        })
      ).toBe(false);
    });

    it('processes live match result and applies settlement, modal, and client closure', () => {
      const applySettlement = vi.fn();
      const renderModal = vi.fn();
      const closeClient = vi.fn();

      const success = processLiveMatchResult(dummyResult, {
        isExiting: false,
        hasResultModal: false,
        applySettlement,
        renderModal,
        closeClient,
      });

      expect(success).toBe(true);
      expect(applySettlement).toHaveBeenCalledTimes(1);
      expect(applySettlement).toHaveBeenCalledWith(dummyResult.settlement);
      expect(renderModal).toHaveBeenCalledTimes(1);
      expect(closeClient).toHaveBeenCalledTimes(1);
    });

    it('deduplicates by settledMatchId idempotently', () => {
      const applySettlement = vi.fn();
      const renderModal = vi.fn();
      const closeClient = vi.fn();

      // First run: not settled yet
      const first = processLiveMatchResult(dummyResult, {
        isExiting: false,
        hasResultModal: false,
        settledMatchId: undefined,
        applySettlement,
        renderModal,
        closeClient,
      });
      expect(first).toBe(true);
      expect(applySettlement).toHaveBeenCalledTimes(1);

      // Second duplicate run with the same settledMatchId
      const second = processLiveMatchResult(dummyResult, {
        isExiting: false,
        hasResultModal: false,
        settledMatchId: 'live_pvp_match_100',
        applySettlement,
        renderModal,
        closeClient,
      });
      expect(second).toBe(false);
      // Calls remain exactly 1
      expect(applySettlement).toHaveBeenCalledTimes(1);
      expect(renderModal).toHaveBeenCalledTimes(1);
      expect(closeClient).toHaveBeenCalledTimes(1);
    });
  });
});
