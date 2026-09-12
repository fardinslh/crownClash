import type {
  BenchmarkAggregateReport,
  BenchmarkAggregateThresholds,
  BenchmarkReport,
  MetricAggregateStats,
} from './BenchmarkTypes.js';

export const DEFAULT_AGGREGATE_THRESHOLDS: BenchmarkAggregateThresholds = {
  presentedFpsCvMaxPercent: 5.0, // CV <= 5% for presented FPS
  p95FrameTimeCvMaxPercent: 10.0, // CV <= 10% for P95
  steadyStateArmiesCvMaxPercent: 10.0, // CV <= 10% for army counts
};

export function calculateSampleStats(
  values: number[],
  cvThresholdPercent?: number
): MetricAggregateStats {
  if (values.length === 0) {
    return {
      mean: 0,
      min: 0,
      max: 0,
      stdDev: 0,
      cvPercent: 0,
      passedThreshold: true,
      unstable: false,
    };
  }

  const n = values.length;
  const sum = values.reduce((acc, v) => acc + v, 0);
  const mean = Math.round((sum / n) * 100) / 100;
  const min = Math.round(Math.min(...values) * 100) / 100;
  const max = Math.round(Math.max(...values) * 100) / 100;

  if (n <= 1) {
    return {
      mean,
      min,
      max,
      stdDev: 0,
      cvPercent: 0,
      passedThreshold: true,
      unstable: false,
    };
  }

  // Sample variance uses (n - 1) denominator
  const sumSqDiff = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0);
  const sampleVariance = sumSqDiff / (n - 1);
  const stdDev = Math.round(Math.sqrt(sampleVariance) * 100) / 100;
  const cvPercent = mean > 0 ? Math.round((stdDev / mean) * 10000) / 100 : 0;

  const passedThreshold = cvThresholdPercent !== undefined ? cvPercent <= cvThresholdPercent : true;
  const unstable = !passedThreshold;

  return {
    mean,
    min,
    max,
    stdDev,
    cvPercent,
    passedThreshold,
    unstable,
  };
}

export function aggregateBenchmarkRuns(
  runs: BenchmarkReport[],
  customThresholds?: Partial<BenchmarkAggregateThresholds>
): BenchmarkAggregateReport {
  if (runs.length === 0) {
    throw new Error('Cannot aggregate an empty list of benchmark runs');
  }

  const thresholds: BenchmarkAggregateThresholds = {
    ...DEFAULT_AGGREGATE_THRESHOLDS,
    ...customThresholds,
  };

  const scenarioName = runs[0].scenario.name;
  const runIds = runs.map((r) => r.id);
  const runsPassedVerification = runs.every((r) => r.verification.passed);

  const presentedFps = calculateSampleStats(
    runs.map((r) => r.metrics.presentedFps),
    thresholds.presentedFpsCvMaxPercent
  );

  const renderedFps = calculateSampleStats(
    runs.map((r) => r.metrics.renderedFps)
  );

  const p95FrameTimeMs = calculateSampleStats(
    runs.map((r) => r.metrics.phaserUpdateDelta.p95Ms),
    thresholds.p95FrameTimeCvMaxPercent
  );

  const framesOver33Pct = calculateSampleStats(
    runs.map((r) => r.metrics.framesOver33Pct)
  );

  const steadyStateAvgArmies = calculateSampleStats(
    runs.map((r) => r.metrics.steadyStateArmyCounts.avg),
    thresholds.steadyStateArmiesCvMaxPercent
  );

  const steadyStateMinArmies = calculateSampleStats(
    runs.map((r) => r.metrics.steadyStateArmyCounts.min)
  );

  const steadyStateMaxArmies = calculateSampleStats(
    runs.map((r) => r.metrics.steadyStateArmyCounts.max)
  );

  const longTaskCount = calculateSampleStats(
    runs.map((r) => r.metrics.longTasks.count)
  );

  const longTaskTotalDurationMs = calculateSampleStats(
    runs.map((r) => r.metrics.longTasks.totalDurationMs)
  );

  const overallPassed =
    runsPassedVerification &&
    presentedFps.passedThreshold &&
    p95FrameTimeMs.passedThreshold &&
    steadyStateAvgArmies.passedThreshold;

  return {
    scenarioName,
    runCount: runs.length,
    runIds,
    runsPassedVerification,
    metrics: {
      presentedFps,
      renderedFps,
      p95FrameTimeMs,
      framesOver33Pct,
      steadyStateAvgArmies,
      steadyStateMinArmies,
      steadyStateMaxArmies,
      longTaskCount,
      longTaskTotalDurationMs,
    },
    thresholds,
    overallPassed,
  };
}

