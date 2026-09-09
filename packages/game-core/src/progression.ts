/**
 * Crown Clash - Core Progression & Economy Engine
 * Pure, deterministic domain logic for match settlement, rewards, economy ledger, and rank tiers.
 */

import { MatchStats } from './types.js';
import { getTreasuryCoinBonusRate } from './upgrades.js';

export type CurrencyType = 'coins' | 'gems' | 'trophies';

export interface RankTierInfo {
  readonly id: string;
  readonly name: string;
  readonly badge: string;
  readonly minTrophies: number;
  readonly maxTrophies: number;
  readonly color: number;
}

export const RANK_TIERS: readonly RankTierInfo[] = [
  { id: 'recruit', name: 'Recruit', badge: '🛡️', minTrophies: 0, maxTrophies: 99, color: 0x94a3b8 },
  { id: 'soldier', name: 'Soldier', badge: '⚔️', minTrophies: 100, maxTrophies: 249, color: 0x38bdf8 },
  { id: 'knight', name: 'Knight', badge: '🎖️', minTrophies: 250, maxTrophies: 499, color: 0x818cf8 },
  { id: 'commander', name: 'Commander', badge: '👑', minTrophies: 500, maxTrophies: 899, color: 0xf59e0b },
  { id: 'warlord', name: 'Warlord', badge: '🔱', minTrophies: 900, maxTrophies: 1399, color: 0xec4899 },
  { id: 'crown_lord', name: 'Crown Lord', badge: '💎', minTrophies: 1400, maxTrophies: 99999, color: 0xa855f7 },
] as const;

export interface PlayerCareer {
  playerId: string;
  coins: number;
  gems: number;
  trophies: number;
  startingGarrisonLevel: number;
  productionLevel: number;
  armySpeedLevel: number;
  treasuryLevel: number;
  matchesPlayed: number;
  matchesWon: number;
  currentStreak: number;
  bestStreak: number;
  lastMatchTimestamp: number;
}

export interface EconomyLedgerEntry {
  id: string;
  player: string;
  currency: CurrencyType;
  amount: number;
  reason: string;
  source: string;
  previousBalance: number;
  resultingBalance: number;
  timestamp: number;
}

export interface MatchRewardBreakdown {
  baseCoins: number;
  speedBonus: number;
  dominationBonus: number;
  streakBonus: number;
  treasuryBonus: number;
  totalCoins: number;
  trophyDelta: number;
}

export interface MatchSettlement {
  matchId: string;
  status: 'victory' | 'defeat' | 'draw';
  breakdown: MatchRewardBreakdown;
  stats: MatchStats;
  previousCareer: PlayerCareer;
  newCareer: PlayerCareer;
  previousRank: RankTierInfo;
  newRank: RankTierInfo;
  rankPromoted: boolean;
  ledgerEntries: EconomyLedgerEntry[];
}

export function createDefaultCareer(playerId: string): PlayerCareer {
  return {
    playerId,
    coins: 100, // Welcome starting capital
    gems: 10,
    trophies: 0,
    startingGarrisonLevel: 0,
    productionLevel: 0,
    armySpeedLevel: 0,
    treasuryLevel: 0,
    matchesPlayed: 0,
    matchesWon: 0,
    currentStreak: 0,
    bestStreak: 0,
    lastMatchTimestamp: 0,
  };
}

export function getRankTier(trophies: number): RankTierInfo {
  const safeTrophies = Math.max(0, trophies);
  for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
    const tier = RANK_TIERS[i];
    if (safeTrophies >= tier.minTrophies) {
      return tier;
    }
  }
  return RANK_TIERS[0];
}

