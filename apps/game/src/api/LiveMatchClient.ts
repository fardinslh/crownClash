import type { Socket } from '@heroiclabs/nakama-js';
import type {
  GameState,
  MatchSettlement,
  MatchStats,
  Slot,
  TeamId,
  TwoVTwoRosterEntry,
} from '@crown-clash/game-core';
import {
  createTwoVTwoDispatchMessage,
  createTwoVTwoReadyMessage,
  createTwoVTwoRematchVoteMessage,
  createTwoVTwoSurrenderMessage,
  parseTwoVTwoServerMessage,
  type TwoVTwoMatchStartedPayload,
  type TwoVTwoParticipantResult,
} from '@crown-clash/game-core';
import { resolveFeatureFlags, type FeatureFlags } from '../config/featureFlags.js';

export type LiveMatchMode = 'queue' | 'create' | 'join' | 'queue_2v2';

const LIVE_CONNECT_TIMEOUT_MS = 15_000;

// ── 2v2 bounded queue recovery (docs/2v2-architecture.md §3.2.3) ──────────
// Each 2v2 queue attempt gets the same 15s boundary as 1v1; a failed or
// expired attempt resubmits a FRESH ticket after backoff, at most 3 times,
// and never downgrades to a different mode.
const QUEUE_2V2_TIMEOUT_MS = LIVE_CONNECT_TIMEOUT_MS;
const QUEUE_2V2_MAX_RETRIES = 3;
const QUEUE_2V2_RETRY_DELAYS_MS = [5_000, 10_000, 20_000] as const;

// ── 2v2 reconnect (§5.1) ──────────────────────────────────────────────────
// The server keeps the slot for 30 seconds; the client stays inside that
// window with bounded retries and treats exhaustion as terminal.
const TWO_V_TWO_RECONNECT_WINDOW_MS = 25_000;
const TWO_V_TWO_RECONNECT_FIRST_DELAY_MS = 500;
const TWO_V_TWO_RECONNECT_RETRY_DELAY_MS = 2_000;
const TWO_V_TWO_RESYNC_TIMEOUT_MS = 5_000;

// Matchmaker ticket for 2v2 (§3.2.1). The server hook overwrites the query
// and properties from authoritative state; these values declare intent.
const TWO_V_TWO_TICKET_QUERY = '*';
const TWO_V_TWO_TICKET_MIN = 4;
const TWO_V_TWO_TICKET_MAX = 4;
const TWO_V_TWO_TICKET_PROPERTIES = { mode: '2v2', schema: '2' } as const;

/** Rejoin rejections that are terminal for the slot (no retry can help). */
const TERMINAL_REJOIN_CODES = new Set([
  'live_match_finished',
  'live_match_not_authorized',
  'live_match_full',
  'not_in_match',
  'match_join_failed',
  // Surrendered (§5.3) and grace-expired (§5.0) slots are closed server-side:
  // no retry can restore them.
  'slot_not_reconnectable',
]);

export interface LiveMatchResult {
  matchId: string;
  status: 'victory' | 'defeat' | 'draw';
  stats: MatchStats;
  settlement: MatchSettlement;
}

export interface LiveMatchStarted {
  matchId: string;
  role: 'player' | 'enemy';
  playerName: string;
  opponentName: string;
  state: GameState;
}

export interface LiveMatchError {
  code: string;
  sequence?: number;
}

/** Version-2 match start / reconnect resync snapshot (§3.3 opcode 2). */
export interface LiveMatchStarted2v2 {
  matchId: string;
  slot: Slot;
  teamId: TeamId;
  nextSequence: number;
  players: readonly TwoVTwoRosterEntry[];
  state: GameState;
}

export interface LiveMatchState2v2 {
  tick: number;
  state: GameState;
}

/** Version-2 per-participant result (§3.3 opcode 7), or a cancelled match. */
export interface LiveMatchResult2v2 {
  matchId: string;
  winnerTeamId?: TeamId;
  outcome?: 'cancelled';
  participants?: readonly TwoVTwoParticipantResult[];
}

export interface LiveMatchReconnectState {
  matchId: string;
  slot: Slot;
  teamId: TeamId;
  nextSequence: number;
}

