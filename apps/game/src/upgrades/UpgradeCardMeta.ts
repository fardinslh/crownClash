import type { UpgradeType } from '@crown-clash/game-core';

export interface UpgradeCardMeta {
  readonly icon: string;
  readonly title: string;
  readonly subtitle: string;
}

/**
 * Presentation metadata shared by every surface that renders an upgrade
 * card (result panel, Kingdom hub), so the name/icon a player learns in one
 * place always matches the other.
 */
export const UPGRADE_CARD_META: Readonly<Record<UpgradeType, UpgradeCardMeta>> = {
  starting_garrison: { icon: '🏰', title: 'CITADEL', subtitle: 'Starting Troops' },
  production: { icon: '⚒', title: 'WAR FORGE', subtitle: 'Production Rate' },
  army_speed: { icon: '⚡', title: 'ROYAL ROADS', subtitle: 'March Speed' },
  treasury: { icon: '🪙', title: 'TREASURY', subtitle: 'Coin Bonus' },
};

export const UPGRADE_TYPES: readonly UpgradeType[] = [
  'starting_garrison',
  'production',
  'army_speed',
  'treasury',
];
