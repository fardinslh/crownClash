import type { UpgradeFailureReason, UpgradeType } from '@crown-clash/game-core';

export type UpgradeAnalyticsEvent =
  | {
      name: 'upgrade_panel_viewed';
      coins: number;
      startingGarrisonLevel: number;
      productionLevel: number;
      armySpeedLevel: number;
    }
  | {
      name: 'upgrade_purchase_succeeded';
      upgradeType: UpgradeType;
      level: number;
      cost: number;
      resultingCoins: number;
    }
  | {
      name: 'upgrade_purchase_failed';
      upgradeType: UpgradeType;
      cost: number | null;
      reason: UpgradeFailureReason;
      coins: number;
    };

export type AnalyticsEvent =
  | UpgradeAnalyticsEvent
  | { name: 'session_start'; playerId: string }
  | { name: 'menu_viewed'; coins: number; trophies: number; rankId: string }
  | { name: 'match_start'; source: 'menu' | 'rematch' }
  | { name: 'match_end'; status: 'victory' | 'defeat' | 'draw'; matchId: string }
  | { name: 'pvp_opponents_viewed'; count: number }
  | { name: 'pvp_attack_start'; defenderId: string; isRevenge: boolean }
  | {
      name: 'pvp_attack_end';
      defenderId: string;
      status: 'victory' | 'defeat' | 'draw';
      isRevenge: boolean;
    }
  | { name: 'pvp_attack_failed'; defenderId: string; reason: string }
  | { name: 'live_queue_joined' }
  | { name: 'live_invite_created' }
  | { name: 'live_invite_joined' }
  | { name: 'live_match_started'; matchId: string }
  | { name: 'live_match_ended'; status: 'victory' | 'defeat' | 'draw' }
  | { name: 'live_match_disconnected' };

export function trackEvent(event: AnalyticsEvent): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent('crown-clash:analytics', { detail: event }));
}

export function trackUpgradeEvent(event: UpgradeAnalyticsEvent): void {
  trackEvent(event);
}
