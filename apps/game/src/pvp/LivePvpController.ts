export type LivePvpView =
  | 'lobby'
  | 'creating'
  | 'waiting'
  | 'entering_code'
  | 'joining'
  | 'queueing'
  | 'error';

export interface LivePvpState {
  view: LivePvpView;
  roomCode: string;
  errorMessage: string;
  copied: boolean;
}

export type LivePvpListener = (state: LivePvpState) => void;

export function sanitizeRoomCode(raw: string): string {
  if (!raw) return '';
  return raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase().slice(0, 8);
}

export function isValidRoomCode(code: string): boolean {
  return /^[0-9A-F]{8}$/.test(code);
}

export function mapLivePvpError(code: string): string {
  switch (code) {
    case 'invite_not_found':
      return 'Battle room not found.\nCheck the code or create a new room.';
    case 'live_match_full':
      return 'This battle room is already full (2/2 players).';
    case 'live_match_invalid_code':
    case 'missing_room_code':
      return 'Invalid code format.\nRoom codes are 8 letters and numbers.';
    case 'live_match_finished':
      return 'This battle has already finished.';
    case 'live_match_not_authorized':
      return 'You are not authorized to join this match.';
    case 'live_connection_timeout':
      return 'Connection timed out.\nPlease check your connection and retry.';
    case 'invite_create_failed':
      return 'Could not create battle room.\nPlease try again.';
    case 'invite_join_failed':
      return 'Could not join battle room.\nPlease check code and try again.';
    case 'matchmaker_failed':
      return 'Matchmaking failed.\nPlease try again.';
    case 'connection_closed':
      return 'Connection to server was closed.\nPlease try again.';
    default:
      return code ? `Error: ${code}` : 'Could not connect to Live PvP.';
  }
}

export class LivePvpController {
  private view: LivePvpView = 'lobby';
  private roomCode = '';
  private errorMessage = '';
  private copied = false;
  private copyResetTimer?: ReturnType<typeof setTimeout>;
  private readonly listeners = new Set<LivePvpListener>();

  constructor(initialCode = '') {
    if (initialCode) {
      this.roomCode = sanitizeRoomCode(initialCode);
    }
  }

  public getState(): LivePvpState {
    return {
      view: this.view,
      roomCode: this.roomCode,
      errorMessage: this.errorMessage,
      copied: this.copied,
    };
  }

  public subscribe(listener: LivePvpListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  public startCreating(): boolean {
    if (this.view === 'creating' || this.view === 'joining' || this.view === 'queueing') {
      return false;
    }
    this.view = 'creating';
    this.errorMessage = '';
    this.copied = false;
    this.notify();
    return true;
  }

  public onInviteCreated(code: string): void {
    this.view = 'waiting';
    this.roomCode = sanitizeRoomCode(code);
    this.errorMessage = '';
    this.copied = false;
    this.notify();
  }

  public startEnteringCode(): boolean {
    if (this.view === 'creating' || this.view === 'joining' || this.view === 'queueing') {
      return false;
    }
    this.view = 'entering_code';
    this.errorMessage = '';
    this.copied = false;
    this.notify();
    return true;
  }

  public setRoomCode(code: string): void {
    this.roomCode = sanitizeRoomCode(code);
    this.errorMessage = '';
    this.notify();
  }

  public startJoining(code?: string): { success: boolean; error?: string } {
    if (this.view === 'creating' || this.view === 'joining' || this.view === 'queueing') {
      return { success: false, error: 'Request already in progress' };
    }
    const targetCode = code !== undefined ? sanitizeRoomCode(code) : this.roomCode;
    if (!isValidRoomCode(targetCode)) {
      const err = 'Enter the 8-character invite code';
      this.errorMessage = err;
      this.notify();
      return { success: false, error: err };
    }
    this.roomCode = targetCode;
    this.view = 'joining';
    this.errorMessage = '';
    this.notify();
    return { success: true };
  }

  public startQueueing(): boolean {
    if (this.view === 'creating' || this.view === 'joining' || this.view === 'queueing') {
      return false;
    }
    this.view = 'queueing';
    this.errorMessage = '';
    this.copied = false;
    this.notify();
    return true;
  }

  public onError(rawCode: string): void {
    this.view = 'error';
    this.errorMessage = mapLivePvpError(rawCode);
    this.copied = false;
    this.notify();
  }

  public markCopied(): void {
    this.copied = true;
    this.notify();
    if (this.copyResetTimer) {
      clearTimeout(this.copyResetTimer);
    }
    this.copyResetTimer = setTimeout(() => {
      this.copied = false;
      this.notify();
    }, 2000);
  }

  public cancel(): void {
    if (this.copyResetTimer) {
      clearTimeout(this.copyResetTimer);
    }
    this.view = 'lobby';
    this.roomCode = '';
    this.errorMessage = '';
    this.copied = false;
    this.notify();
  }

  public returnToLobby(): void {
    this.cancel();
  }

  public destroy(): void {
    if (this.copyResetTimer) {
      clearTimeout(this.copyResetTimer);
    }
    this.listeners.clear();
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('[LivePvpController] listener error:', err);
      }
    }
  }
}
