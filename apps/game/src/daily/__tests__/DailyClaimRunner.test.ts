import { describe, expect, it, vi } from 'vitest';
import type { DailyClaimResult, DailyRewardType } from '@crown-clash/game-core';
import { DailyClaimRunner, type DailyClaimRunnerHooks } from '../DailyClaimRunner.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function hooks() {
  const calls: string[] = [];
  const value: DailyClaimRunnerHooks & { calls: string[] } = {
    calls,
    onPendingChanged: (type) => calls.push(`pending:${type ?? 'none'}`),
    onResult: () => calls.push('result'),
    onError: () => calls.push('error'),
  };
  return value;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const result = { success: true } as DailyClaimResult;

describe('DailyClaimRunner', () => {
  it('serializes claims and restores close after completion', async () => {
    const pending = deferred<DailyClaimResult>();
    const claim = vi.fn(() => pending.promise);
    const events = hooks();
    const runner = new DailyClaimRunner(claim, events);

    runner.run('play_matches');
    runner.run('win_match');
    expect(runner.requestClose()).toBe(false);
    expect(claim).toHaveBeenCalledTimes(1);

    pending.resolve(result);
    await flush();
    expect(events.calls).toEqual(['pending:play_matches', 'result', 'pending:none']);
    expect(runner.requestClose()).toBe(true);
  });

  it('suppresses success hooks after shutdown', async () => {
    const pending = deferred<DailyClaimResult>();
    const events = hooks();
    const runner = new DailyClaimRunner(() => pending.promise, events);
    runner.run('capture_territories');
    runner.shutdown();
    pending.resolve(result);
    await flush();
    expect(events.calls).toEqual(['pending:capture_territories']);
  });

  it('suppresses error hooks after shutdown and ignores later runs', async () => {
    const pending = deferred<DailyClaimResult>();
    const claim = vi.fn((_type: DailyRewardType) => pending.promise);
    const events = hooks();
    const runner = new DailyClaimRunner(claim, events);
    runner.run('crown_chest');
    runner.shutdown();
    runner.run('play_matches');
    pending.reject(new Error('network'));
    await flush();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(events.calls).toEqual(['pending:crown_chest']);
  });

  it('routes an active claim error and clears pending state', async () => {
    const events = hooks();
    const failure = new Error('network');
    const runner = new DailyClaimRunner(() => Promise.reject(failure), events);

    runner.run('win_match');
    await flush();

    expect(events.calls).toEqual(['pending:win_match', 'error', 'pending:none']);
    expect(runner.pending).toBeNull();
    expect(runner.requestClose()).toBe(true);
  });
});
