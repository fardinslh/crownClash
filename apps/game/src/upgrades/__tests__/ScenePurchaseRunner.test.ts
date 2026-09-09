import { describe, expect, it, vi } from 'vitest';
import type { UpgradePurchaseResult, UpgradeType } from '@crown-clash/game-core';
import { ScenePurchaseRunner, ScenePurchaseRunnerHooks } from '../ScenePurchaseRunner.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const fakeResult = { success: true } as unknown as UpgradePurchaseResult;

function createHooks(): ScenePurchaseRunnerHooks & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    onPendingChanged: (pending) => calls.push(`pending:${pending ?? 'none'}`),
    onResult: () => calls.push('result'),
    onError: () => calls.push('error'),
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ScenePurchaseRunner', () => {
  it('fires pending then result hooks in order around a successful purchase', async () => {
    const purchase = deferred<UpgradePurchaseResult>();
    const hooks = createHooks();
    const runner = new ScenePurchaseRunner(() => purchase.promise, hooks);

    runner.run('army_speed');
    expect(hooks.calls).toEqual(['pending:army_speed']);
    expect(runner.pending).toBe('army_speed');

    purchase.resolve(fakeResult);
    await flushMicrotasks();

    expect(hooks.calls).toEqual(['pending:army_speed', 'result', 'pending:none']);
    expect(runner.pending).toBeNull();
  });

  it('ignores a second run while a purchase is already pending', async () => {
    const purchase = deferred<UpgradePurchaseResult>();
    const purchaseFn = vi.fn(() => purchase.promise);
    const hooks = createHooks();
    const runner = new ScenePurchaseRunner(purchaseFn, hooks);

    runner.run('army_speed');
    runner.run('treasury');

    expect(purchaseFn).toHaveBeenCalledTimes(1);
    expect(runner.pending).toBe('army_speed');

    purchase.resolve(fakeResult);
    await flushMicrotasks();
    expect(hooks.calls).toEqual(['pending:army_speed', 'result', 'pending:none']);
  });

  it('refuses to close while a purchase is in flight and allows it once settled', async () => {
    const purchase = deferred<UpgradePurchaseResult>();
    const runner = new ScenePurchaseRunner(() => purchase.promise, createHooks());

    expect(runner.requestClose()).toBe(true);
    runner.run('production');
    expect(runner.requestClose()).toBe(false);

    purchase.resolve(fakeResult);
    await flushMicrotasks();
    expect(runner.requestClose()).toBe(true);
  });

  it('drops result and refresh hooks when the scene shuts down mid-flight', async () => {
    const purchase = deferred<UpgradePurchaseResult>();
    const hooks = createHooks();
    const runner = new ScenePurchaseRunner(() => purchase.promise, hooks);

    runner.run('army_speed');
    runner.shutdown();

    purchase.resolve(fakeResult);
    await flushMicrotasks();

    expect(hooks.calls).toEqual(['pending:army_speed']);
    expect(runner.pending).toBeNull();
    expect(runner.isActive).toBe(false);
  });

  it('drops the error hook when the scene shuts down before a rejection lands', async () => {
    const purchase = deferred<UpgradePurchaseResult>();
    const hooks = createHooks();
    const runner = new ScenePurchaseRunner(() => purchase.promise, hooks);

    runner.run('army_speed');
    runner.shutdown();

    purchase.reject(new Error('backend_required_for_upgrade_purchase'));
    await flushMicrotasks();

    expect(hooks.calls).toEqual(['pending:army_speed']);
    expect(runner.pending).toBeNull();
  });

  it('routes purchase failures to onError and clears the pending state', async () => {
    const failure = new Error('network down');
    const hooks = createHooks();
    const onError = vi.fn();
    const runner = new ScenePurchaseRunner(() => Promise.reject(failure), {
      ...hooks,
      onError,
    });

    runner.run('treasury');
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledWith('treasury', failure);
    expect(runner.pending).toBeNull();
    expect(runner.requestClose()).toBe(true);
  });

  it('ignores run calls after shutdown', () => {
    const purchaseFn = vi.fn(
      (_type: UpgradeType) => new Promise<UpgradePurchaseResult>(() => undefined)
    );
    const runner = new ScenePurchaseRunner(purchaseFn, createHooks());

    runner.shutdown();
    runner.run('army_speed');

    expect(purchaseFn).not.toHaveBeenCalled();
    expect(runner.pending).toBeNull();
  });
});