export type LiveMatchEventMap = {
  ready: undefined;
  queue_waiting: undefined;
  invite_created: { roomCode: string };
  invite_waiting: undefined;
  match_started: LiveMatchStarted;
  state: GameState;
  command_accepted: { sequence: number };
  command_rejected: LiveMatchError;
  match_result: LiveMatchResult;
  error: LiveMatchError;
  closed: undefined;
  // Version-2 (2v2) events. 1v1 consumers never receive these.
  match_started_2v2: LiveMatchStarted2v2;
  state_2v2: LiveMatchState2v2;
  command_accepted_2v2: { sequence: number; slot: Slot };
  command_rejected_2v2: LiveMatchError;
  match_result_2v2: LiveMatchResult2v2;
  rematch_started: { matchId: string };
  reconnecting: { matchId: string; attempt: number };
  reconnected: LiveMatchReconnectState;
  reconnect_failed: { matchId: string; code: string };
  // The finished match closed after the rematch window expired (§2.6):
  // the session is terminal and the player drops to the menu.
  expired: { matchId: string };
};

type LiveMatchEvent = {
  [K in keyof LiveMatchEventMap]: { type: K } & (LiveMatchEventMap[K] extends undefined
    ? {}
    : { payload: LiveMatchEventMap[K] });
}[keyof LiveMatchEventMap];

interface LiveServerPayload {
  type: string;
  code?: string;
  roomCode?: string;
  matchId?: string;
  role?: 'player' | 'enemy';
  playerName?: string;
  opponentName?: string;
  state?: GameState;
  sequence?: number;
  result?: LiveMatchResult;
}

const OP_MATCH_STARTED = 2;
const OP_STATE = 3;
const OP_COMMAND_ACCEPTED = 5;
const OP_COMMAND_REJECTED = 6;
const OP_MATCH_RESULT = 7;
const OP_ERROR = 8;
const OP_MATCH_CLOSED = 9;
const OP_DISPATCH = 1;

function parseLiveErrorCode(err: unknown, fallback: string): string {
  if (!err) return fallback;
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: string };
    if (parsed && typeof parsed.message === 'string' && parsed.message) {
      return parsed.message;
    }
    if (parsed && typeof parsed.error === 'string' && parsed.error) {
      return parsed.error;
    }
  } catch { /* ignore */ }
  if (raw.includes('invite_not_found')) return 'invite_not_found';
  if (raw.includes('live_match_full')) return 'live_match_full';
  if (raw.includes('live_match_invalid_code')) return 'live_match_invalid_code';
  if (raw.includes('live_match_finished')) return 'live_match_finished';
  if (raw.includes('live_match_not_authorized')) return 'live_match_not_authorized';
  if (raw.includes('live_connection_timeout')) return 'live_connection_timeout';
  if (raw.includes('missing_room_code')) return 'missing_room_code';
  if (raw.includes('two_v2_disabled')) return 'two_v2_disabled';
  if (raw.includes('queue_2v2_failed')) return 'queue_2v2_failed';
  if (raw.includes('two_v2_session_in_progress')) return 'two_v2_session_in_progress';
  return raw || fallback;
}

/** Creates a fresh connected socket for the same authenticated session. */
export type LiveMatchSocketTransport = () => Promise<Socket>;

export interface LiveMatchClientOptions {
  /** Feature flags; defaults to the process-wide resolved flags. */
  readonly flags?: FeatureFlags;
  /**
   * Opens a NEW connected socket for reconnecting an active 2v2 match.
   * Without it, socket loss during a 2v2 match is terminal immediately.
   */
  readonly reconnectTransport?: LiveMatchSocketTransport;
}

type TwoVTwoSessionPhase =
  | 'connecting'
  | 'active'
  | 'reconnecting'
  | 'reconnect_failed'
  | 'finished'
  | 'cancelled'
  | 'expired';

interface TwoVTwoSession {
  phase: TwoVTwoSessionPhase;
  rawMatchId: string;
  canonicalMatchId: string | null;
  slot: Slot | null;
  teamId: TeamId | null;
  roster: readonly TwoVTwoRosterEntry[] | null;
  nextSequence: number;
  /** Highest authoritative tick applied; lower-or-equal ticks are ignored. */
  lastAppliedTick: number;
  /** Server-accepted sequences: restored sessions never replay these. */
  acceptedSequences: Set<number>;
  /** Sent but not yet acked; dropped on resync, dropped on rejection. */
  pendingSequences: Set<number>;
  socket: Socket;
  reconnect: {
    attempts: number;
    attemptTimer: ReturnType<typeof setTimeout> | null;
    resyncTimer: ReturnType<typeof setTimeout> | null;
    deadlineTimer: ReturnType<typeof setTimeout> | null;
  } | null;
}

