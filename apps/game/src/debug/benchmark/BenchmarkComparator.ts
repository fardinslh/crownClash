import type {
  BenchmarkComparisonResult,
  BenchmarkReport,
  MetricDelta,
} from './BenchmarkTypes.js';

export interface CompareOptions {
  /** Maximum allowable relative difference in average army counts (default 0.25 = 25%) */
  maxArmyVarianceRatio?: number;
  /** Maximum allowable duration difference in seconds (default 1.0s) */
  maxDurationDiffSeconds?: number;
}

function calculateMetricDelta(baseline: number, candidate: number, higherIsBetter: boolean): MetricDelta {
  const delta = Math.round((candidate - baseline) * 100) / 100;
  const percentChange = baseline !== 0
    ? Math.round(((candidate - baseline) / Math.abs(baseline)) * 1000) / 10
    : 0;
  const improved = higherIsBetter ? candidate > baseline : candidate < baseline;

  return {
    baseline,
    candidate,
    delta,
    percentChange,
    improved,
  };
}

export function compareBenchmarks(
  baseline: BenchmarkReport,
  candidate: BenchmarkReport,
  options: CompareOptions = {}
): BenchmarkComparisonResult {
  const maxArmyVariance = options.maxArmyVarianceRatio ?? 0.25;
  const maxDurationDiff = options.maxDurationDiffSeconds ?? 1.0;

  // 1. Must both have passed self-verification
  if (!baseline.verification.passed) {
    return {
      rejected: true,
      reasonCode: 'UNVERIFIED_SAMPLE',
      message: `Baseline failed internal verification: ${baseline.verification.failures.join('; ')}`,
    };
  }
  if (!candidate.verification.passed) {
    return {
      rejected: true,
      reasonCode: 'UNVERIFIED_SAMPLE',
      message: `Candidate failed internal verification: ${candidate.verification.failures.join('; ')}`,
    };
  }

  // 2. Reject if renderer differs
  if (baseline.environment.renderer !== candidate.environment.renderer) {
    return {
      rejected: true,
      reasonCode: 'RENDERER_MISMATCH',
      message: `Renderer mismatch: baseline is '${baseline.environment.renderer}', but candidate is '${candidate.environment.renderer}'`,
    };
  }

  // 3. Reject if viewport or DPR differs
  const bv = baseline.environment.viewport;
  const cv = candidate.environment.viewport;
  if (bv.width !== cv.width || bv.height !== cv.height || bv.dpr !== cv.dpr) {
    return {
      rejected: true,
      reasonCode: 'VIEWPORT_MISMATCH',
      message: `Viewport/DPR mismatch: baseline is ${bv.width}x${bv.height}@${bv.dpr}, but candidate is ${cv.width}x${cv.height}@${cv.dpr}`,
    };
  }

  // 4. Reject if build mode differs
  if (baseline.environment.buildMode !== candidate.environment.buildMode) {
    return {
      rejected: true,
      reasonCode: 'BUILD_MODE_MISMATCH',
      message: `Build mode mismatch: baseline is '${baseline.environment.buildMode}', candidate is '${candidate.environment.buildMode}'`,
    };
  }

  // 5. Reject if scenario duration differs
  const baseDurationSec = baseline.metrics.sampleDurationMs / 1000;
  const candDurationSec = candidate.metrics.sampleDurationMs / 1000;
  if (Math.abs(baseDurationSec - candDurationSec) > maxDurationDiff) {
    return {
      rejected: true,
      reasonCode: 'DURATION_MISMATCH',
      message: `Duration difference (${Math.abs(baseDurationSec - candDurationSec).toFixed(2)}s) exceeds tolerance of ${maxDurationDiff}s`,
    };
  }

  // 6. Reject if army counts differ beyond documented tolerance
  const baseArmyAvg = baseline.metrics.armyCounts.avg;
  const candArmyAvg = candidate.metrics.armyCounts.avg;

  if (baseline.scenario.name !== 'idle_match') {
    const denominator = Math.max(baseArmyAvg, 1);
    const variance = Math.abs(candArmyAvg - baseArmyAvg) / denominator;
    if (variance > maxArmyVariance) {
      return {
        rejected: true,
        reasonCode: 'ARMY_COUNT_VARIANCE_EXCEEDED',
        message: `Army count variance ratio ${(variance * 100).toFixed(1)}% exceeds allowable tolerance of ${(maxArmyVariance * 100).toFixed(1)}% (baseline avg: ${baseArmyAvg}, candidate avg: ${candArmyAvg})`,
      };
    }
  } else {
    // In idle match, both must have 0 peak armies
    if (baseline.metrics.armyCounts.peak > 0 || candidate.metrics.armyCounts.peak > 0) {
      return {
        rejected: true,
        reasonCode: 'ARMY_COUNT_VARIANCE_EXCEEDED',
        message: `Idle match must have zero armies (baseline peak: ${baseline.metrics.armyCounts.peak}, candidate peak: ${candidate.metrics.armyCounts.peak})`,
      };
    }
  }

  // Draw calls comparison if available
  let drawCallsPerFrame: MetricDelta | null = null;
  if (baseline.metrics.drawCalls && candidate.metrics.drawCalls) {
    drawCallsPerFrame = calculateMetricDelta(
      baseline.metrics.drawCalls.avgPerFrame,
      candidate.metrics.drawCalls.avgPerFrame,
      false // lower is better
    );
  }

  return {
    rejected: false,
    presentedFps: calculateMetricDelta(baseline.metrics.presentedFps, candidate.metrics.presentedFps, true),
    renderedFps: calculateMetricDelta(baseline.metrics.renderedFps, candidate.metrics.renderedFps, true),
    p95FrameTimeMs: calculateMetricDelta(baseline.metrics.phaserUpdateDelta.p95Ms, candidate.metrics.phaserUpdateDelta.p95Ms, false),
    framesOver33Pct: calculateMetricDelta(baseline.metrics.framesOver33Pct, candidate.metrics.framesOver33Pct, false),
    avgArmyCount: calculateMetricDelta(baseArmyAvg, candArmyAvg, true),
    peakObjects: calculateMetricDelta(baseline.metrics.peakObjects, candidate.metrics.peakObjects, false),
    drawCallsPerFrame,
  };
}
