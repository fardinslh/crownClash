import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserPlatformAdapter,
  isHapticsEnabled,
  setHapticsEnabled,
  withHapticsPreference,
} from '../index.js';

function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  return store;
}

describe('haptics preference', () => {
  beforeEach(() => {
    stubStorage();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is on by default and persists the choice', () => {
    expect(isHapticsEnabled()).toBe(true);
    setHapticsEnabled(false);
    expect(isHapticsEnabled()).toBe(false);
    setHapticsEnabled(true);
    expect(isHapticsEnabled()).toBe(true);
  });

  it('stays on when storage throws (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(isHapticsEnabled()).toBe(true);
    expect(() => setHapticsEnabled(false)).not.toThrow();
  });

  it('silences every haptic call but keeps the rest of the adapter working', () => {
    const adapter = new BrowserPlatformAdapter();
    const impact = vi.spyOn(adapter, 'hapticImpact').mockImplementation(() => {});
    const notify = vi.spyOn(adapter, 'hapticNotification').mockImplementation(() => {});
    const select = vi.spyOn(adapter, 'hapticSelection').mockImplementation(() => {});
    const gated = withHapticsPreference(adapter);

    gated.hapticImpact('light');
    gated.hapticNotification('success');
    gated.hapticSelection();
    expect(impact).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);

    setHapticsEnabled(false);
    gated.hapticImpact('light');
    gated.hapticNotification('error');
    gated.hapticSelection();
    expect(impact).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);

    expect(gated.platform).toBe('browser');
    expect(gated.getUser().id).toBeTruthy();
    expect(gated).toBeInstanceOf(BrowserPlatformAdapter);
  });
});