interface TwoVTwoQueueState {
  attempt: number;
  ticket: string | null;
  queueTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Real-time live PvP client backed by the Nakama socket API.
 *
 * Public interface matches the previous raw-WebSocket implementation so
 * MenuScene and GameScene need no event-name changes. Internally it uses
 * the Nakama matchmaker for queue mode, RPCs for invite create/join, and
 * authoritative match data for state propagation.
 *
 * Phase 4 adds the version-2 layer for 2v2 (`queue_2v2` mode): a flagged,
 * four-player ticket with bounded queue recovery, strictly validated v2
 * payloads, and slot-preserving reconnect within the server's grace window.
 * The 1v1 paths are untouched; 1v1 and 2v2 queue state never mix.
 */
export class LiveMatchClient {
  private readonly socket: Socket;
  private matchId: string | null = null;
  private matchmakerTicket: string | null = null;
  private readonly listeners = new Map<
    keyof LiveMatchEventMap,
    Set<(payload: LiveMatchEventMap[keyof LiveMatchEventMap]) => void>
  >();
  private nextSequence = 0;
  private intentionallyClosed = false;
  private lastSettledMatchId: string | null = null;
  private readonly flags: FeatureFlags;
  private readonly reconnectTransport: LiveMatchSocketTransport | null;
  private activeMode: LiveMatchMode | null = null;
  // Monotonic epoch: event handlers bound to an older socket become inert
  // the moment a newer socket is adopted (stale sessions cannot act).
  private socketEpoch = 0;
  private twoVTwoQueue: TwoVTwoQueueState | null = null;
  private v2: TwoVTwoSession | null = null;

  constructor(socket: Socket, options: LiveMatchClientOptions = {}) {
    this.socket = socket;
    this.flags = options.flags ?? resolveFeatureFlags();
    this.reconnectTransport = options.reconnectTransport ?? null;
    this.bindSocketHandlers(socket);
  }

  public on<K extends keyof LiveMatchEventMap>(
    type: K,
    listener: (payload: LiveMatchEventMap[K]) => void
  ): () => void {
    const listeners =
      this.listeners.get(type) ||
      new Set<(payload: LiveMatchEventMap[keyof LiveMatchEventMap]) => void>();
    listeners.add(listener as (payload: LiveMatchEventMap[keyof LiveMatchEventMap]) => void);
    this.listeners.set(type, listeners);
    return () => listeners.delete(listener as (payload: LiveMatchEventMap[keyof LiveMatchEventMap]) => void);
  }

  public connect(mode: LiveMatchMode, roomCode?: string): Promise<void> {
    this.intentionallyClosed = false;
    this.nextSequence = 0;

    if (mode === 'queue_2v2') {
      return this.connectQueue2v2();
    }

    // A legacy 1v1/invite connection must never overlap a 2v2 queue or
    // session on the same socket. This is a protocol boundary, not merely a
    // UI assumption.
    if (this.twoVTwoQueue || this.v2 || this.activeMode === 'queue_2v2') {
      return Promise.reject(new Error('two_v2_session_in_progress'));
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('live_connection_timeout'));
      }, LIVE_CONNECT_TIMEOUT_MS);

      const settle = (err?: Error) => {
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve();
      };

      if (mode === 'queue') {
        this.socket
          .addMatchmaker('', 2, 2)
          .then((ticket) => {
            this.matchmakerTicket = ticket.ticket;
            this.emit({ type: 'queue_waiting' });
            settle();
          })
          .catch((err) => settle(new Error(parseLiveErrorCode(err, 'matchmaker_failed'))));
        return;
      }

      if (mode === 'create') {
        this.socket
          .rpc('pvp/create_invite', '')
          .then((rpcResult) => {
            const data = JSON.parse(rpcResult.payload ?? '') as { matchId: string; inviteCode: string };
            this.matchId = data.matchId;
            this.emit({ type: 'invite_created', payload: { roomCode: data.inviteCode } });
            return this.socket.joinMatch(data.matchId, undefined, { code: data.inviteCode });
          })
          .then(() => {
            this.emit({ type: 'invite_waiting' });
            settle();
          })
          .catch((err) => settle(new Error(parseLiveErrorCode(err, 'invite_create_failed'))));
        return;
      }

      if (mode === 'join') {
        if (!roomCode) {
          settle(new Error('missing_room_code'));
          return;
        }
        this.socket
          .rpc('pvp/join_invite', JSON.stringify({ inviteCode: roomCode }))
          .then((rpcResult) => {
            const data = JSON.parse(rpcResult.payload ?? '') as { matchId: string };
            this.matchId = data.matchId;
            return this.socket.joinMatch(data.matchId, undefined, { code: roomCode });
          })
          .then(() => settle())
          .catch((err) => settle(new Error(parseLiveErrorCode(err, 'invite_join_failed'))));
        return;
      }

