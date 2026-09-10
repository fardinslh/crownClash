import type { LeagueClaimResult, LeagueState, LeagueTierState } from './types.js';
import {
  getRankTier,
  RANK_TIERS,
  type EconomyLedgerEntry,
  type PlayerCareer,
  type RankTierInfo,
} from './progression.js';

export const LEAGUE_REWARDS: Readonly<Record<string, number>> = {
  recruit: 0,
  soldier: 75,
  knight: 150,
  commander: 250,
  warlord: 400,
  crown_lord: 700,
};

export interface LeagueProgress {
  current: RankTierInfo;
  next: RankTierInfo | null;
  progress: number;
  trophiesToNext: number;
}

export function getKingdomPower(career: PlayerCareer): number {
  return (
    career.startingGarrisonLevel +
    career.productionLevel +
    career.armySpeedLevel +
    career.treasuryLevel
  );
}

export function getLeagueProgress(trophies: number): LeagueProgress {
  const safeTrophies = Math.max(0, trophies);
  const current = getRankTier(safeTrophies);
  const index = RANK_TIERS.findIndex((tier) => tier.id === current.id);
  const next = RANK_TIERS[index + 1] ?? null;
  if (!next) return { current, next: null, progress: 1, trophiesToNext: 0 };
  const span = next.minTrophies - current.minTrophies;
  return {
    current,
    next,
    progress: Math.min(1, Math.max(0, (safeTrophies - current.minTrophies) / span)),
    trophiesToNext: Math.max(0, next.minTrophies - safeTrophies),
  };
}

export function createLeagueState(
  career: PlayerCareer,
  claimedRankIds: readonly string[] = []
): LeagueState {
  const claimed = new Set(claimedRankIds);
  const tiers: LeagueTierState[] = RANK_TIERS.map((tier) => ({
    rankId: tier.id,
    name: tier.name,
    badge: tier.badge,
    minTrophies: tier.minTrophies,
    reward: LEAGUE_REWARDS[tier.id] ?? 0,
    unlocked: career.trophies >= tier.minTrophies,
    claimed: tier.id === 'recruit' || claimed.has(tier.id),
  }));
  return {
    trophies: career.trophies,
    kingdomPower: getKingdomPower(career),
    currentRankId: getRankTier(career.trophies).id,
    tiers,
  };
}

export function claimLeagueRewardLocally(
  state: LeagueState,
  career: PlayerCareer,
  rankId: string,
  claimId: string,
  timestamp = Date.now()
): LeagueClaimResult {
  const tier = state.tiers.find((item) => item.rankId === rankId);
  const failure = (reason: LeagueClaimResult['reason']): LeagueClaimResult => ({
    claimId,
    success: false,
    reason,
    rankId,
    reward: 0,
    replayed: false,
    state,
    newCareer: career,
  });
  if (!tier || tier.reward <= 0) return failure('invalid_rank');
  if (career.trophies < tier.minTrophies) return failure('not_unlocked');
  if (tier.claimed) return failure('already_claimed');

  const newCareer = { ...career, coins: career.coins + tier.reward };
  const ledgerEntry: EconomyLedgerEntry = {
    id: `league_${claimId}`,
    player: career.playerId,
    currency: 'coins',
    amount: tier.reward,
    reason: `league_${rankId}`,
    source: 'league_reward',
    previousBalance: career.coins,
    resultingBalance: newCareer.coins,
    timestamp,
  };
  return {
    claimId,
    success: true,
    rankId,
    reward: tier.reward,
    replayed: false,
    state: createLeagueState(newCareer, [
      ...state.tiers.filter((item) => item.claimed).map((item) => item.rankId),
      rankId,
    ]),
    newCareer,
    ledgerEntry,
  };
}
