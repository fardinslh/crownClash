import { LIVE_QUEUE_BOT_FALLBACK_SECONDS } from '../config/liveQueue.js';

export interface FallbackTimers {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: FallbackTimers = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Arms the queue-wait timer. `onExpire` receives how many whole seconds the
 * player waited. Returns a disarm function that is safe to call any number of
 * times, including after the timer fired.
 */
export function armLiveQueueFallback(
  onExpire: (waitedSeconds: number) => void,
  delaySeconds: number = LIVE_QUEUE_BOT_FALLBACK_SECONDS,
  timers: FallbackTimers = realTimers
): () => void {
  let handle: unknown = timers.set(() => {
    handle = undefined;
    onExpire(Math.round(delaySeconds));
  }, delaySeconds * 1000);
  return () => {
    if (handle === undefined) return;
    timers.clear(handle);
    handle = undefined;
  };
}
