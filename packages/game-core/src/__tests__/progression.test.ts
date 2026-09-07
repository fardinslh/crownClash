import { describe, expect, it } from 'vitest';
import {
  calculateMatchRewards,
  createDefaultCareer,
  getRankTier,
  settleMatch,
} from '../progression.js';
import { getNextUpgradeCost, getPlayerUpgradeModifiers, purchaseUpgrade } from '../upgrades.js';
import { MatchStats } from '../types.js';

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
        startingGarrisonLevel: 5,
        coins: 9999,
      };
      expect(getNextUpgradeCost(maxedCareer, 'starting_garrison')).toBeNull();

      const maxed = purchaseUpgrade(maxedCareer, 'starting_garrison', 'upgrade_003');
      expect(maxed.success).toBe(false);
      if (maxed.success) throw new Error('Expected max-level purchase to fail');
      expect(maxed.reason).toBe('max_level');
      expect(maxed.newCareer).toEqual(maxedCareer);
    });

    it('calculates deterministic next-match modifiers from levels', () => {
      const career = {
        ...createDefaultCareer('upgrader_4'),
        startingGarrisonLevel: 2,
        productionLevel: 3,
        armySpeedLevel: 4,
      };

      expect(getPlayerUpgradeModifiers(career)).toEqual({
        startingUnits: 26,
        productionRateMultiplier: 1.24,
        armySpeedMultiplier: 1.24,
      });
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
      expect(rewards.totalCoins).toBe(80);
      expect(rewards.trophyDelta).toBe(30);
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
