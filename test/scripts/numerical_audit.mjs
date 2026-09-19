#!/usr/bin/env node
/**
 * Cross-engine numerical-determinism audit (TypeScript client vs Go server).
 *
 * Enumerates EVERY floating-point decision boundary the shared simulation
 * owns and drives the REAL production engines over exhaustive boundary-case
 * sets, comparing bit-for-bit results:
 *
 *   1. Army arrival (`nextProgress >= 1.0`): every unique battlefield
 *      distance x every reachable army-speed multiplier (21 levels x
 *      crown_guard/quartermaster/vanguard) x stable-source multiplier.
 *      Records arrival step, arrival progress bits, and the minimum gap to
 *      the 1.0 boundary.
 *   2. Production accumulator (`Math.floor(currentAcc) > 0`): every base
 *      territory rate x production multiplier x territory-type multiplier.
 *      Records first unit-grant step, final units, accumulator bits, and the
 *      minimum gap to the integer grant boundary.
 *   3. AI scoring (`score > AI_SCORE_EPSILON` and `score > bestScore`
 *      tie-break): full synthetic boards over the real battlefield geometry
 *      with (source units x target units) grids, including exact-tie
 *      equidistant target pairs. Records the decision.
 *
 * The Go side runs the REAL dispatchArmy/stepSimulation/evaluateAIMove inside
 * the pinned golang container (test file: apps/server-nakama/
 * numerical_audit_test.go); the TS side runs the real game-core exports.
 *
 * Exit code 1 on any outcome-level divergence (arrival step, grant step,
 * unit counts, AI decision). Bit-level drift that does not flip a decision
 * is reported as informational.
 *
 * Usage: node test/scripts/numerical_audit.mjs [--fast] [--keep-artifacts]
 *   --fast: subset of multipliers (still all battlefields/distances/AI grid)
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as core from '../../packages/game-core/dist/packages/game-core/src/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FAST = process.argv.includes('--fast');
const KEEP_ARTIFACTS = process.argv.includes('--keep-artifacts');

// ---------------------------------------------------------------------------
// float64 bit helpers
// ---------------------------------------------------------------------------

const bitBuffer = new ArrayBuffer(8);
const bitF64 = new Float64Array(bitBuffer);
const bitU64 = new BigUint64Array(bitBuffer);
function bits(value) {
  bitF64[0] = value;
  return bitU64[0].toString(16).padStart(16, '0');
}

// ---------------------------------------------------------------------------
// Case enumeration
// ---------------------------------------------------------------------------

function modifierSets() {
  // Real modifier values come from the production function itself.
  const careers = [];
  const commanders = FAST
    ? ['crown_guard', 'quartermaster', 'vanguard']
    : ['crown_guard', 'crown_guard', 'quartermaster', 'vanguard'];
  const levels = FAST ? [0, 5, 10, 20] : Array.from({ length: 21 }, (_, l) => l);
  for (const commander of commanders) {
    for (const level of levels) {
      const base = {
        playerId: 'audit',
        coins: 0,
        gems: 0,
        trophies: 0,
        startingGarrisonLevel: 0,
        productionLevel: 0,
        armySpeedLevel: 0,
        treasuryLevel: 0,
        selectedCommanderId: commander,
      };
      const speedCareer = { ...base, armySpeedLevel: level };
      const prodCareer = { ...base, productionLevel: level };
      const speed = core.getPlayerUpgradeModifiers(speedCareer).armySpeedMultiplier;
      const prod = core.getPlayerUpgradeModifiers(prodCareer).productionRateMultiplier;
      careers.push({ commander, level, speed, prod });
    }
  }
  return careers;
}

function enumerateProgressCases() {
  const cases = [];
  const seen = new Set();
  const speeds = [...new Set(modifierSets().map((m) => m.speed))];
  for (const battlefield of core.BATTLEFIELDS) {
    for (const source of battlefield.territories) {
      for (const target of battlefield.territories) {
        if (source.id === target.id) continue;
        const distance = Math.hypot(target.x - source.x, target.y - source.y);
        const sourceStable = source.type === 'stable';
        const key = `${bits(distance)}|${sourceStable}`;
        if (seen.has(key)) continue;
        seen.add(key);
        for (const travelMultiplier of speeds) {
          cases.push({
            id: `${battlefield.id}_${source.id}->${target.id}_m${travelMultiplier}`,
            sourceX: source.x,
            sourceY: source.y,
            targetX: target.x,
            targetY: target.y,
            sourceStable,
            travelMultiplier,
            maxSteps: 4600,
          });
        }
      }
    }
  }
  return cases;
}

function enumerateProductionCases() {
  const cases = [];
  const baseRates = FAST ? [1.2, 0.85] : [1.2, 0.9, 0.85, 1.1];
  const typeMults = [1, 1.25];
  const prodMults = [...new Set(modifierSets().map((m) => m.prod))];
  for (const baseRate of baseRates) {
    for (const prodMultiplier of prodMults) {
      // The territory's rate as created by map.ts: one multiply.
      const territoryRate = baseRate * prodMultiplier;
      for (const typeMult of typeMults) {
        cases.push({
          id: `r${baseRate}_p${prodMultiplier}_t${typeMult}`,
          productionRate: territoryRate,
          territoryType: typeMult === 1.25 ? 'barracks' : 'fortress',
          maxUnits: 65,
          maxSteps: 4600,
        });
      }
    }
  }
  return cases;
}

const SOURCE_UNITS = FAST ? [8, 16, 25, 40] : [8, 9, 15, 16, 17, 20, 25, 32, 40];
const TARGET_UNITS = FAST ? [1, 8, 10, 14, 20] : [1, 2, 4, 6, 8, 9, 10, 11, 12, 14, 16, 20];

function enumerateAICases() {
  const cases = [];
  for (const battlefield of core.BATTLEFIELDS) {
    const template = Object.fromEntries(battlefield.territories.map((t) => [t.id, t]));
    const bases = battlefield.territories.filter((t) => t.owner === 'player' || t.owner === 'enemy');
    for (const base of bases) {
      const enemyBaseId = base.owner === 'enemy' ? base.id : battlefield.territories.find((t) => t.owner === 'enemy').id;
      for (const target of battlefield.territories) {
        if (target.id === enemyBaseId || target.id === base.id) continue;
        // Scoring grid: every (source units x target units) combination over
        // the real geometry, including the known FMA razor edge
        // (dist 250, target units 10 => score exactly 0 in JS).
        for (const sourceUnits of SOURCE_UNITS) {
          for (const targetUnits of TARGET_UNITS) {
            const patches = [
              { id: enemyBaseId, units: sourceUnits },
              { id: target.id, owner: 'player', units: targetUnits },
            ];
            cases.push({
              id: `ai_${battlefield.id}_${enemyBaseId}->${target.id}_u${sourceUnits}_t${targetUnits}`,
              battlefieldId: battlefield.id,
              patches,
            });
          }
        }
        // Exact-tie probes: every real equidistant target pair from this base.
        for (const other of battlefield.territories) {
          if (other.id === target.id || other.id === enemyBaseId || other.id === base.id) continue;
          const d1 = Math.hypot(target.x - base.x, target.y - base.y);
          const d2 = Math.hypot(other.x - base.x, other.y - base.y);
          if (d1 !== d2 || target.type !== other.type) continue;
          for (const sourceUnits of SOURCE_UNITS) {
            const patches = [
              { id: enemyBaseId, units: sourceUnits },
              { id: target.id, owner: 'neutral', units: 8 },
              { id: other.id, owner: 'neutral', units: 8 },
            ];
            cases.push({
              id: `tie_${battlefield.id}_${enemyBaseId}_${target.id}vs${other.id}_u${sourceUnits}`,
              battlefieldId: battlefield.id,
              patches,
            });
          }
        }
      }
    }
  }
  return cases;
}

// ---------------------------------------------------------------------------
// TS-side engine execution (real game-core exports)
// ---------------------------------------------------------------------------

function runProgressCaseTs(c) {
  const source = {
    id: 'src', name: 'Source', x: c.sourceX, y: c.sourceY, radius: 20,
    owner: 'player', units: 40, maxUnits: 65, productionRate: 0, tier: 1, type: c.sourceStable ? 'stable' : 'fortress',
  };
  const target = {
    id: 'tgt', name: 'Target', x: c.targetX, y: c.targetY, radius: 20,
    // Enemy-owned so the real engine's instant victory check (no enemy
    // territories and no enemy armies) does not terminate the state before
    // the army arrives.
    owner: 'enemy', units: 1, maxUnits: 65, productionRate: 0, tier: 1, type: 'fortress',
  };
  // Real production dispatch path (Math.hypot, duration clamp, 1/duration).
  const dispatch = core.dispatchArmy(source, target, 'player', 0.5, () => 'audit_army', c.travelMultiplier);
  if (!dispatch.success || !dispatch.army) throw new Error(`dispatch failed for ${c.id}`);
  const army = dispatch.army;

  // Mirror of simulation.ts's army loop (same expression shape and order);
  // cross-validated against the real core.stepSimulation below.
  const delta = core.PVP_SIMULATION_TICK_SECONDS;
  let progress = 0;
  let arrivalStep = 0;
  let arrivalProgress = 0;
  let minGap = Infinity;
  for (let step = 1; step <= c.maxSteps; step++) {
    const nextProgress = progress + army.speed * delta;
    const gap = Math.abs(nextProgress - 1.0);
    if (gap < minGap) minGap = gap;
    if (nextProgress >= 1.0) {
      arrivalStep = step;
      arrivalProgress = nextProgress;
      break;
    }
    progress = nextProgress;
  }

  // Cross-validate the mirror against the real engine: a state with the same
  // single army must arrive on the same step via core.stepSimulation.
  let state = {
    battlefieldId: 'crown_cross',
    territories: { src: source, tgt: target },
    armies: [{ ...army }],
    status: 'playing',
    elapsedTimeSeconds: 0,
    timeLimitSeconds: 1e18,
    stats: {
      matchDurationSeconds: 0,
      playerUnitsDispatched: 0,
      enemyUnitsDispatched: 0,
      territoriesCapturedByPlayer: 0,
      territoriesCapturedByEnemy: 0,
    },
  };
  let accumulators = {};
  let realArrivalStep = 0;
  for (let step = 1; step <= c.maxSteps; step++) {
    if (state.status !== 'playing') break;
    const result = core.stepSimulation(state, accumulators, delta);
    state = result.state;
    accumulators = result.accumulators;
    if (result.resolvedArrivals.length > 0) {
      realArrivalStep = step;
      break;
    }
  }
  if (realArrivalStep !== arrivalStep) {
    throw new Error(`[${c.id}] TS mirror arrival step ${arrivalStep} != real engine ${realArrivalStep}`);
  }

  return {
    id: c.id,
    arrivalStep,
    arrivalProgress,
    arrivalProgressBits: bits(arrivalProgress),
    speedBits: bits(army.speed),
    minBoundaryGap: Number.isFinite(minGap) ? minGap : 0,
  };
}

function runProductionCaseTs(c) {
  // n_center: a real crown_cross territory ID (the Go tickGeneration only
  // visits territories in the authoritative battlefield order list).
  const territories = {
    n_center: {
      id: 'n_center', name: 'Audit', x: 200, y: 360, radius: 20,
      owner: 'player', units: 0, maxUnits: c.maxUnits, productionRate: c.productionRate, tier: 1, type: c.territoryType,
    },
  };
  let accumulators = {};
  let firstGrantStep = 0;
  let minGap = Infinity;
  let grantsHash = 14695981039346656037n;
  const grants = [];
  const delta = core.PVP_SIMULATION_TICK_SECONDS;
  for (let step = 1; step <= c.maxSteps; step++) {
    const unitsBefore = territories.n_center.units;
    const result = core.tickUnitGeneration(territories, accumulators, delta);
    territories.n_center = result.territories.n_center;
    accumulators = result.accumulators;
    const granted = territories.n_center.units - unitsBefore;
    grants.push(granted);
    grantsHash = ((grantsHash ^ BigInt(granted)) * 1099511628211n) & 0xffffffffffffffffn;
    const preFloor = accumulators.n_center + granted;
    // Skip capped/reset steps (preFloor == 0): the accumulator is forced to
    // zero at capacity, which is not a rounding boundary.
    if (preFloor > 0) {
      const gap = Math.abs(preFloor - Math.round(preFloor));
      if (gap < minGap) minGap = gap;
    }
    if (firstGrantStep === 0 && territories.n_center.units > 0) firstGrantStep = step;
  }
  return {
    id: c.id,
    firstGrantStep,
    finalUnits: territories.n_center.units,
    finalAccumulator: accumulators.n_center,
    accumulatorBits: bits(accumulators.n_center),
    minBoundaryGap: Number.isFinite(minGap) ? minGap : 0,
    grantsHash: grantsHash.toString(16),
    grants,
  };
}

function runAICaseTs(c) {
  // Rebuild the battlefield board exactly as the Go side does via
  // CreateTerritoriesForBattlefield with zero modifiers: owned territories
  // take the modifier's starting units (0) and rate (0); neutral territories
  // keep template values. Patches then apply on top.
  const battlefield = core.getBattlefield(c.battlefieldId);
  const territories = {};
  for (const t of battlefield.territories) {
    const owned = t.owner === 'player' || t.owner === 'enemy';
    territories[t.id] = {
      id: t.id, name: t.name, x: t.x, y: t.y, radius: t.radius,
      owner: t.owner,
      units: owned ? 0 : t.units,
      maxUnits: t.maxUnits,
      productionRate: owned ? 0 : t.productionRate,
      tier: t.tier, type: t.type,
    };
  }
  for (const patch of c.patches) {
    const territory = territories[patch.id];
    if (!territory) throw new Error(`patch target ${patch.id} missing in ${c.battlefieldId}`);
    if (patch.owner !== undefined) territory.owner = patch.owner;
    if (patch.units !== undefined) territory.units = patch.units;
  }
  const move = core.evaluateAiMove(territories, 'enemy', 8);
  return {
    id: c.id,
    ok: move !== null,
    fromId: move ? move.fromId : '',
    toId: move ? move.toId : '',
  };
}

// ---------------------------------------------------------------------------
// Go-side execution
// ---------------------------------------------------------------------------

function runGoSide(cases, workDir) {
  const scenariosPath = path.join(workDir, 'audit_cases.json');
  const outputPath = path.join(workDir, 'audit_go_results.json');
  fs.writeFileSync(scenariosPath, JSON.stringify({
    progressCases: cases.progress,
    productionCases: cases.production,
    aiCases: cases.ai,
  }), 'utf8');

  execFileSync(
    'docker',
    [
      'run', '--rm',
      '-v', `${REPO_ROOT}:/repo:ro`,
      '-v', `${workDir}:/data`,
      '-w', '/repo/apps/server-nakama',
      '-e', `NUMERICAL_AUDIT_SCENARIOS=/data/${path.basename(scenariosPath)}`,
      '-e', `NUMERICAL_AUDIT_OUTPUT=/data/${path.basename(outputPath)}`,
      'golang:1.26.5',
      'go', 'test', '-run', 'TestNumericalAuditDump', '-count=1', '-v', '.',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  if (!fs.existsSync(outputPath)) {
    throw new Error('Go audit produced no output file (fail closed)');
  }
  return JSON.parse(fs.readFileSync(outputPath, 'utf8'));
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function compare(casesTs, goOutput) {
  const failures = [];
  const info = { speedBitDrift: 0, progressBitDrift: 0, accumulatorBitDrift: 0 };
  const minGaps = { progress: Infinity, production: Infinity };

  if (casesTs.progress.length !== goOutput.progress.length) {
    throw new Error('progress case count mismatch between TS and Go');
  }
  for (let i = 0; i < casesTs.progress.length; i++) {
    const ts = casesTs.progress[i];
    const go = goOutput.progress[i];
    if (ts.id !== go.id) throw new Error(`progress ordering mismatch: ${ts.id} vs ${go.id}`);
    if (ts.minBoundaryGap < minGaps.progress) minGaps.progress = ts.minBoundaryGap;
    if (ts.speedBits !== go.speedBits) info.speedBitDrift++;
    if (ts.arrivalProgressBits !== go.arrivalProgressBits) info.progressBitDrift++;
    if (ts.arrivalStep !== go.arrivalStep) {
      failures.push(
        `ARRIVAL STEP DIVERGENCE [${ts.id}]: ts=${ts.arrivalStep} (progress ${ts.arrivalProgress}, bits ${ts.arrivalProgressBits}) go=${go.arrivalStep} (progress ${go.arrivalProgress}, bits ${go.arrivalProgressBits})`
      );
    }
  }

  if (casesTs.production.length !== goOutput.production.length) {
    throw new Error('production case count mismatch between TS and Go');
  }
  for (let i = 0; i < casesTs.production.length; i++) {
    const ts = casesTs.production[i];
    const go = goOutput.production[i];
    if (ts.id !== go.id) throw new Error(`production ordering mismatch: ${ts.id} vs ${go.id}`);
    if (ts.minBoundaryGap < minGaps.production) minGaps.production = ts.minBoundaryGap;
    if (ts.accumulatorBits !== go.accumulatorBits) info.accumulatorBitDrift++;
    if (ts.firstGrantStep !== go.firstGrantStep || ts.finalUnits !== go.finalUnits || ts.grantsHash !== go.grantsHash) {
      let firstDivergentStep = -1;
      for (let step = 0; step < Math.min(ts.grants.length, go.grants.length); step++) {
        if (ts.grants[step] !== go.grants[step]) {
          firstDivergentStep = step + 1;
          break;
        }
      }
      failures.push(
        `PRODUCTION DIVERGENCE [${ts.id}]: ts firstGrant=${ts.firstGrantStep} finalUnits=${ts.finalUnits} grantsHash=${ts.grantsHash} ` +
        `go firstGrant=${go.firstGrantStep} finalUnits=${go.finalUnits} grantsHash=${go.grantsHash} ` +
        `firstDivergentStep=${firstDivergentStep} ` +
        `tsGrants[step-2..step+2]=[${ts.grants.slice(firstDivergentStep - 3, firstDivergentStep + 2)}] ` +
        `goGrants[step-2..step+2]=[${go.grants.slice(firstDivergentStep - 3, firstDivergentStep + 2)}]`
      );
    }
  }

  if (casesTs.ai.length !== goOutput.ai.length) {
    throw new Error('ai case count mismatch between TS and Go');
  }
  for (let i = 0; i < casesTs.ai.length; i++) {
    const ts = casesTs.ai[i];
    const go = goOutput.ai[i];
    if (ts.id !== go.id) throw new Error(`ai ordering mismatch: ${ts.id} vs ${go.id}`);
    // Observable behavior: whether the AI acts, and (only when it acts)
    // which move it picks. When ok=false the Go engine still returns its
    // best rejected candidate in fromId/toId (the production call site
    // ignores them), so those scratch values must not be compared.
    if (ts.ok !== go.ok || (ts.ok && (ts.fromId !== go.fromId || ts.toId !== go.toId))) {
      failures.push(
        `AI DECISION DIVERGENCE [${ts.id}]: ts=${ts.ok ? `${ts.fromId}->${ts.toId}` : 'no move'} go=${go.ok ? `${go.fromId}->${go.toId}` : 'no move'}`
      );
    }
  }

  return { failures, info, minGaps };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('================================================================');
  console.log(' Numerical Determinism Audit: TS client engine vs Go server engine');
  console.log(` mode: ${FAST ? 'fast' : 'full (exhaustive)'}`);
  console.log('================================================================\n');

  console.log('Enumerating boundary cases...');
  const cases = {
    progress: enumerateProgressCases(),
    production: enumerateProductionCases(),
    ai: enumerateAICases(),
  };
  console.log(`  progress cases:   ${cases.progress.length} (unique distance x speed multiplier)`);
  console.log(`  production cases: ${cases.production.length} (base rate x prod multiplier x type multiplier)`);
  console.log(`  ai cases:         ${cases.ai.length} (scoring grid + exact-tie pairs)\n`);

  console.log('[1/3] Running the real TypeScript engine...');
  const tsStart = Date.now();
  const tsProgress = cases.progress.map((c) => runProgressCaseTs(c));
  const tsProduction = cases.production.map((c) => runProductionCaseTs(c));
  const tsAI = cases.ai.map((c) => runAICaseTs(c));
  console.log(`      done in ${((Date.now() - tsStart) / 1000).toFixed(1)}s\n`);

  console.log('[2/3] Running the real Go engine (pinned golang container)...');
  const goStart = Date.now();
  const workDir = fs.mkdtempSync(path.join(REPO_ROOT, 'qa-artifacts', 'bot-parity', 'audit-'));
  let goOutput;
  try {
    goOutput = runGoSide(cases, workDir);
  } finally {
    if (!KEEP_ARTIFACTS) fs.rmSync(workDir, { recursive: true, force: true });
    else console.log(`      artifacts kept in ${workDir}`);
  }
  console.log(`      done in ${((Date.now() - goStart) / 1000).toFixed(1)}s\n`);

  console.log('[3/3] Comparing bit-for-bit results...');
  const { failures, info, minGaps } = compare(
    { progress: tsProgress, production: tsProduction, ai: tsAI },
    goOutput
  );

  console.log(`\n  informational bit drift (no decision flipped):`);
  console.log(`    army speed values differing in last ulp (hypot/division): ${info.speedBitDrift}/${cases.progress.length}`);
  console.log(`    arrival progress values differing in last ulp:            ${info.progressBitDrift}/${cases.progress.length}`);
  console.log(`    production accumulator values differing in last ulp:      ${info.accumulatorBitDrift}/${cases.production.length}`);
  console.log(`  minimum distance of any accumulated value to its decision boundary:`);
  console.log(`    army arrival (progress 1.0):        ${minGaps.progress.toExponential(3)}`);
  console.log(`    production grant (integer boundary): ${minGaps.production.toExponential(3)}`);

  if (failures.length > 0) {
    console.error(`\n[AUDIT FAILED] ${failures.length} outcome-level divergence(s); first divergent cases:`);
    for (const failure of failures.slice(0, 10)) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }
  console.log('\n[AUDIT PASSED] No engine disagreement on any tested decision boundary.');
}

main();