export function formatAggregateMarkdown(report: BenchmarkAggregateReport): string {
  const m = report.metrics;
  const t = report.thresholds;

  return `# Benchmark Multi-Run Aggregation Report: ${report.scenarioName}

- **Total Runs**: ${report.runCount}
- **Run IDs**: ${report.runIds.join(', ')}
- **Individual Verifications Passed**: ${report.runsPassedVerification ? 'YES' : 'NO'}
- **Overall Aggregation Status**: ${report.overallPassed ? 'PASSED (STABLE)' : 'FAILED / UNSTABLE'}

## Statistical Summary

| Metric | Mean | Min | Max | Sample StdDev | CV (%) | Threshold | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Presented FPS** | ${m.presentedFps.mean} | ${m.presentedFps.min} | ${m.presentedFps.max} | ${m.presentedFps.stdDev} | ${m.presentedFps.cvPercent}% | $\\le ${t.presentedFpsCvMaxPercent}\\%$ | ${m.presentedFps.unstable ? '⚠️ UNSTABLE' : '✅ PASS'} |
| **Raw Rendered FPS** | ${m.renderedFps.mean} | ${m.renderedFps.min} | ${m.renderedFps.max} | ${m.renderedFps.stdDev} | ${m.renderedFps.cvPercent}% | N/A | ${m.renderedFps.unstable ? '⚠️ UNSTABLE' : '✅ PASS'} |
| **P95 Frame Delta (ms)** | ${m.p95FrameTimeMs.mean} | ${m.p95FrameTimeMs.min} | ${m.p95FrameTimeMs.max} | ${m.p95FrameTimeMs.stdDev} | ${m.p95FrameTimeMs.cvPercent}% | $\\le ${t.p95FrameTimeCvMaxPercent}\\%$ | ${m.p95FrameTimeMs.unstable ? '⚠️ UNSTABLE' : '✅ PASS'} |
| **Frames >33.3ms (%)** | ${m.framesOver33Pct.mean}% | ${m.framesOver33Pct.min}% | ${m.framesOver33Pct.max}% | ${m.framesOver33Pct.stdDev}% | ${m.framesOver33Pct.cvPercent}% | N/A | ${m.framesOver33Pct.unstable ? '⚠️ UNSTABLE' : '✅ PASS'} |
| **Steady-State Armies (avg)** | ${m.steadyStateAvgArmies.mean} | ${m.steadyStateAvgArmies.min} | ${m.steadyStateAvgArmies.max} | ${m.steadyStateAvgArmies.stdDev} | ${m.steadyStateAvgArmies.cvPercent}% | $\\le ${t.steadyStateArmiesCvMaxPercent}\\%$ | ${m.steadyStateAvgArmies.unstable ? '⚠️ UNSTABLE' : '✅ PASS'} |
| **Steady-State Armies (min)** | ${m.steadyStateMinArmies.mean} | ${m.steadyStateMinArmies.min} | ${m.steadyStateMinArmies.max} | ${m.steadyStateMinArmies.stdDev} | ${m.steadyStateMinArmies.cvPercent}% | N/A | ${m.steadyStateMinArmies.unstable ? '⚠️ UNSTABLE' : '✅ PASS'} |
| **Steady-State Armies (max)** | ${m.steadyStateMaxArmies.mean} | ${m.steadyStateMaxArmies.min} | ${m.steadyStateMaxArmies.max} | ${m.steadyStateMaxArmies.stdDev} | ${m.steadyStateMaxArmies.cvPercent}% | N/A | ${m.steadyStateMaxArmies.unstable ? '⚠️ UNSTABLE' : '✅ PASS'} |
| **Long Tasks Count** | ${m.longTaskCount.mean} | ${m.longTaskCount.min} | ${m.longTaskCount.max} | ${m.longTaskCount.stdDev} | ${m.longTaskCount.cvPercent}% | N/A | ${m.longTaskCount.unstable ? '⚠️ UNSTABLE' : '✅ PASS'} |
| **Long Tasks Duration (ms)** | ${m.longTaskTotalDurationMs.mean} | ${m.longTaskTotalDurationMs.min} | ${m.longTaskTotalDurationMs.max} | ${m.longTaskTotalDurationMs.stdDev} | ${m.longTaskTotalDurationMs.cvPercent}% | N/A | ${m.longTaskTotalDurationMs.unstable ? '⚠️ UNSTABLE' : '✅ PASS'} |
`;
}
