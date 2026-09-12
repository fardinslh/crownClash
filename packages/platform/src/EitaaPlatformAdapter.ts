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

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    Eitaa?: any;
  }
}

export class EitaaPlatformAdapter implements PlatformAdapter {
  readonly platform: PlatformType = 'eitaa';

  private eitaaBridge: any = null;
  private user: PlatformUser;
  private backButtonCallback: (() => void) | null = null;
  private listeners: Map<PlatformEventType, Set<() => void>> = new Map();

  constructor() {
    if (typeof window !== 'undefined') {
      this.eitaaBridge = window.Eitaa || null;
    }
    this.user = this.extractEitaaUser();
  }

  async initialize(): Promise<void> {
    if (!this.eitaaBridge) return;

    try {
      this.eitaaBridge.ready?.();
      this.eitaaBridge.expand?.();

      this.eitaaBridge.onEvent?.('viewportChanged', () => this.emit('viewportChanged'));
      this.eitaaBridge.onEvent?.('backButtonClicked', () => {
        this.emit('backButtonClicked');
        if (this.backButtonCallback) {
          this.backButtonCallback();
        }
      });
    } catch (err) {
      console.warn('[Platform:eitaa] Failed during initialization:', err);
    }

    if (typeof document !== 'undefined') {
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
    try {
      this.eitaaBridge?.ready?.();
    } catch {
      // Ignored
    }
  }

  getUser(): PlatformUser {
    return this.user;
  }

  getInitDataRaw(): string {
    if (this.eitaaBridge?.initData) {
      return this.eitaaBridge.initData;
    }
    if (typeof window !== 'undefined' && window.location?.search) {
      return window.location.search.slice(1);
    }
    return '';
  }

  getTheme(): PlatformTheme {
    const isDark =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches;

    return {
      bgColor: isDark ? '#0a0f1d' : '#ffffff',
      textColor: isDark ? '#f8fafc' : '#0a0f1d',
      accentColor: '#e05a1e', // Eitaa distinctive orange tone
      surfaceColor: isDark ? '#1e293b' : '#fff7ed',
      buttonColor: '#e05a1e',
      buttonTextColor: '#ffffff',
      isDark: isDark ?? true,
    };
  }

  hapticImpact(style: HapticImpactStyle): void {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        const ms = style === 'heavy' ? 40 : style === 'medium' ? 22 : 10;
        navigator.vibrate(ms);
      } catch {
        // Ignored
      }
    }
  }

  hapticNotification(type: HapticNotificationType): void {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(type === 'success' ? [25, 40, 50] : [40, 30, 40]);
      } catch {
        // Ignored
      }
    }
  }

  hapticSelection(): void {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(8);
      } catch {
        // Ignored
      }
    }
  }

  expand(): void {
    try {
      this.eitaaBridge?.expand?.();
    } catch {
      // Ignored
    }
  }

  async requestFullscreen(): Promise<boolean> {
    try {
      if (typeof document !== 'undefined' && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        return true;
      }
    } catch {
      // Not permitted
    }
    return false;
  }

  showBackButton(onClick: () => void): void {
    this.backButtonCallback = onClick;
    try {
      this.eitaaBridge?.BackButton?.show?.();
    } catch {
      // Ignored
    }
  }

  hideBackButton(): void {
    this.backButtonCallback = null;
    try {
      this.eitaaBridge?.BackButton?.hide?.();
    } catch {
      // Ignored
    }
  }

  triggerBackButton(): void {
    this.emit('backButtonClicked');
    if (this.backButtonCallback) {
      this.backButtonCallback();
    }
  }

  openLink(url: string): void {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank');
    }
  }

  async share(options: ShareOptions): Promise<boolean> {
    try {
      const shareUrl = options.url ? `&url=${encodeURIComponent(options.url)}` : '';
      const shareText = encodeURIComponent(options.text);
      const eitaaShareLink = `https://eitaa.com/share/url?text=${shareText}${shareUrl}`;

      this.openLink(eitaaShareLink);
      return true;
    } catch {
      return false;
    }
  }

  async requestPayment(_invoice: PaymentInvoice): Promise<PaymentResult> {
    return {
      status: 'pending',
      error: 'Eitaa in-app payment requires server-side gateway redirect',
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
    try {
      this.eitaaBridge?.close?.();
    } catch {
      if (typeof window !== 'undefined') {
        window.close();
      }
    }
  }

  private emit(event: PlatformEventType): void {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error(`[Platform:eitaa] Error in ${event} listener:`, err);
      }
    });
  }

  private extractEitaaUser(): PlatformUser {
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        const qId = params.get('eitaa_id') || params.get('user_id');
        if (qId) {
          return {
            id: qId,
            username: params.get('username') || `EitaaUser_${qId.slice(-4)}`,
            firstName: params.get('first_name') || 'Eitaa Commander',
            languageCode: 'fa',
          };
        }
      } catch {
        // Ignored
      }
    }

    return {
      id: 'eitaa_guest',
      username: 'EitaaPlayer',
      firstName: 'Commander',
      languageCode: 'fa',
    };
  }
}
