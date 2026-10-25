export type LivePvpView =
  | 'lobby'
  | 'creating'
  | 'waiting'
  | 'entering_code'
  | 'joining'
  | 'queueing'
  | 'queueing_2v2'
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
    case 'two_v2_disabled':
      return 'نبرد ۲ در ۲ هنوز در دسترس نیست.\nلطفاً بازی را به‌روزرسانی کن.';
    case 'queue_2v2_failed':
      return 'نبرد ۲ در ۲ پیدا نشد.\nدوباره تلاش کن.';
    case 'invite_not_found':
      return 'اتاق نبرد پیدا نشد.\nکد را بررسی کن یا اتاق جدید بساز.';
    case 'live_match_full':
      return 'ظرفیت این اتاق پر است (۲ از ۲).';
    case 'live_match_invalid_code':
    case 'missing_room_code':
      return 'قالب کد نامعتبر است.\nکد اتاق ۸ حرف و عدد است.';
    case 'live_match_finished':
      return 'این نبرد قبلاً تمام شده است.';
    case 'live_match_not_authorized':
      return 'اجازهٔ ورود به این نبرد را نداری.';
    case 'live_connection_timeout':
      return 'اتصال زمان‌بر شد.\nاینترنتت را بررسی کن و دوباره تلاش کن.';
    case 'invite_create_failed':
      return 'ساخت اتاق نبرد ناموفق بود.\nدوباره تلاش کن.';
    case 'invite_join_failed':
      return 'ورود به اتاق ناموفق بود.\nکد را بررسی کن و دوباره تلاش کن.';
    case 'matchmaker_failed':
      return 'یافتن حریف ناموفق بود.\nدوباره تلاش کن.';
    case 'connection_closed':
      return 'اتصال به سرور قطع شد.\nدوباره تلاش کن.';
    default:
      return code ? `خطا: ${code}` : 'اتصال به نبرد آنلاین برقرار نشد.';
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
    if (this.view === 'creating' || this.view === 'joining' || this.view === 'queueing' || this.view === 'queueing_2v2') {
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
    if (this.view === 'creating' || this.view === 'joining' || this.view === 'queueing' || this.view === 'queueing_2v2') {
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
    if (this.view === 'creating' || this.view === 'joining' || this.view === 'queueing' || this.view === 'queueing_2v2') {
      return { success: false, error: 'درخواست قبلی در حال انجام است' };
    }
    const targetCode = code !== undefined ? sanitizeRoomCode(code) : this.roomCode;
    if (!isValidRoomCode(targetCode)) {
      const err = 'کد دعوت ۸ حرفی را وارد کن';
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
    if (this.view === 'creating' || this.view === 'joining' || this.view === 'queueing' || this.view === 'queueing_2v2') {
      return false;
    }
    this.view = 'queueing';
    this.errorMessage = '';
    this.copied = false;
    this.notify();
    return true;
  }

  /**
   * Enters the 2v2 queueing view. Distinct from the 1v1 queue so the UI can
   * show honest four-player progress copy and never silently downgrade.
   */
  public startQueueing2v2(): boolean {
    if (this.view === 'creating' || this.view === 'joining' || this.view === 'queueing' || this.view === 'queueing_2v2') {
      return false;
    }
    this.view = 'queueing_2v2';
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
