import { BalePlatformAdapter } from './BalePlatformAdapter.js';
import { BrowserPlatformAdapter } from './BrowserPlatformAdapter.js';
import { EitaaPlatformAdapter } from './EitaaPlatformAdapter.js';
import { TelegramPlatformAdapter } from './TelegramPlatformAdapter.js';
import { PlatformAdapter } from './types.js';

/**
 * Automatically detects the current messenger mini-app environment
 * and instantiates the appropriate PlatformAdapter.
 *
 * Target priority: Bale -> Eitaa -> Telegram -> Browser fallback.
 */
export function createPlatformAdapter(): PlatformAdapter {
  if (typeof window === 'undefined') {
    return new BrowserPlatformAdapter();
  }

  const userAgent = window.navigator?.userAgent || '';
  const search = window.location?.search || '';
  const params = new URLSearchParams(search);
  const explicitPlatform = params.get('platform')?.toLowerCase();

  // 1. Explicit override (useful for testing mini-app UI in browser)
  if (explicitPlatform === 'bale') {
    return new BalePlatformAdapter();
  }
  if (explicitPlatform === 'eitaa') {
    return new EitaaPlatformAdapter();
  }
  if (explicitPlatform === 'telegram') {
    return new TelegramPlatformAdapter();
  }

  // 2. Bale Mini App detection
  if (
    Boolean(window.BaleApp) ||
    userAgent.includes('Bale') ||
    params.has('bale_id')
  ) {
    return new BalePlatformAdapter();
  }

  // 3. Eitaa Mini App detection
  if (
    Boolean(window.Eitaa) ||
    userAgent.includes('Eitaa') ||
    params.has('eitaa_id')
  ) {
    return new EitaaPlatformAdapter();
  }

  // 4. Telegram Mini App detection
  if (
    Boolean(window.Telegram?.WebApp?.initData) ||
    params.has('tgWebAppData') ||
    userAgent.includes('Telegram')
  ) {
    return new TelegramPlatformAdapter();
  }

  // 5. Default browser fallback
  return new BrowserPlatformAdapter();
}
