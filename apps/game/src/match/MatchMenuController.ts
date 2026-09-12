export type MatchMenuState = 'closed' | 'menu' | 'confirm';

export interface MatchQuitEvent {
  name: 'match_quit';
  matchId: string;
  mode: 'bot' | 'live';
  durationSeconds: number;
}

export interface MatchMenuDependencies {
  readonly liveMode: boolean;
  readonly matchId: string;
  getDurationSeconds: () => number;
  closeLiveClient?: () => void;
  trackQuit: (event: MatchQuitEvent) => boolean;
  onStateChange?: (state: MatchMenuState) => void;
  onExitConfirmed?: () => void;
  isModalVisible?: () => boolean;
}

export class MatchMenuController {
  private state: MatchMenuState = 'closed';
  private exiting = false;

  constructor(private readonly deps: MatchMenuDependencies) {}

  public getState(): MatchMenuState {
    return this.state;
  }

  public isOpen(): boolean {
    return this.state !== 'closed';
  }

  public isPaused(): boolean {
    // Bot simulation pauses while either modal is open.
    // Live authoritative simulation must not pause.
    if (this.deps.liveMode || !this.isOpen()) {
      return false;
    }
    // Guard against desynchronization where state is open but modal visual was destroyed/hidden
    if (this.deps.isModalVisible && !this.deps.isModalVisible()) {
      this.closeMenu();
      return false;
    }
    return true;
  }

  public reconcileVisualState(isModalVisible: boolean): void {
    if (!isModalVisible && this.isOpen()) {
      this.closeMenu();
    }
  }

  public isExiting(): boolean {
    return this.exiting;
  }

  public openMenu(): void {
    if (this.exiting) return;
    this.state = 'menu';
    this.deps.onStateChange?.(this.state);
  }

  public closeMenu(): void {
    if (this.exiting) return;
    this.state = 'closed';
    this.deps.onStateChange?.(this.state);
  }

  public openConfirm(): void {
    if (this.exiting) return;
    this.state = 'confirm';
    this.deps.onStateChange?.(this.state);
  }

  public backToMenu(): void {
    if (this.exiting) return;
    this.state = 'menu';
    this.deps.onStateChange?.(this.state);
  }

  /**
   * Platform back button handling:
   * - closed menu -> opens menu.
   * - open menu -> closes menu.
   * - confirmation -> steps back to previous modal (menu).
   * - never immediately abandons match without confirmation.
   */
  public handleBackButton(): void {
    if (this.exiting) return;
    if (this.state === 'confirm') {
      this.backToMenu();
    } else if (this.state === 'menu') {
      this.closeMenu();
    } else {
      this.openMenu();
    }
  }

  /**
   * Confirmed exit handler:
   * - Guarded by `this.exiting` for strict idempotency against repeated taps.
   * - Emits existing `match_quit` event exactly once.
   * - Live mode: calls `closeLiveClient()` to trigger server-authoritative forfeit.
   * - Bot mode: no settlement or rewards granted.
   * - Triggers `onExitConfirmed()` callback to return safely to MenuScene.
   */
  public confirmExit(): void {
    if (this.exiting) return;
    this.exiting = true;
    this.state = 'closed';

    const durationSeconds = this.deps.getDurationSeconds();
    this.deps.trackQuit({
      name: 'match_quit',
      matchId: this.deps.matchId,
      mode: this.deps.liveMode ? 'live' : 'bot',
      durationSeconds,
    });

    if (this.deps.liveMode && this.deps.closeLiveClient) {
      this.deps.closeLiveClient();
    }

    this.deps.onExitConfirmed?.();
  }

  public getConfirmationMessage(): string {
    return this.deps.liveMode
      ? 'Leaving forfeits this match.'
      : 'Current battle progress will be lost.';
  }
}
