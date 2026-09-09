import { getUpgradeLevel, isUpgradeMilestoneLevel, UpgradePurchaseResult, UpgradeType } from '@crown-clash/game-core';
import type { PlatformAdapter } from '@crown-clash/platform';
import { isLocalCareerFallbackAllowed } from '../api/GameApiClient.js';
import { trackUpgradeEvent } from '../analytics/Analytics.js';
import { sounds } from '../audio/SoundEffects.js';

/**
 * Minimal career surface the purchase flow depends on. CareerManager
 * satisfies this shape structurally, and tests can supply a lightweight
 * fake instead of wiring up the full singleton and local storage.
 */
export interface UpgradeCareerSource {
  isRemoteConnected(): boolean;
  purchaseUpgradeRemote(type: UpgradeType): Promise<UpgradePurchaseResult>;
  purchaseUpgrade(type: UpgradeType): UpgradePurchaseResult;
}

export interface UpgradePurchaseCallbacks {
  onMilestone?: (level: number) => void;
}

/**
 * The single server-authoritative purchase path shared by the post-match
 * result panel and the Kingdom hub. Both entry points must apply the exact
 * same rules: never mutate optimistically ahead of the response, never fall
 * back to the local economy outside of dev builds, and emit identical
 * analytics regardless of where the purchase was made.
 */
export async function purchaseUpgradeThroughCareer(
  career: UpgradeCareerSource,
  platform: PlatformAdapter,
  type: UpgradeType,
  callbacks: UpgradePurchaseCallbacks = {}
): Promise<UpgradePurchaseResult> {
  const purchase = career.isRemoteConnected()
    ? await career.purchaseUpgradeRemote(type)
    : isLocalCareerFallbackAllowed()
      ? career.purchaseUpgrade(type)
      : (() => {
          throw new Error('backend_required_for_upgrade_purchase');
        })();

  if (purchase.success) {
    sounds.playCoin();
    platform.hapticNotification('success');
    const level = getUpgradeLevel(purchase.newCareer, type);
    if (isUpgradeMilestoneLevel(level)) {
      callbacks.onMilestone?.(level);
    }
    trackUpgradeEvent({
      name: 'upgrade_purchase_succeeded',
      purchaseId: purchase.ledgerEntry.id,
    });
  } else {
    trackUpgradeEvent({
      name: 'upgrade_purchase_failed',
      upgradeType: type,
      reason: purchase.reason,
    });
  }

  return purchase;
}
