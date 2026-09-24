import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveMatchClient, type LiveMatchResult2v2, type LiveMatchStarted2v2 } from '../LiveMatchClient.js';
import type { TwoVTwoMatchStartedPayload } from '@crown-clash/game-core';

/**
 * Deterministic Phase 4 verification for the 2v2 networking layer
 * (docs/2v2-architecture.md §3.2.1 ticket, §3.3 v2 payloads, §5.1 reconnect).
 * Fake timers only — no real sleeps anywhere.
 */

const FLAGS_2V2 = { enable2v2: true };
/** Comfortably beyond the 25s reconnect window for expiry assertions. */
const TWO_V_TWO_TEST_TOTAL_WINDOW_MS = 40_000;

type AnySocket = any;

function createMockSocket(): AnySocket {
  const socket: any = {
    onmatchdata: null,
    onmatchmakermatched: null,
    ondisconnect: null,
    sendMatchState: vi.fn().mockResolvedValue(undefined),
    joinMatch: vi.fn().mockResolvedValue(undefined),
    leaveMatch: vi.fn().mockResolvedValue(undefined),
    removeMatchmaker: vi.fn().mockResolvedValue(undefined),
    addMatchmaker: vi.fn().mockResolvedValue({ ticket: 'ticket-unused' }),
    disconnect: vi.fn(),
  };
  return socket;
}

const encoder = new TextEncoder();

function frame(payload: any, opCode?: number): AnySocket {
  const opcodes: Record<string, number> = {
    state: 3,
    command_accepted: 5,
    command_rejected: 6,
    match_result: 7,
    error: 8,
  };
  return { op_code: opCode ?? opcodes[payload?.type] ?? OP_DISPATCH, data: encoder.encode(JSON.stringify(payload)) };
}

const OP_DISPATCH = 1;
const OP_MATCH_STARTED = 2;

function startedPayload(overrides: Record<string, unknown> = {}): TwoVTwoMatchStartedPayload {
  return {
    schemaVersion: 2,
    type: 'match_started',
    matchId: 'live2v2_949eec1e_1790103440400',
    mode: '2v2',
    slot: 2,
    teamId: 'b',
    nextSequence: 5,
    players: [
      { slot: 0, teamId: 'a', userId: 'u0', displayName: 'P0' },
      { slot: 1, teamId: 'a', userId: 'u1', displayName: 'P1' },
      { slot: 2, teamId: 'b', userId: 'me', displayName: 'Me' },
      { slot: 3, teamId: 'b', userId: 'u3', displayName: 'P3' },
    ],
    state: { status: 'playing', territories: {}, armies: [], elapsedTimeSeconds: 12 },
    ...overrides,
  } as unknown as TwoVTwoMatchStartedPayload;
}

/** Enters an active 2v2 match on the given mock socket. */
async function enterActive2v2Match(
  socket: ReturnType<typeof createMockSocket>,
  client: LiveMatchClient,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  socket.addMatchmaker.mockResolvedValueOnce({ ticket: 'ticket-2v2-0' });
  const connectPromise = client.connect('queue_2v2');
  await vi.advanceTimersByTimeAsync(0);
  socket.onmatchmakermatched?.({ match_id: 'raw-match-1.crownclash', token: 'tok' });
  await vi.advanceTimersByTimeAsync(0);
  socket.onmatchdata?.({ op_code: OP_MATCH_STARTED, data: encoder.encode(JSON.stringify(startedPayload(overrides))) });
  await vi.advanceTimersByTimeAsync(0);
  await connectPromise;
}

