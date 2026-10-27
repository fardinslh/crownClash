import { describe, expect, it } from 'vitest';
import { popScale, resolveFeelProfile } from '../FeelProfile.js';
import { FeedbackThrottle } from '../FeedbackThrottle.js';
import { captureShake, rollSteps } from '../CountChange.js';
import { RecyclingPool } from '../RecyclingPool.js';

describe('resolveFeelProfile', () => {
  it('keeps cheap pops on low-end devices but drops shake, particles and flashes', () => {
    const lite = resolveFeelProfile({ reducedEffects: true, prefersReducedMotion: false });
    expect(lite.tier).toBe('lite');
    expect(lite.pops).toBe(true);
    expect(lite.expandingRings).toBe(true);
    expect([lite.shake, lite.particles, lite.flash, lite.rollCounts]).toEqual([false, false, false, false]);
  });

  it('gives full effects to capable devices', () => {
    const full = resolveFeelProfile({ reducedEffects: false, prefersReducedMotion: false });
    expect(full).toMatchObject({ tier: 'full', pops: true, shake: true, particles: true, flash: true, rollCounts: true });
  });

  it('honours an OS reduced-motion request over device class', () => {
    const still = resolveFeelProfile({ reducedEffects: true, prefersReducedMotion: true });
    expect(still.tier).toBe('still');
    expect(still.shake).toBe(false);
    expect(still.expandingRings).toBe(false);
    expect(popScale(still, 1.28)).toBe(1.05);
    expect(popScale(still, 0.88)).toBe(0.88);
  });

  it('passes pop scales through on full and lite', () => {
    expect(popScale(resolveFeelProfile({ reducedEffects: false, prefersReducedMotion: false }), 1.28)).toBe(1.28);
    expect(popScale(resolveFeelProfile({ reducedEffects: true, prefersReducedMotion: false }), 1.28)).toBe(1.28);
  });
});

describe('FeedbackThrottle', () => {
  it('fires a gated effect at most once per gap', () => {
    const t = new FeedbackThrottle();
    expect(t.allowGap('shake', 250, 0)).toBe(true);
    expect(t.allowGap('shake', 250, 100)).toBe(false);
    expect(t.allowGap('shake', 250, 249)).toBe(false);
    expect(t.allowGap('shake', 250, 250)).toBe(true);
    expect(t.allowGap('other', 250, 260)).toBe(true);
  });

  it('caps bursts within a sliding window', () => {
    const t = new FeedbackThrottle();
    expect([0, 10, 20].map((ms) => t.allowBurst('float', 3, 100, ms))).toEqual([true, true, true]);
    expect(t.allowBurst('float', 3, 100, 50)).toBe(false);
    expect(t.allowBurst('float', 3, 100, 100)).toBe(true);
  });
});

describe('rollSteps', () => {
  it('ends exactly at the target and never exceeds the step budget', () => {
    const steps = rollSteps(40, 3, 6);
    expect(steps.length).toBeLessThanOrEqual(6);
    expect(steps.at(-1)).toBe(3);
    expect(steps.every((v, i) => i === 0 || v < steps[i - 1])).toBe(true);
  });

  it('uses one step per unit for small changes', () => {
    expect(rollSteps(10, 12, 6)).toEqual([11, 12]);
    expect(rollSteps(5, 4, 6)).toEqual([4]);
  });

  it('returns nothing for no change and a direct jump for invalid input', () => {
    expect(rollSteps(7, 7)).toEqual([]);
    expect(rollSteps(Number.NaN, 4)).toEqual([4]);
  });
});

describe('captureShake', () => {
  it('shakes for the crown keep and for towers the player loses only', () => {
    expect(captureShake({ crownKeep: true, attacker: 'player', previousOwner: 'neutral' })).toBe('big');
    expect(captureShake({ crownKeep: false, attacker: 'enemy', previousOwner: 'player' })).toBe('small');
    expect(captureShake({ crownKeep: false, attacker: 'player', previousOwner: 'enemy' })).toBe('none');
    expect(captureShake({ crownKeep: false, attacker: 'enemy', previousOwner: 'neutral' })).toBe('none');
  });
});

describe('RecyclingPool', () => {
  it('creates up to max, reuses released items, then takes over the oldest busy one', () => {
    let n = 0;
    const pool = new RecyclingPool(() => ({ id: n++ }), 2);
    const a = pool.acquire();
    const b = pool.acquire();
    expect([a.recycled, b.recycled]).toEqual([false, false]);
    const c = pool.acquire();
    expect(c.recycled).toBe(true);
    expect(c.item).toBe(a.item);
    pool.release(b.item);
    const d = pool.acquire();
    expect(d.item).toBe(b.item);
    expect(d.recycled).toBe(false);
    expect(pool.size).toBe(2);
  });

  it('ignores releasing an item twice', () => {
    const pool = new RecyclingPool(() => ({}), 1);
    const { item } = pool.acquire();
    pool.release(item);
    pool.release(item);
    pool.acquire();
    expect(pool.acquire().recycled).toBe(true);
  });
});
