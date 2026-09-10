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

  it('validates tutorial analytics event envelopes', async () => {
    const analytics = await import('./Analytics.js');

    const validStarted = {
      eventId: 'event_1',
      name: 'tutorial_started',
      sessionId: 'session_1',
      occurredAt: Date.now(),
      schemaVersion: 1,
      props: {},
    };
    expect(analytics.isAnalyticsEvent(validStarted)).toBe(true);

    const validStep = {
      eventId: 'event_2',
      name: 'tutorial_step_completed',
      sessionId: 'session_1',
      occurredAt: Date.now(),
      schemaVersion: 1,
      props: { stepId: 'drag_to_attack' },
    };
    expect(analytics.isAnalyticsEvent(validStep)).toBe(true);

    const validCompleted = {
      eventId: 'event_3',
      name: 'tutorial_completed',
      sessionId: 'session_1',
      occurredAt: Date.now(),
      schemaVersion: 1,
      props: {},
    };
    expect(analytics.isAnalyticsEvent(validCompleted)).toBe(true);

    const validSkipped = {
      eventId: 'event_4',
      name: 'tutorial_skipped',
      sessionId: 'session_1',
      occurredAt: Date.now(),
      schemaVersion: 1,
      props: { lastStepId: 'drag_to_attack' },
    };
    expect(analytics.isAnalyticsEvent(validSkipped)).toBe(true);
  });
});
