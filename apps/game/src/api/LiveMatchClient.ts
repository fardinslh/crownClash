import type { Socket } from '@heroiclabs/nakama-js';
import type {
  GameState,
  MatchSettlement,
  MatchStats,
} from '@crown-clash/game-core';

export type LiveMatchMode = 'queue' | 'create' | 'join';

const LIVE_CONNECT_TIMEOUT_MS = 15_000;

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
const OP_DISPATCH = 1;

/**
 * Real-time live PvP client backed by the Nakama socket API.
 *
 * Public interface matches the previous raw-WebSocket implementation so
 * MenuScene and GameScene need no event-name changes. Internally it uses
 * the Nakama matchmaker for queue mode, RPCs for invite create/join, and
 * authoritative match data for state propagation.
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
  private readonly onMatchData: (data: { op_code: number; data: Uint8Array }) => void;
  private readonly onMatchmakerMatched: (matched: { match_id: string; token: string }) => void;
  private readonly onDisconnect: (evt: Event) => void;

  constructor(socket: Socket) {
    this.socket = socket;
    this.onMatchData = (data) => this.handleMatchData(data);
    this.onMatchmakerMatched = (matched) => this.handleMatchmakerMatched(matched);
    this.onDisconnect = () => {
      if (!this.intentionallyClosed) {
        this.emit({ type: 'closed' });
      }
    };
    this.socket.onmatchdata = this.onMatchData;
    this.socket.onmatchmakermatched = this.onMatchmakerMatched;
    this.socket.ondisconnect = this.onDisconnect;
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
          .catch((err) => settle(err instanceof Error ? err : new Error('matchmaker_failed')));
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
          .catch((err) => settle(err instanceof Error ? err : new Error('invite_create_failed')));
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
          .catch((err) => settle(err instanceof Error ? err : new Error('invite_join_failed')));
        return;
      }

      settle(new Error('unknown_live_mode'));
    });
  }

  public sendDispatch(sourceId: string, targetId: string): number {
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

  public close(): void {
    this.intentionallyClosed = true;
    if (this.matchId) {
      void this.socket.leaveMatch(this.matchId).catch(() => undefined);
      this.matchId = null;
    }
    if (this.matchmakerTicket) {
      void this.socket.removeMatchmaker(this.matchmakerTicket).catch(() => undefined);
      this.matchmakerTicket = null;
    }
  }

  private handleMatchmakerMatched(matched: { match_id: string; token: string }): void {
    this.matchId = matched.match_id;
    void this.socket
      .joinMatch(matched.match_id, matched.token)
      .catch(() => this.emit({ type: 'error', payload: { code: 'match_join_failed' } }));
  }

  private handleMatchData(data: { op_code: number; data: Uint8Array }): void {
    let payload: LiveServerPayload;
    try {
      const raw = new TextDecoder().decode(data.data);
      payload = JSON.parse(raw) as LiveServerPayload;
    } catch {
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
      case OP_MATCH_RESULT:
        this.emit({ type: 'match_result', payload: payload.result as LiveMatchResult });
        return;
      case OP_ERROR:
        this.emit({ type: 'error', payload: { code: payload.code || 'live_error' } });
        return;
      default:
        return;
    }
  }

  private emit(event: LiveMatchEvent): void {
    const listeners = this.listeners.get(event.type);
    if (!listeners) return;
    const payload = 'payload' in event ? event.payload : undefined;
    listeners.forEach((listener) => listener(payload as never));
  }
}
