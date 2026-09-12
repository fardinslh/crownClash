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
    Telegram?: {
      WebApp?: any;
    };
  }
}

export class TelegramPlatformAdapter implements PlatformAdapter {
  readonly platform: PlatformType = 'telegram';

  private webApp: any = null;
  private user: PlatformUser;
  private backButtonCallback: (() => void) | null = null;
  private listeners: Map<PlatformEventType, Set<() => void>> = new Map();

  constructor() {
    if (typeof window !== 'undefined') {
      this.webApp = window.Telegram?.WebApp || null;
    }
    this.user = this.extractTelegramUser();
  }

  async initialize(): Promise<void> {
    if (!this.webApp) return;

    try {
      this.webApp.ready();
      this.webApp.expand();

      // Hook Telegram WebApp events
      this.webApp.onEvent?.('viewportChanged', () => this.emit('viewportChanged'));
      this.webApp.onEvent?.('themeChanged', () => this.emit('themeChanged'));
      this.webApp.onEvent?.('backButtonClicked', () => {
        this.emit('backButtonClicked');
        if (this.backButtonCallback) {
          this.backButtonCallback();
        }
      });
    } catch (err) {
      console.warn('[Platform:telegram] Failed during initialization:', err);
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
      this.webApp?.ready();
    } catch {
      // Ignored
    }
  }

  getUser(): PlatformUser {
    return this.user;
  }

  getInitDataRaw(): string {
    return this.webApp?.initData || '';
  }

  getTheme(): PlatformTheme {
    const params = this.webApp?.themeParams || {};
    const isDark = this.webApp?.colorScheme === 'dark';

    return {
      bgColor: params.bg_color || (isDark ? '#0a0f1d' : '#ffffff'),
      textColor: params.text_color || (isDark ? '#f8fafc' : '#0a0f1d'),
      accentColor: params.link_color || '#3b82f6',
      surfaceColor: params.secondary_bg_color || (isDark ? '#1e293b' : '#f1f5f9'),
      buttonColor: params.button_color || '#3b82f6',
      buttonTextColor: params.button_text_color || '#ffffff',
      isDark,
    };
  }

  hapticImpact(style: HapticImpactStyle): void {
    try {
      this.webApp?.HapticFeedback?.impactOccurred(style);
    } catch {
      // Ignored
    }
  }

  hapticNotification(type: HapticNotificationType): void {
    try {
      this.webApp?.HapticFeedback?.notificationOccurred(type);
    } catch {
      // Ignored
    }
  }

  hapticSelection(): void {
    try {
      this.webApp?.HapticFeedback?.selectionChanged();
    } catch {
      // Ignored
    }
  }

  expand(): void {
    try {
      this.webApp?.expand();
    } catch {
      // Ignored
    }
  }

  async requestFullscreen(): Promise<boolean> {
    try {
      if (typeof this.webApp?.requestFullscreen === 'function') {
        await this.webApp.requestFullscreen();
        return true;
      }
    } catch {
      // Fullscreen not supported or rejected
    }
    return false;
  }

  showBackButton(onClick: () => void): void {
    this.backButtonCallback = onClick;
    try {
      this.webApp?.BackButton?.show();
    } catch {
      // Ignored
    }
  }

  hideBackButton(): void {
    this.backButtonCallback = null;
    try {
      this.webApp?.BackButton?.hide();
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
      if (this.webApp?.openLink) {
        this.webApp.openLink(url);
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
      const tgShareUrl = `https://t.me/share/url?text=${shareText}${shareUrl}`;

      if (this.webApp?.openTelegramLink) {
        this.webApp.openTelegramLink(tgShareUrl);
        return true;
      } else {
        this.openLink(tgShareUrl);
        return true;
      }
    } catch {
      return false;
    }
  }

  async requestPayment(invoice: PaymentInvoice): Promise<PaymentResult> {
    return new Promise((resolve) => {
      try {
        if (!this.webApp?.openInvoice) {
          resolve({ status: 'failed', error: 'Invoices not supported in this WebApp version' });
          return;
        }

        this.webApp.openInvoice(invoice.slug, (status: string) => {
          if (status === 'paid') {
            resolve({ status: 'paid' });
          } else if (status === 'cancelled') {
            resolve({ status: 'cancelled' });
          } else {
            resolve({ status: 'failed', error: status });
          }
        });
      } catch (err) {
        resolve({ status: 'failed', error: String(err) });
      }
    });
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
      this.webApp?.close();
    } catch {
      // Ignored
    }
  }

  private emit(event: PlatformEventType): void {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error(`[Platform:telegram] Error in ${event} listener:`, err);
      }
    });
  }

  private extractTelegramUser(): PlatformUser {
    const rawUser = this.webApp?.initDataUnsafe?.user;
    if (rawUser && rawUser.id) {
      return {
        id: String(rawUser.id),
        username: rawUser.username || `User_${rawUser.id}`,
        firstName: rawUser.first_name,
        lastName: rawUser.last_name,
        languageCode: rawUser.language_code,
        isPremium: Boolean(rawUser.is_premium),
        photoUrl: rawUser.photo_url,
      };
    }

    return {
      id: 'tg_guest',
      username: 'TelegramPlayer',
      firstName: 'Commander',
    };
  }
}
