#!/usr/bin/env node
/**
 * Bisects a saved parity run (scenarios.json + go_results.json) by re-running
 * the TS replay mirror and reporting the first checkpoint where any integer
 * simulation field (territory owner/units, army identity) diverges, including
 * the AI decisions immediately before it.
 */

import fs from 'node:fs';
import path from 'node:path';
import * as core from '../../packages/game-core/dist/packages/game-core/src/index.js';
import { runTsReplayMirror } from './bot_parity_harness.mjs';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node bot_parity_bisect.mjs <qa-artifacts/bot-parity/run-XXXX> [scenarioIdSubstring]');
  process.exit(1);
}
const filter = process.argv[3] ?? '';

const scenarios = JSON.parse(fs.readFileSync(path.join(dir, 'scenarios.json'), 'utf8'));
const goResults = JSON.parse(fs.readFileSync(path.join(dir, 'go_results.json'), 'utf8'));

for (let i = 0; i < scenarios.length; i++) {
  const scenario = scenarios[i];
  if (filter && !scenario.id.includes(filter)) continue;
  const go = goResults[i];
  if (go.id !== scenario.id) throw new Error('ordering mismatch');

  const mirror = runTsReplayMirror(scenario);
  console.log(`scenario ${scenario.id}: mirror=${mirror.status} go=${go.status} checkpoints ts=${mirror.checkpoints.length} go=${go.checkpoints.length}`);

  const n = Math.min(mirror.checkpoints.length, go.checkpoints.length);
  for (let c = 0; c < n; c++) {
    const ts = mirror.checkpoints[c];
    const gs = go.checkpoints[c];
    if (ts.kind !== gs.kind) {
      console.log(`first structure divergence at checkpoint ${c}: kind ts=${ts.kind} go=${gs.kind}`);
      reportContext(mirror, go, c);
      process.exit(2);
    }
    const territoryIds = new Set([...Object.keys(ts.territories), ...Object.keys(gs.territories)]);
    for (const id of territoryIds) {
      const t1 = ts.territories[id];
      const t2 = gs.territories[id];
      if (!t1 || !t2 || t1.owner !== t2.owner || t1.units !== t2.units) {
        console.log(`first integer divergence at checkpoint ${c} (${ts.kind} at=${ts.at} status=${ts.status}):`);
        console.log(`  territory ${id}: ts=${JSON.stringify(t1)} go=${JSON.stringify(t2)}`);
        reportContext(mirror, go, c);
        process.exit(2);
      }
    }
    if (ts.armies.length !== gs.armies.length) {
      console.log(`first integer divergence at checkpoint ${c} (${ts.kind} at=${ts.at}): army count ts=${ts.armies.length} go=${gs.armies.length}`);
      reportContext(mirror, go, c);
      process.exit(2);
    }
    for (let a = 0; a < ts.armies.length; a++) {
      const a1 = ts.armies[a];
      const a2 = gs.armies[a];
      if (a1.sourceId !== a2.sourceId || a1.targetId !== a2.targetId || a1.owner !== a2.owner || a1.units !== a2.units) {
        console.log(`first integer divergence at checkpoint ${c} (${ts.kind} at=${ts.at}): army[${a}] ts=${JSON.stringify(a1)} go=${JSON.stringify(a2)}`);
        reportContext(mirror, go, c);
        process.exit(2);
      }
      if (Math.abs(a1.progress - a2.progress) > 1e-9) {
        console.log(`army progress divergence (beyond tolerance) at checkpoint ${c} (${ts.kind} at=${ts.at}): army[${a}] ts=${a1.progress} go=${a2.progress}`);
        reportContext(mirror, go, c);
        process.exit(2);
      }
    }
  }
  console.log(`  no integer divergence within the common prefix (${n} checkpoints); one side ended early or only float drift`);
}

function reportContext(mirror, go, divergeIndex) {
  for (const label of ['ts', 'go']) {
    const checkpoints = label === 'ts' ? mirror.checkpoints : go.checkpoints;
    console.log(`--- ${label} checkpoints around divergence ---`);
    for (let c = Math.max(0, divergeIndex - 2); c <= Math.min(checkpoints.length - 1, divergeIndex + 2); c++) {
      const cp = checkpoints[c];
      const armiesSummary = cp.armies.map((a) => `${a.owner}:${a.units}#${a.sourceId}->${a.targetId}@${a.progress.toFixed(6)}`).join(' | ');
      const territorySummary = Object.entries(cp.territories)
        .filter(([, t]) => t.units !== undefined)
        .map(([id, t]) => `${id}:${t.owner[0]}${t.units}`)
        .join(' ');
      console.log(`  [${c}] ${cp.kind} at=${cp.at} status=${cp.status}`);
      console.log(`      territories: ${territorySummary}`);
      console.log(`      armies: ${armiesSummary || '(none)'}`);
    }
  }
}
