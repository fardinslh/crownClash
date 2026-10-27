import { describe, expect, it } from 'vitest';
import { STREAM_MAX_FOLLOWERS, troopFollowerCount, troopStreamSlots } from '../TroopStream.js';

describe('troop stream formation', () => {
  it('grows the column with army size up to the device cap', () => {
    expect(troopFollowerCount(3, 10)).toBe(1);
    expect(troopFollowerCount(6, 10)).toBe(2);
    expect(troopFollowerCount(15, 10)).toBe(4);
    expect(troopFollowerCount(30, 10)).toBe(7);
    expect(troopFollowerCount(200, STREAM_MAX_FOLLOWERS.full)).toBe(10);
    expect(troopFollowerCount(200, STREAM_MAX_FOLLOWERS.reduced)).toBe(4);
    expect(troopFollowerCount(Number.NaN, 10)).toBe(1);
  });

  it('places followers behind the leader in two files, rear guard last', () => {
    const slots = troopStreamSlots(40, 10, true);
    expect(slots).toHaveLength(10);
    expect(slots.every((s) => s.back > 0)).toBe(true);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].back).toBeGreaterThanOrEqual(slots[i - 1].back);
      expect(slots[i].delayMs).toBeGreaterThan(slots[i - 1].delayMs);
    }
    // Two files: alternate sides, never stacked on the same point.
    expect(new Set(slots.slice(0, 2).map((s) => s.side)).size).toBe(2);
  });

  it('centres a lone follower and an odd last one', () => {
    expect(troopStreamSlots(3, 10)).toEqual([{ back: 15, side: 0, delayMs: 45 }]);
    const odd = troopStreamSlots(15, 10, true);
    expect(odd).toHaveLength(5);
    expect(odd.at(-1)!.side).toBe(0);
  });
});
