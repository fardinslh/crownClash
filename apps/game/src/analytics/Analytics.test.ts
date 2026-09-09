import { beforeEach, describe, expect, it, vi } from 'vitest';

const listeners = new EventTarget();

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: listeners.addEventListener.bind(listeners),
      removeEventListener: listeners.removeEventListener.bind(listeners),
      dispatchEvent: listeners.dispatchEvent.bind(listeners),
    },
  });
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: class<T> extends Event {
      public readonly detail: T;

      constructor(name: string, init: CustomEventInit<T>) {
        super(name);
        this.detail = init.detail as T;
      }
    },
  });
});

describe('analytics events', () => {
  it('emits session_start once per app lifecycle', async () => {
    const analytics = await import('./Analytics.js');
    const events: unknown[] = [];
    const listener = (event: Event): void => {
      events.push((event as CustomEvent).detail);
    };
    window.addEventListener('crown-clash:analytics', listener);

    analytics.trackSessionStart();
    analytics.trackSessionStart();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: 'session_start',
      schemaVersion: analytics.ANALYTICS_SCHEMA_VERSION,
    });
    window.removeEventListener('crown-clash:analytics', listener);
  });

  it('does not duplicate a terminal match event', async () => {
    const analytics = await import('./Analytics.js');
    const events: unknown[] = [];
    const listener = (event: Event): void => {
      events.push((event as CustomEvent).detail);
    };
    window.addEventListener('crown-clash:analytics', listener);

    expect(analytics.trackTerminalMatchEvent({
      name: 'match_end',
      matchId: 'match_1',
      mode: 'bot',
      result: 'victory',
      durationSeconds: 12,
    })).toBe(true);
    expect(analytics.trackTerminalMatchEvent({
      name: 'match_quit',
      matchId: 'match_1',
      mode: 'live',
      durationSeconds: 12,
    })).toBe(false);

    expect(events).toHaveLength(1);
    window.removeEventListener('crown-clash:analytics', listener);
  });
});
