import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOTYPE_EVENT, PROTOTYPE_STORAGE_KEY, trackPrototypeEvent } from './PrototypeAnalytics.js';

describe('local playtest analytics', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('keeps only 100 events in session storage and uses a separate event stream', () => {
    const values = new Map<string, string>();
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent, sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } });
    for (let i = 0; i < 105; i++) {
      trackPrototypeEvent({ name: 'prototype_start', matchId: `test_${i}`, mode: 'crown', elapsedSeconds: 0 });
    }
    const history = JSON.parse(values.get(PROTOTYPE_STORAGE_KEY)!);
    expect(history).toHaveLength(100);
    expect(history[0].matchId).toBe('test_5');
    expect(history[99].matchId).toBe('test_104');
    expect(dispatchEvent).toHaveBeenCalledTimes(105);
    expect(PROTOTYPE_EVENT).toBe('crown-clash:prototype');
    expect(dispatchEvent.mock.calls.every(([event]) => event.type === 'crown-clash:prototype')).toBe(true);
    expect(dispatchEvent.mock.calls.some(([event]) => event.type === 'crown-clash:analytics')).toBe(false);
  });
  it('still emits the event when the browser disallows storage', () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent, sessionStorage: { getItem: () => { throw new Error('blocked'); } } });
    trackPrototypeEvent({ name: 'prototype_quit', matchId: 'test', mode: 'classic', elapsedSeconds: 4 });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0][0].detail.name).toBe('prototype_quit');
  });
});
