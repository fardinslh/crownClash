/**
 * Keeps stacked feedback readable: several armies landing in the same frame
 * should not fire several camera shakes or a wall of floating numbers.
 * The clock is passed in so the rules are testable without timers.
 */
export class FeedbackThrottle {
  private readonly lastFired = new Map<string, number>();
  private readonly windows = new Map<string, number[]>();

  /** True at most once per `minGapMs` for `key`. */
  allowGap(key: string, minGapMs: number, nowMs: number): boolean {
    const last = this.lastFired.get(key);
    if (last !== undefined && nowMs - last < minGapMs) return false;
    this.lastFired.set(key, nowMs);
    return true;
  }

  /** True for at most `max` calls within any `windowMs` for `key`. */
  allowBurst(key: string, max: number, windowMs: number, nowMs: number): boolean {
    const recent = (this.windows.get(key) ?? []).filter((t) => nowMs - t < windowMs);
    if (recent.length >= max) {
      this.windows.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    this.windows.set(key, recent);
    return true;
  }

  reset(): void {
    this.lastFired.clear();
    this.windows.clear();
  }
}
