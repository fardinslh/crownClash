import { describe, expect, it, vi } from 'vitest';
import {
  BalePlatformAdapter,
  BrowserPlatformAdapter,
  createPlatformAdapter,
  EitaaPlatformAdapter,
  TelegramPlatformAdapter,
} from '../index.js';

describe('Crown Clash - Platform Architecture Tests', () => {
  describe('BrowserPlatformAdapter', () => {
    it('initializes with platform identity as browser', () => {
      const adapter = new BrowserPlatformAdapter();
      expect(adapter.platform).toBe('browser');
    });

    it('provides user identity with non-empty id and username', () => {
      const adapter = new BrowserPlatformAdapter();
      const user = adapter.getUser();
      expect(user).toBeDefined();
      expect(user.id).toBeTruthy();
      expect(user.username).toBeTruthy();
    });

    it('returns structured theme parameters', () => {
      const adapter = new BrowserPlatformAdapter();
      const theme = adapter.getTheme();
      expect(theme.bgColor).toMatch(/^#/);
      expect(theme.textColor).toMatch(/^#/);
      expect(theme.surfaceColor).toMatch(/^#/);
      expect(typeof theme.isDark).toBe('boolean');
    });

    it('provides raw initData string for authentication', () => {
      const adapter = new BrowserPlatformAdapter();
      const initData = adapter.getInitDataRaw();
      expect(typeof initData).toBe('string');
      expect(initData.length).toBeGreaterThan(0);
    });

    it('handles event subscription and unsubscription cleanly', () => {
      const adapter = new BrowserPlatformAdapter();
      const callback = vi.fn();

      const unsubscribe = adapter.on('viewportChanged', callback);
      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
    });

    it('safely invokes haptic methods without errors', () => {
      const adapter = new BrowserPlatformAdapter();
      expect(() => adapter.hapticImpact('light')).not.toThrow();
      expect(() => adapter.hapticImpact('heavy')).not.toThrow();
      expect(() => adapter.hapticNotification('success')).not.toThrow();
      expect(() => adapter.hapticSelection()).not.toThrow();
    });

    it('controls back button visibility and invokes callback on trigger', () => {
      const adapter = new BrowserPlatformAdapter();
      const backSpy = vi.fn();
      const eventSpy = vi.fn();

      adapter.on('backButtonClicked', eventSpy);
      adapter.showBackButton(backSpy);
      adapter.triggerBackButton();

      expect(backSpy).toHaveBeenCalledTimes(1);
      expect(eventSpy).toHaveBeenCalledTimes(1);

      adapter.hideBackButton();
      adapter.triggerBackButton();
      expect(backSpy).toHaveBeenCalledTimes(1); // Not called again when hidden
      expect(eventSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('BalePlatformAdapter', () => {
    it('initializes with platform identity as bale', () => {
      const adapter = new BalePlatformAdapter();
      expect(adapter.platform).toBe('bale');
    });

    it('applies Bale branded emerald palette in theme', () => {
      const adapter = new BalePlatformAdapter();
      const theme = adapter.getTheme();
      expect(theme.accentColor).toBe('#00a389');
    });

    it('defaults user language to Persian (fa)', () => {
      const adapter = new BalePlatformAdapter();
      const user = adapter.getUser();
      expect(user.languageCode).toBe('fa');
    });
  });

  describe('EitaaPlatformAdapter', () => {
    it('initializes with platform identity as eitaa', () => {
      const adapter = new EitaaPlatformAdapter();
      expect(adapter.platform).toBe('eitaa');
    });

    it('applies Eitaa branded orange palette in theme', () => {
      const adapter = new EitaaPlatformAdapter();
      const theme = adapter.getTheme();
      expect(theme.accentColor).toBe('#e05a1e');
    });
  });

  describe('TelegramPlatformAdapter', () => {
    it('initializes with platform identity as telegram', () => {
      const adapter = new TelegramPlatformAdapter();
      expect(adapter.platform).toBe('telegram');
    });

    it('returns guest telegram identity when not in live messenger webview', () => {
      const adapter = new TelegramPlatformAdapter();
      const user = adapter.getUser();
      expect(user.id).toBe('tg_guest');
    });
  });

  describe('createPlatformAdapter (Factory)', () => {
    it('returns BrowserPlatformAdapter by default in node/browser environment', () => {
      const adapter = createPlatformAdapter();
      expect(adapter).toBeDefined();
      expect(['browser', 'bale', 'eitaa', 'telegram']).toContain(adapter.platform);
    });
  });
});
