import type { BenchmarkScenarioConfig, BenchmarkScenarioName } from './BenchmarkTypes.js';

export function createMulberry32(seed: number): () => number {
  let state = seed | 0;
  return function () {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ScriptedDispatch {
  timeSec: number;
  sourceId: string;
  targetId: string;
  owner: 'player' | 'enemy';
  units: number;
}

export function computeScheduleHash(schedule: readonly ScriptedDispatch[]): string {
  let hash = 0x811c9dc5;
  const str = JSON.stringify(schedule);
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface DeterministicScenarioDefinition {
  config: BenchmarkScenarioConfig;
  generateSchedule: (seed: number, durationSec: number) => ScriptedDispatch[];
}

export const SCENARIO_DEFINITIONS: Record<BenchmarkScenarioName, DeterministicScenarioDefinition> = {
  idle_match: {
    config: {
      name: 'idle_match',
      durationSeconds: 30,
      warmupDurationSeconds: 0,
      seed: 1337,
      scheduleHash: '811c9dc5',
      targetArmyRange: { min: 0, max: 0 },
      maxAllowedLongTasks: 0,
      description: 'Zero dispatches for 30s; asserts army count remains exactly 0',
    },
    generateSchedule: () => [],
  },

  normal_combat: {
    config: {
      name: 'normal_combat',
      durationSeconds: 60,
      warmupDurationSeconds: 4.0,
      seed: 20260912,
      scheduleHash: '', // dynamically set based on generated schedule
      targetArmyRange: { min: 5, max: 10 },
      maxAllowedLongTasks: 0,
      description: 'Maintains 5-10 concurrent armies (steady-state 6-8) via deterministic dispatch schedule',
    },
    generateSchedule: (_seed: number, durationSec: number) => {
      const schedule: ScriptedDispatch[] = [];
      const lanes: Array<{ sourceId: string; targetId: string; owner: 'player' | 'enemy' }> = [
        { sourceId: 'p_base', targetId: 'n_top_left', owner: 'player' },
        { sourceId: 'e_base', targetId: 'n_bot_left', owner: 'enemy' },
        { sourceId: 'p_base', targetId: 'n_top_right', owner: 'player' },
        { sourceId: 'e_base', targetId: 'n_bot_right', owner: 'enemy' },
        { sourceId: 'p_base', targetId: 'n_top_left', owner: 'player' },
        { sourceId: 'e_base', targetId: 'n_bot_left', owner: 'enemy' },
        { sourceId: 'p_base', targetId: 'n_top_right', owner: 'player' },
        { sourceId: 'e_base', targetId: 'n_bot_right', owner: 'enemy' },
      ];

      // Dispatches every 0.38s across ~2.8s lanes maintain strictly 6-8 concurrent armies in steady state (t >= 4.0s)
      let t = 0.5;
      let laneIdx = 0;
      while (t <= durationSec + 2.0) {
        const lane = lanes[laneIdx % lanes.length];
        laneIdx++;
        schedule.push({
          timeSec: Math.round(t * 100) / 100,
          sourceId: lane.sourceId,
          targetId: lane.targetId,
          owner: lane.owner,
          units: 5,
        });
        t += 0.32;
      }
      return schedule;
    },
  },

  heavy_combat: {
    config: {
      name: 'heavy_combat',
      durationSeconds: 60,
      warmupDurationSeconds: 4.0,
      seed: 987654321,
      scheduleHash: '',
      targetArmyRange: { min: 6, max: 18 },
      description: 'Maintains high-density combat (steady-state 6-18 armies) across high-density lanes',
    },
    generateSchedule: (seed: number, durationSec: number) => {
      const rng = createMulberry32(seed);
      const schedule: ScriptedDispatch[] = [];
      const lanes: Array<{ sourceId: string; targetId: string; owner: 'player' | 'enemy' }> = [
        { sourceId: 'p_base', targetId: 'n_bot_left', owner: 'player' },
        { sourceId: 'p_base', targetId: 'n_center', owner: 'player' },
        { sourceId: 'p_base', targetId: 'n_bot_right', owner: 'player' },
        { sourceId: 'p_base', targetId: 'n_top_left', owner: 'player' },
        { sourceId: 'p_base', targetId: 'n_top_right', owner: 'player' },
        { sourceId: 'e_base', targetId: 'n_top_left', owner: 'enemy' },
        { sourceId: 'e_base', targetId: 'n_center', owner: 'enemy' },
        { sourceId: 'e_base', targetId: 'n_top_right', owner: 'enemy' },
        { sourceId: 'e_base', targetId: 'n_bot_left', owner: 'enemy' },
        { sourceId: 'e_base', targetId: 'n_bot_right', owner: 'enemy' },
      ];

      // Dispatch 3 armies every 0.35s to maintain 22-26 concurrent armies
      let t = 0.5;
      while (t < durationSec - 0.5) {
        for (let k = 0; k < 3; k++) {
          const lIdx = Math.floor(rng() * lanes.length);
          const lane = lanes[lIdx];
          schedule.push({
            timeSec: Math.round((t + k * 0.08) * 100) / 100,
            sourceId: lane.sourceId,
            targetId: lane.targetId,
            owner: lane.owner,
            units: 4,
          });
        }
        t += 0.35;
      }
      return schedule;
    },
  },

  qa_stress: {
    config: {
      name: 'qa_stress',
      durationSeconds: 60,
      warmupDurationSeconds: 2.0,
      seed: 424242,
      scheduleHash: '811c9dc5',
      targetArmyRange: { min: 1, max: 50 },
      description: 'QA Stress mode activation with fixed PRNG seed for 60s',
    },
    generateSchedule: () => [],
  },

  background_resume: {
    config: {
      name: 'background_resume',
      durationSeconds: 45,
      warmupDurationSeconds: 4.0,
      seed: 555888,
      scheduleHash: '',
      targetArmyRange: { min: 5, max: 10 },
      maxAllowedLongTasks: 0,
      description: 'Combat for 5s, background for 10s (t=5 to t=15), then resume for 30s',
    },
    generateSchedule: (seed: number, durationSec: number) => {
      // Re-use normal combat generator but skip between t=5 and t=15
      const all = SCENARIO_DEFINITIONS.normal_combat.generateSchedule(seed, durationSec);
      return all.filter((d) => d.timeSec < 5.0 || d.timeSec >= 15.0);
    },
  },

  rapid_dispatches: {
    config: {
      name: 'rapid_dispatches',
      durationSeconds: 30,
      warmupDurationSeconds: 3.0,
      seed: 777111,
      scheduleHash: '',
      targetArmyRange: { min: 6, max: 18 },
      maxAllowedLongTasks: 0,
      description: 'High-frequency burst dispatches every 0.15s across lanes to stress object allocation',
    },
    generateSchedule: (_seed: number, durationSec: number) => {
      const schedule: ScriptedDispatch[] = [];
      const lanes: Array<{ sourceId: string; targetId: string; owner: 'player' | 'enemy' }> = [
        { sourceId: 'p_base', targetId: 'n_top_left', owner: 'player' },
        { sourceId: 'e_base', targetId: 'n_top_right', owner: 'enemy' },
        { sourceId: 'p_base', targetId: 'n_bot_left', owner: 'player' },
        { sourceId: 'e_base', targetId: 'n_bot_right', owner: 'enemy' },
        { sourceId: 'p_base', targetId: 'n_center', owner: 'player' },
        { sourceId: 'e_base', targetId: 'n_center', owner: 'enemy' },
      ];
      let t = 0.5;
      let laneIdx = 0;
      while (t <= durationSec + 1.0) {
        const lane = lanes[laneIdx % lanes.length];
        laneIdx++;
        schedule.push({
          timeSec: Math.round(t * 100) / 100,
          sourceId: lane.sourceId,
          targetId: lane.targetId,
          owner: lane.owner,
          units: 3,
        });
        t += 0.16;
      }
      return schedule;
    },
  },

  late_match_pressure: {
    config: {
      name: 'late_match_pressure',
      durationSeconds: 30,
      warmupDurationSeconds: 3.0,
      seed: 888222,
      scheduleHash: '',
      targetArmyRange: { min: 8, max: 25 },
      description: 'High army pressure and continuous center tower collisions/captures to stress combat effects',
    },
    generateSchedule: (seed: number, durationSec: number) => {
      const rng = createMulberry32(seed);
      const schedule: ScriptedDispatch[] = [];
      const targets = ['n_center', 'n_top_left', 'n_top_right', 'n_bot_left', 'n_bot_right'];
      let t = 0.5;
      while (t <= durationSec + 1.0) {
        // Player wave towards center
        const pTarget = targets[Math.floor(rng() * targets.length)];
        schedule.push({
          timeSec: Math.round(t * 100) / 100,
          sourceId: 'p_base',
          targetId: pTarget,
          owner: 'player',
          units: 4,
        });
        // Enemy wave towards center or bases
        const eTarget = targets[Math.floor(rng() * targets.length)];
        schedule.push({
          timeSec: Math.round((t + 0.05) * 100) / 100,
          sourceId: 'e_base',
          targetId: eTarget,
          owner: 'enemy',
          units: 4,
        });
        t += 0.22;
      }
      return schedule;
    },
  },
};

