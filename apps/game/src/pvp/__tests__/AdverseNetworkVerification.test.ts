import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LivePvpController, mapLivePvpError } from '../LivePvpController.js';
import { LiveMatchClient, type LiveMatchResult } from '../../api/LiveMatchClient.js';
import { PerformanceMonitor } from '../../debug/PerformanceMonitor.js';
import { processLiveMatchResult } from '../../scenes/gameSceneGuards.js';
import type { GameState } from '@crown-clash/game-core';

describe('Adverse Network & Lifecycle Verification with Real Modules', () => {
  let mockWindow: any;
  let mockDocument: any;
  let winListeners: Record<string, Function[]> = {};
  let docListeners: Record<string, Function[]> = {};

  beforeEach(() => {
    winListeners = {};
    docListeners = {};

    mockDocument = {
      hidden: false,
      addEventListener: (event: string, fn: Function) => {
        docListeners[event] = docListeners[event] || [];
        docListeners[event].push(fn);
      },
      removeEventListener: (event: string, fn: Function) => {
        if (docListeners[event]) {
          docListeners[event] = docListeners[event].filter((f) => f !== fn);
        }
      },
      _trigger: (event: string) => {
        (docListeners[event] || []).forEach((fn) => fn());
      },
    };

    mockWindow = {
      navigator: {
        userAgent: 'Android Chrome QA',
        platform: 'Linux armv8l',
        language: 'en-US',
        hardwareConcurrency: 8,
        onLine: true,
      },
      innerWidth: 430,
      innerHeight: 932,
      devicePixelRatio: 3,
      addEventListener: (event: string, fn: Function) => {
        winListeners[event] = winListeners[event] || [];
        winListeners[event].push(fn);
      },
      removeEventListener: (event: string, fn: Function) => {
        if (winListeners[event]) {
          winListeners[event] = winListeners[event].filter((f) => f !== fn);
        }
      },
      dispatchEvent: vi.fn(),
      _trigger: (event: string) => {
        (winListeners[event] || []).forEach((fn) => fn());
      },
    };

    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('document', mockDocument);
    vi.stubGlobal('navigator', mockWindow.navigator);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('LivePvpController Adverse Network Recovery', () => {
    it('maps network timeouts and disconnections to user-friendly messages', () => {
      const controller = new LivePvpController();
      expect(controller.getState().view).toBe('lobby');

      // Test real error mappings
      expect(mapLivePvpError('live_connection_timeout')).toContain('timed out');
      expect(mapLivePvpError('connection_closed')).toContain('Connection to server was closed');
      expect(mapLivePvpError('live_match_full')).toContain('already full');

      // Exercise controller error state
      controller.onError('live_connection_timeout');
      expect(controller.getState().view).toBe('error');
      expect(controller.getState().errorMessage).toContain('timed out');

      // User retries after adverse network failure
      controller.cancel();
      expect(controller.getState().view).toBe('lobby');
      expect(controller.getState().errorMessage).toBe('');
    });
  });

  describe('LiveMatchClient Real Message & Opcode Handling', () => {
    const OP_STATE = 3;
    const OP_COMMAND_ACCEPTED = 5;
    const OP_COMMAND_REJECTED = 6;
    const OP_MATCH_RESULT = 7;

    function createMockSocket() {
      const socket: any = {
        onmatchdata: null,
        onmatchmakermatched: null,
        ondisconnect: null,
        sendMatchState: vi.fn(),
        joinMatch: vi.fn().mockResolvedValue({}),
        leaveMatch: vi.fn().mockResolvedValue({}),
        rpc: vi.fn(),
      };
      return socket;
    }

    it('processes authoritative state and command rejection events via real LiveMatchClient', () => {
      const mockSocket = createMockSocket();
      const client = new LiveMatchClient(mockSocket);

      let receivedState: GameState | null = null;
      let rejectedCommand: { sequence?: number; code: string } | null = null;
      let acceptedSequence: number | null = null;

      client.on('state', (state) => {
        receivedState = state;
      });
      client.on('command_rejected', (err) => {
        rejectedCommand = err;
      });
      client.on('command_accepted', (data) => {
        acceptedSequence = data.sequence;
      });

      // Simulate incoming authoritative state payload from Nakama
      const dummyGameState: any = {
        id: 'test_state_1',
        status: 'playing',
        territories: {
          p_base: { id: 'p_base', name: 'Base', owner: 'player', units: 22, maxUnits: 60, tier: 3, x: 50, y: 100, radius: 30, productionRate: 1.5, type: 'tower' },
        },
        armies: [],
      };

      const encoder = new TextEncoder();
      mockSocket.onmatchdata({
        op_code: OP_STATE,
        data: encoder.encode(JSON.stringify({ state: dummyGameState })),
      });

      expect(receivedState).toEqual(dummyGameState);

      // Simulate command accepted
      mockSocket.onmatchdata({
        op_code: OP_COMMAND_ACCEPTED,
        data: encoder.encode(JSON.stringify({ sequence: 42 })),
      });
      expect(acceptedSequence).toBe(42);

      // Simulate command rejected under adverse conditions
      mockSocket.onmatchdata({
        op_code: OP_COMMAND_REJECTED,
        data: encoder.encode(JSON.stringify({ sequence: 43, code: 'stale_command' })),
      });
      expect(rejectedCommand).toEqual({ sequence: 43, code: 'stale_command' });

      client.close();
    });

    it('handles duplicate match result messages idempotently without duplicate settlement, presentation, or analytics', () => {
      const mockSocket = createMockSocket();
      const client = new LiveMatchClient(mockSocket);

      const matchResults: LiveMatchResult[] = [];
      const applySettlement = vi.fn();
      const renderModal = vi.fn();

      let settledMatchId: string | undefined;

      // Actual GameScene consumer behavior wired to client
      client.on('match_result', (res) => {
        matchResults.push(res);
        const processed = processLiveMatchResult(res, {
          isExiting: false,
          hasResultModal: false,
          isStressMode: false,
          settledMatchId,
          applySettlement,
          renderModal,
        });
        if (processed) {
          settledMatchId = res.matchId;
        }
      });

      const dummyResult: LiveMatchResult = {
        matchId: 'live_match_123',
        status: 'victory',
        stats: {
          matchDurationSeconds: 45,
          playerUnitsDispatched: 30,
          enemyUnitsDispatched: 20,
          territoriesCapturedByPlayer: 3,
          territoriesCapturedByEnemy: 1,
        },
        settlement: {
          matchId: 'live_match_123',
          status: 'victory',
          breakdown: {
            baseCoins: 20,
            speedBonus: 5,
            dominationBonus: 0,
            streakBonus: 0,
            treasuryBonus: 0,
            totalCoins: 25,
            trophyDelta: 15,
          },
          stats: {
            matchDurationSeconds: 45,
            playerUnitsDispatched: 30,
            enemyUnitsDispatched: 20,
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

      const encoder = new TextEncoder();
      const payload = encoder.encode(JSON.stringify({ result: dummyResult }));

      // Deliver duplicate match result (e.g. retransmitted socket frame from server)
      mockSocket.onmatchdata({ op_code: OP_MATCH_RESULT, data: payload });
      mockSocket.onmatchdata({ op_code: OP_MATCH_RESULT, data: payload });

      // LiveMatchClient deduplication guarantees exactly 1 emission
      expect(matchResults.length).toBe(1);
      expect(matchResults[0].settlement.matchId).toBe('live_match_123');
      expect(matchResults[0].settlement.status).toBe('victory');

      // Consumer settlement, presentation, and client close occur exactly once
      expect(applySettlement).toHaveBeenCalledTimes(1);
      expect(applySettlement).toHaveBeenCalledWith(dummyResult.settlement);
      expect(renderModal).toHaveBeenCalledTimes(1);
      expect(renderModal).toHaveBeenCalledWith(
        dummyResult.status,
        dummyResult.stats,
        dummyResult.settlement
      );

      expect(mockWindow.dispatchEvent).toHaveBeenCalled();
      const analyticsCallsCount = mockWindow.dispatchEvent.mock.calls.length;

      // Even if a second duplicate result is delivered directly to the consumer, consumer rejects it
      const duplicateProcessed = processLiveMatchResult(dummyResult, {
        isExiting: false,
        hasResultModal: false,
        isStressMode: false,
        settledMatchId,
        applySettlement,
        renderModal,
      });
      expect(duplicateProcessed).toBe(false);
      expect(applySettlement).toHaveBeenCalledTimes(1);
      expect(renderModal).toHaveBeenCalledTimes(1);
      expect(mockWindow.dispatchEvent).toHaveBeenCalledTimes(analyticsCallsCount);

      client.close();
    });

    it('emits closed event upon unexpected socket disconnection', () => {
      const mockSocket = createMockSocket();
      const client = new LiveMatchClient(mockSocket);

      let closedEmitted = false;
      client.on('closed', () => {
        closedEmitted = true;
      });

      // Trigger unexpected socket disconnect
      mockSocket.ondisconnect(new Event('close'));
      expect(closedEmitted).toBe(true);

      client.close();
    });
  });

  describe('Real Adverse Network Tracking in PerformanceMonitor', () => {
    it('measures drops, reconnects, and backgrounding durations accurately', () => {
      let mockTime = 2000;
      const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => mockTime);

      const monitor = new PerformanceMonitor();

      // Verify online initial status
      expect(monitor.getNetworkStats().currentStatus).toBe('online');
      expect(monitor.getNetworkStats().disconnectCount).toBe(0);

      // Simulate adverse network drop (3s)
      mockWindow.navigator.onLine = false;
      mockWindow._trigger('offline');
      expect(monitor.getNetworkStats().currentStatus).toBe('offline');
      expect(monitor.getNetworkStats().disconnectCount).toBe(1);

      // Restore network
      mockWindow.navigator.onLine = true;
      mockWindow._trigger('online');
      expect(monitor.getNetworkStats().currentStatus).toBe('online');
      expect(monitor.getNetworkStats().reconnectCount).toBe(1);

      // Simulate backgrounding (10s)
      mockDocument.hidden = true;
      mockDocument._trigger('visibilitychange');
      expect(monitor.getLifecycleStats().pauseCount).toBe(1);

      mockTime += 10000;

      mockDocument.hidden = false;
      mockDocument._trigger('visibilitychange');
      expect(monitor.getLifecycleStats().resumeCount).toBe(1);
      expect(monitor.getLifecycleStats().totalBackgroundSeconds).toBe(10);

      nowSpy.mockRestore();
      monitor.destroy();
    });
  });
});
