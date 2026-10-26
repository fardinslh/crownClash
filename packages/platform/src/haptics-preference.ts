import type { PlatformAdapter } from './types.js';

const STORAGE_KEY = 'crown_clash_haptics_off';

/** Haptics are on unless the player turned them off (stored locally, per device). */
export function isHapticsEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) !== 'true';
  } catch {
    return true;
  }
}

/** Persists the choice; storage failures (private mode) leave it session-less but harmless. */
export function setHapticsEnabled(enabled: boolean): void {
  try {
    if (enabled) globalThis.localStorage?.removeItem(STORAGE_KEY);
    else globalThis.localStorage?.setItem(STORAGE_KEY, 'true');
  } catch {}
}

const HAPTIC_METHODS = new Set<string | symbol>(['hapticImpact', 'hapticNotification', 'hapticSelection']);

/**
 * Wraps an adapter so every haptic call honours the player's preference.
 * Gating here (instead of at each call site) keeps all scenes and all
 * messenger adapters consistent, including scenes that build their own
 * fallback adapter.
 */
export function withHapticsPreference<T extends PlatformAdapter>(adapter: T): T {
  return new Proxy(adapter, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (HAPTIC_METHODS.has(prop)) {
        return (...args: unknown[]): void => {
          if (isHapticsEnabled()) value.apply(target, args);
        };
      }
      return value.bind(target);
    },
  });
}