describe('LiveMatchClient 2v2 networking (Phase 4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('matchmaking ticket', () => {
    it('submits a four-player ticket declaring mode 2v2 and schema 2', async () => {
      const socket = createMockSocket();
      socket.addMatchmaker.mockResolvedValue({ ticket: 't-2v2' });
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });

      const waiting: number[] = [];
      client.on('queue_waiting', () => waiting.push(1));
      const connectPromise = client.connect('queue_2v2');
      await vi.advanceTimersByTimeAsync(0);

      expect(socket.addMatchmaker).toHaveBeenCalledTimes(1);
      expect(socket.addMatchmaker).toHaveBeenCalledWith('*', 4, 4, { mode: '2v2', schema: '2' });
      expect(waiting.length).toBe(1);
      await connectPromise;
      client.close();
    });

    it('feature flag false prevents any 2v2 ticket from being submitted', async () => {
      const socket = createMockSocket();
      const client = new LiveMatchClient(socket, { flags: { enable2v2: false } });

      await expect(client.connect('queue_2v2')).rejects.toThrow('two_v2_disabled');
      expect(socket.addMatchmaker).not.toHaveBeenCalled();
    });

    it('1v1 queue ticket behavior remains byte-identical (empty query, 2 players, no properties)', async () => {
      const socket = createMockSocket();
      socket.addMatchmaker.mockResolvedValue({ ticket: 't-1v1' });
      const client = new LiveMatchClient(socket, { flags: { enable2v2: true } });

      const connectPromise = client.connect('queue');
      await vi.advanceTimersByTimeAsync(0);

      expect(socket.addMatchmaker).toHaveBeenCalledTimes(1);
      expect(socket.addMatchmaker).toHaveBeenCalledWith('', 2, 2);
      await connectPromise;
      client.close();
    });

    it('queue timeout retries with fresh tickets using 5s/10s/20s backoff', async () => {
      const socket = createMockSocket();
      let ticketCounter = 0;
      socket.addMatchmaker.mockImplementation(() => Promise.resolve({ ticket: `t-${ticketCounter++}` }));
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });

      const errors: string[] = [];
      client.on('error', ({ code }) => errors.push(code));
      const connectPromise = client.connect('queue_2v2');
      await vi.advanceTimersByTimeAsync(0);
      expect(socket.addMatchmaker).toHaveBeenCalledTimes(1);

      // Attempt 0 expires after the 15s queue boundary; the stale ticket is
      // removed and a FRESH ticket follows the 5s backoff.
      await vi.advanceTimersByTimeAsync(15_000);
      expect(socket.removeMatchmaker).toHaveBeenCalledWith('t-0');
      expect(socket.addMatchmaker).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(socket.addMatchmaker).toHaveBeenCalledTimes(2);
      expect(socket.addMatchmaker).toHaveBeenLastCalledWith('*', 4, 4, { mode: '2v2', schema: '2' });

      await vi.advanceTimersByTimeAsync(15_000);
      expect(socket.removeMatchmaker).toHaveBeenCalledWith('t-1');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(socket.addMatchmaker).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(15_000);
      expect(socket.removeMatchmaker).toHaveBeenCalledWith('t-2');
      await vi.advanceTimersByTimeAsync(20_000);
      expect(socket.addMatchmaker).toHaveBeenCalledTimes(4);

      // Attempt 3 (the last retry) expires: terminal failure, no 5th ticket.
      // The connect promise follows the 1v1 contract (resolves once the
      // first ticket is submitted); terminal failure surfaces via 'error'.
      await vi.advanceTimersByTimeAsync(15_000);
      expect(socket.addMatchmaker).toHaveBeenCalledTimes(4);
      expect(errors).toEqual(['queue_2v2_failed']);
      await connectPromise;
      client.close();
    });

    it('queue retries never fall back to 1v1 (every ticket is a 4-player 2v2 ticket)', async () => {
      const socket = createMockSocket();
      let ticketCounter = 0;
      socket.addMatchmaker.mockImplementation(() => Promise.resolve({ ticket: `t-${ticketCounter++}` }));
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });

      const errors: string[] = [];
      client.on('error', ({ code }) => errors.push(code));
      const connectPromise = client.connect('queue_2v2');
      await vi.advanceTimersByTimeAsync(0);
      // Drive every retry to terminal exhaustion quickly.
      for (let attempt = 0; attempt < 4; attempt++) {
        await vi.advanceTimersByTimeAsync(15_000);
        await vi.advanceTimersByTimeAsync(20_000);
      }
      expect(errors).toEqual(['queue_2v2_failed']);
      await connectPromise;

      for (const call of socket.addMatchmaker.mock.calls as unknown[][]) {
        expect(call[0]).toBe('*');
        expect(call[1]).toBe(4);
        expect(call[2]).toBe(4);
        expect(call[3]).toEqual({ mode: '2v2', schema: '2' });
      }
      expect(
        (socket.addMatchmaker.mock.calls as unknown[][]).some((call) => call[1] === 2)
      ).toBe(false);
      client.close();
    });

    it('a 2v2 session refuses a second concurrent connect', async () => {
      const socket = createMockSocket();
      socket.addMatchmaker.mockReturnValue(new Promise(() => undefined));
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });

      void client.connect('queue_2v2');
      await vi.advanceTimersByTimeAsync(0);
      await expect(client.connect('queue_2v2')).rejects.toThrow('two_v2_session_in_progress');
      client.close();
    });

    it('prevents 1v1 and 2v2 queue state from overlapping in either direction', async () => {
      const socket = createMockSocket();
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });
      await client.connect('queue');
      await expect(client.connect('queue_2v2')).rejects.toThrow('two_v2_session_in_progress');
      client.close();

      const socket2 = createMockSocket();
      const client2 = new LiveMatchClient(socket2, { flags: FLAGS_2V2 });
      await client2.connect('queue_2v2');
      await expect(client2.connect('queue')).rejects.toThrow('two_v2_session_in_progress');
      client2.close();
    });
  });

  describe('v2 control message encoding', () => {
    it('automatically sends ready immediately after joining the countdown lobby', async () => {
      const socket = createMockSocket();
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });
      socket.addMatchmaker.mockResolvedValueOnce({ ticket: 'ticket-2v2-0' });
      await client.connect('queue_2v2');
      socket.onmatchmakermatched?.({ match_id: 'raw-match-1.crownclash', token: 'tok' });
      await vi.advanceTimersByTimeAsync(0);

      expect(socket.sendMatchState).toHaveBeenCalledWith(
        'raw-match-1.crownclash',
        OP_DISPATCH,
        JSON.stringify({ schemaVersion: 2, type: 'ready' })
      );
      client.close();
    });
    it('encodes ready, surrender, and rematch_vote with schemaVersion 2', async () => {
      const socket = createMockSocket();
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });
      await enterActive2v2Match(socket, client);
      socket.sendMatchState.mockClear();

      client.sendReady();
      client.sendSurrender();
      socket.onmatchdata?.({
        op_code: 7,
        data: encoder.encode(JSON.stringify({
          schemaVersion: 2,
          type: 'match_result',
          result: {
            matchId: 'live2v2_949eec1e_1790103440400',
            mode: '2v2',
            winnerTeamId: 'a',
            participants: startedPayload().players.map((player) => ({
              slot: player.slot,
              teamId: player.teamId,
              userId: player.userId,
              status: player.teamId === 'a' ? 'victory' : 'defeat',
            })),
          },
        })),
      });
      client.sendRematchVote();

      const bodies = (socket.sendMatchState.mock.calls as unknown[][]).map((call) =>
        JSON.parse(call[2] as string)
      );
      expect(bodies).toEqual([
        { schemaVersion: 2, type: 'ready' },
        { schemaVersion: 2, type: 'surrender' },
        { schemaVersion: 2, type: 'rematch_vote' },
      ]);
      client.close();
    });

    it('dispatch uses schemaVersion 2 and a per-slot sequence cursor', async () => {
      const socket = createMockSocket();
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });
      await enterActive2v2Match(socket, client);
      socket.sendMatchState.mockClear();

      const first = client.sendDispatch('b_base_w', 'b_gate_w');
      const second = client.sendDispatch('b_base_w', 'n_corner_sw');

      expect(first).toBe(5); // restored cursor from the server
      expect(second).toBe(6);
      const bodies = (socket.sendMatchState.mock.calls as unknown[][]).map((call) =>
        JSON.parse(call[2] as string)
      );
      expect(bodies[0]).toEqual({
        schemaVersion: 2, type: 'dispatch', sequence: 5, sourceId: 'b_base_w', targetId: 'b_gate_w',
      });
      expect(bodies[1]).toEqual({
        schemaVersion: 2, type: 'dispatch', sequence: 6, sourceId: 'b_base_w', targetId: 'n_corner_sw',
      });
      client.close();
    });

    it('never rolls a sequence cursor backward after an ambiguous send failure', async () => {
      const socket = createMockSocket();
      const freshSocket = createMockSocket();
      const client = new LiveMatchClient(socket, {
        flags: FLAGS_2V2,
        reconnectTransport: vi.fn().mockResolvedValue(freshSocket),
      });
      await enterActive2v2Match(socket, client);
      socket.sendMatchState.mockRejectedValueOnce(new Error('socket closed'));

      expect(client.sendDispatch('b_base_w', 'b_gate_w')).toBe(5);
      await vi.advanceTimersByTimeAsync(0);
      expect(() => client.sendDispatch('b_base_w', 'b_gate_w')).toThrow('two_v2_not_active');

      await vi.advanceTimersByTimeAsync(500);
      freshSocket.onmatchdata?.({
        op_code: OP_MATCH_STARTED,
        data: encoder.encode(JSON.stringify(startedPayload({ nextSequence: 6 }))),
      });
      expect(client.sendDispatch('b_base_w', 'b_gate_w')).toBe(6);
      client.close();
    });

    it('control and dispatch messages fail closed once the session is not active', async () => {
      const socket = createMockSocket();
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });
      await enterActive2v2Match(socket, client);

      // Match ends (atomic settlement result) → terminal session.
      socket.onmatchdata?.({
        op_code: 7,
        data: encoder.encode(JSON.stringify({
          schemaVersion: 2,
          type: 'match_result',
          result: {
            matchId: 'live2v2_949eec1e_1790103440400',
            mode: '2v2',
            winnerTeamId: 'a',
            participants: startedPayload().players.map((player) => ({
              slot: player.slot,
              teamId: player.teamId,
              userId: player.userId,
              status: player.teamId === 'a' ? 'victory' : 'defeat',
            })),
          },
        })),
      });

      expect(() => client.sendDispatch('b_base_w', 'b_gate_w')).toThrow('two_v2_not_active');
      expect(() => client.sendSurrender()).toThrow('two_v2_not_active');
      // A finished match is precisely when rematch voting is valid.
      expect(() => client.sendRematchVote()).not.toThrow();
      client.close();
    });
  });

  describe('inbound v2 validation (fail closed)', () => {
    it('malformed JSON and wrong-schema payloads never mutate or emit state', async () => {
      const socket = createMockSocket();
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });
      await enterActive2v2Match(socket, client);

      const events: unknown[] = [];
      client.on('state_2v2', (payload) => events.push(payload));
      client.on('match_started_2v2', (payload) => events.push(payload));
      client.on('match_result_2v2', (payload) => events.push(payload));
      client.on('error', (payload) => events.push(payload));

      socket.onmatchdata?.({ op_code: OP_MATCH_STARTED, data: encoder.encode('not-json{') });
      // Legacy-shaped (schemaVersion absent) match_started on a v2 session.
      socket.onmatchdata?.({
        op_code: OP_MATCH_STARTED,
        data: encoder.encode(JSON.stringify({ matchId: 'x', role: 'player', state: { status: 'playing', territories: {}, armies: [] } })),
      });
      // schemaVersion 1.
      socket.onmatchdata?.({
        op_code: 3,
        data: encoder.encode(JSON.stringify({ schemaVersion: 1, type: 'state', tick: 99, state: { status: 'playing', territories: {}, armies: [] } })),
      });
      // Impossible slot.
      socket.onmatchdata?.({
        op_code: OP_MATCH_STARTED,
        data: encoder.encode(JSON.stringify(startedPayload({ slot: 9, teamId: 'a' }))),
      });
      // Team/slot mismatch.
      socket.onmatchdata?.({
        op_code: OP_MATCH_STARTED,
        data: encoder.encode(JSON.stringify(startedPayload({ slot: 0, teamId: 'b' }))),
      });
      // Non-monotonic garbage tick.
      socket.onmatchdata?.({
        op_code: 3,
        data: encoder.encode(JSON.stringify({ schemaVersion: 2, type: 'state', tick: -4, state: { status: 'playing', territories: {}, armies: [] } })),
      });

      expect(events).toEqual([]);
      client.close();
    });

    it('a v2 state payload with a stale tick is ignored', async () => {
      const socket = createMockSocket();
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });
      await enterActive2v2Match(socket, client);

      const states: number[] = [];
      client.on('state_2v2', (payload) => states.push(payload.tick));

      socket.onmatchdata?.(frame({ schemaVersion: 2, type: 'state', tick: 10, state: { status: 'playing', territories: {}, armies: [], elapsedTimeSeconds: 0.2 } }));
      socket.onmatchdata?.(frame({ schemaVersion: 2, type: 'state', tick: 11, state: { status: 'playing', territories: {}, armies: [], elapsedTimeSeconds: 0.22 } }));
      // Stale replays (retransmitted frames) are ignored.
      socket.onmatchdata?.(frame({ schemaVersion: 2, type: 'state', tick: 10, state: { status: 'playing', territories: {}, armies: [], elapsedTimeSeconds: 0.2 } }));
      socket.onmatchdata?.(frame({ schemaVersion: 2, type: 'state', tick: 9, state: { status: 'playing', territories: {}, armies: [], elapsedTimeSeconds: 0.18 } }));

      expect(states).toEqual([10, 11]);
      client.close();
    });

    it('rejects valid v2 payload shapes delivered on the wrong opcode', async () => {
      const socket = createMockSocket();
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });
      await enterActive2v2Match(socket, client);

      const states: number[] = [];
      client.on('state_2v2', ({ tick }) => states.push(tick));
      socket.onmatchdata?.(frame({
        schemaVersion: 2,
        type: 'state',
        tick: 12,
        state: { status: 'playing', territories: {}, armies: [] },
      }, OP_DISPATCH));

      expect(states).toEqual([]);
      client.close();
    });

    it('ignores an acknowledgement attributed to another slot', async () => {
      const socket = createMockSocket();
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });
      await enterActive2v2Match(socket, client);
      const accepted: number[] = [];
      client.on('command_accepted_2v2', ({ sequence }) => accepted.push(sequence));
      client.sendDispatch('b_base_w', 'b_gate_w');

      socket.onmatchdata?.(frame({ schemaVersion: 2, type: 'command_accepted', sequence: 5, slot: 0 }));
      expect(accepted).toEqual([]);
      client.close();
    });

    it('duplicate v2 match_result payloads are emitted exactly once', async () => {
      const socket = createMockSocket();
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });
      await enterActive2v2Match(socket, client);

      const results: LiveMatchResult2v2[] = [];
      client.on('match_result_2v2', (payload) => results.push(payload));
      const resultFrame = {
        op_code: 7,
        data: encoder.encode(JSON.stringify({
          schemaVersion: 2,
          type: 'match_result',
          result: {
            matchId: 'live2v2_949eec1e_1790103440400',
            mode: '2v2',
            outcome: 'cancelled',
          },
        })),
      };
      socket.onmatchdata?.(resultFrame);
      socket.onmatchdata?.(resultFrame);

      expect(results.length).toBe(1);
      expect(results[0].outcome).toBe('cancelled');
      client.close();
    });
  });

  describe('reconnect (§5.1)', () => {
    function wireReconnectFixtures() {
      const originalSocket = createMockSocket();
      const freshSocket = createMockSocket();
      const reconnectTransport = vi.fn().mockResolvedValue(freshSocket);
      const client = new LiveMatchClient(originalSocket, {
        flags: FLAGS_2V2,
        reconnectTransport,
      });
      return { client, originalSocket, freshSocket, reconnectTransport };
    }

    it('reconnects within the grace window and restores slot, team, and nextSequence', async () => {
      const { client, originalSocket, freshSocket, reconnectTransport } = wireReconnectFixtures();
      await enterActive2v2Match(originalSocket, client);

      const reconnecting: number[] = [];
      const reconnected: LiveMatchStarted2v2[] = [];
      client.on('reconnecting', ({ attempt }) => reconnecting.push(attempt));
      client.on('reconnected', (payload) => reconnected.push(payload as unknown as LiveMatchStarted2v2));

      // One accepted command before the drop.
      client.sendDispatch('b_base_w', 'b_gate_w');
      originalSocket.onmatchdata?.(frame({ schemaVersion: 2, type: 'command_accepted', sequence: 5, slot: 2 }));

      // Unexpected socket loss mid-match.
      originalSocket.ondisconnect?.(new Event('close'));
      expect(reconnecting).toEqual([0]);

      // Fresh socket + rejoin, still inside the 30s grace window.
      await vi.advanceTimersByTimeAsync(500);
      expect(reconnectTransport).toHaveBeenCalledTimes(1);
      expect(freshSocket.joinMatch).toHaveBeenCalledWith('raw-match-1.crownclash');

      // Server resync: full v2 match_started with the authoritative cursor.
      freshSocket.onmatchdata?.(
        { op_code: OP_MATCH_STARTED, data: encoder.encode(JSON.stringify(startedPayload({ nextSequence: 6 }))) }
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(reconnected.length).toBe(1);
      expect(reconnected[0].slot).toBe(2);
      expect(reconnected[0].teamId).toBe('b');
      expect(reconnected[0].nextSequence).toBe(6);

      // The restored cursor continues from the server value (no replay of 5).
      const next = client.sendDispatch('b_base_w', 'b_gate_w');
      expect(next).toBe(6);
      const sent = JSON.parse((freshSocket.sendMatchState as ReturnType<typeof vi.fn>).mock.calls[0][2] as string);
      expect(sent.sequence).toBe(6);
      client.close();
    });

    it('rejects a reconnect resync that changes match identity or assigned slot', async () => {
      const { client, originalSocket, freshSocket } = wireReconnectFixtures();
      await enterActive2v2Match(originalSocket, client);
      const reconnected: unknown[] = [];
      client.on('reconnected', (payload) => reconnected.push(payload));
      originalSocket.ondisconnect?.(new Event('close'));
      await vi.advanceTimersByTimeAsync(500);

      freshSocket.onmatchdata?.({
        op_code: OP_MATCH_STARTED,
        data: encoder.encode(JSON.stringify(startedPayload({
          matchId: 'live2v2_other_1', slot: 0, teamId: 'a', nextSequence: 99,
        }))),
      });
      expect(reconnected).toEqual([]);
      expect(() => client.sendDispatch('b_base_w', 'b_gate_w')).toThrow('two_v2_not_active');
      client.close();
    });

    it('ignores stale snapshots delivered after the reconnect resync', async () => {
      const { client, originalSocket, freshSocket } = wireReconnectFixtures();
      await enterActive2v2Match(originalSocket, client);

      originalSocket.ondisconnect?.(new Event('close'));
      await vi.advanceTimersByTimeAsync(500);
      freshSocket.onmatchdata?.(
        { op_code: OP_MATCH_STARTED, data: encoder.encode(JSON.stringify(startedPayload({ nextSequence: 6 }))) }
      );

      const states: number[] = [];
      client.on('state_2v2', (payload) => states.push(payload.tick));
      freshSocket.onmatchdata?.(frame({ schemaVersion: 2, type: 'state', tick: 40, state: { status: 'playing', territories: {}, armies: [], elapsedTimeSeconds: 0.8 } }));
      // Stale: older than the applied tick.
      freshSocket.onmatchdata?.(frame({ schemaVersion: 2, type: 'state', tick: 39, state: { status: 'playing', territories: {}, armies: [], elapsedTimeSeconds: 0.78 } }));
      freshSocket.onmatchdata?.(frame({ schemaVersion: 2, type: 'state', tick: 40, state: { status: 'playing', territories: {}, armies: [], elapsedTimeSeconds: 0.8 } }));

      expect(states).toEqual([40]);
      client.close();
    });

    it('accepted commands are never replayed after a reconnect', async () => {
      const { client, originalSocket, freshSocket } = wireReconnectFixtures();
      await enterActive2v2Match(originalSocket, client);

      // Commands 5 and 6 sent; only 5 acked before the drop.
      client.sendDispatch('b_base_w', 'b_gate_w');
      client.sendDispatch('b_base_w', 'n_corner_sw');
      originalSocket.onmatchdata?.(frame({ schemaVersion: 2, type: 'command_accepted', sequence: 5, slot: 2 }));

      originalSocket.ondisconnect?.(new Event('close'));
      await vi.advanceTimersByTimeAsync(500);
      freshSocket.onmatchdata?.(
        { op_code: OP_MATCH_STARTED, data: encoder.encode(JSON.stringify(startedPayload({ nextSequence: 7 }))) }
      );

      // The accepted 5 is recorded and the cursor jumps to the server value;
      // nothing pre-disconnect is re-sent.
      const sentBodies = (freshSocket.sendMatchState as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => JSON.parse(call[2] as string)
      );
      expect(sentBodies).toEqual([]);
      const next = client.sendDispatch('b_base_w', 'b_gate_w');
      expect(next).toBe(7);
      expect(next).not.toBe(5);
      client.close();
    });

    it('a stale pre-disconnect socket can never regain control or emit events', async () => {
      const { client, originalSocket, freshSocket } = wireReconnectFixtures();
      await enterActive2v2Match(originalSocket, client);

      originalSocket.ondisconnect?.(new Event('close'));
      await vi.advanceTimersByTimeAsync(500);
      freshSocket.onmatchdata?.(
        { op_code: OP_MATCH_STARTED, data: encoder.encode(JSON.stringify(startedPayload({ nextSequence: 6 }))) }
      );

      const events: unknown[] = [];
      client.on('state_2v2', (payload) => events.push(payload));
      client.on('command_accepted_2v2', (payload) => events.push(payload));
      client.on('closed', () => events.push('closed'));

      // The zombie (kicked, evicted) socket delivers data and a disconnect.
      originalSocket.onmatchdata?.(frame({ schemaVersion: 2, type: 'state', tick: 900, state: { status: 'playing', territories: {}, armies: [], elapsedTimeSeconds: 18 } }));
      originalSocket.ondisconnect?.(new Event('close'));

      expect(events).toEqual([]);
      client.close();
    });

    it('reconnect after abandonment fails closed with a terminal state', async () => {
      const { client, originalSocket, freshSocket, reconnectTransport } = wireReconnectFixtures();
      await enterActive2v2Match(originalSocket, client);
      // The match finished while the slot was gone: the rejoin (which uses
      // the fresh socket) is rejected with the finished-match code.
      freshSocket.joinMatch.mockRejectedValue(new Error('live_match_finished'));

      const failures: Array<{ matchId: string; code: string }> = [];
      client.on('reconnect_failed', (payload) => failures.push(payload));

      originalSocket.ondisconnect?.(new Event('close'));
      await vi.advanceTimersByTimeAsync(500);

      expect(failures).toEqual([
        { matchId: 'live2v2_949eec1e_1790103440400', code: 'live_match_finished' },
      ]);
      // Terminal: no further reconnect attempts or transports.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(reconnectTransport).toHaveBeenCalledTimes(1);
      expect(() => client.sendDispatch('b_base_w', 'b_gate_w')).toThrow('two_v2_not_active');
      client.close();
    });

    it('reconnect exhausts the grace window and terminates when the resync never arrives', async () => {
      const { client, originalSocket, reconnectTransport } = wireReconnectFixtures();
      await enterActive2v2Match(originalSocket, client);

      const failures: Array<{ matchId: string; code: string }> = [];
      client.on('reconnect_failed', (payload) => failures.push(payload));

      originalSocket.ondisconnect?.(new Event('close'));
      // Drive past the 25s reconnect window (first attempt + retries, none
      // resyncing because the fresh sockets never deliver match_started).
      await vi.advanceTimersByTimeAsync(TWO_V_TWO_TEST_TOTAL_WINDOW_MS);

      expect(failures.length).toBe(1);
      expect(failures[0].code).toBe('reconnect_window_expired');
      expect(reconnectTransport.mock.calls.length).toBeGreaterThan(1);
      expect(() => client.sendDispatch('b_base_w', 'b_gate_w')).toThrow('two_v2_not_active');
      client.close();
    });
  });

  describe('shutdown hygiene', () => {
    it('close() during queue retries clears all timers and never resubmits', async () => {
      const socket = createMockSocket();
      let ticketCounter = 0;
      socket.addMatchmaker.mockImplementation(() => Promise.resolve({ ticket: `t-${ticketCounter++}` }));
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });

      const events: string[] = [];
      client.on('error', ({ code }) => events.push(code));
      void client.connect('queue_2v2');
      await vi.advanceTimersByTimeAsync(0);

      client.close();
      await vi.advanceTimersByTimeAsync(120_000);

      expect(socket.removeMatchmaker).toHaveBeenCalledWith('t-0');
      expect(socket.addMatchmaker).toHaveBeenCalledTimes(1);
      expect(events).toEqual([]);
    });

    it('close() during a reconnect aborts the attempt without new transports or joins', async () => {
      const originalSocket = createMockSocket();
      const freshSocket = createMockSocket();
      const reconnectTransport = vi.fn().mockResolvedValue(freshSocket);
      const client = new LiveMatchClient(originalSocket, { flags: FLAGS_2V2, reconnectTransport });
      await enterActive2v2Match(originalSocket, client);

      originalSocket.ondisconnect?.(new Event('close'));
      client.close();
      await vi.advanceTimersByTimeAsync(60_000);

      // close() cleared the reconnect timers before the first attempt fired,
      // so the transport never runs and the fresh socket is never joined.
      expect(reconnectTransport).not.toHaveBeenCalled();
      expect(freshSocket.joinMatch).not.toHaveBeenCalled();
      client.on('state_2v2', () => {
        throw new Error('no events after close');
      });
      // A dead socket left unbound delivers nothing; the throwing listener
      // above would fail the test if it did.
      freshSocket.onmatchdata?.(frame({ schemaVersion: 2, type: 'state', tick: 3, state: { status: 'playing', territories: {}, armies: [] } }));
    });
  });

  describe('rematch window expiry (§2.6: idlers drop to the menu)', () => {
    const RESULT_MATCH_ID = 'live2v2_949eec1e_1790103440400';

    /** Settled (non-cancelled) result for the active match. */
    const settledResultFrame = (matchId: string) => ({
      op_code: 7,
      data: encoder.encode(JSON.stringify({
        schemaVersion: 2,
        type: 'match_result',
        result: {
          matchId,
          mode: '2v2',
          winnerTeamId: 'a',
          participants: startedPayload().players.map((player) => ({
            slot: player.slot,
            teamId: player.teamId,
            userId: player.userId,
            status: player.teamId === 'a' ? 'victory' : 'defeat',
          })),
        },
      })),
    });
    const matchClosedFrame = (matchId: string) => ({
      op_code: 9,
      data: encoder.encode(JSON.stringify({ schemaVersion: 2, type: 'match_closed', matchId })),
    });

    it('emits expired exactly once, never reconnects, and fails sends closed', async () => {
      const socket = createMockSocket();
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });
      await enterActive2v2Match(socket, client);
      socket.onmatchdata?.(settledResultFrame(RESULT_MATCH_ID));

      const expired: string[] = [];
      client.on('expired', ({ matchId }) => expired.push(matchId));
      const reconnecting: unknown[] = [];
      client.on('reconnecting', (payload) => reconnecting.push(payload));

      socket.onmatchdata?.(matchClosedFrame(RESULT_MATCH_ID));
      expect(expired).toEqual([RESULT_MATCH_ID]);

      // Duplicate delivery is absorbed: an expired session never re-emits.
      socket.onmatchdata?.(matchClosedFrame(RESULT_MATCH_ID));
      expect(expired).toEqual([RESULT_MATCH_ID]);

      // Terminal: no reconnect on a later socket loss, and every send path
      // fails closed (no commands into a dead session). The raw socket drop
      // still surfaces as a plain closed event, which GameScene ignores in
      // the expired state (it already returned to the menu).
      expect(() => socket.ondisconnect?.(new Event('close'))).not.toThrow();
      expect(reconnecting).toEqual([]);
      await vi.advanceTimersByTimeAsync(TWO_V_TWO_TEST_TOTAL_WINDOW_MS);
      expect(reconnecting).toEqual([]);
      expect(() => client.sendDispatch('b_base_w', 'b_gate_w')).toThrow('two_v2_not_active');
      expect(() => client.sendSurrender()).toThrow('two_v2_not_active');
      expect(() => client.sendRematchVote()).toThrow('two_v2_not_active');
      client.close();
    });

    it('ignores match_closed for another match id', async () => {
      const socket = createMockSocket();
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });
      await enterActive2v2Match(socket, client);
      socket.onmatchdata?.(settledResultFrame(RESULT_MATCH_ID));

      const expired: string[] = [];
      client.on('expired', ({ matchId }) => expired.push(matchId));
      socket.onmatchdata?.(matchClosedFrame('live2v2_other_1790103440400'));

      expect(expired).toEqual([]);
      // The session is still finished (not expired): rematch voting stays valid.
      expect(() => client.sendRematchVote()).not.toThrow();
      client.close();
    });

    it('ignores match_closed while the match is still active', async () => {
      const socket = createMockSocket();
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });
      await enterActive2v2Match(socket, client);

      const expired: string[] = [];
      client.on('expired', ({ matchId }) => expired.push(matchId));
      socket.onmatchdata?.(matchClosedFrame(RESULT_MATCH_ID));

      expect(expired).toEqual([]);
      // The active session keeps working: a dispatch is still accepted.
      expect(() => client.sendDispatch('b_base_w', 'b_gate_w')).not.toThrow();
      client.close();
    });

    it('a stale result from a previous match never reaches the new rematch session', async () => {
      const socket = createMockSocket();
      const client = new LiveMatchClient(socket, { flags: FLAGS_2V2 });
      await enterActive2v2Match(socket, client);
      socket.onmatchdata?.(settledResultFrame(RESULT_MATCH_ID));

      const results: LiveMatchResult2v2[] = [];
      client.on('match_result_2v2', (payload) => results.push(payload));

      // All four voted: the fresh rematch session joins a new raw match and
      // adopts the new canonical id from its match_started.
      socket.onmatchdata?.({
        op_code: OP_MATCH_STARTED,
        data: encoder.encode(JSON.stringify({ schemaVersion: 2, type: 'rematch_started', matchId: 'raw-match-2.crownclash' })),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(socket.joinMatch).toHaveBeenCalledWith('raw-match-2.crownclash');
      const rematchStarted = startedPayload({ matchId: 'live2v2_fresh_1790103500000' });
      socket.onmatchdata?.({ op_code: OP_MATCH_STARTED, data: encoder.encode(JSON.stringify(rematchStarted)) });
      await vi.advanceTimersByTimeAsync(0);

      // The delayed OLD result arrives after the rematch started, alongside
      // the fresh match's own result: only the fresh one may pass.
      socket.onmatchdata?.(settledResultFrame(RESULT_MATCH_ID));
      socket.onmatchdata?.(settledResultFrame('live2v2_fresh_1790103500000'));

      expect(results.map((result) => result.matchId)).toEqual(['live2v2_fresh_1790103500000']);
      client.close();
    });
  });
});