export function calculateMatchRewards(
  status: 'victory' | 'defeat' | 'draw',
  stats: MatchStats,
  currentStreak: number,
  treasuryLevel = 0
): MatchRewardBreakdown {
  const applyTreasuryBonus = (
    baseCoins: number,
    speedBonus: number,
    dominationBonus: number,
    streakBonus: number,
    trophyDelta: number
  ): MatchRewardBreakdown => {
    const preTreasuryCoinReward = baseCoins + speedBonus + dominationBonus + streakBonus;
    const treasuryBonus = Math.floor(preTreasuryCoinReward * getTreasuryCoinBonusRate(treasuryLevel));
    return {
      baseCoins,
      speedBonus,
      dominationBonus,
      streakBonus,
      treasuryBonus,
      totalCoins: preTreasuryCoinReward + treasuryBonus,
      trophyDelta,
    };
  };

  if (status === 'victory') {
    const baseCoins = 40;

    // Speed bonus: fast blitzkrieg wins get extra gold
    let speedBonus = 0;
    if (stats.matchDurationSeconds > 0 && stats.matchDurationSeconds <= 40) {
      speedBonus = 15;
    } else if (stats.matchDurationSeconds <= 60) {
      speedBonus = 10;
    }

    // Domination bonus: capturing 5 or more territories in match
    const dominationBonus = stats.territoriesCapturedByPlayer >= 5 ? 15 : 0;

    // Win streak bonus (+5 per streak, max +25)
    const newStreak = currentStreak + 1;
    const streakBonus = Math.min(25, Math.max(0, (newStreak - 1) * 5));

    return applyTreasuryBonus(baseCoins, speedBonus, dominationBonus, streakBonus, 30);
  }

  if (status === 'defeat') {
    return applyTreasuryBonus(10, 0, 0, 0, -12);
  }

  // Draw
  return applyTreasuryBonus(20, 0, 0, 0, 5);
}

/**
 * Server-authoritative, deterministic settlement of a finished match.
 * Mutates career state and outputs immutable auditable ledger entries.
 */
export function settleMatch(
  career: PlayerCareer,
  status: 'victory' | 'defeat' | 'draw',
  stats: MatchStats,
  matchId: string,
  timestamp = Date.now()
): MatchSettlement {
  const previousCareer: PlayerCareer = { ...career };
  const previousRank = getRankTier(previousCareer.trophies);

  const breakdown = calculateMatchRewards(
    status,
    stats,
    previousCareer.currentStreak,
    previousCareer.treasuryLevel
  );

  // New Career metrics
  const matchesPlayed = previousCareer.matchesPlayed + 1;
  const isWin = status === 'victory';
  const matchesWon = isWin ? previousCareer.matchesWon + 1 : previousCareer.matchesWon;
  const currentStreak = isWin ? previousCareer.currentStreak + 1 : 0;
  const bestStreak = Math.max(previousCareer.bestStreak, currentStreak);

  // Calculate new Trophy Balance (cannot fall below 0 in Recruit tier)
  const newTrophies = Math.max(0, previousCareer.trophies + breakdown.trophyDelta);
  const actualTrophyDelta = newTrophies - previousCareer.trophies;

  // Calculate new Coin Balance
  const newCoins = previousCareer.coins + breakdown.totalCoins;

  const newCareer: PlayerCareer = {
    ...previousCareer,
    coins: newCoins,
    trophies: newTrophies,
    matchesPlayed,
    matchesWon,
    currentStreak,
    bestStreak,
    lastMatchTimestamp: timestamp,
  };

  const newRank = getRankTier(newCareer.trophies);
  const rankPromoted = newRank.minTrophies > previousRank.minTrophies;

  // Build auditable ledger entries adhering to Constitution
  const ledgerEntries: EconomyLedgerEntry[] = [
    {
      id: `${matchId}_coins_${timestamp}`,
      player: career.playerId,
      currency: 'coins',
      amount: breakdown.totalCoins,
      reason: isWin ? 'match_victory' : status === 'draw' ? 'match_draw' : 'match_consolation',
      source: 'battle_settlement',
      previousBalance: previousCareer.coins,
      resultingBalance: newCoins,
      timestamp,
    },
  ];

  if (actualTrophyDelta !== 0) {
    ledgerEntries.push({
      id: `${matchId}_trophies_${timestamp}`,
      player: career.playerId,
      currency: 'trophies',
      amount: actualTrophyDelta,
      reason: isWin ? 'rank_victory' : status === 'draw' ? 'rank_draw' : 'rank_defeat',
      source: 'battle_settlement',
      previousBalance: previousCareer.trophies,
      resultingBalance: newTrophies,
      timestamp,
    });
  }

  return {
    matchId,
    status,
    breakdown,
    stats,
    previousCareer,
    newCareer,
    previousRank,
    newRank,
    rankPromoted,
    ledgerEntries,
  };
}