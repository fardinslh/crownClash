import type { TrackedAnalyticsEvent } from '../api/GameApiClient.js';

type SerializableValue = string | number | boolean;

export interface AnalyticsSinkOptions {
  flush: (events: readonly TrackedAnalyticsEvent[]) => Promise<void>;
  shouldFlush?: () => boolean;
  flushIntervalMs?: number;
  maxBuffer?: number;
}

/**
 * Collects the analytics events dispatched on the
 * `crown-clash:analytics` CustomEvent and batches them to the backend.
 * Events are retained (up to the buffer cap) while flushing is impossible,
 * e.g. before the session token exists, and retried on the next tick.
 */
export class AnalyticsSink {
  private readonly options: Required<Pick<AnalyticsSinkOptions, 'flushIntervalMs' | 'maxBuffer'>>;
  private readonly flushFn: AnalyticsSinkOptions['flush'];
  private readonly shouldFlush: () => boolean;
  private buffer: TrackedAnalyticsEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(options: AnalyticsSinkOptions) {
    this.flushFn = options.flush;
    this.shouldFlush = options.shouldFlush ?? (() => true);
    this.options = {
      flushIntervalMs: options.flushIntervalMs ?? 10_000,
      maxBuffer: options.maxBuffer ?? 100,
    };
  }

  public start(): void {
    if (typeof window === 'undefined' || this.timer !== null) return;
    window.addEventListener('crown-clash:analytics', this.handleEvent);
    this.timer = setInterval(() => {
      void this.flush();
    }, this.options.flushIntervalMs);
  }

  public stop(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('crown-clash:analytics', this.handleEvent);
    }
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0 || !this.shouldFlush()) {
      return Promise.resolve();
    }
    this.flushing = true;
    const events = this.buffer.splice(0, this.buffer.length);
    return this.flushFn(events)
      .catch(() => {
        this.buffer.unshift(...events);
        this.trimBuffer();
      })
      .finally(() => {
        this.flushing = false;
      });
  }

  private readonly handleEvent = (event: Event): void => {
    const detail = (event as CustomEvent<Record<string, unknown> | undefined>).detail;
    if (!detail || typeof detail.name !== 'string' || detail.name.length === 0) return;
    const { name, ...rest } = detail;
    const props: Record<string, SerializableValue> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        props[key] = value;
      }
    }
    this.buffer.push({ name, props });
    this.trimBuffer();
  };

  private trimBuffer(): void {
    if (this.buffer.length > this.options.maxBuffer) {
      this.buffer.splice(0, this.buffer.length - this.options.maxBuffer);
    }
  }
}
