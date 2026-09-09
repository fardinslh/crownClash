import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ANALYTICS_BATCH_MAX_SIZE, AnalyticsSink } from './AnalyticsSink.js';
import type { AnalyticsEvent } from './Analytics.js';

const listeners = new EventTarget();
const documentListeners = new EventTarget();

function createEvent(index: number): AnalyticsEvent {
  return {
    eventId: `event_${index}`,
    name: 'live_queue_joined',
    sessionId: 'session_test',
    occurredAt: 1_725_000_000_000 + index,
    schemaVersion: 1,
    props: {},
  };
}

function dispatch(event: unknown): void {
  const browserEvent = new Event('crown-clash:analytics');
  Object.defineProperty(browserEvent, 'detail', { value: event });
  listeners.dispatchEvent(browserEvent);
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: () => void } {
  let resolve!: () => void;
  let reject!: () => void;
  const promise = new Promise<void>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: listeners.addEventListener.bind(listeners),
      removeEventListener: listeners.removeEventListener.bind(listeners),
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      addEventListener: documentListeners.addEventListener.bind(documentListeners),
      removeEventListener: documentListeners.removeEventListener.bind(documentListeners),
      visibilityState: 'hidden',
    },
  });
});

describe('AnalyticsSink', () => {
  it('sends batches of at most 50 events in order', async () => {
    const sent: string[][] = [];
    const sink = new AnalyticsSink({
      flush: async (events) => {
        sent.push(events.map((event) => event.eventId));
      },
    });
    sink.start();
    for (let index = 0; index <= ANALYTICS_BATCH_MAX_SIZE; index++) {
      dispatch(createEvent(index));
    }

    await sink.flush();

    expect(sent).toEqual([
      Array.from({ length: ANALYTICS_BATCH_MAX_SIZE }, (_, index) => `event_${index}`),
      ['event_50'],
    ]);
    sink.stop();
  });

  it('restores a failed batch before newer events and retries in order', async () => {
    const calls: string[][] = [];
    let fail = true;
    const sink = new AnalyticsSink({
      flush: async (events) => {
        calls.push(events.map((event) => event.eventId));
        if (fail) throw new Error('offline');
      },
    });
    sink.start();
    dispatch(createEvent(1));
    dispatch(createEvent(2));
    dispatch(createEvent(3));

    await sink.flush();
    dispatch(createEvent(4));
    fail = false;
    await sink.flush();

    expect(calls).toEqual([
      ['event_1', 'event_2', 'event_3'],
      ['event_1', 'event_2', 'event_3', 'event_4'],
    ]);
    sink.stop();
  });

  it('preserves events buffered while a flush is in flight', async () => {
    const pending = deferred();
    const calls: string[][] = [];
    const sink = new AnalyticsSink({
      flush: async (events) => {
        calls.push(events.map((event) => event.eventId));
        await pending.promise;
      },
    });
    sink.start();
    dispatch(createEvent(1));

    const first = sink.flush();
    dispatch(createEvent(2));
    pending.resolve();
    await first;
    await sink.flush();

    expect(calls).toEqual([['event_1'], ['event_2']]);
    sink.stop();
  });

  it('prevents simultaneous flushes', async () => {
    const pending = deferred();
    const flush = vi.fn(() => pending.promise);
    const sink = new AnalyticsSink({ flush });
    sink.start();
    dispatch(createEvent(1));

    const first = sink.flush();
    const second = sink.flush();
    expect(flush).toHaveBeenCalledTimes(1);

    pending.resolve();
    await Promise.all([first, second]);
    sink.stop();
  });

  it('keeps the newest events when the bounded buffer overflows', async () => {
    const sent: string[][] = [];
    const sink = new AnalyticsSink({
      maxBuffer: 2,
      flush: async (events) => {
        sent.push(events.map((event) => event.eventId));
      },
    });
    sink.start();
    dispatch(createEvent(1));
    dispatch(createEvent(2));
    dispatch(createEvent(3));

    await sink.flush();

    expect(sent).toEqual([['event_2', 'event_3']]);
    sink.stop();
  });

  it('ignores malformed event details', async () => {
    const flush = vi.fn(async () => undefined);
    const sink = new AnalyticsSink({ flush });
    sink.start();
    dispatch({ name: 'live_queue_joined' });
    dispatch({ ...createEvent(1), props: { nested: {} } });

    await sink.flush();

    expect(flush).not.toHaveBeenCalled();
    sink.stop();
  });
});
