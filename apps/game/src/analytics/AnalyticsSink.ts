import { isAnalyticsEvent, type AnalyticsEvent } from './Analytics.js';

export const ANALYTICS_BATCH_MAX_SIZE = 50;

export interface AnalyticsSinkOptions {
  flush: (events: readonly AnalyticsEvent[]) => Promise<void>;
  shouldFlush?: () => boolean;
  flushIntervalMs?: number;
  maxBuffer?: number;
}

/**
 * Collects typed event envelopes and sends them in ordered, idempotent batches.
 * Failed batches are restored ahead of newer events, and analytics failures are
 * intentionally isolated from normal gameplay.
 */
export class AnalyticsSink {
  private readonly options: Required<Pick<AnalyticsSinkOptions, 'flushIntervalMs' | 'maxBuffer'>>;
  private readonly flushFn: AnalyticsSinkOptions['flush'];
  private readonly shouldFlush: () => boolean;
  private buffer: AnalyticsEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushPromise: Promise<void> | null = null;

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
    window.addEventListener('pagehide', this.flushOnPageHide);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.flushOnLifecycleChange);
    }
    this.timer = setInterval(() => {
      void this.flush();
    }, this.options.flushIntervalMs);
  }

  public stop(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('crown-clash:analytics', this.handleEvent);
      window.removeEventListener('pagehide', this.flushOnPageHide);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.flushOnLifecycleChange);
      }
    }
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    if (this.buffer.length === 0 || !this.shouldFlush()) return Promise.resolve();

    this.flushPromise = this.flushBufferedEvents().finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  private async flushBufferedEvents(): Promise<void> {
    while (this.buffer.length > 0 && this.shouldFlush()) {
      const batch = this.buffer.splice(0, ANALYTICS_BATCH_MAX_SIZE);
      try {
        await this.flushFn(batch);
      } catch {
        this.buffer.unshift(...batch);
        this.trimBuffer(batch.length);
        return;
      }
    }
  }

  private readonly flushOnLifecycleChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
    void this.flush();
  };

  private readonly flushOnPageHide = (): void => {
    void this.flush();
  };

  private readonly handleEvent = (event: Event): void => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!isAnalyticsEvent(detail)) return;
    this.buffer.push(detail);
    this.trimBuffer();
  };

  private trimBuffer(preserveHead = 0): void {
    if (this.buffer.length > this.options.maxBuffer) {
      const overflow = this.buffer.length - this.options.maxBuffer;
      if (preserveHead > 0) {
        this.buffer.splice(Math.max(preserveHead, this.options.maxBuffer), overflow);
      } else {
        this.buffer.splice(0, overflow);
      }
    }
  }
}
