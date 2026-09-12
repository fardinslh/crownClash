import { describe, expect, it } from 'vitest';
import {
  createMulberry32,
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

  it('normal_combat schedule is 100% deterministic with fixed seed', () => {
    const def = SCENARIO_DEFINITIONS.normal_combat;
    const s1 = def.generateSchedule(20260912, 60);
    const s2 = def.generateSchedule(20260912, 60);

    expect(s1.length).toBeGreaterThan(0);
    expect(s1).toEqual(s2);
  });

  it('heavy_combat schedule generates sufficient dispatches to sustain 20+ armies', () => {
    const def = SCENARIO_DEFINITIONS.heavy_combat;
    const schedule = def.generateSchedule(987654321, 60);

    // Should have dense dispatch count
    expect(schedule.length).toBeGreaterThan(100);
    // Dispatches spread across time
    expect(schedule[0].timeSec).toBeLessThan(1.0);
    expect(schedule[schedule.length - 1].timeSec).toBeGreaterThan(50.0);
  });

  it('idle_match schedule is empty', () => {
    const def = SCENARIO_DEFINITIONS.idle_match;
    const schedule = def.generateSchedule(1337, 30);
    expect(schedule).toHaveLength(0);
  });
});