      settle(new Error('unknown_live_mode'));
    });
  }

  public sendDispatch(sourceId: string, targetId: string): number {
    if (this.v2) {
      return this.sendTwoVTwoDispatch(sourceId, targetId);
    }
    if (!this.matchId) {
      throw new Error('live_connection_not_open');
    }
    const sequence = this.nextSequence++;
    void this.socket.sendMatchState(
      this.matchId,
      OP_DISPATCH,
      JSON.stringify({ type: 'dispatch', sequence, sourceId, targetId })
    );
    return sequence;
  }

  /** Version-2 controls (§3.3), each constrained to its valid match phases. */
  public sendReady(): void {
    this.sendTwoVTwoControl(createTwoVTwoReadyMessage(), ['connecting', 'active']);
  }

  public sendSurrender(): void {
    this.sendTwoVTwoControl(createTwoVTwoSurrenderMessage(), ['connecting', 'active']);
  }

  public sendRematchVote(): void {
    this.sendTwoVTwoControl(createTwoVTwoRematchVoteMessage(), ['finished']);
  }

  public close(): void {
    this.intentionallyClosed = true;
    const session = this.v2;
    this.teardownTwoVTwoQueue();
    this.teardownTwoVTwoReconnectTimers();
    if (this.matchId) {
      void this.socket.leaveMatch(this.matchId).catch(() => undefined);
      this.matchId = null;
    } else if (session && session.rawMatchId) {
      void session.socket.leaveMatch(session.rawMatchId).catch(() => undefined);
    }
    if (this.matchmakerTicket) {
      void this.socket.removeMatchmaker(this.matchmakerTicket).catch(() => undefined);
      this.matchmakerTicket = null;
    }
    this.detachCurrentSocketHandlers();
    this.v2 = null;
    this.activeMode = null;
  }

  private bindSocketHandlers(socket: Socket): void {
    const epoch = ++this.socketEpoch;
    socket.onmatchdata = (data) => {
      if (epoch === this.socketEpoch) this.handleMatchData(data);
    };
    socket.onmatchmakermatched = (matched: { match_id: string; token: string }) => {
      if (epoch === this.socketEpoch) this.handleMatchmakerMatched(matched);
    };
    socket.ondisconnect = () => {
      if (epoch !== this.socketEpoch) return;
      if (this.intentionallyClosed) return;
      if (this.v2 && this.v2.phase === 'active') {
        // Unexpected socket loss during an active 2v2 match: reconnect.
        this.beginTwoVTwoReconnect();
        return;
      }
      this.emit({ type: 'closed' });
    };
  }

  private detachCurrentSocketHandlers(): void {
    // Epoch invalidation plus explicit noop detatch: a stale pre-disconnect
    // socket can never deliver data after a newer session takes over.
    this.socketEpoch++;
    for (const socket of this.collectBoundSockets()) {
      socket.onmatchdata = () => {};
      socket.onmatchmakermatched = () => {};
      socket.ondisconnect = () => {};
    }
  }

  private collectBoundSockets(): Socket[] {
    const sockets = new Set<Socket>([this.socket]);
    if (this.v2) sockets.add(this.v2.socket);
    return [...sockets];
  }

  // ── 2v2 matchmaking (§3.2.1/§3.2.3) ────────────────────────────────────

  private connectQueue2v2(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const settle = (err?: Error) => {
        if (err) reject(err);
        else resolve();
      };
      if (!this.flags.enable2v2) {
        // Flag boundary: when disabled, no 2v2 ticket can ever be submitted.
        settle(new Error('two_v2_disabled'));
        return;
      }
      if (this.twoVTwoQueue || this.v2 || this.matchmakerTicket || this.matchId) {
        settle(new Error('two_v2_session_in_progress'));
        return;
      }
      this.activeMode = 'queue_2v2';
      this.twoVTwoQueue = { attempt: 0, ticket: null, queueTimer: null, retryTimer: null };
      this.submitTwoVTwoTicket(settle);
    });
  }

  private submitTwoVTwoTicket(settle: (err?: Error) => void): void {
    const queue = this.twoVTwoQueue;
    if (!queue || this.intentionallyClosed) return;
    // Every attempt submits a fresh ticket (never reuse a ticket id).
    this.socket
      .addMatchmaker(TWO_V_TWO_TICKET_QUERY, TWO_V_TWO_TICKET_MIN, TWO_V_TWO_TICKET_MAX, {
        ...TWO_V_TWO_TICKET_PROPERTIES,
      })
      .then((ticket) => {
        if (!this.twoVTwoQueue || this.twoVTwoQueue !== queue || this.intentionallyClosed) return;
        queue.ticket = ticket.ticket;
        this.emit({ type: 'queue_waiting' });
        queue.queueTimer = setTimeout(() => {
          if (!this.twoVTwoQueue || this.twoVTwoQueue !== queue) return;
          // Bounded queue timeout: drop the stale ticket and retry.
          this.removeTwoVTwoTicket(queue);
          queue.queueTimer = null;
          this.scheduleTwoVTwoRetry(settle, 'queue_2v2_timeout');
        }, QUEUE_2V2_TIMEOUT_MS);
        settle();
      })
      .catch((err) => {
        if (!this.twoVTwoQueue || this.twoVTwoQueue !== queue || this.intentionallyClosed) return;
        this.scheduleTwoVTwoRetry(settle, parseLiveErrorCode(err, 'matchmaker_failed'));
      });
  }

  private scheduleTwoVTwoRetry(settle: (err?: Error) => void, _reason: string): void {
    const queue = this.twoVTwoQueue;
    if (!queue || this.twoVTwoQueue !== queue || this.intentionallyClosed) return;
    if (queue.attempt >= QUEUE_2V2_MAX_RETRIES) {
      // Terminal failure. Never silently downgrade to 1v1.
      this.teardownTwoVTwoQueue();
      this.emit({ type: 'error', payload: { code: 'queue_2v2_failed' } });
      settle(new Error('queue_2v2_failed'));
      return;
    }
    const delay = QUEUE_2V2_RETRY_DELAYS_MS[queue.attempt];
    queue.attempt++;
    queue.retryTimer = setTimeout(() => {
      if (!this.twoVTwoQueue || this.twoVTwoQueue !== queue || this.intentionallyClosed) return;
      queue.retryTimer = null;
      this.submitTwoVTwoTicket(settle);
    }, delay);
  }

  private removeTwoVTwoTicket(queue: TwoVTwoQueueState): void {
    if (!queue.ticket) return;
    const ticket = queue.ticket;
    queue.ticket = null;
    void this.socket.removeMatchmaker(ticket).catch(() => undefined);
  }

  private teardownTwoVTwoQueue(): void {
    const queue = this.twoVTwoQueue;
    if (!queue) return;
    this.twoVTwoQueue = null;
    if (queue.queueTimer) clearTimeout(queue.queueTimer);
    if (queue.retryTimer) clearTimeout(queue.retryTimer);
    this.removeTwoVTwoTicket(queue);
  }

  // ── 2v2 match session ──────────────────────────────────────────────────

  private sendTwoVTwoDispatch(sourceId: string, targetId: string): number {
    const session = this.v2;
    // Only a fully active session can act: reconnecting, reconnect-failed
    // (terminal abandoned), finished, and cancelled sessions all fail closed.
    if (!session || session.phase !== 'active') {
      throw new Error('two_v2_not_active');
    }
    const sequence = session.nextSequence++;
    session.pendingSequences.add(sequence);
    void session.socket
      .sendMatchState(session.rawMatchId, OP_DISPATCH, createTwoVTwoDispatchMessage(sequence, sourceId, targetId))
      .catch(() => {
        // Delivery is ambiguous: the server may have accepted the command
        // before the transport surfaced an error. Never roll the cursor
        // backwards or reuse a sequence; reconnect and let the authoritative
        // nextSequence resync decide what was consumed.
        if (this.v2 === session) {
          this.beginTwoVTwoReconnect();
        }
      });
    return sequence;
  }

  private sendTwoVTwoControl(message: string, allowedPhases: readonly TwoVTwoSessionPhase[]): void {
    const session = this.v2;
    if (!session || !allowedPhases.includes(session.phase)) {
      throw new Error('two_v2_not_active');
    }
    void session.socket
      .sendMatchState(session.rawMatchId, OP_DISPATCH, message)
      .catch(() => {
        if (this.v2 === session && session.phase === 'active') {
          this.beginTwoVTwoReconnect();
        }
      });
  }

  private handleMatchmakerMatched(matched: { match_id: string; token: string }): void {
    if (this.activeMode === 'queue_2v2') {
      // Queue complete: stop the recovery timers; keep queue state for
      // close() ticket cleanup until the join resolves. The raw match id is
      // tracked in the v2 session only — 1v1 queue state is never touched.
      const queue = this.twoVTwoQueue;
      if (queue) {
        if (queue.queueTimer) clearTimeout(queue.queueTimer);
        if (queue.retryTimer) clearTimeout(queue.retryTimer);
        this.twoVTwoQueue = null;
      }
      this.v2 = {
        phase: 'connecting',
        rawMatchId: matched.match_id,
        canonicalMatchId: null,
        slot: null,
        teamId: null,
        roster: null,
        nextSequence: 0,
        lastAppliedTick: -1,
        acceptedSequences: new Set(),
        pendingSequences: new Set(),
        socket: this.socket,
        reconnect: null,
      };
      void this.socket
        .joinMatch(matched.match_id, matched.token)
        .then(() => {
          // The server's ready handshake occurs before match_started, so the
          // client must signal readiness while the local session is still in
          // its connecting phase.
          if (this.v2 && this.v2.rawMatchId === matched.match_id && this.v2.phase === 'connecting') {
            this.sendReady();
          }
        })
        .catch(() => this.emit({ type: 'error', payload: { code: 'match_join_failed' } }));
      return;
    }
    this.matchId = matched.match_id;
    void this.socket
      .joinMatch(matched.match_id, matched.token)
      .catch(() => this.emit({ type: 'error', payload: { code: 'match_join_failed' } }));
  }

  private handleMatchData(data: { op_code: number; data: Uint8Array }): void {
    let payload: LiveServerPayload & { schemaVersion?: number };
    try {
      const raw = new TextDecoder().decode(data.data);
      payload = JSON.parse(raw) as LiveServerPayload & { schemaVersion?: number };
    } catch {
      return;
    }

    // Version-2 payloads are validated strictly before any state change;
    // malformed, wrong-schema, or impossible messages fail closed here.
    if (payload && payload.schemaVersion === 2) {
      this.handleTwoVTwoPayload(data.op_code, payload);
      return;
    }
    // A 2v2 session must never be mutated by legacy-shaped payloads.
    if (this.v2) {
      return;
    }

    switch (data.op_code) {
      case OP_MATCH_STARTED:
        this.emit({
          type: 'match_started',
          payload: {
            matchId: payload.matchId || '',
            role: payload.role || 'player',
            playerName: payload.playerName || 'Commander',
            opponentName: payload.opponentName || 'Opponent',
            state: payload.state as GameState,
          },
        });
        return;
      case OP_STATE:
        this.emit({ type: 'state', payload: payload.state as GameState });
        return;
      case OP_COMMAND_ACCEPTED:
        this.emit({
          type: 'command_accepted',
          payload: { sequence: payload.sequence || 0 },
        });
        return;
      case OP_COMMAND_REJECTED:
        this.emit({
          type: 'command_rejected',
          payload: {
            sequence: payload.sequence || 0,
            code: payload.code || 'command_rejected',
          },
        });
        return;
      case OP_MATCH_RESULT: {
        const result = payload.result as LiveMatchResult;
        if (!result || !result.matchId) return;
        if (this.lastSettledMatchId === result.matchId) {
          return;
        }
        this.lastSettledMatchId = result.matchId;
        this.emit({ type: 'match_result', payload: result });
        return;
      }
      case OP_ERROR:
        this.emit({ type: 'error', payload: { code: payload.code || 'live_error' } });
        return;
      default:
        return;
    }
  }

  private handleTwoVTwoPayload(opCode: number, envelope: { type?: string }): void {
    // parseTwoVTwoServerMessage returns null for anything malformed,
    // wrong-schema, or impossible: those never touch client state.
    const message = parseTwoVTwoServerMessage(envelope);
    if (!message) {
      return;
    }
    const expectedOpcode: Record<typeof message.kind, number> = {
      match_started: OP_MATCH_STARTED,
      state: OP_STATE,
      command_accepted: OP_COMMAND_ACCEPTED,
      command_rejected: OP_COMMAND_REJECTED,
      match_result: OP_MATCH_RESULT,
      rematch_started: OP_MATCH_STARTED,
      match_closed: OP_MATCH_CLOSED,
      error: OP_ERROR,
    };
    if (opCode !== expectedOpcode[message.kind]) return;
    const session = this.v2;
    switch (message.kind) {
      case 'match_started':
        this.handleTwoVTwoMatchStarted(message.payload);
        return;
      case 'state': {
        if (!session) return;
        // Stale snapshot guard: older-than-applied ticks are ignored.
        if (message.payload.tick <= session.lastAppliedTick) return;
        session.lastAppliedTick = message.payload.tick;
        this.emit({ type: 'state_2v2', payload: message.payload });
        return;
      }
      case 'command_accepted': {
        if (!session) return;
        const { sequence } = message.payload;
        if (session.slot === null || message.payload.slot !== session.slot) return;
        if (!session.pendingSequences.has(sequence)) {
          // Duplicate or stale ack (e.g. raced with a reconnect): ignore.
          return;
        }
        session.pendingSequences.delete(sequence);
        session.acceptedSequences.add(sequence);
        this.emit({ type: 'command_accepted_2v2', payload: message.payload });
        return;
      }
      case 'command_rejected': {
        if (!session) return;
        session.pendingSequences.delete(message.payload.sequence);
        this.emit({
          type: 'command_rejected_2v2',
          payload: { code: message.payload.code, sequence: message.payload.sequence },
        });
        return;
      }
      case 'match_result': {
        if (!session) return;
        const matchId = message.payload.matchId;
        if (session.canonicalMatchId !== matchId) return;
        if (this.lastSettledMatchId === matchId) return;
        this.lastSettledMatchId = matchId;
        session.phase = message.payload.outcome === 'cancelled' ? 'cancelled' : 'finished';
        this.emit({ type: 'match_result_2v2', payload: message.payload });
        return;
      }
      case 'rematch_started':
        if (!session || session.phase !== 'finished') return;
        this.beginTwoVTwoRematch(message.payload.matchId);
        this.emit({ type: 'rematch_started', payload: message.payload });
        return;
      case 'match_closed':
        // Rematch-window expiry (§2.6): the finished match is gone. Only a
        // finished session for the very match the server names may expire;
        // the phase becomes terminal so no reconnect can ever start, and
        // the GameScene drops to the menu. Duplicate deliveries are
        // absorbed: an expired session never re-emits.
        if (!session || session.phase !== 'finished') return;
        if (session.canonicalMatchId !== message.payload.matchId) return;
        session.phase = 'expired';
        this.emit({ type: 'expired', payload: { matchId: message.payload.matchId } });
        return;
      case 'error':
        this.emit({ type: 'error', payload: message.payload });
        return;
      default:
        return;
    }
  }

  private handleTwoVTwoMatchStarted(payload: TwoVTwoMatchStartedPayload): void {
    const session = this.v2;
    if (!session) return;
    if (session.phase === 'reconnecting') {
      // A resync is allowed to refresh state and sequence only; it cannot
      // move the authenticated player to another match, slot, or team.
      if (
        session.canonicalMatchId !== payload.matchId ||
        session.slot !== payload.slot ||
        session.teamId !== payload.teamId
      ) {
        return;
      }
      // Resync (§5.1): restore slot, team, roster, authoritative state, and
      // the server's next expected sequence. Accepted commands are never
      // replayed: pending predictions are dropped and the sequence cursor
      // becomes the server value.
      this.adoptTwoVTwoSession(session, payload);
      this.teardownTwoVTwoReconnectTimers();
      session.reconnect = null;
      session.phase = 'active';
      this.emit({ type: 'match_started_2v2', payload });
      this.emit({
        type: 'reconnected',
        payload: {
          matchId: payload.matchId,
          slot: payload.slot,
          teamId: payload.teamId,
          nextSequence: payload.nextSequence,
        },
      });
      return;
    }
    if (session.phase === 'connecting') {
      this.adoptTwoVTwoSession(session, payload);
      session.phase = 'active';
      this.emit({ type: 'match_started_2v2', payload });
      return;
    }
    // Duplicate or unsolicited resync while already active/finished:
    // fail closed, keep the applied state.
  }

  private adoptTwoVTwoSession(
    session: TwoVTwoSession,
    payload: TwoVTwoMatchStartedPayload
  ): void {
    session.canonicalMatchId = payload.matchId;
    session.slot = payload.slot;
    session.teamId = payload.teamId;
    session.roster = payload.players;
    // The server's cursor is authoritative (§5.1): restored sessions never
    // replay already accepted commands.
    session.nextSequence = payload.nextSequence;
    session.lastAppliedTick = -1;
    session.pendingSequences = new Set();
  }

  private beginTwoVTwoRematch(rawMatchId: string): void {
    const previous = this.v2;
    if (!previous || previous.phase === 'reconnect_failed') return;
    this.v2 = {
      phase: 'connecting',
      rawMatchId,
      canonicalMatchId: null,
      slot: null,
      teamId: null,
      roster: null,
      nextSequence: 0,
      lastAppliedTick: -1,
      acceptedSequences: new Set(),
      pendingSequences: new Set(),
      socket: previous.socket,
      reconnect: null,
    };
    void previous.socket
      .joinMatch(rawMatchId)
      .catch(() => this.emit({ type: 'error', payload: { code: 'match_join_failed' } }));
  }

  // ── 2v2 reconnect (§5.1) ───────────────────────────────────────────────

  private beginTwoVTwoReconnect(): void {
    const session = this.v2;
    if (!session || session.phase !== 'active' || this.intentionallyClosed) return;
    session.phase = 'reconnecting';
    session.reconnect = {
      attempts: 0,
      attemptTimer: null,
      resyncTimer: null,
      deadlineTimer: null,
    };
    this.emit({
      type: 'reconnecting',
      payload: { matchId: session.canonicalMatchId ?? '', attempt: 0 },
    });
    // Stay inside the server's 30s grace window with margin.
    session.reconnect.deadlineTimer = setTimeout(() => {
      this.finishTwoVTwoReconnect('reconnect_window_expired');
    }, TWO_V_TWO_RECONNECT_WINDOW_MS);
    this.scheduleTwoVTwoReconnectAttempt(TWO_V_TWO_RECONNECT_FIRST_DELAY_MS);
  }

  private scheduleTwoVTwoReconnectAttempt(delayMs: number): void {
    const session = this.v2;
    if (!session || session.phase !== 'reconnecting' || !session.reconnect) return;
    session.reconnect.attemptTimer = setTimeout(() => {
      void this.attemptTwoVTwoReconnect();
    }, delayMs);
  }

  private async attemptTwoVTwoReconnect(): Promise<void> {
    const session = this.v2;
    if (!session || session.phase !== 'reconnecting' || !session.reconnect) return;
    if (!this.reconnectTransport) {
      this.finishTwoVTwoReconnect('reconnect_unavailable');
      return;
    }
    let freshSocket: Socket | null = null;
    try {
      freshSocket = await this.reconnectTransport();
      if (
        !this.v2 ||
        this.v2 !== session ||
        session.phase !== 'reconnecting' ||
        this.intentionallyClosed
      ) {
        // Aborted mid-flight: never leave an orphan socket bound.
        this.detachSocketHandlers(freshSocket);
        try { freshSocket.disconnect(false); } catch { /* ignore */ }
        return;
      }
      // The stale pre-disconnect socket loses its handlers now.
      this.detachSocketHandlers(session.socket);
      session.socket = freshSocket;
      this.bindSocketHandlers(freshSocket);
      await freshSocket.joinMatch(session.rawMatchId);
      // Resync deadline: the server must send match_started (full snapshot
      // + nextSequence) before this socket is trusted.
      session.reconnect.resyncTimer = setTimeout(() => {
        if (!this.v2 || this.v2 !== session || session.phase !== 'reconnecting') return;
        if (session.socket === freshSocket) {
          this.detachSocketHandlers(freshSocket);
          try { freshSocket.disconnect(false); } catch { /* ignore */ }
        }
        this.scheduleNextTwoVTwoReconnectAttempt();
      }, TWO_V_TWO_RESYNC_TIMEOUT_MS);
    } catch (err) {
      if (freshSocket) {
        this.detachSocketHandlers(freshSocket);
        try { freshSocket.disconnect(false); } catch { /* ignore */ }
      }
      if (!this.v2 || this.v2 !== session || session.phase !== 'reconnecting') return;
      const code = parseLiveErrorCode(err, 'match_join_failed');
      if (TERMINAL_REJOIN_CODES.has(code)) {
        this.finishTwoVTwoReconnect(code);
        return;
      }
      this.scheduleNextTwoVTwoReconnectAttempt();
    }
  }

  private scheduleNextTwoVTwoReconnectAttempt(): void {
    const session = this.v2;
    if (!session || session.phase !== 'reconnecting' || !session.reconnect) return;
    session.reconnect.attempts++;
    this.emit({
      type: 'reconnecting',
      payload: {
        matchId: session.canonicalMatchId ?? '',
        attempt: session.reconnect.attempts,
      },
    });
    this.scheduleTwoVTwoReconnectAttempt(TWO_V_TWO_RECONNECT_RETRY_DELAY_MS);
  }

  private finishTwoVTwoReconnect(code: string): void {
    const session = this.v2;
    if (!session || session.phase !== 'reconnecting') return;
    this.teardownTwoVTwoReconnectTimers();
    session.reconnect = null;
    session.phase = 'reconnect_failed';
    this.emit({
      type: 'reconnect_failed',
      payload: { matchId: session.canonicalMatchId ?? '', code },
    });
  }

  private teardownTwoVTwoReconnectTimers(): void {
    const session = this.v2;
    if (!session || !session.reconnect) return;
    if (session.reconnect.attemptTimer) clearTimeout(session.reconnect.attemptTimer);
    if (session.reconnect.resyncTimer) clearTimeout(session.reconnect.resyncTimer);
    if (session.reconnect.deadlineTimer) clearTimeout(session.reconnect.deadlineTimer);
    session.reconnect.attemptTimer = null;
    session.reconnect.resyncTimer = null;
    session.reconnect.deadlineTimer = null;
  }

  private detachSocketHandlers(socket: Socket): void {
    socket.onmatchdata = () => {};
    socket.onmatchmakermatched = () => {};
    socket.ondisconnect = () => {};
  }

  private emit(event: LiveMatchEvent): void {
    const listeners = this.listeners.get(event.type);
    if (!listeners) return;
    const payload = 'payload' in event ? event.payload : undefined;
    listeners.forEach((listener) => listener(payload as never));
  }
}
