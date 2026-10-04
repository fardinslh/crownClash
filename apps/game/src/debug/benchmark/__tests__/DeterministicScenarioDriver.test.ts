import { describe, expect, it } from 'vitest';
import {
  createInitialGameState,
  dispatchArmy,
  PVP_SIMULATION_TICK_SECONDS,
  stepSimulation,
} from '@crown-clash/game-core';
import {
  createMulberry32,
  computeScheduleHash,
  SCENARIO_DEFINITIONS,
} from '../DeterministicScenarioDriver.js';

describe('DeterministicScenarioDriver', () => {
  it('mulberry32 produces identical sequence for identical seed', () => {
    const rng1 = createMulberry32(12345);
    const rng2 = createMulberry32(12345);

    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());

    expect(seq1).toEqual(seq2);
  });

  it('mulberry32 produces different sequence for different seed', () => {
    const rng1 = createMulberry32(12345);
    const rng2 = createMulberry32(54321);

    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());

    expect(seq1).not.toEqual(seq2);
  });

  it('computeScheduleHash computes reproducible hash and detects alterations', () => {
    const s1 = [{ timeSec: 1.0, sourceId: 'p_base', targetId: 'n_center', owner: 'player' as const, units: 5 }];
    const s2 = [{ timeSec: 1.0, sourceId: 'p_base', targetId: 'n_center', owner: 'player' as const, units: 5 }];
    const s3 = [{ timeSec: 1.1, sourceId: 'p_base', targetId: 'n_center', owner: 'player' as const, units: 5 }];

    const h1 = computeScheduleHash(s1);
    const h2 = computeScheduleHash(s2);
    const h3 = computeScheduleHash(s3);

    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toMatch(/^[0-9a-f]{8}$/);
  });

  it('normal_combat schedule is 100% deterministic with fixed seed', () => {
    const def = SCENARIO_DEFINITIONS.normal_combat;
    const s1 = def.generateSchedule(20260912, 60);
    const s2 = def.generateSchedule(20260912, 60);

    expect(s1.length).toBeGreaterThan(0);
    expect(s1).toEqual(s2);
  });

  it('normal_combat schedule maintains steady-state active armies strictly within [5, 10]', () => {
    const def = SCENARIO_DEFINITIONS.normal_combat;
    const schedule = def.generateSchedule(20260912, 30);
    const warmupSec = def.config.warmupDurationSeconds; // 4.0s
    const armyDuration = 2.80; // approximate travel duration across base-to-node lanes

    // Sample every 0.1s from warmup to 29.0s
    for (let t = warmupSec; t <= 29.0; t += 0.1) {
      const active = schedule.filter((d) => d.timeSec <= t && t < d.timeSec + armyDuration).length;
      expect(active).toBeGreaterThanOrEqual(5);
      expect(active).toBeLessThanOrEqual(10);
    }
  });

  it('heavy_combat keeps real simulated armies within [6, 18] after warmup', () => {
    const def = SCENARIO_DEFINITIONS.heavy_combat;
    const durationSeconds = def.config.durationSeconds;
    const schedule = def.generateSchedule(def.config.seed, durationSeconds);
    let state = createInitialGameState({ battlefieldId: 'crown_cross' });
    let accumulators: Record<string, number> = {};
    let scheduleIndex = 0;
    const steadyCounts: number[] = [];

    expect(def.config.targetArmyRange).toEqual({ min: 6, max: 18 });
    expect(schedule.length).toBeGreaterThan(0);

    for (let tick = 1; tick <= Math.round(durationSeconds / PVP_SIMULATION_TICK_SECONDS); tick++) {
      const now = tick * PVP_SIMULATION_TICK_SECONDS;
      const result = stepSimulation(state, accumulators, PVP_SIMULATION_TICK_SECONDS);
      state = result.state;
      accumulators = result.accumulators;
      expect(state.status).toBe('playing');

      // The benchmark refills bases before dispatch; travel and arrival stay real.
      for (const [id, owner] of [['p_base', 'player'], ['e_base', 'enemy']] as const) {
        const base = state.territories[id];
        expect(base).toBeDefined();
        if (base.units < 15) {
          base.units = 30;
          base.owner = owner;
        }
      }

      while (scheduleIndex < schedule.length && schedule[scheduleIndex].timeSec <= now + 1e-9) {
        const scheduled = schedule[scheduleIndex];
        const source = state.territories[scheduled.sourceId];
        const target = state.territories[scheduled.targetId];
        expect(source).toBeDefined();
        expect(target).toBeDefined();
        source.owner = scheduled.owner;
        if (source.units < 10) source.units = 25;
        const dispatched = dispatchArmy(source, target, scheduled.owner, 0.5,
          () => `scenario_army_${scheduleIndex}`, 1);
        expect(dispatched.success, `scheduled dispatch ${scheduleIndex}: ${dispatched.reason ?? ''}`).toBe(true);
        expect(dispatched.army).toBeDefined();
        expect(dispatched.sourceTerritory).toBeDefined();
        state.territories[source.id] = dispatched.sourceTerritory!;
        state.armies.push(dispatched.army!);
        scheduleIndex++;
      }

      if (now >= def.config.warmupDurationSeconds) {
        const count = state.armies.length;
        steadyCounts.push(count);
        expect(count, `army count at ${now.toFixed(2)}s`).toBeGreaterThanOrEqual(6);
        expect(count, `army count at ${now.toFixed(2)}s`).toBeLessThanOrEqual(18);
      }
    }

    expect(scheduleIndex).toBe(schedule.length);
    expect(steadyCounts.length).toBeGreaterThan(0);
  });

  it('idle_match schedule is empty', () => {
    const def = SCENARIO_DEFINITIONS.idle_match;
    const schedule = def.generateSchedule(1337, 30);
    expect(schedule).toHaveLength(0);
  });
});
