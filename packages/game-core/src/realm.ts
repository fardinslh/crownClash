import type { CommanderId } from './commanders.js';
import { getCommander } from './commanders.js';
import type { PlayerCareer, MatchSettlement } from './progression.js';
import type { PlayerUpgradeModifiers, UpgradeType } from './upgrades.js';
import type { BattlefieldId } from './battlefields.js';

export type RealmSource = 'ranked' | 'friend' | 'revenge';
export type RealmCombatPolicy = 'equal' | 'bounded';
export interface RealmDefense {
  challengeRewardEligible?: boolean;
  playerId: string; displayName: string; version: string; kingdomLevel: number;
  kingdomTierId: string; trophies: number; commanderId: CommanderId;
  levels: [number, number, number];
}
export interface RealmTicket {
  rewardTreasuryLevel: number;
  matchId: string; source: RealmSource; combatPolicy: RealmCombatPolicy;
  battlefieldId: BattlefieldId; gameplayRulesVersion: 2; configVersion: number;
  defender: RealmDefense; playerModifiers: PlayerUpgradeModifiers;
  enemyModifiers: PlayerUpgradeModifiers; effectiveLevels: [number, number, number];
  createdAt: number; expiresAt: number; rewardEligible: boolean;
  originId?: string;
}
export interface RealmHistory {
  matchId: string; incoming: boolean; opponentName: string; status: 'victory' | 'defeat' | 'draw';
  createdAt: number; revengeAvailable: boolean; combatPolicy: RealmCombatPolicy;
}
export interface RealmResult { ticket: RealmTicket; settlement: MatchSettlement; rewarded: boolean }
export interface CoinProduct { id: 'starter' | 'refill'; coins: number; amountRials: number; once: boolean }
export interface CoinOrder {
  id: string; product: CoinProduct; state: 'created' | 'pending' | 'fulfilled' | 'refunded';
  invoice: string; createdAt: number;
}
export interface RealmConfig {
  enabled: boolean; paymentsEnabled: boolean; version: number; botUsername: string;
  products: CoinProduct[];
}
export interface RealmHome {
  defense: RealmDefense; goal: UpgradeType; history: RealmHistory[];
  activeTicket?: RealmTicket; activePractice?: import('./battlefields.js').BotMatchTicket; socialRewardsRemaining: number;
}

/** Only owned progression is clipped; temporary equal-power choices never grant ownership. */
export function realmModifiers(
  levels: readonly number[], opponentLevels: readonly number[], commanderId: CommanderId,
  policy: RealmCombatPolicy,
): { levels: [number, number, number]; modifiers: PlayerUpgradeModifiers } {
  const normalize = (value: number | undefined): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(20, Math.floor(value))) : 0;
  const effective = [0, 1, 2].map(index => policy === 'equal' ? 0
    : Math.min(normalize(levels[index]), normalize(opponentLevels[index]) + 2)) as [number, number, number];
  const commander = getCommander(commanderId);
  return { levels: effective, modifiers: {
    startingUnits: Math.max(1, 20 + effective[0] + commander.startingUnitsDelta),
    productionRateMultiplier: Math.round((1 + effective[1] * .02) * commander.productionMultiplier * 1000) / 1000,
    armySpeedMultiplier: Math.round((1 + effective[2] * .015) * commander.armySpeedMultiplier * 1000) / 1000,
  } };
}
export function careerCombatLevels(career: PlayerCareer): [number, number, number] {
  return [career.startingGarrisonLevel, career.productionLevel, career.armySpeedLevel];
}
