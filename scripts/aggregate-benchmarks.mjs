import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateBenchmarkRuns, formatAggregateMarkdown } from '../apps/game/src/debug/benchmark/BenchmarkAggregator.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const SUMMARIES_DIR = path.resolve(REPO_ROOT, 'qa-artifacts/summaries');

export function runAggregation(scenario = 'normal_combat', runFiles = ['normal_combat_run1.json', 'normal_combat_run2.json', 'normal_combat_run3.json']) {
  const reports = [];
  for (const file of runFiles) {
    const fullPath = path.isAbsolute(file) ? file : path.join(SUMMARIES_DIR, file);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Summary file not found: ${fullPath}`);
    }
    const report = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    reports.push(report);
  }

  const aggregate = aggregateBenchmarkRuns(reports);
  const md = formatAggregateMarkdown(aggregate);

  const jsonOut = path.join(SUMMARIES_DIR, `${scenario}_aggregate.json`);
  const mdOut = path.join(SUMMARIES_DIR, `${scenario}_aggregate.md`);

  fs.writeFileSync(jsonOut, JSON.stringify(aggregate, null, 2), 'utf8');
  fs.writeFileSync(mdOut, md, 'utf8');

  console.log(`\n======================================================`);
  console.log(`AGGREGATION REPORT: ${scenario} (${reports.length} runs)`);
  console.log(`Overall Status: ${aggregate.overallPassed ? 'PASSED (STABLE)' : 'FAILED / UNSTABLE'}`);
  console.log(`Presented FPS: mean ${aggregate.metrics.presentedFps.mean} (CV: ${aggregate.metrics.presentedFps.cvPercent}%)`);
  console.log(`P95 Frame Delta: mean ${aggregate.metrics.p95FrameTimeMs.mean}ms (CV: ${aggregate.metrics.p95FrameTimeMs.cvPercent}%)`);
  console.log(`Steady-State Armies: mean ${aggregate.metrics.steadyStateAvgArmies.mean} (CV: ${aggregate.metrics.steadyStateAvgArmies.cvPercent}%)`);
  console.log(`Saved aggregate JSON to: ${jsonOut}`);
  console.log(`Saved aggregate Markdown to: ${mdOut}`);
  console.log(`======================================================\n`);

  return aggregate;
}

if (process.argv[1] && process.argv[1].endsWith('aggregate-benchmarks.mjs')) {
  const scenario = process.argv[2] || 'normal_combat';
  const customFiles = process.argv.slice(3).filter(a => !a.startsWith('--'));
  const files = customFiles.length > 0 ? customFiles : [
    `${scenario}_run1.json`,
    `${scenario}_run2.json`,
    `${scenario}_run3.json`,
  ];
  try {
    const agg = runAggregation(scenario, files);
    if (!agg.overallPassed) {
      console.warn('Warning: Aggregate benchmark runs failed verification or exceeded stability thresholds');
    }
  } catch (err) {
    console.error('Aggregation error:', err);
    process.exit(1);
  }
}
