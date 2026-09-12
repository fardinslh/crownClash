import {
  HapticImpactStyle,
  HapticNotificationType,
  PaymentInvoice,
  PaymentResult,
  PlatformAdapter,
  PlatformEventType,
  PlatformTheme,
  PlatformType,
  PlatformUser,
  ShareOptions,
} from './types.js';

export class BrowserPlatformAdapter implements PlatformAdapter {
  readonly platform: PlatformType = 'browser';

  private user: PlatformUser;
  private backButtonCallback: (() => void) | null = null;
  private listeners: Map<PlatformEventType, Set<() => void>> = new Map();

  constructor() {
    this.user = this.loadOrCreateGuestUser();
  }

  async initialize(): Promise<void> {
    // Listen for resize / viewport events
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.emit('viewportChanged'));
      window.addEventListener('popstate', () => {
        this.emit('backButtonClicked');
        if (this.backButtonCallback) {
          this.backButtonCallback();
        }
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.emit('appPaused');
        } else {
          this.emit('appResumed');
        }
      });
    }
  }

  ready(): void {
    // No-op in standard browser
  }

  getUser(): PlatformUser {
    return this.user;
  }

  getInitDataRaw(): string {
    // Query string or synthetic dev auth token
    if (typeof window !== 'undefined' && window.location?.search) {
      return window.location.search.slice(1);
    }
    return `auth_date=${Math.floor(Date.now() / 1000)}&user=${encodeURIComponent(
      JSON.stringify(this.user)
    )}&hash=dev_mock_hash`;
  }

  getTheme(): PlatformTheme {
    const isDark =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches;

    return {
      bgColor: isDark ? '#0a0f1d' : '#f8fafc',
      textColor: isDark ? '#f8fafc' : '#0a0f1d',
      accentColor: '#3b82f6',
      surfaceColor: isDark ? '#1e293b' : '#ffffff',
      buttonColor: '#3b82f6',
      buttonTextColor: '#ffffff',
      isDark: isDark ?? true,
    };
  }

  hapticImpact(style: HapticImpactStyle): void {
    if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;

    try {
      switch (style) {
        case 'light':
        case 'soft':
          navigator.vibrate(10);
          break;
        case 'medium':
        case 'rigid':
          navigator.vibrate(22);
          break;
        case 'heavy':
          navigator.vibrate(40);
          break;
      }
    } catch {
      // Ignored
    }
  }

  hapticNotification(type: HapticNotificationType): void {
    if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;

    try {
      switch (type) {
        case 'success':
          navigator.vibrate([25, 40, 50]);
          break;
        case 'warning':
          navigator.vibrate([40, 30, 40]);
          break;
        case 'error':
          navigator.vibrate([50, 40, 50, 40, 60]);
          break;
      }
    } catch {
      // Ignored
    }
  }

  hapticSelection(): void {
    if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
    try {
      navigator.vibrate(8);
    } catch {
      // Ignored
    }
  }

  expand(): void {
    // Browser viewport is already managed by document/window
  }

  async requestFullscreen(): Promise<boolean> {
    if (typeof document === 'undefined') return false;

    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        return true;
      }
    } catch {
      // Fullscreen not permitted
    }
    return false;
  }

  showBackButton(onClick: () => void): void {
    this.backButtonCallback = onClick;
  }

  hideBackButton(): void {
    this.backButtonCallback = null;
  }

  triggerBackButton(): void {
    this.emit('backButtonClicked');
    if (this.backButtonCallback) {
      this.backButtonCallback();
    }
  }

  openLink(url: string): void {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  async share(options: ShareOptions): Promise<boolean> {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({
          title: 'Crown Clash',
          text: options.text,
          url: options.url || (typeof window !== 'undefined' ? window.location.href : ''),
        });
        return true;
      } catch {
        // User cancelled or share failed
      }
    }

    // Fallback: copy to clipboard
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        const fullContent = options.url ? `${options.text} ${options.url}` : options.text;
        await navigator.clipboard.writeText(fullContent);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  async requestPayment(_invoice: PaymentInvoice): Promise<PaymentResult> {
    // Mock browser payment for testing
    return {
      status: 'pending',
      error: 'Payments are not supported in standard browser preview',
    };
  }

  on(event: PlatformEventType, callback: () => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  close(): void {
    if (typeof window !== 'undefined') {
      window.close();
    }
  }

  private emit(event: PlatformEventType): void {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error(`[Platform:browser] Error in ${event} listener:`, err);
      }
    });
  }

  private loadOrCreateGuestUser(): PlatformUser {
    if (typeof window === 'undefined') {
      return { id: 'server_guest', username: 'Guest' };
    }

    // Check query params (?user_id=...&name=...)
    try {
      const params = new URLSearchParams(window.location.search);
      const qId = params.get('user_id');
      const qName = params.get('username') || params.get('name');
      if (qId) {
        return {
          id: qId,
          username: qName || `Player_${qId.slice(-4)}`,
          firstName: qName || 'Player',
        };
      }
    } catch {
      // Ignore URL parsing errors
    }

    // Check LocalStorage
    try {
      const stored = window.localStorage.getItem('crown_clash_guest_user');
      if (stored) {
        return JSON.parse(stored);
      }

      const randomId = Math.floor(1000 + Math.random() * 9000).toString();
      const guestUser: PlatformUser = {
        id: `guest_${randomId}`,
        username: `Commander_${randomId}`,
        firstName: 'Commander',
      };
      window.localStorage.setItem('crown_clash_guest_user', JSON.stringify(guestUser));
      return guestUser;
    } catch {
      return { id: 'guest_fallback', username: 'Commander' };
    }
  }
}
