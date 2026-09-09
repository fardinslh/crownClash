import { describe, expect, it } from 'vitest';
import { formatDailyReset } from '../daily.js';

describe('daily reset display', () => {
  it('formats the remaining server window and clamps expired windows', () => {
    const now = 1_700_000_000_000;
    expect(formatDailyReset(now + 3_661_000, now)).toBe('01:01:01');
    expect(formatDailyReset(now - 1, now)).toBe('00:00:00');
  });

  it('rounds partial seconds up so the countdown does not show zero early', () => {
    expect(formatDailyReset(1_501, 1_000)).toBe('00:00:01');
  });
});
