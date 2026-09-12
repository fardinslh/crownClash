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
    BaleApp?: any;
    Telegram?: {
      WebApp?: any;
    };
  }
}

export class BalePlatformAdapter implements PlatformAdapter {
  readonly platform: PlatformType = 'bale';

  private baleBridge: any = null;
  private user: PlatformUser;
  private backButtonCallback: (() => void) | null = null;
  private listeners: Map<PlatformEventType, Set<() => void>> = new Map();

  constructor() {
    if (typeof window !== 'undefined') {
      this.baleBridge = window.BaleApp || window.Telegram?.WebApp || null;
    }
    this.user = this.extractBaleUser();
  }

  async initialize(): Promise<void> {
    if (!this.baleBridge) return;

    try {
      this.baleBridge.ready?.();
      this.baleBridge.expand?.();

      this.baleBridge.onEvent?.('viewportChanged', () => this.emit('viewportChanged'));
      this.baleBridge.onEvent?.('themeChanged', () => this.emit('themeChanged'));
      this.baleBridge.onEvent?.('backButtonClicked', () => {
        this.emit('backButtonClicked');
        if (this.backButtonCallback) {
          this.backButtonCallback();
        }
      });
    } catch (err) {
      console.warn('[Platform:bale] Failed during initialization:', err);
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
      this.baleBridge?.ready?.();
    } catch {
      // Ignored
    }
  }

  getUser(): PlatformUser {
    return this.user;
  }

  getInitDataRaw(): string {
    if (this.baleBridge?.initData) {
      return this.baleBridge.initData;
    }
    if (typeof window !== 'undefined' && window.location?.search) {
      return window.location.search.slice(1);
    }
    return '';
  }

  getTheme(): PlatformTheme {
    const params = this.baleBridge?.themeParams || {};
    const isDark = this.baleBridge?.colorScheme === 'dark';

    return {
      bgColor: params.bg_color || (isDark ? '#0a0f1d' : '#ffffff'),
      textColor: params.text_color || (isDark ? '#f8fafc' : '#0a0f1d'),
      accentColor: params.link_color || '#00a389', // Bale distinctive emerald brand tone
      surfaceColor: params.secondary_bg_color || (isDark ? '#1e293b' : '#f0fdf4'),
      buttonColor: params.button_color || '#00a389',
      buttonTextColor: params.button_text_color || '#ffffff',
      isDark,
    };
  }

  hapticImpact(style: HapticImpactStyle): void {
    if (this.baleBridge?.HapticFeedback?.impactOccurred) {
      try {
        this.baleBridge.HapticFeedback.impactOccurred(style);
        return;
      } catch {
        // Fallback to web vibration
      }
    }

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
    if (this.baleBridge?.HapticFeedback?.notificationOccurred) {
      try {
        this.baleBridge.HapticFeedback.notificationOccurred(type);
        return;
      } catch {
        // Fallback
      }
    }

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(type === 'success' ? [25, 40, 50] : [40, 30, 40]);
      } catch {
        // Ignored
      }
    }
  }

  hapticSelection(): void {
    if (this.baleBridge?.HapticFeedback?.selectionChanged) {
      try {
        this.baleBridge.HapticFeedback.selectionChanged();
        return;
      } catch {
        // Fallback
      }
    }

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
      this.baleBridge?.expand?.();
    } catch {
      // Ignored
    }
  }

  async requestFullscreen(): Promise<boolean> {
    try {
      if (typeof this.baleBridge?.requestFullscreen === 'function') {
        await this.baleBridge.requestFullscreen();
        return true;
      }
      if (typeof document !== 'undefined' && document.documentElement.requestFullscreen) {
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
    try {
      this.baleBridge?.BackButton?.show?.();
    } catch {
      // Ignored
    }
  }

  hideBackButton(): void {
    this.backButtonCallback = null;
    try {
      this.baleBridge?.BackButton?.hide?.();
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
    try {
      if (this.baleBridge?.openLink) {
        this.baleBridge.openLink(url);
      } else if (typeof window !== 'undefined') {
        window.open(url, '_blank');
      }
    } catch {
      // Ignored
    }
  }

  async share(options: ShareOptions): Promise<boolean> {
    try {
      const shareUrl = options.url ? `&url=${encodeURIComponent(options.url)}` : '';
      const shareText = encodeURIComponent(options.text);
      const baleDeepLink = `bale://share?text=${shareText}${shareUrl}`;
      const baleWebLink = `https://ble.ir/share/url?text=${shareText}${shareUrl}`;

      if (this.baleBridge?.openTelegramLink) {
        this.baleBridge.openTelegramLink(baleDeepLink);
        return true;
      }

      this.openLink(baleWebLink);
      return true;
    } catch {
      return false;
    }
  }

  async requestPayment(_invoice: PaymentInvoice): Promise<PaymentResult> {
    // Bale payments are server-settled via payment gateway (e.g. Shaparak / ZarinPal)
    return {
      status: 'pending',
      error: 'Bale payment gateway invoice settlement should be invoked via backend redirect',
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
      this.baleBridge?.close?.();
    } catch {
      // Ignored
    }
  }

  private emit(event: PlatformEventType): void {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error(`[Platform:bale] Error in ${event} listener:`, err);
      }
    });
  }

  private extractBaleUser(): PlatformUser {
    const rawUser = this.baleBridge?.initDataUnsafe?.user;
    if (rawUser && rawUser.id) {
      return {
        id: String(rawUser.id),
        username: rawUser.username || `Bale_${rawUser.id}`,
        firstName: rawUser.first_name,
        lastName: rawUser.last_name,
        languageCode: rawUser.language_code || 'fa',
        photoUrl: rawUser.photo_url,
      };
    }

    // Check query params if passed directly by Bale webview
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        const qId = params.get('bale_id') || params.get('user_id');
        if (qId) {
          return {
            id: qId,
            username: params.get('username') || `BaleUser_${qId.slice(-4)}`,
            firstName: params.get('first_name') || 'Bale Commander',
            languageCode: 'fa',
          };
        }
      } catch {
        // Ignored
      }
    }

    return {
      id: 'bale_guest',
      username: 'BalePlayer',
      firstName: 'Commander',
      languageCode: 'fa',
    };
  }
}
