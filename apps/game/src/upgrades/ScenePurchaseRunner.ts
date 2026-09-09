import type { UpgradePurchaseResult, UpgradeType } from '@crown-clash/game-core';

export interface ScenePurchaseRunnerHooks {
  onPendingChanged: (pendingType: UpgradeType | null) => void;
  onResult: (type: UpgradeType, result: UpgradePurchaseResult) => void;
  onError: (type: UpgradeType, error: unknown) => void;
}

/**
 * Serializes upgrade purchases for a scene and keeps their async completion
 * lifecycle-safe. UI hooks never fire after shutdown() — by then the scene's
 * game objects are destroyed and touching them would throw — and
 * requestClose() refuses to leave while a purchase is in flight, so the next
 * scene can never render career data from before the purchase settled.
 * Career state itself is always settled inside the purchase function
 * regardless of scene liveness; only the UI callbacks are gated.
 */
export class ScenePurchaseRunner {
  private pendingType: UpgradeType | null = null;
  private active = true;

  constructor(
    private readonly purchase: (type: UpgradeType) => Promise<UpgradePurchaseResult>,
    private readonly hooks: ScenePurchaseRunnerHooks
  ) {}

  get pending(): UpgradeType | null {
    return this.pendingType;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** True when the scene may be left; false while a purchase is in flight. */
  requestClose(): boolean {
    return this.pendingType === null;
  }

  shutdown(): void {
    this.active = false;
  }

  run(type: UpgradeType): void {
    if (this.pendingType !== null || !this.active) return;
    this.pendingType = type;
    this.hooks.onPendingChanged(type);
    void this.complete(type);
  }

  private async complete(type: UpgradeType): Promise<void> {
    try {
      const result = await this.purchase(type);
      if (this.active) this.hooks.onResult(type, result);
    } catch (error) {
      if (this.active) this.hooks.onError(type, error);
    } finally {
      this.pendingType = null;
      if (this.active) this.hooks.onPendingChanged(null);
    }
  }
}
