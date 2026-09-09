import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCareer, UpgradePurchaseResult } from '@crown-clash/game-core';
import type { PlatformAdapter } from '@crown-clash/platform';
import type { UpgradeCareerSource } from '../UpgradePurchaseController.js';

const { trackUpgradeEvent } = vi.hoisted(() => ({ trackUpgradeEvent: vi.fn() }));
const { isLocalCareerFallbackAllowed } = vi.hoisted(() => ({
  isLocalCareerFallbackAllowed: vi.fn(() => true),
}));

vi.mock('../../analytics/Analytics.js', () => ({ trackUpgradeEvent }));
vi.mock('../../api/GameApiClient.js', () => ({ isLocalCareerFallbackAllowed }));

const { purchaseUpgradeThroughCareer } = await import('../UpgradePurchaseController.js');

function createPlatform(): PlatformAdapter {
  return {
    hapticNotification: vi.fn(),
    hapticImpact: vi.fn(),
  } as unknown as PlatformAdapter;
}

function successResult(overrides: Partial<UpgradePurchaseResult & { success: true }> = {}) {
  const previousCareer = createDefaultCareer('kingdom_player');
  const newCareer = { ...previousCareer, coins: previousCareer.coins - 50, armySpeedLevel: 1 };
  return {
    success: true as const,
    cost: 50,
    previousCareer,
    newCareer,
    ledgerEntry: {
      id: 'purchase_1',
      player: previousCareer.playerId,
      currency: 'coins' as const,
      amount: -50,
      reason: 'upgrade_army_speed',
      source: 'upgrade_purchase' as const,
      previousBalance: previousCareer.coins,
      resultingBalance: newCareer.coins,
      timestamp: 1,
    },
    ...overrides,
  };
}

describe('purchaseUpgradeThroughCareer', () => {
  beforeEach(() => {
    trackUpgradeEvent.mockClear();
    isLocalCareerFallbackAllowed.mockReturnValue(true);
  });

  it('buys through the remote career when connected and tracks success', async () => {
    const platform = createPlatform();
    const purchase = successResult();
    const career: UpgradeCareerSource = {
      isRemoteConnected: () => true,
      purchaseUpgradeRemote: vi.fn(async () => purchase),
      purchaseUpgrade: vi.fn(),
    };

    const result = await purchaseUpgradeThroughCareer(career, platform, 'army_speed');

    expect(result).toBe(purchase);
    expect(career.purchaseUpgradeRemote).toHaveBeenCalledWith('army_speed');
    expect(career.purchaseUpgrade).not.toHaveBeenCalled();
    expect(platform.hapticNotification).toHaveBeenCalledWith('success');
    expect(trackUpgradeEvent).toHaveBeenCalledWith({
      name: 'upgrade_purchase_succeeded',
      purchaseId: 'purchase_1',
    });
  });

  it('invokes the milestone callback only when the new level lands on a milestone', async () => {
    const platform = createPlatform();
    const onMilestone = vi.fn();
    const career: UpgradeCareerSource = {
      isRemoteConnected: () => true,
      purchaseUpgradeRemote: vi.fn(async () =>
        successResult({
          newCareer: { ...createDefaultCareer('p'), armySpeedLevel: 5, coins: 0 },
        })
      ),
      purchaseUpgrade: vi.fn(),
    };

    await purchaseUpgradeThroughCareer(career, platform, 'army_speed', { onMilestone });

    expect(onMilestone).toHaveBeenCalledWith(5);
  });

  it('does not invoke the milestone callback on a non-milestone level', async () => {
    const platform = createPlatform();
    const onMilestone = vi.fn();
    const career: UpgradeCareerSource = {
      isRemoteConnected: () => true,
      purchaseUpgradeRemote: vi.fn(async () => successResult()), // lands on level 1
      purchaseUpgrade: vi.fn(),
    };

    await purchaseUpgradeThroughCareer(career, platform, 'army_speed', { onMilestone });

    expect(onMilestone).not.toHaveBeenCalled();
  });

  it('tracks a failure event and skips haptics/milestone when the purchase is rejected', async () => {
    const platform = createPlatform();
    const previousCareer = createDefaultCareer('poor_player');
    const career: UpgradeCareerSource = {
      isRemoteConnected: () => true,
      purchaseUpgradeRemote: vi.fn(async () => ({
        success: false as const,
        reason: 'insufficient_coins' as const,
        cost: 500,
        previousCareer,
        newCareer: previousCareer,
      })),
      purchaseUpgrade: vi.fn(),
    };

    const result = await purchaseUpgradeThroughCareer(career, platform, 'treasury');

    expect(result.success).toBe(false);
    expect(platform.hapticNotification).not.toHaveBeenCalled();
    expect(trackUpgradeEvent).toHaveBeenCalledWith({
      name: 'upgrade_purchase_failed',
      upgradeType: 'treasury',
      reason: 'insufficient_coins',
    });
  });

  it('falls back to the local purchase path when not remote-connected and fallback is allowed', async () => {
    const platform = createPlatform();
    const purchase = successResult();
    const career: UpgradeCareerSource = {
      isRemoteConnected: () => false,
      purchaseUpgradeRemote: vi.fn(),
      purchaseUpgrade: vi.fn(() => purchase),
    };

    const result = await purchaseUpgradeThroughCareer(career, platform, 'army_speed');

    expect(result).toBe(purchase);
    expect(career.purchaseUpgrade).toHaveBeenCalledWith('army_speed');
    expect(career.purchaseUpgradeRemote).not.toHaveBeenCalled();
  });

  it('throws instead of silently using the local economy when not connected and fallback is disallowed', async () => {
    isLocalCareerFallbackAllowed.mockReturnValue(false);
    const platform = createPlatform();
    const career: UpgradeCareerSource = {
      isRemoteConnected: () => false,
      purchaseUpgradeRemote: vi.fn(),
      purchaseUpgrade: vi.fn(),
    };

    await expect(purchaseUpgradeThroughCareer(career, platform, 'army_speed')).rejects.toThrow(
      'backend_required_for_upgrade_purchase'
    );
    expect(career.purchaseUpgrade).not.toHaveBeenCalled();
    expect(trackUpgradeEvent).not.toHaveBeenCalled();
  });
});
