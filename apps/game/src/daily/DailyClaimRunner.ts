import type { DailyClaimResult, DailyRewardType } from '@crown-clash/game-core';

export interface DailyClaimRunnerHooks {
  onPendingChanged: (pending: DailyRewardType | null) => void;
  onResult: (result: DailyClaimResult) => void;
  onError: (type: DailyRewardType, error: unknown) => void;
}

/** Serializes claims and suppresses callbacks after the owning scene shuts down. */
export class DailyClaimRunner {
  private pendingType: DailyRewardType | null = null;
  private active = true;

  constructor(
    private readonly claim: (type: DailyRewardType) => Promise<DailyClaimResult>,
    private readonly hooks: DailyClaimRunnerHooks
  ) {}

  get pending(): DailyRewardType | null {
    return this.pendingType;
  }

  get isActive(): boolean {
    return this.active;
  }

  requestClose(): boolean {
    return this.pendingType === null;
  }

  shutdown(): void {
    this.active = false;
  }

  run(type: DailyRewardType): void {
    if (!this.active || this.pendingType !== null) return;
    this.pendingType = type;
    this.hooks.onPendingChanged(type);
    void this.complete(type);
  }

  private async complete(type: DailyRewardType): Promise<void> {
    try {
      const result = await this.claim(type);
      if (this.active) this.hooks.onResult(result);
    } catch (error) {
      if (this.active) this.hooks.onError(type, error);
    } finally {
      this.pendingType = null;
      if (this.active) this.hooks.onPendingChanged(null);
    }
  }
}
