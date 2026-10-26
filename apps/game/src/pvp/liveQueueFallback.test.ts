import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_QUEUE_BOT_FALLBACK_SECONDS } from '../config/liveQueue.js';
import { armLiveQueueFallback } from './liveQueueFallback.js';

describe('armLiveQueueFallback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once after the configured wait and reports the seconds waited', () => {
    const onExpire = vi.fn();
    armLiveQueueFallback(onExpire);
    vi.advanceTimersByTime(LIVE_QUEUE_BOT_FALLBACK_SECONDS * 1000 - 1);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onExpire).toHaveBeenCalledWith(LIVE_QUEUE_BOT_FALLBACK_SECONDS);
    vi.advanceTimersByTime(60_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('never fires once disarmed, and disarming twice is harmless', () => {
    const onExpire = vi.fn();
    const disarm = armLiveQueueFallback(onExpire);
    vi.advanceTimersByTime(5_000);
    disarm();
    disarm();
    vi.advanceTimersByTime(60_000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('allows disarming after it fired', () => {
    const onExpire = vi.fn();
    const disarm = armLiveQueueFallback(onExpire, 1);
    vi.advanceTimersByTime(1_000);
    expect(() => disarm()).not.toThrow();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
