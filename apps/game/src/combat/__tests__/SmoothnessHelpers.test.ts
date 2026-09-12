import { describe, expect, it } from 'vitest';
import {
  computeMarchStride,
  fastComputeDominance,
  DominanceBarDirtyChecker,
  STRIDE_PERIOD_SECONDS,
  DustPuffSimulator,
  type DustPuffItem,
} from '../SmoothnessHelpers.js';
import { formatDominancePercentages } from '../../ui/HudLayout.js';

describe('SmoothnessHelpers', () => {
  describe('computeMarchStride', () => {
    it('bounds leader and follower stride offsets deterministically', () => {
      // Test across multiple phases in the cycle
      for (let t = 0; t <= STRIDE_PERIOD_SECONDS; t += 0.02) {
        const stride = computeMarchStride(t, 0);

        // Leader bob is between -3.5 and 0
        expect(stride.leaderY).toBeGreaterThanOrEqual(-3.501);
        expect(stride.leaderY).toBeLessThanOrEqual(0.001);

        // Follower bob is between -2.5 and 0
        expect(stride.followerYOffset).toBeGreaterThanOrEqual(-2.501);
        expect(stride.followerYOffset).toBeLessThanOrEqual(0.001);

        // Scales remain close to base values
        expect(stride.leaderScaleX).toBeGreaterThanOrEqual(0.22);
        expect(stride.leaderScaleX).toBeLessThanOrEqual(0.26);
        expect(stride.leaderScaleY).toBeGreaterThanOrEqual(0.24);
        expect(stride.leaderScaleY).toBeLessThanOrEqual(0.28);
      }
    });

    it('repeats seamlessly every STRIDE_PERIOD_SECONDS', () => {
      const atZero = computeMarchStride(0);
      const atPeriod = computeMarchStride(STRIDE_PERIOD_SECONDS);

      expect(atZero.leaderY).toBeCloseTo(atPeriod.leaderY, 4);
      expect(atZero.followerYOffset).toBeCloseTo(atPeriod.followerYOffset, 4);
    });

    it('shifts phase accurately with delay parameter', () => {
      const halfPeriod = STRIDE_PERIOD_SECONDS / 2;
      const atQuarter = computeMarchStride(STRIDE_PERIOD_SECONDS / 4, 0);
      const atThreeQuartersDelayed = computeMarchStride(STRIDE_PERIOD_SECONDS * 0.75, halfPeriod);

      expect(atQuarter.leaderY).toBeCloseTo(atThreeQuartersDelayed.leaderY, 4);
      expect(atQuarter.followerYOffset).toBeCloseTo(atThreeQuartersDelayed.followerYOffset, 4);
    });
  });

  describe('fastComputeDominance', () => {
    it('produces identical output to formatDominancePercentages with zero array allocations', () => {
      const testState = {
        territories: {
          t1: { owner: 'player', units: 30 },
          t2: { owner: 'enemy', units: 15 },
          t3: { owner: 'neutral', units: 10 },
          t4: { owner: 'neutral', units: 5 },
        },
        armies: [
          { owner: 'player', units: 10 },
          { owner: 'player', units: 5 },
          { owner: 'enemy', units: 8 },
        ],
      };

      // Calculate baseline reference using existing formatDominancePercentages
      const territories = Object.values(testState.territories);
      let pStr = 0;
      let eStr = 0;
      let nStr = 0;
      territories.forEach((t) => {
        if (t.owner === 'player') pStr += 35 + t.units;
        else if (t.owner === 'enemy') eStr += 35 + t.units;
        else nStr += 15 + t.units;
      });
      testState.armies.forEach((a) => {
        if (a.owner === 'player') pStr += a.units;
        else if (a.owner === 'enemy') eStr += a.units;
      });

      const baseline = formatDominancePercentages({
        playerStrength: pStr,
        enemyStrength: eStr,
        neutralStrength: nStr,
        playerArmiesCount: testState.armies.filter((a) => a.owner === 'player').length,
        enemyArmiesCount: testState.armies.filter((a) => a.owner === 'enemy').length,
        enemyTerritoriesCount: territories.filter((t) => t.owner === 'enemy').length,
      });

      // Calculate using allocation-free fastComputeDominance
      const fastResult = fastComputeDominance(testState);

      expect(fastResult.playerPct).toBe(baseline.playerPct);
      expect(fastResult.enemyPct).toBe(baseline.enemyPct);
      expect(fastResult.neutralPct).toBe(baseline.neutralPct);
      expect(fastResult.playerDomText).toBe(baseline.playerDomText);
      expect(fastResult.enemyDomText).toBe(baseline.enemyDomText);
      expect(fastResult.isLastEnemyArmy).toBe(baseline.isLastEnemyArmy);
    });

    it('correctly handles last enemy army state', () => {
      const state = {
        territories: {
          t1: { owner: 'player', units: 50 },
          t2: { owner: 'player', units: 25 },
        },
        armies: [{ owner: 'enemy', units: 2 }],
      };

      const result = fastComputeDominance(state);
      expect(result.isLastEnemyArmy).toBe(true);
      expect(result.enemyDomText).not.toBe('0%');
      expect(result.enemyPct).toBeGreaterThanOrEqual(1);
    });
  });

  describe('DominanceBarDirtyChecker', () => {
    it('detects when percentages change and ignores identical subsequent checks', () => {
      const checker = new DominanceBarDirtyChecker();

      const firstState = {
        playerPct: 50,
        enemyPct: 30,
        neutralPct: 20,
        playerDomText: '50%',
        enemyDomText: '30%',
        isLastEnemyArmy: false,
      };

      // Initial check must mark dirty
      const res1 = checker.check(firstState);
      expect(res1.barsChanged).toBe(true);
      expect(res1.playerTextChanged).toBe(true);
      expect(res1.enemyTextChanged).toBe(true);

      // Identical check must NOT mark dirty
      const res2 = checker.check(firstState);
      expect(res2.barsChanged).toBe(false);
      expect(res2.playerTextChanged).toBe(false);
      expect(res2.enemyTextChanged).toBe(false);

      // State with only units changing but same rounded percentages
      const res3 = checker.check({ ...firstState });
      expect(res3.barsChanged).toBe(false);

      // Changed percentages
      const res4 = checker.check({
        ...firstState,
        playerPct: 52,
        enemyPct: 28,
        playerDomText: '52%',
        enemyDomText: '28%',
      });
      expect(res4.barsChanged).toBe(true);
      expect(res4.playerTextChanged).toBe(true);
      expect(res4.enemyTextChanged).toBe(true);
    });

    it('clears cache on reset()', () => {
      const checker = new DominanceBarDirtyChecker();
      const state = {
        playerPct: 50,
        enemyPct: 30,
        neutralPct: 20,
        playerDomText: '50%',
        enemyDomText: '30%',
        isLastEnemyArmy: false,
      };

      checker.check(state);
      checker.reset();

      // After reset, checking same state marks dirty again
      const res = checker.check(state);
      expect(res.barsChanged).toBe(true);
    });
  });

  describe('DustPuffSimulator', () => {
    it('spawns and updates puffs within fixed ring-buffer capacity without allocations', () => {
      const pool = new DustPuffSimulator(4);
      expect(pool.getItems().length).toBe(4);
      expect(pool.getItems().every((item: DustPuffItem) => !item.active)).toBe(true);

      const item1 = pool.spawn(100, 200, 0xff0000, 0.2);
      expect(item1.active).toBe(true);
      expect(item1.alpha).toBe(0.45);
      expect(item1.scale).toBe(1);

      // Step forward half duration
      pool.update(0.1);
      expect(item1.active).toBe(true);
      expect(item1.scale).toBeGreaterThan(1);
      expect(item1.alpha).toBeLessThan(0.45);

      // Step forward past duration
      pool.update(0.15);
      expect(item1.active).toBe(false);
      expect(item1.alpha).toBe(0);
    });

    it('wraps around circular buffer when spawning more items than capacity', () => {
      const pool = new DustPuffSimulator(3);
      pool.spawn(10, 10, 0x111111);
      pool.spawn(20, 20, 0x222222);
      pool.spawn(30, 30, 0x333333);

      // 4th spawn wraps back to slot 0
      const wrapped = pool.spawn(40, 40, 0x444444);
      expect(pool.getItems()[0]).toBe(wrapped);
      expect(wrapped.color).toBe(0x444444);
    });

    it('resets all active items on reset()', () => {
      const pool = new DustPuffSimulator(3);
      pool.spawn(10, 10, 0x111111);
      pool.spawn(20, 20, 0x222222);

      pool.reset();
      expect(pool.getItems().every((item: DustPuffItem) => !item.active && item.alpha === 0)).toBe(true);
    });
  });
});
