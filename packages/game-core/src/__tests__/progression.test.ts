import { describe, expect, it } from 'vitest';
import {
  calculateMatchRewards,
  createDefaultCareer,
  getRankTier,
  settleMatch,
} from '../progression.js';
import {
  getNextUpgradeCost,
  getUpgradeCardViewModel,
  getUpgradeEffectLabel,
  getPlayerUpgradeModifiers,
  getTreasuryCoinBonusRate,
  getUpgradeMilestoneProgress,
  getUpgradeMilestoneTier,
  getUpgradeMilestoneLabel,
  purchaseUpgrade,
} from '../upgrades.js';
import { MatchStats } from '../types.js';
import {
  claimLeagueRewardLocally,
  createLeagueState,
  getKingdomPower,
  getLeagueProgress,
} from '../league.js';
import { getKingdomLevel, getKingdomProgress, MAX_KINGDOM_LEVEL } from '../kingdom.js';

describe('Progression & Economy Engine', () => {
  it('creates a clean default career with welcome capital', () => {
    const career = createDefaultCareer('player_123');
    expect(career.playerId).toBe('player_123');
    expect(career.coins).toBe(100);
    expect(career.gems).toBe(10);
    expect(career.trophies).toBe(0);
    expect(career.startingGarrisonLevel).toBe(0);
    expect(career.productionLevel).toBe(0);
    expect(career.armySpeedLevel).toBe(0);
    expect(career.treasuryLevel).toBe(0);
    expect(career.matchesPlayed).toBe(0);
    expect(career.matchesWon).toBe(0);
    expect(career.currentStreak).toBe(0);
  });

  describe('Upgrade Purchases', () => {
    it('deducts the configured cost and creates an auditable coin entry', () => {
      const initial = createDefaultCareer('upgrader_1');
      const result = purchaseUpgrade(initial, 'production', 'upgrade_001', 1700000000000);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected upgrade purchase to succeed');
      expect(result.cost).toBe(50);
      expect(result.newCareer.productionLevel).toBe(1);
      expect(result.newCareer.coins).toBe(50);
      expect(initial.productionLevel).toBe(0);
      expect(result.ledgerEntry).toMatchObject({
        id: 'upgrade_001',
        player: 'upgrader_1',
        currency: 'coins',
        amount: -50,
        reason: 'upgrade_production',
        source: 'upgrade_purchase',
        previousBalance: 100,
        resultingBalance: 50,
        timestamp: 1700000000000,
      });
    });

    it('rejects unaffordable and max-level upgrades without changing career', () => {
      const poorCareer = { ...createDefaultCareer('upgrader_2'), coins: 49 };
      const unaffordable = purchaseUpgrade(poorCareer, 'army_speed', 'upgrade_002');

      expect(unaffordable.success).toBe(false);
      if (unaffordable.success) throw new Error('Expected upgrade purchase to fail');
      expect(unaffordable.reason).toBe('insufficient_coins');
      expect(unaffordable.newCareer).toEqual(poorCareer);

      const maxedCareer = {
        ...createDefaultCareer('upgrader_3'),
        startingGarrisonLevel: 20,
        coins: 9999,
      };
      expect(getNextUpgradeCost(maxedCareer, 'starting_garrison')).toBeNull();

      const maxed = purchaseUpgrade(maxedCareer, 'starting_garrison', 'upgrade_003');
      expect(maxed.success).toBe(false);
      if (maxed.success) throw new Error('Expected max-level purchase to fail');
      expect(maxed.reason).toBe('max_level');
      expect(maxed.newCareer).toEqual(maxedCareer);
    });

    it.each([
      [0, 50],
      [1, 100],
      [2, 175],
      [3, 275],
      [4, 400],
      [5, 500],
      [6, 625],
      [7, 775],
      [8, 950],
      [9, 1150],
      [10, 1375],
      [11, 1625],
      [12, 1900],
      [13, 2200],
      [14, 2525],
      [15, 2875],
      [16, 3250],
      [17, 3650],
      [18, 4100],
      [19, 4600],
    ])('uses the balance cost at level %i', (level, cost) => {
      const career = { ...createDefaultCareer('cost_test'), coins: 10000, treasuryLevel: level };
      expect(getNextUpgradeCost(career, 'treasury')).toBe(cost);
    });

    it('purchases Treasury through level 20 and rejects a further purchase', () => {
      let career = { ...createDefaultCareer('treasury_test'), coins: 100000 };
      for (let level = 0; level < 20; level++) {
        const result = purchaseUpgrade(career, 'treasury', `treasury_${level}`, 1000 + level);
        expect(result.success).toBe(true);
        if (!result.success) throw new Error('Treasury purchase failed');
        career = result.newCareer;
      }
      expect(career.treasuryLevel).toBe(20);
      expect(getNextUpgradeCost(career, 'treasury')).toBeNull();
      const rejected = purchaseUpgrade(career, 'treasury', 'treasury_max');
      expect(rejected.success).toBe(false);
      if (!rejected.success) expect(rejected.reason).toBe('max_level');
    });

    it.each([
      [0, 20, 1, 1, 0, 0],
      [5, 35, 1.4, 1.3, 0.25, 1],
      [6, 36, 1.42, 1.315, 0.27, 1],
      [10, 40, 1.5, 1.375, 0.35, 2],
      [15, 45, 1.6, 1.45, 0.45, 3],
      [20, 50, 1.7, 1.525, 0.55, 4],
    ])('keeps TypeScript upgrade rules in parity at level %i', (level, startingUnits, production, speed, treasuryRate, tier) => {
      const career = {
        ...createDefaultCareer('upgrader_4'),
        startingGarrisonLevel: level,
        productionLevel: level,
        armySpeedLevel: level,
      };
      expect(getPlayerUpgradeModifiers(career)).toEqual({
        startingUnits,
        productionRateMultiplier: production,
        armySpeedMultiplier: speed,
      });
      expect(getTreasuryCoinBonusRate(level)).toBe(treasuryRate);
      expect(getUpgradeMilestoneTier(level)).toBe(tier);
    });

    it.each([
      ['army_speed', 6, '+31.5% march', 'M5→10'],
      ['army_speed', 20, '+52.5% march', 'M20 ✓'],
      ['treasury', 20, '+55% coins', 'M20 ✓'],
    ] as const)('uses exact shared presentation at level %i', (type, level, effect, milestone) => {
      expect(getUpgradeEffectLabel(type, level)).toBe(effect);
      expect(getUpgradeMilestoneLabel(level)).toBe(milestone);
    });

    it.each([
      [0, 0],
      [1, 0.2],
      [4, 0.8],
      [5, 1],
      [6, 0.2],
      [19, 0.8],
      [20, 1],
    ])('reports milestone progress %i -> %j', (level, progress) => {
      expect(getUpgradeMilestoneProgress(level)).toBeCloseTo(progress, 5);
    });
  });

  describe('Upgrade Card View Model', () => {
    it('presents a fresh, unpurchased upgrade', () => {
      const career = { ...createDefaultCareer('kingdom_0'), coins: 0 };
      const card = getUpgradeCardViewModel(career, 'army_speed');

      expect(card).toMatchObject({
        type: 'army_speed',
        level: 0,
        maxLevel: 20,
        isMaxLevel: false,
        currentEffectLabel: '+0% march',
        nextEffectLabel: '+6% march',
        nextCost: 50,
        canAfford: false,
        milestoneLabel: 'M0→5',
        milestoneProgress: 0,
      });
    });

    it('marks a card affordable once coins cover the next cost', () => {
      const career = { ...createDefaultCareer('kingdom_5'), coins: 500, armySpeedLevel: 5 };
      const card = getUpgradeCardViewModel(career, 'army_speed');

      expect(card).toMatchObject({
        level: 5,
        currentEffectLabel: '+30% march',
        nextEffectLabel: '+31.5% march',
        nextCost: 500,
        canAfford: true,
        milestoneLabel: 'M5 ✓',
        milestoneProgress: 1,
      });
    });

    it('reports mid-tier progress and cost just past a milestone', () => {
      const career = { ...createDefaultCareer('kingdom_6'), coins: 100, armySpeedLevel: 6 };
      const card = getUpgradeCardViewModel(career, 'army_speed');

      expect(card).toMatchObject({
        level: 6,
        currentEffectLabel: '+31.5% march',
        nextEffectLabel: '+33% march',
        nextCost: 625,
        canAfford: false,
        milestoneLabel: 'M5→10',
        milestoneProgress: 0.2,
      });
    });

    it('shows the final pre-max card with an exact decimal effect', () => {
      const career = { ...createDefaultCareer('kingdom_19'), coins: 4600, armySpeedLevel: 19 };
      const card = getUpgradeCardViewModel(career, 'army_speed');

      expect(card).toMatchObject({
        level: 19,
        currentEffectLabel: '+51% march',
        nextEffectLabel: '+52.5% march',
        nextCost: 4600,
        canAfford: true,
        milestoneLabel: 'M15→20',
        milestoneProgress: 0.8,
      });
    });

    it('flags a fully maxed card with no further cost or next effect', () => {
      const career = { ...createDefaultCareer('kingdom_20'), coins: 99999, armySpeedLevel: 20 };
      const card = getUpgradeCardViewModel(career, 'army_speed');

      expect(card).toMatchObject({
        level: 20,
        isMaxLevel: true,
        currentEffectLabel: '+52.5% march',
        nextEffectLabel: null,
        nextCost: null,
        canAfford: false,
        milestoneLabel: 'M20 ✓',
        milestoneProgress: 1,
      });
    });
  });

  describe('Kingdom Progression', () => {
    it('derives kingdom level from all four normalized upgrades', () => {
      const career = {
        ...createDefaultCareer('realm_1'),
        startingGarrisonLevel: 3,
        productionLevel: 5,
        armySpeedLevel: 7,
        treasuryLevel: 9,
      };

      expect(getKingdomLevel(career)).toBe(24);
      expect(MAX_KINGDOM_LEVEL).toBe(80);
    });

    it.each([
      [0, 'war_camp', 10, 0],
      [9, 'war_camp', 1, 0.9],
      [10, 'stone_fort', 15, 0],
      [24, 'stone_fort', 1, 14 / 15],
      [25, 'royal_keep', 20, 0],
      [45, 'grand_citadel', 20, 0],
      [65, 'crown_capital', 0, 1],
      [80, 'crown_capital', 0, 1],
    ])(
      'maps total level %i to %s',
      (totalLevel, tierId, levelsToNextTier, tierProgress) => {
        const perUpgrade = Math.floor(totalLevel / 4);
        const remainder = totalLevel % 4;
        const career = {
          ...createDefaultCareer(`realm_${totalLevel}`),
          startingGarrisonLevel: perUpgrade + (remainder > 0 ? 1 : 0),
          productionLevel: perUpgrade + (remainder > 1 ? 1 : 0),
          armySpeedLevel: perUpgrade + (remainder > 2 ? 1 : 0),
          treasuryLevel: perUpgrade,
        };

        expect(getKingdomProgress(career)).toMatchObject({
          totalLevel,
          tier: { id: tierId },
          levelsToNextTier,
        });
        expect(getKingdomProgress(career).tierProgress).toBeCloseTo(tierProgress, 5);
      }
    );

    it('clamps invalid upgrade values before calculating progress', () => {
      const career = {
        ...createDefaultCareer('realm_invalid'),
        startingGarrisonLevel: 99,
        productionLevel: -4,
        armySpeedLevel: Number.NaN,
        treasuryLevel: 4.8,
      };

      expect(getKingdomLevel(career)).toBe(24);
    });
  });

  describe('Rank Tiers', () => {
    it('determines rank tier accurately by trophy count', () => {
      expect(getRankTier(0).id).toBe('recruit');
      expect(getRankTier(50).name).toBe('Recruit');
      expect(getRankTier(100).id).toBe('soldier');
      expect(getRankTier(249).id).toBe('soldier');
      expect(getRankTier(250).id).toBe('knight');
      expect(getRankTier(500).id).toBe('commander');
      expect(getRankTier(900).id).toBe('warlord');
      expect(getRankTier(1400).id).toBe('crown_lord');
      expect(getRankTier(2500).id).toBe('crown_lord');
    });

    it('handles negative or clamped trophy values gracefully', () => {
      expect(getRankTier(-10).id).toBe('recruit');
    });
  });

  describe('League Road', () => {
    it('calculates kingdom power and progress to next rank', () => {
      const career = {
        ...createDefaultCareer('league_1'),
        trophies: 175,
        startingGarrisonLevel: 2,
        productionLevel: 3,
        armySpeedLevel: 4,
        treasuryLevel: 1,
      };
      expect(getKingdomPower(career)).toBe(10);
      expect(getLeagueProgress(career.trophies)).toMatchObject({
        current: { id: 'soldier' },
        next: { id: 'knight' },
        progress: 0.5,
        trophiesToNext: 75,
      });
    });

    it('builds unlocked and claimed league tiers', () => {
      const state = createLeagueState(
        { ...createDefaultCareer('league_2'), trophies: 500 },
        ['soldier']
      );
      expect(state.currentRankId).toBe('commander');
      expect(state.tiers.find((tier) => tier.rankId === 'recruit')?.claimed).toBe(true);
      expect(state.tiers.find((tier) => tier.rankId === 'soldier')).toMatchObject({
        unlocked: true,
        claimed: true,
        reward: 75,
      });
      expect(state.tiers.find((tier) => tier.rankId === 'commander')).toMatchObject({
        unlocked: true,
        claimed: false,
        reward: 250,
      });
      expect(state.tiers.find((tier) => tier.rankId === 'warlord')?.unlocked).toBe(false);
    });

    it('claims an unlocked reward once with an auditable ledger entry', () => {
      const career = { ...createDefaultCareer('league_3'), trophies: 100 };
      const result = claimLeagueRewardLocally(
        createLeagueState(career),
        career,
        'soldier',
        'claim_1',
        1234
      );
      expect(result).toMatchObject({ success: true, reward: 75 });
      expect(result.newCareer.coins).toBe(175);
      expect(result.ledgerEntry).toMatchObject({
        id: 'league_claim_1',
        amount: 75,
        reason: 'league_soldier',
        source: 'league_reward',
        previousBalance: 100,
        resultingBalance: 175,
        timestamp: 1234,
      });
      expect(
        result.state.tiers.find((tier) => tier.rankId === 'soldier')?.claimed
      ).toBe(true);
      expect(
        claimLeagueRewardLocally(result.state, result.newCareer, 'soldier', 'claim_2').reason
      ).toBe('already_claimed');
    });

    it('rejects locked and unknown rewards without mutation', () => {
      const career = createDefaultCareer('league_4');
      const state = createLeagueState(career);
      expect(claimLeagueRewardLocally(state, career, 'knight', 'claim_1').reason).toBe(
        'not_unlocked'
      );
      expect(claimLeagueRewardLocally(state, career, 'recruit', 'claim_2').reason).toBe(
        'invalid_rank'
      );
    });
  });

  describe('Reward Calculations', () => {
    it('calculates victory rewards with speed, domination, and streak bonuses', () => {
      const stats: MatchStats = {
        matchDurationSeconds: 32, // blitzkrieg (<40s)
        playerUnitsDispatched: 50,
        enemyUnitsDispatched: 25,
        territoriesCapturedByPlayer: 6, // domination (>=5)
        territoriesCapturedByEnemy: 1,
      };

      const rewards = calculateMatchRewards('victory', stats, 2); // on 2-streak
      expect(rewards.baseCoins).toBe(40);
      expect(rewards.speedBonus).toBe(15);
      expect(rewards.dominationBonus).toBe(15);
      expect(rewards.streakBonus).toBe(10); // (3 - 1) * 5
      expect(rewards.treasuryBonus).toBe(0);
      expect(rewards.totalCoins).toBe(80);
      expect(rewards.trophyDelta).toBe(30);
    });

    it('adds Treasury bonus only after reward components are calculated', () => {
      const stats: MatchStats = {
        matchDurationSeconds: 35,
        playerUnitsDispatched: 0,
        enemyUnitsDispatched: 0,
        territoriesCapturedByPlayer: 5,
        territoriesCapturedByEnemy: 0,
      };
      const rewards = calculateMatchRewards('victory', stats, 0, 20);
      expect(rewards).toMatchObject({
        baseCoins: 40,
        speedBonus: 15,
        dominationBonus: 15,
        streakBonus: 0,
        treasuryBonus: 38,
        totalCoins: 108,
        trophyDelta: 30,
      });
    });

    it('calculates defeat rewards as consolation gold and trophy deduction', () => {
      const stats: MatchStats = {
        matchDurationSeconds: 70,
        playerUnitsDispatched: 30,
        enemyUnitsDispatched: 50,
        territoriesCapturedByPlayer: 1,
        territoriesCapturedByEnemy: 5,
      };

      const rewards = calculateMatchRewards('defeat', stats, 3);
      expect(rewards.baseCoins).toBe(10);
      expect(rewards.totalCoins).toBe(10);
      expect(rewards.trophyDelta).toBe(-12);
    });

    it('calculates draw rewards with moderate coins and slight trophies', () => {
      const stats: MatchStats = {
        matchDurationSeconds: 90,
        playerUnitsDispatched: 40,
        enemyUnitsDispatched: 40,
        territoriesCapturedByPlayer: 3,
        territoriesCapturedByEnemy: 3,
      };

      const rewards = calculateMatchRewards('draw', stats, 0);
      expect(rewards.baseCoins).toBe(20);
      expect(rewards.totalCoins).toBe(20);
      expect(rewards.trophyDelta).toBe(5);
    });
  });

  describe('Match Settlement & Ledger Auditing', () => {
    it('settles victory, updates streaks, and records append-only ledger entries', () => {
      const initial = createDefaultCareer('hero_1');
      const stats: MatchStats = {
        matchDurationSeconds: 35,
        playerUnitsDispatched: 40,
        enemyUnitsDispatched: 20,
        territoriesCapturedByPlayer: 5,
        territoriesCapturedByEnemy: 0,
      };

      const settlement = settleMatch(initial, 'victory', stats, 'match_001', 1700000000000);

      // Career validation
      expect(settlement.newCareer.coins).toBe(100 + settlement.breakdown.totalCoins);
      expect(settlement.newCareer.trophies).toBe(30);
      expect(settlement.newCareer.matchesPlayed).toBe(1);
      expect(settlement.newCareer.matchesWon).toBe(1);
      expect(settlement.newCareer.currentStreak).toBe(1);
      expect(settlement.newCareer.bestStreak).toBe(1);

      // Auditable ledger entries adhering to Constitution
      expect(settlement.ledgerEntries.length).toBe(2);

      const coinEntry = settlement.ledgerEntries.find((e) => e.currency === 'coins')!;
      expect(coinEntry.player).toBe('hero_1');
      expect(coinEntry.amount).toBe(settlement.breakdown.totalCoins);
      expect(coinEntry.previousBalance).toBe(100);
      expect(coinEntry.resultingBalance).toBe(100 + settlement.breakdown.totalCoins);
      expect(coinEntry.reason).toBe('match_victory');

      const trophyEntry = settlement.ledgerEntries.find((e) => e.currency === 'trophies')!;
      expect(trophyEntry.previousBalance).toBe(0);
      expect(trophyEntry.resultingBalance).toBe(30);
      expect(trophyEntry.amount).toBe(30);
    });

    it('preserves purchased upgrade levels during match settlement', () => {
      const initial = {
        ...createDefaultCareer('upgrader_5'),
        startingGarrisonLevel: 1,
        productionLevel: 2,
        armySpeedLevel: 3,
        treasuryLevel: 8,
      };
      const stats: MatchStats = {
        matchDurationSeconds: 90,
        playerUnitsDispatched: 20,
        enemyUnitsDispatched: 20,
        territoriesCapturedByPlayer: 2,
        territoriesCapturedByEnemy: 2,
      };

      const settlement = settleMatch(initial, 'draw', stats, 'match_upgrades');
      expect(settlement.newCareer.startingGarrisonLevel).toBe(1);
      expect(settlement.newCareer.productionLevel).toBe(2);
      expect(settlement.newCareer.armySpeedLevel).toBe(3);
      expect(settlement.newCareer.treasuryLevel).toBe(8);
    });

    it('prevents trophy balance from dropping below zero on defeat', () => {
      const initial = createDefaultCareer('recruit_1');
      initial.trophies = 5;

      const stats: MatchStats = {
        matchDurationSeconds: 80,
        playerUnitsDispatched: 20,
        enemyUnitsDispatched: 60,
        territoriesCapturedByPlayer: 1,
        territoriesCapturedByEnemy: 6,
      };

      const settlement = settleMatch(initial, 'defeat', stats, 'match_002', 1700000000000);
      expect(settlement.newCareer.trophies).toBe(0); // Clamped to 0
      expect(settlement.newCareer.currentStreak).toBe(0);

      const trophyEntry = settlement.ledgerEntries.find((e) => e.currency === 'trophies')!;
      expect(trophyEntry.amount).toBe(-5);
      expect(trophyEntry.resultingBalance).toBe(0);
    });

    it('detects rank promotion correctly when crossing trophy thresholds', () => {
      const career = createDefaultCareer('hero_rank');
      career.trophies = 90; // In Recruit tier (0-99)

      const stats: MatchStats = {
        matchDurationSeconds: 45,
        playerUnitsDispatched: 40,
        enemyUnitsDispatched: 30,
        territoriesCapturedByPlayer: 4,
        territoriesCapturedByEnemy: 1,
      };

      const settlement = settleMatch(career, 'victory', stats, 'match_rank_up');
      expect(settlement.newCareer.trophies).toBe(120); // Climbs to Soldier (100+)
      expect(settlement.previousRank.id).toBe('recruit');
      expect(settlement.newRank.id).toBe('soldier');
      expect(settlement.rankPromoted).toBe(true);
    });
  });
});
