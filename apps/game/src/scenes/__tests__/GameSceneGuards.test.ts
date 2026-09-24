import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Slot, TeamId } from '@crown-clash/game-core';
import {
  shouldActivateStressMode,
  canInitiateBotSettlement,
  canFinalizeBotSettlement,
  canHandleLiveSettlement,
  processLiveMatchResult,
} from '../gameSceneGuards.js';
import type { LiveMatchResult } from '../../api/LiveMatchClient.js';

const analyticsListeners = new EventTarget();

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: analyticsListeners.addEventListener.bind(analyticsListeners),
      removeEventListener: analyticsListeners.removeEventListener.bind(analyticsListeners),
      dispatchEvent: analyticsListeners.dispatchEvent.bind(analyticsListeners),
    },
  });
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: class<T> extends Event {
      public readonly detail: T;

      constructor(name: string, init: CustomEventInit<T>) {
        super(name);
        this.detail = init.detail as T;
      }
    },
  });
});

function collectAnalyticsEvents(): unknown[] {
  const events: unknown[] = [];
  const listener = (event: Event): void => {
    events.push((event as CustomEvent).detail);
  };
  window.addEventListener('crown-clash:analytics', listener);
  return events;
}

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

  describe('track2v2ResultAnalytics', () => {
    it('emits the terminal match_end with 2v2 attribution plus reward and live-match events', async () => {
      const analytics = await import('../../analytics/Analytics.js');
      const guards = await import('../gameSceneGuards.js');
      const events = collectAnalyticsEvents();

      const recorded = guards.track2v2ResultAnalytics({
        matchId: 'live2v2_deadbeef_1',
        cancelled: false,
        myStatus: 'victory',
        durationSeconds: 42,
        slot: 1,
        teamId: 'a',
      });

      expect(recorded).toBe(true);
      expect(events).toHaveLength(3);
      expect(events[0]).toMatchObject({
        name: 'match_end',
        props: {
          matchId: 'live2v2_deadbeef_1',
          mode: '2v2',
          result: 'victory',
          durationSeconds: 42,
          slot: 1,
          teamId: 'a',
        },
      });
      expect(events[1]).toMatchObject({
        name: 'match_reward_received',
        props: { matchId: 'live2v2_deadbeef_1', mode: '2v2' },
      });
      expect(events[2]).toMatchObject({
        name: 'live_match_ended',
        props: { matchId: 'live2v2_deadbeef_1', status: 'victory' },
      });
      // The event payload must satisfy the server-side envelope schema.
      expect(events[0]).toMatchObject({ schemaVersion: analytics.ANALYTICS_SCHEMA_VERSION });
    });

    it('emits nothing for cancelled matches (zero settlements)', async () => {
      const guards = await import('../gameSceneGuards.js');
      const events = collectAnalyticsEvents();

      const recorded = guards.track2v2ResultAnalytics({
        matchId: 'live2v2_cancelled_1',
        cancelled: true,
        myStatus: 'unknown',
        durationSeconds: 12,
        slot: 0,
        teamId: 'a',
      });

      expect(recorded).toBe(false);
      expect(events).toHaveLength(0);
    });

    it('emits nothing when the local slot has no derivable result', async () => {
      const guards = await import('../gameSceneGuards.js');
      const events = collectAnalyticsEvents();

      const recorded = guards.track2v2ResultAnalytics({
        matchId: 'live2v2_deadbeef_2',
        cancelled: false,
        myStatus: 'unknown',
        durationSeconds: 30,
        slot: 3,
        teamId: 'b',
      });

      expect(recorded).toBe(false);
      expect(events).toHaveLength(0);
    });

    it('deduplicates terminal events per match (match_quit wins, later match_end suppressed)', async () => {
      const guards = await import('../gameSceneGuards.js');
      const { trackTerminalMatchEvent } = await import('../../analytics/Analytics.js');
      const events = collectAnalyticsEvents();

      // Simulate the disconnect-quit recorded first (same shared terminal set).
      expect(
        trackTerminalMatchEvent({
          name: 'match_quit',
          matchId: 'live2v2_deadbeef_3',
          mode: '2v2',
          durationSeconds: 18,
        })
      ).toBe(true);

      // The late per-participant result arrives: no second terminal event.
      const recorded = guards.track2v2ResultAnalytics({
        matchId: 'live2v2_deadbeef_3',
        cancelled: false,
        myStatus: 'defeat',
        durationSeconds: 30,
        slot: 2,
        teamId: 'b',
      });

      expect(recorded).toBe(false);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ name: 'match_quit' });
    });
  });

  describe('isCurrent2v2MatchResult (current-match result guard)', () => {
    const OLD_MATCH = 'live2v2_old_1';
    const NEW_MATCH = 'live2v2_new_2';

    interface ParticipantRow {
      slot: Slot;
      teamId: TeamId;
      userId: string;
      status: 'victory' | 'defeat' | 'draw';
    }

    const settledResult = (slotOrder: number[], overrides: Record<string, unknown> = {}) => ({
      matchId: NEW_MATCH,
      participants: slotOrder.map((slot): ParticipantRow => ({
        slot: slot as Slot,
        teamId: (slot < 2 ? 'a' : 'b') as TeamId,
        userId: `u${slot}`,
        status: slot < 2 ? 'victory' : 'defeat',
      })),
      ...overrides,
    });

    it('accepts the current match even when the local slot is not the first participant', async () => {
      const guards = await import('../gameSceneGuards.js');
      // Local player owns slot 2: it sits at array position 2, never 0.
      expect(
        guards.isCurrent2v2MatchResult({
          result: settledResult([0, 1, 2, 3]),
          activeMatchId: NEW_MATCH,
          mySlot: 2,
          myTeamId: 'b',
        })
      ).toBe(true);
    });

    it('rejects a delayed result from a previous match after a rematch starts', async () => {
      const guards = await import('../gameSceneGuards.js');
      expect(
        guards.isCurrent2v2MatchResult({
          result: settledResult([0, 1, 2, 3], { matchId: OLD_MATCH }),
          activeMatchId: NEW_MATCH,
          mySlot: 2,
          myTeamId: 'b',
        })
      ).toBe(false);
    });

    it('rejects a result whose local slot is missing or duplicated', async () => {
      const guards = await import('../gameSceneGuards.js');
      // Slot 2 missing (duplicated slot 3 instead) — also fails uniqueness.
      expect(
        guards.isCurrent2v2MatchResult({
          result: settledResult([0, 1, 3, 3]),
          activeMatchId: NEW_MATCH,
          mySlot: 2,
          myTeamId: 'b',
        })
      ).toBe(false);
      // The local slot appears twice.
      expect(
        guards.isCurrent2v2MatchResult({
          result: settledResult([0, 1, 2, 2]),
          activeMatchId: NEW_MATCH,
          mySlot: 2,
          myTeamId: 'b',
        })
      ).toBe(false);
    });

    it('rejects a participant whose team conflicts with the active session', async () => {
      const guards = await import('../gameSceneGuards.js');
      const conflicting = settledResult([0, 1, 2, 3]);
      (conflicting.participants as ParticipantRow[])[2].teamId = 'a'; // slot 2 must be team b
      expect(
        guards.isCurrent2v2MatchResult({
          result: conflicting,
          activeMatchId: NEW_MATCH,
          mySlot: 2,
          myTeamId: 'b',
        })
      ).toBe(false);
    });

    it('rejects settled results with malformed participant sets', async () => {
      const guards = await import('../gameSceneGuards.js');
      expect(
        guards.isCurrent2v2MatchResult({
          result: settledResult([0, 1, 2]) as never,
          activeMatchId: NEW_MATCH,
          mySlot: 2,
          myTeamId: 'b',
        })
      ).toBe(false);
      expect(
        guards.isCurrent2v2MatchResult({
          result: { matchId: NEW_MATCH },
          activeMatchId: NEW_MATCH,
          mySlot: 2,
          myTeamId: 'b',
        })
      ).toBe(false);
    });

    it('accepts a cancelled result only for the current match', async () => {
      const guards = await import('../gameSceneGuards.js');
      expect(
        guards.isCurrent2v2MatchResult({
          result: { matchId: NEW_MATCH, outcome: 'cancelled' as const },
          activeMatchId: NEW_MATCH,
          mySlot: 2,
          myTeamId: 'b',
        })
      ).toBe(true);
      expect(
        guards.isCurrent2v2MatchResult({
          result: { matchId: OLD_MATCH, outcome: 'cancelled' as const },
          activeMatchId: NEW_MATCH,
          mySlot: 2,
          myTeamId: 'b',
        })
      ).toBe(false);
    });
  });

  describe('selectLocal2v2Participant (local-slot settlement selection)', () => {
    const participant = (slot: number) => ({
      slot: slot as Slot,
      teamId: (slot < 2 ? 'a' : 'b') as TeamId,
      userId: `u${slot}`,
      status: slot < 2 ? ('victory' as const) : ('defeat' as const),
    });

    it('selects by the authenticated slot, never by array position', async () => {
      const guards = await import('../gameSceneGuards.js');
      const mine = guards.selectLocal2v2Participant(
        { participants: [participant(0), participant(1), participant(2), participant(3)] },
        2
      );
      expect(mine?.slot).toBe(2);
      expect(mine?.userId).toBe('u2');
    });

    it('returns null for duplicate or missing local slots', async () => {
      const guards = await import('../gameSceneGuards.js');
      expect(
        guards.selectLocal2v2Participant(
          { participants: [participant(0), participant(1), participant(2), participant(2)] },
          2
        )
      ).toBeNull();
      expect(
        guards.selectLocal2v2Participant(
          { participants: [participant(0), participant(1), participant(3)] },
          2
        )
      ).toBeNull();
      expect(guards.selectLocal2v2Participant({ participants: undefined }, 2)).toBeNull();
    });
  });
});
