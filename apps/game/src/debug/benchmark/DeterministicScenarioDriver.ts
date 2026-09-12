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

export interface DeterministicScenarioDefinition {
  config: BenchmarkScenarioConfig;
  generateSchedule: (seed: number, durationSec: number) => ScriptedDispatch[];
}

export const SCENARIO_DEFINITIONS: Record<BenchmarkScenarioName, DeterministicScenarioDefinition> = {
  idle_match: {
    config: {
      name: 'idle_match',
      durationSeconds: 30,
      seed: 1337,
      targetArmyRange: { min: 0, max: 0 },
      description: 'Zero dispatches for 30s; asserts army count remains exactly 0',
    },
    generateSchedule: () => [],
  },

  normal_combat: {
    config: {
      name: 'normal_combat',
      durationSeconds: 60,
      seed: 20260912,
      targetArmyRange: { min: 5, max: 10 },
      description: 'Maintains 5-10 concurrent armies via deterministic dispatch schedule',
    },
    generateSchedule: (seed: number, durationSec: number) => {
      const rng = createMulberry32(seed);
      const schedule: ScriptedDispatch[] = [];
      const playerLanes: [string, string][] = [
        ['p_base', 'n_bot_left'],
        ['p_base', 'n_center'],
        ['p_base', 'n_bot_right'],
        ['n_bot_left', 'n_mid_left'],
        ['n_bot_right', 'n_mid_right'],
        ['n_mid_left', 'n_center'],
        ['n_mid_right', 'n_center'],
      ];
      const enemyLanes: [string, string][] = [
        ['e_base', 'n_top_left'],
        ['e_base', 'n_center'],
        ['e_base', 'n_top_right'],
        ['n_top_left', 'n_mid_left'],
        ['n_top_right', 'n_mid_right'],
        ['n_mid_left', 'e_base'],
        ['n_mid_right', 'e_base'],
      ];

      // Paired player + enemy dispatches every 0.6s to maintain 6-8 concurrent moving armies
      let t = 0.5;
      while (t < durationSec - 1.0) {
        const pIdx = Math.floor(rng() * playerLanes.length);
        const eIdx = Math.floor(rng() * enemyLanes.length);
        const [pSrc, pDst] = playerLanes[pIdx];
        const [eSrc, eDst] = enemyLanes[eIdx];

        schedule.push({
          timeSec: Math.round(t * 100) / 100,
          sourceId: pSrc,
          targetId: pDst,
          owner: 'player',
          units: 5,
        });

        schedule.push({
          timeSec: Math.round((t + 0.1) * 100) / 100,
          sourceId: eSrc,
          targetId: eDst,
          owner: 'enemy',
          units: 5,
        });

        t += 0.55 + rng() * 0.1;
      }
      return schedule;
    },
  },

  heavy_combat: {
    config: {
      name: 'heavy_combat',
      durationSeconds: 60,
      seed: 987654321,
      targetArmyRange: { min: 20, max: 35 },
      description: 'Maintains 20+ concurrent armies across high-density lanes',
    },
    generateSchedule: (seed: number, durationSec: number) => {
      const rng = createMulberry32(seed);
      const schedule: ScriptedDispatch[] = [];
      const lanes: [string, string, 'player' | 'enemy'][] = [
        ['p_base', 'n_bot_left', 'player'],
        ['p_base', 'n_center', 'player'],
        ['p_base', 'n_bot_right', 'player'],
        ['n_bot_left', 'n_mid_left', 'player'],
        ['n_bot_right', 'n_mid_right', 'player'],
        ['n_mid_left', 'n_center', 'player'],
        ['n_mid_right', 'n_center', 'player'],
        ['e_base', 'n_top_left', 'enemy'],
        ['e_base', 'n_center', 'enemy'],
        ['e_base', 'n_top_right', 'enemy'],
        ['n_top_left', 'n_mid_left', 'enemy'],
        ['n_top_right', 'n_mid_right', 'enemy'],
        ['n_mid_left', 'n_center', 'enemy'],
        ['n_mid_right', 'n_center', 'enemy'],
      ];

      // Dispatch 4 armies every 0.4s to maintain 22-26 concurrent armies
      let t = 0.5;
      while (t < durationSec - 1.0) {
        for (let k = 0; k < 4; k++) {
          const lIdx = Math.floor(rng() * lanes.length);
          const lane = lanes[lIdx];
          schedule.push({
            timeSec: Math.round((t + k * 0.08) * 100) / 100,
            sourceId: lane[0],
            targetId: lane[1],
            owner: lane[2],
            units: 4,
          });
        }
        t += 0.42;
      }
      return schedule;
    },
  },

  qa_stress: {
    config: {
      name: 'qa_stress',
      durationSeconds: 60,
      seed: 424242,
      targetArmyRange: { min: 1, max: 50 },
      description: 'QA Stress mode activation with fixed PRNG seed for 60s',
    },
    generateSchedule: () => [],
  },

  background_resume: {
    config: {
      name: 'background_resume',
      durationSeconds: 45,
      seed: 555888,
      targetArmyRange: { min: 5, max: 25 },
      description: 'Combat for 5s, background for 10s (t=5 to t=15), then resume for 30s',
    },
    generateSchedule: (seed: number, durationSec: number) => {
      // Re-use normal combat generator but skip between t=5 and t=15
      const all = SCENARIO_DEFINITIONS.normal_combat.generateSchedule(seed, durationSec);
      return all.filter((d) => d.timeSec < 5.0 || d.timeSec >= 15.0);
    },
  },
};
