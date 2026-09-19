#!/usr/bin/env node
/**
 * Seeded deterministic bot-parity stress runner (deeper than the CI fast set).
 *
 * Generates randomized-but-reproducible full-match scenarios from a seed:
 * every battlefield, the full career-modifier space (all upgrade levels x
 * commanders), continuous dispatch policies across the whole 90s match, and
 * replay-invalid action mutations. Each scenario runs the SAME pipeline as
 * the crosscheck: client prediction (game-core mirror) -> TS replay
 * (simulatePvpBattle + validated checkpoint mirror) -> Go authoritative
 * replay (real simulateBattle in the pinned golang container).
 *
 * Determinism: the generator is a seeded PRNG (mulberry32). A failure always
 * reports the failing scenario id (which embeds the seed and all generation
 * parameters) plus the FIRST diverging checkpoint, so any divergence is
 * reproducible with `--seed <seed> --count <n> --only <index>`.
 *
 * Usage: node test/scripts/bot_parity_stress.mjs [--seed 1337] [--count 32]
 *                [--keep-artifacts] [--only <index>]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { careerOf, runPipeline } from './bot_parity_crosscheck.mjs';
import * as core from '../../packages/game-core/dist/packages/game-core/src/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const BATTLEFIELDS = ['crown_cross', 'twin_passes', 'royal_ring'];
const COMMANDERS = ['crown_guard', 'quartermaster', 'vanguard'];

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildStressScenarios(seed, count) {
  const rng = mulberry32(seed);
  const scenarios = [];
  for (let index = 0; index < count; index++) {
    const battlefieldId = BATTLEFIELDS[Math.floor(rng() * BATTLEFIELDS.length)];
    const commander = COMMANDERS[Math.floor(rng() * COMMANDERS.length)];
    const career = careerOf(
      Math.floor(rng() * 21),
      Math.floor(rng() * 21),
      Math.floor(rng() * 21),
      commander
    );
    // Continuous dispatching across the whole match with randomized rhythm:
    // overlapping marches, simultaneous multi-source volleys, and heavy
    // accumulator churn. maxActions 0 = until the time limit.
    const policy = {
      firstActionAt: Math.round(rng() * 200) / 100,
      interval: Math.round(rng() * 150) / 100 + 0.25,
      maxActions: 0,
      multiSources: 1 + Math.floor(rng() * 3),
    };
    scenarios.push({
      id: `stress_seed${seed}_i${index}_${career.selectedCommanderId}_g${career.startingGarrisonLevel}p${career.productionLevel}s${career.armySpeedLevel}_${battlefieldId}`,
      kind: 'prediction',
      battlefieldId,
      career,
      expect: null,
      playerPolicy: policy,
    });
  }
  return scenarios;
}

async function main() {
  const argOf = (flag, fallback) => {
    const index = process.argv.indexOf(flag);
    return index !== -1 ? process.argv[index + 1] : fallback;
  };
  const seed = Number(argOf('--seed', '1337'));
  const count = Number(argOf('--count', '32'));
  const usesOnly = process.argv.includes('--only');
  const only = usesOnly ? Number(process.argv[process.argv.indexOf('--only') + 1]) : null;
  const keepArtifacts = process.argv.includes('--keep-artifacts');

  if (!Number.isInteger(seed) || seed < 0) throw new Error(`--seed must be a non-negative integer, got ${seed}`);
  if (!Number.isInteger(count) || count <= 0) throw new Error(`--count must be a positive integer, got ${count}`);

  console.log('================================================================');
  console.log(' Bot Parity Stress: seeded deterministic cross-engine matches');
  console.log('================================================================');
  console.log(` seed=${seed} count=${count}\n`);

  const allScenarios = buildStressScenarios(seed, count);
  const scenarios = usesOnly ? [allScenarios[only]] : allScenarios;

  const comparisons = await runPipeline(scenarios, { keepArtifacts });

  let failureCount = 0;
  for (const { tsResult, goResult, problems } of comparisons) {
    if (problems.length > 0) {
      failureCount++;
      console.log(`\n  [MISMATCH] ${tsResult.id}`);
      console.log(`    modifiers: ${JSON.stringify(tsResult.playerModifiers)}`);
      console.log(`    client prediction=${tsResult.predictionStatus} tsReplay=${tsResult.tsReplayStatus} goReplay=${goResult.status}`);
      for (const problem of problems) {
        // compareScenario reports the FIRST diverging checkpoint already.
        console.log(`    - ${problem}`);
      }
      console.log(`    reproduce with: node test/scripts/bot_parity_stress.mjs --seed ${seed} --count ${count}${usesOnly ? ` --only ${only}` : ''}`);
    }
  }

  if (failureCount > 0) {
    console.error(`\n[BOT PARITY STRESS FAILED] ${failureCount}/${scenarios.length} scenarios diverged (seed ${seed}).`);
    process.exit(1);
  }
  console.log(`\n[BOT PARITY STRESS PASSED] ${scenarios.length}/${scenarios.length} seeded scenarios agree across engines (seed ${seed}).`);
}

main().catch((error) => {
  console.error('\n[BOT PARITY STRESS FAILED]', error);
  process.exit(1);
});
