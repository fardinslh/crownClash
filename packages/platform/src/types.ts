export type PlatformType = 'browser' | 'bale' | 'eitaa' | 'telegram' | 'mock';

export type HapticImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
export type HapticNotificationType = 'success' | 'warning' | 'error';

export interface PlatformUser {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  photoUrl?: string;
  isPremium?: boolean;
}

export interface PlatformTheme {
  bgColor: string;
  textColor: string;
  accentColor: string;
  surfaceColor: string;
  buttonColor: string;
  buttonTextColor: string;
  isDark: boolean;
}

export interface ShareOptions {
  text: string;
  url?: string;
}

export interface PaymentInvoice {
  slug: string;
  title: string;
  description: string;
  amount: number;
  currency: string;
}

export interface PaymentResult {
  status: 'paid' | 'cancelled' | 'failed' | 'pending';
  transactionId?: string;
  error?: string;
}

export type PlatformEventType = 'viewportChanged' | 'themeChanged' | 'backButtonClicked' | 'appResumed' | 'appPaused';

export interface PlatformAdapter {
  /**
   * The identifier of the active platform environment.
   */
  readonly platform: PlatformType;

  /**
   * Initializes platform SDKs, listeners, and authentication states.
   */
  initialize(): Promise<void>;

  /**
   * Signals the mini-app host that the game UI has completed loading.
   */
  ready(): void;

  /**
   * Returns current authenticated user metadata or a guest fallback.
   */
  getUser(): PlatformUser;

  /**
   * Raw authentication payload (e.g., Telegram WebApp initData string)
   * to send to the backend for cryptographic validation.
   */
  getInitDataRaw(): string;

  /**
   * Returns current platform UI theme parameters.
   */
  getTheme(): PlatformTheme;

  /**
   * Triggers haptic impact vibration.
   */
  hapticImpact(style: HapticImpactStyle): void;

  /**
   * Triggers haptic notification pattern (e.g. victory, defeat, error).
   */
  hapticNotification(type: HapticNotificationType): void;

  /**
   * Triggers light selection tick haptic.
   */
  hapticSelection(): void;

  /**
   * Requests expanding the viewport to full mini-app height.
   */
  expand(): void;

  /**
   * Requests device fullscreen mode if supported by the platform.
   */
  requestFullscreen(): Promise<boolean>;

  /**
   * Controls native platform Back Button visibility and click callback.
   */
  showBackButton(onClick: () => void): void;
  hideBackButton(): void;
  triggerBackButton(): void;

  /**
   * Opens an external link safely through the messenger client.
   */
  openLink(url: string): void;

  /**
   * Invokes native messenger sharing / referral invite link.
   */
  share(options: ShareOptions): Promise<boolean>;

  /**
   * Initiates payment flow via platform native checkout.
   */
  requestPayment(invoice: PaymentInvoice): Promise<PaymentResult>;

  /**
   * Subscribes to platform lifecycle or viewport events.
   */
  on(event: PlatformEventType, callback: () => void): () => void;

  /**
   * Closes the mini app window.
   */
  close(): void;
}
