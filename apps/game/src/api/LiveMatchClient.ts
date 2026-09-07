import type {
  GameState,
  MatchSettlement,
  MatchStats,
} from '@crown-clash/game-core';

export type LiveMatchMode = 'queue' | 'create' | 'join';

const LIVE_CONNECT_TIMEOUT_MS = 10_000;

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

export class LiveMatchClient {
  private socket: WebSocket | null = null;
  private readonly listeners = new Map<
    keyof LiveMatchEventMap,
    Set<(payload: LiveMatchEventMap[keyof LiveMatchEventMap]) => void>
  >();
  private nextSequence = 0;
  private intentionallyClosed = false;

  constructor(
    private readonly baseUrl: string,
    private readonly sessionToken: string
  ) {}

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
    return new Promise((resolve, reject) => {
      const url = this.baseUrl.replace(/^http/, 'ws') + '/pvp/live';
      const socket = new WebSocket(url);
      this.socket = socket;

      const connectTimeout = setTimeout(() => {
        socket.close();
        reject(new Error('live_connection_timeout'));
      }, LIVE_CONNECT_TIMEOUT_MS);

      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'auth', token: this.sessionToken }));
      };
      socket.onmessage = (event) => {
        let message: LiveServerPayload;
        try {
          message = JSON.parse(event.data as string) as LiveServerPayload;
        } catch {
          return;
        }
        if (message.type === 'ready') {
          clearTimeout(connectTimeout);
          socket.send(JSON.stringify({ type: 'join', mode, roomCode }));
          resolve();
        }
        this.handleMessage(message);
      };
      socket.onerror = () => {
        if (this.socket === socket) {
          clearTimeout(connectTimeout);
          reject(new Error('live_connection_failed'));
        }
      };
      socket.onclose = () => {
        clearTimeout(connectTimeout);
        if (!this.intentionallyClosed) {
          this.emit({ type: 'closed' });
        }
      };
    });
  }

  public sendDispatch(sourceId: string, targetId: string): number {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('live_connection_not_open');
    }
    const sequence = this.nextSequence++;
    this.socket.send(
      JSON.stringify({
        type: 'dispatch',
        sequence,
        sourceId,
        targetId,
      })
    );
    return sequence;
  }

  public close(): void {
    this.intentionallyClosed = true;
    this.socket?.close();
    this.socket = null;
  }

  private handleMessage(message: LiveServerPayload): void {
    if (message.type === 'invite_created') {
      this.emit({ type: message.type, payload: { roomCode: message.roomCode || '' } });
      return;
    }
    if (message.type === 'command_accepted' || message.type === 'command_rejected') {
      this.emit({
        type: message.type,
        payload: {
          sequence: message.sequence || 0,
          ...(message.type === 'command_rejected' ? { code: message.code || 'command_rejected' } : {}),
        },
      } as LiveMatchEvent);
      return;
    }
    if (message.type === 'error') {
      this.emit({ type: 'error', payload: { code: message.code || 'live_error' } });
      return;
    }
    if (message.type === 'ready') {
      this.emit({ type: 'ready' });
      return;
    }
    if (message.type === 'queue_waiting') {
      this.emit({ type: 'queue_waiting' });
      return;
    }
    if (message.type === 'invite_waiting') {
      this.emit({ type: 'invite_waiting' });
      return;
    }
    if (message.type === 'match_started') {
      this.emit({
        type: 'match_started',
        payload: {
          matchId: message.matchId || '',
          role: message.role || 'player',
          playerName: message.playerName || 'Commander',
          opponentName: message.opponentName || 'Opponent',
          state: message.state as GameState,
        },
      });
      return;
    }
    if (message.type === 'state') {
      this.emit({ type: 'state', payload: message.state as GameState });
      return;
    }
    if (message.type === 'match_result') {
      this.emit({ type: 'match_result', payload: message.result as LiveMatchResult });
      return;
    }
    if (message.type === 'closed') {
      this.emit({ type: 'closed' });
    }
  }

  private emit(event: LiveMatchEvent): void {
    const listeners = this.listeners.get(event.type);
    if (!listeners) return;
    const payload = 'payload' in event ? event.payload : undefined;
    listeners.forEach((listener) => listener(payload as never));
  }
}
