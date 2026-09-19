#!/usr/bin/env node
/**
 * Cross-implementation bot-parity crosscheck (TS client engine vs Go server engine).
 *
 * For every scenario this tool:
 *  1. runs the GameScene-mirror client prediction (shared game-core engine);
 *  2. replays the recorded actions through the real TS replay engine
 *     (core.simulatePvpBattle) and the validated checkpoint mirror;
 *  3. replays the same actions through the real Go authoritative engine
 *     (apps/server-nakama simulateBattle) inside the official golang container;
 *  4. asserts client prediction status == TS replay status == Go replay status;
 *  5. diffs TS/Go checkpoints to localize the FIRST diverging simulation state.
 *
 * Fails closed: any missing result, engine error, or mismatch is a hard
 * failure with a detailed first-divergence report.
 *
 * Usage: node test/scripts/bot_parity_crosscheck.mjs [--keep-artifacts]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as core from '../../packages/game-core/dist/packages/game-core/src/index.js';
import {
  runClientPrediction,
  runTsReplay,
} from './bot_parity_harness.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// Scenario generation
// ---------------------------------------------------------------------------

function careerOf(garrison, production, speed, commander = 'crown_guard') {
  return {
    playerId: 'parity',
    coins: 0,
    gems: 0,
    trophies: 0,
    startingGarrisonLevel: garrison,
    productionLevel: production,
    armySpeedLevel: speed,
    treasuryLevel: 0,
    selectedCommanderId: commander,
  };
}

const BATTLEFIELDS = ['crown_cross', 'twin_passes', 'royal_ring'];

function buildScenarios() {
  const scenarios = [];

  // Modifier sets: default, mid, upgraded, the EXACT modifier set from the
  // production bot_result_status_mismatch log (garrison 5 / production 5 /
  // speed 5 / vanguard => 32 units, 1.4 production, 1.495 speed), and maxed.
  const modifierSets = [
    { id: 'default', career: careerOf(0, 0, 0), expect: { startingUnits: 20, productionRateMultiplier: 1, armySpeedMultiplier: 1 } },
    { id: 'mid', career: careerOf(3, 2, 1), expect: { startingUnits: 29, productionRateMultiplier: 1.16, armySpeedMultiplier: 1.06 } },
    { id: 'upgraded', career: careerOf(4, 3, 2), expect: { startingUnits: 32, productionRateMultiplier: 1.24, armySpeedMultiplier: 1.12 } },
    {
      id: 'production_mismatch_log_set',
      career: careerOf(5, 5, 5, 'vanguard'),
      expect: { startingUnits: 32, productionRateMultiplier: 1.4, armySpeedMultiplier: 1.495 },
    },
    { id: 'maxed', career: careerOf(20, 20, 20), expect: { startingUnits: 50, productionRateMultiplier: 1.7, armySpeedMultiplier: 1.525 } },
  ];

  const playerPolicies = {
    aggressive: { firstActionAt: 0.3, interval: 0.35, maxActions: 0, multiSources: 1 },
    coordinated: { firstActionAt: 0.5, interval: 0.5, maxActions: 0, multiSources: 3 },
    sparse: { firstActionAt: 2.0, interval: 2.5, maxActions: 0, multiSources: 1 },
  };

  let scenarioId = 0;
  for (const set of modifierSets) {
    for (const battlefieldId of BATTLEFIELDS) {
      for (const [policyName, policy] of Object.entries(playerPolicies)) {
        scenarioId++;
        scenarios.push({
          id: `s${scenarioId}_${set.id}_${battlefieldId}_${policyName}`,
          kind: 'prediction',
          battlefieldId,
          career: set.career,
          expect: set.expect,
          playerPolicy: policy,
        });
      }
    }
  }

  // Idle scenario: no player actions at all (must end in defeat).
  scenarioId++;
  scenarios.push({
    id: `s${scenarioId}_default_crown_cross_idle`,
    kind: 'prediction',
    battlefieldId: 'crown_cross',
    career: careerOf(0, 0, 0),
    expect: modifierSets[0].expect,
    playerPolicy: null,
  });

  // Replay-invalid actions: structurally valid sequences containing actions
  // the replay engine must SKIP (nonexistent source, unknown target,
  // self-target). Both engines must skip identically and agree on status.
  scenarioId++;
  scenarios.push({
    id: `s${scenarioId}_invalid_actions_replay`,
    kind: 'replay_only_invalid',
    battlefieldId: 'crown_cross',
    career: careerOf(5, 5, 5, 'vanguard'),
    expect: modifierSets[3].expect,
    playerPolicy: playerPolicies.aggressive,
    mutateActionsForReplay: (actions) => {
      if (actions.length < 3) throw new Error('not enough actions to mutate');
      const mutated = actions.map((action) => ({ ...action }));
      mutated[1] = { ...mutated[1], sourceId: 'no_such_tower' };
      mutated[2] = { ...mutated[2], targetId: 'no_such_tower' };
      mutated[3] = { ...mutated[3], sourceId: mutated[3].targetId }; // self-target
      return mutated;
    },
  });

  return scenarios;
}

// ---------------------------------------------------------------------------
// TS engine execution
// ---------------------------------------------------------------------------

function assertModifiers(set) {
  const modifiers = core.getPlayerUpgradeModifiers(set.career);
  for (const [key, expected] of Object.entries(set.expect)) {
    const actual = modifiers[key];
    if (typeof expected === 'number' && !Number.isInteger(expected)) {
      if (Math.abs(actual - expected) > 1e-9) {
        throw new Error(`modifier ${key}: expected ~${expected}, got ${actual}`);
      }
    } else if (actual !== expected) {
      throw new Error(`modifier ${key}: expected ${expected}, got ${actual}`);
    }
  }
  return modifiers;
}

async function runTsSide(scenarios) {
  const results = [];
  for (const scenario of scenarios) {
    const playerModifiers = assertModifiers(scenario);
    const prediction = runClientPrediction({
      battlefieldId: scenario.battlefieldId,
      playerModifiers,
      playerPolicy: scenario.playerPolicy,
    });

    let actions = prediction.actions;
    if (scenario.mutateActionsForReplay) {
      actions = scenario.mutateActionsForReplay(actions);
    }

    const replay = runTsReplay({
      id: scenario.id,
      battlefieldId: scenario.battlefieldId,
      playerModifiers,
      enemyModifiers: { startingUnits: 20, productionRateMultiplier: 1, armySpeedMultiplier: 1 },
      actions,
    });

    results.push({
      id: scenario.id,
      kind: scenario.kind,
      battlefieldId: scenario.battlefieldId,
      playerModifiers,
      predictionStatus: prediction.status,
      tsReplayStatus: replay.real.summary.status,
      tsReplaySummary: replay.real.summary,
      actions,
      tsCheckpoints: replay.mirror.checkpoints,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Go engine execution (official golang toolchain container)
// ---------------------------------------------------------------------------

function runGoSide(tsResults, workDir) {
  const scenariosPath = path.join(workDir, 'scenarios.json');
  const outputPath = path.join(workDir, 'go_results.json');
  fs.writeFileSync(scenariosPath, JSON.stringify(tsResults.map((result) => ({
    id: result.id,
    battlefieldId: result.battlefieldId,
    playerModifiers: result.playerModifiers,
    enemyModifiers: { startingUnits: 20, productionRateMultiplier: 1, armySpeedMultiplier: 1 },
    actions: result.actions,
  }))), 'utf8');

  execFileSync(
    'docker',
    [
      'run', '--rm',
      '-v', `${REPO_ROOT}:/repo:ro`,
      '-v', `${workDir}:/data`,
      '-w', '/repo/apps/server-nakama',
      '-e', `PARITY_SCENARIOS=/data/${path.basename(scenariosPath)}`,
      '-e', `PARITY_OUTPUT=/data/${path.basename(outputPath)}`,
      'golang:1.26.5',
      'go', 'test', '-run', 'TestParityReplayDump', '-count=1', '-v', '.',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  if (!fs.existsSync(outputPath)) {
    throw new Error('Go replay dump produced no output file (fail closed)');
  }
  const results = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  if (!Array.isArray(results) || results.length !== tsResults.length) {
    throw new Error(`Go replay returned ${Array.isArray(results) ? results.length : 'non-array'} results for ${tsResults.length} scenarios`);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

const FLOAT_TOLERANCE = 1e-9;
// Near-zero accumulators accumulate sub-1e-12 cross-engine arithmetic noise
// (hypot/ulp differences). Values that small can be compared absolutely:
// any divergence that can change an OUTCOME shows up in integer fields
// (units, owners, army identity), which are always compared exactly.
const FLOAT_ABSOLUTE_FLOOR = 1e-12;

function compareFloat(field, a, b, drifts, scenarioId, location) {
  if (a === b) return;
  const absolute = Math.abs(a - b);
  if (absolute <= FLOAT_ABSOLUTE_FLOOR) {
    if (drifts !== null && absolute > 0) {
      drifts.push({ location, field, a, b, relative: absolute });
    }
    return;
  }
  const denominator = Math.max(Math.abs(a), Math.abs(b), 1e-12);
  const relative = absolute / denominator;
  if (relative > FLOAT_TOLERANCE) {
    throw new Error(
      `[${scenarioId}] float divergence at ${location}: ${field} client=${a} server=${b} (relative ${relative.toExponential(3)})`
    );
  }
  if (relative > 0 && drifts !== null) {
    drifts.push({ location, field, a, b, relative });
  }
}

function compareCheckpoint(scenarioId, index, tsCheckpoint, goCheckpoint, drifts) {
  const location = `checkpoint[${index}] kind=${tsCheckpoint.kind} at=${tsCheckpoint.at}`;
  if (tsCheckpoint.kind !== goCheckpoint.kind) {
    throw new Error(`[${scenarioId}] checkpoint kind mismatch at ${location}: client=${tsCheckpoint.kind} server=${goCheckpoint.kind}`);
  }
  compareFloat('at', tsCheckpoint.at, goCheckpoint.at, null, scenarioId, location);
  if (tsCheckpoint.status !== goCheckpoint.status) {
    throw new Error(`[${scenarioId}] status divergence at ${location}: client=${tsCheckpoint.status} server=${goCheckpoint.status}`);
  }
  compareFloat('elapsed', tsCheckpoint.elapsed, goCheckpoint.elapsed, drifts, scenarioId, location);

  const territoryIds = new Set([...Object.keys(tsCheckpoint.territories), ...Object.keys(goCheckpoint.territories)]);
  for (const id of territoryIds) {
    const tsTerritory = tsCheckpoint.territories[id];
    const goTerritory = goCheckpoint.territories[id];
    if (!tsTerritory || !goTerritory) {
      throw new Error(`[${scenarioId}] territory ${id} missing at ${location}: client=${Boolean(tsTerritory)} server=${Boolean(goTerritory)}`);
    }
    if (tsTerritory.owner !== goTerritory.owner) {
      throw new Error(`[${scenarioId}] territory ${id} owner divergence at ${location}: client=${tsTerritory.owner} server=${goTerritory.owner}`);
    }
    if (tsTerritory.units !== goTerritory.units) {
      throw new Error(`[${scenarioId}] territory ${id} units divergence at ${location}: client=${tsTerritory.units} server=${goTerritory.units}`);
    }
    compareFloat(`territory ${id} productionRate`, tsTerritory.productionRate, goTerritory.productionRate, drifts, scenarioId, location);
  }

  if (tsCheckpoint.armies.length !== goCheckpoint.armies.length) {
    throw new Error(
      `[${scenarioId}] army count divergence at ${location}: client=${tsCheckpoint.armies.length} server=${goCheckpoint.armies.length}`
    );
  }
  for (let i = 0; i < tsCheckpoint.armies.length; i++) {
    const tsArmy = tsCheckpoint.armies[i];
    const goArmy = goCheckpoint.armies[i];
    const armyLabel = `${location} army[${i}] (${tsArmy.sourceId}->${tsArmy.targetId})`;
    if (tsArmy.sourceId !== goArmy.sourceId || tsArmy.targetId !== goArmy.targetId || tsArmy.owner !== goArmy.owner || tsArmy.units !== goArmy.units) {
      throw new Error(`[${scenarioId}] army identity divergence at ${armyLabel}: client=${JSON.stringify(tsArmy)} server=${JSON.stringify(goArmy)}`);
    }
    compareFloat('army progress', tsArmy.progress, goArmy.progress, drifts, scenarioId, armyLabel);
    compareFloat('army speed', tsArmy.speed, goArmy.speed, drifts, scenarioId, armyLabel);
  }

  const accumulatorKeys = new Set([...Object.keys(tsCheckpoint.accumulators), ...Object.keys(goCheckpoint.accumulators)]);
  for (const key of accumulatorKeys) {
    compareFloat(
      `accumulator ${key}`,
      tsCheckpoint.accumulators[key] ?? 0,
      goCheckpoint.accumulators[key] ?? 0,
      drifts, scenarioId, location
    );
  }
}

function compareScenario(tsResult, goResult) {
  const problems = [];
  const drifts = [];

  if (tsResult.tsReplayStatus !== goResult.status) {
    problems.push(`TS replay status ${tsResult.tsReplayStatus} != Go replay status ${goResult.status}`);
  }
  if (tsResult.kind !== 'replay_only_invalid') {
    // The client prediction must agree with both replay engines. For the
    // invalid-action scenario the prediction ran on unmutated actions, so
    // only the two replay engines are compared there.
    if (tsResult.predictionStatus !== goResult.status) {
      problems.push(`client prediction status ${tsResult.predictionStatus} != authoritative Go status ${goResult.status}`);
    }
  }
  if (tsResult.tsReplaySummary.actionsProcessed !== goResult.actionsProcessed) {
    problems.push(`actionsProcessed mismatch: client=${tsResult.tsReplaySummary.actionsProcessed} server=${goResult.actionsProcessed}`);
  }

  if (tsResult.tsCheckpoints.length !== goResult.checkpoints.length) {
    problems.push(
      `checkpoint count mismatch: client=${tsResult.tsCheckpoints.length} server=${goResult.checkpoints.length}`
    );
  } else {
    for (let i = 0; i < tsResult.tsCheckpoints.length; i++) {
      // compareCheckpoint throws on the first real divergence; catch and
      // record so the report can show it in context.
      try {
        compareCheckpoint(tsResult.id, i, tsResult.tsCheckpoints[i], goResult.checkpoints[i], drifts);
      } catch (error) {
        problems.push(error.message);
        break;
      }
    }
  }

  return { problems, drifts };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const keepArtifacts = process.argv.includes('--keep-artifacts');
  const onlyIndex = process.argv.indexOf('--only');
  const onlyFilter = onlyIndex !== -1 ? process.argv[onlyIndex + 1] : null;
  console.log('================================================================');
  console.log(' Bot Parity Crosscheck: TS client engine vs Go server engine');
  console.log('================================================================\n');

  const allScenarios = buildScenarios();
  const scenarios = onlyFilter
    ? allScenarios.filter((s) => s.id.includes(onlyFilter) || String(allScenarios.indexOf(s)) === onlyFilter)
    : allScenarios;
  console.log(`Generated ${allScenarios.length} scenarios (3 battlefields x 5 modifier sets x 3 policies + idle + invalid-actions).`);
  if (onlyFilter) console.log(`Filtered to ${scenarios.length} matching "${onlyFilter}".\n`);

  console.log('[1/3] Running TS client prediction + TS replay engine...');
  const tsResults = await runTsSide(scenarios);
  console.log(`      ${tsResults.length} scenarios simulated on the TypeScript engine.`);

  console.log('[2/3] Replaying identical actions through the Go authoritative engine...');
  // Artifacts must live under the repository (colima only mounts the home
  // directory into the VM, so /tmp bind mounts arrive empty). The directory
  // is gitignored via `qa-artifacts/bot-parity/`.
  const artifactBase = path.join(REPO_ROOT, 'qa-artifacts', 'bot-parity');
  fs.mkdirSync(artifactBase, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(artifactBase, 'run-'));
  let goResults;
  try {
    goResults = runGoSide(tsResults, workDir);
  } finally {
    if (!keepArtifacts) {
      fs.rmSync(workDir, { recursive: true, force: true });
    } else {
      console.log(`      Artifacts kept in ${workDir}`);
    }
  }
  console.log(`      ${goResults.length} scenarios replayed on the Go engine.\n`);

  console.log('[3/3] Comparing statuses, stats, and state checkpoints...');
  let failureCount = 0;
  const statusAgreement = { prediction: 0, replay: 0 };
  for (let i = 0; i < scenarios.length; i++) {
    const tsResult = tsResults[i];
    const goResult = goResults[i];
    if (goResult.id !== tsResult.id) {
      throw new Error(`result ordering mismatch at index ${i}: ${tsResult.id} vs ${goResult.id}`);
    }
    const { problems, drifts } = compareScenario(tsResult, goResult);
    if (tsResult.predictionStatus === goResult.status) statusAgreement.prediction++;
    if (tsResult.tsReplayStatus === goResult.status) statusAgreement.replay++;

    if (problems.length > 0) {
      failureCount++;
      console.log(`\n  [MISMATCH] ${tsResult.id}`);
      console.log(`    modifiers: ${JSON.stringify(tsResult.playerModifiers)}`);
      console.log(`    client prediction=${tsResult.predictionStatus} tsReplay=${tsResult.tsReplayStatus} goReplay=${goResult.status}`);
      for (const problem of problems) {
        console.log(`    - ${problem}`);
      }
      if (drifts.length > 0) {
        const worst = drifts.reduce((a, b) => (b.relative > a.relative ? b : a));
        console.log(`    (largest tolerated float drift before divergence: ${worst.field} at ${worst.location}, relative ${worst.relative.toExponential(3)})`);
      }
    } else {
      const driftNote = drifts.length > 0 ? ` (${drifts.length} sub-tolerance float drifts, max relative ${(drifts.reduce((a, b) => (b.relative > a.relative ? b : a)).relative).toExponential(2)})` : '';
      console.log(`  [OK] ${tsResult.id}: status=${goResult.status} actions=${goResult.actionsProcessed}${driftNote}`);
    }
  }

  console.log(`\nStatus agreement: client prediction ${statusAgreement.prediction}/${scenarios.length}, TS replay ${statusAgreement.replay}/${scenarios.length}`);
  if (failureCount > 0) {
    console.error(`\n[BOT PARITY CROSSCHECK FAILED] ${failureCount}/${scenarios.length} scenarios diverged.`);
    process.exit(1);
  }
  console.log('\n[BOT PARITY CROSSCHECK PASSED] All scenarios agree across engines.');
}

main().catch((error) => {
  console.error('\n[BOT PARITY CROSSCHECK FAILED]', error);
  process.exit(1);
});
