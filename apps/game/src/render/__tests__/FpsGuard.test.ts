import { describe, expect, it, vi } from 'vitest';
import { RENDER_TIER_CAP_KEY, createFpsGuard, readRenderTierCap, writeRenderTierCap } from '../FpsGuard.js';

const feed = (guard: ReturnType<typeof createFpsGuard>, fps: number, seconds: number): void => {
  for (let t = 0; t < seconds; t += 0.5) guard.sample(fps, 0.5);
};

describe('createFpsGuard', () => {
  it('lowers the tier by one step when the averaged battle fps is too low', () => {
    const onDowngrade = vi.fn();
    const guard = createFpsGuard({ tier: 'high', onDowngrade });
    feed(guard, 30, 25);
    expect(onDowngrade).toHaveBeenCalledOnce();
    expect(onDowngrade).toHaveBeenCalledWith('high', 'mid', 30);
    expect(guard.judged).toBe(true);
  });

  it('does nothing for a smooth battle, and judges only once', () => {
    const onDowngrade = vi.fn();
    const guard = createFpsGuard({ tier: 'mid', onDowngrade });
    feed(guard, 58, 25);
    feed(guard, 10, 25);
    expect(onDowngrade).not.toHaveBeenCalled();
  });

  it('ignores stalls, zero fps and bad samples so a backgrounded WebView is not "slow"', () => {
    const onDowngrade = vi.fn();
    const guard = createFpsGuard({ tier: 'high', onDowngrade });
    for (let i = 0; i < 100; i++) guard.sample(0, 0.5);
    for (let i = 0; i < 100; i++) guard.sample(5, 4);
    guard.sample(Number.NaN, 0.5);
    expect(onDowngrade).not.toHaveBeenCalled();
    expect(guard.judged).toBe(false);
  });

  it('has nothing to lower on the low tier', () => {
    const onDowngrade = vi.fn();
    const guard = createFpsGuard({ tier: 'low', onDowngrade });
    feed(guard, 10, 25);
    expect(onDowngrade).not.toHaveBeenCalled();
  });
});

describe('tier cap storage', () => {
  const memory = (): { store: Map<string, string>; getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } => {
    const store = new Map<string, string>();
    return { store, getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) };
  };

  it('round-trips a valid tier and ignores garbage', () => {
    const storage = memory();
    expect(readRenderTierCap(storage)).toBeUndefined();
    writeRenderTierCap(storage, 'mid');
    expect(readRenderTierCap(storage)).toBe('mid');
    storage.store.set(RENDER_TIER_CAP_KEY, 'ultra');
    expect(readRenderTierCap(storage)).toBeUndefined();
  });

  it('never throws when storage is blocked', () => {
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readRenderTierCap(blocked)).toBeUndefined();
    expect(() => writeRenderTierCap(blocked, 'low')).not.toThrow();
    expect(readRenderTierCap(undefined)).toBeUndefined();
  });
});
