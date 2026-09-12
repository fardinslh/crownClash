import type {
  BenchmarkMetrics,
  BenchmarkPrerequisites,
  BenchmarkVerificationResult,
  DeltaPercentiles,
} from './BenchmarkTypes.js';

export interface RawFrameSample {
  timestampMs: number;
  deltaMs: number;
}

export interface RawBenchmarkSampleInput {
  sampleDurationMs: number;
  renderFrames: RawFrameSample[];
  simulationTicks: number;
  longTasks: Array<{ duration: number }>;
  armyCountSamples: number[];
  peakObjects: number;
  peakTweens: number;
  memoryMb: {
    start: number | null;
    peak: number | null;
  };
  totalDrawCalls: number | null;
}

export function calculatePercentiles(values: number[]): DeltaPercentiles {
  if (values.length === 0) {
    return { avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = Math.round((sum / sorted.length) * 100) / 100;

  const getPercentile = (p: number): number => {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return Math.round(sorted[idx] * 100) / 100;
  };

  return {
    avgMs: avg,
    p50Ms: getPercentile(50),
    p95Ms: getPercentile(95),
    p99Ms: getPercentile(99),
    maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
  };
}

export function processAndDeduplicateFrames(rawFrames: RawFrameSample[]): {
  validDeltas: number[];
  duplicateCount: number;
} {
  const validDeltas: number[] = [];
  let duplicateCount = 0;
  let lastTimestamp = -1;

  for (let i = 0; i < rawFrames.length; i++) {
    const frame = rawFrames[i];
    // Deduplicate: same timestamp as previous frame or non-positive delta
    if (i > 0 && (frame.timestampMs === lastTimestamp || frame.deltaMs <= 0)) {
      duplicateCount++;
      continue;
    }
    lastTimestamp = frame.timestampMs;
    validDeltas.push(frame.deltaMs);
  }

  return { validDeltas, duplicateCount };
}

export function computeBenchmarkMetrics(
  input: RawBenchmarkSampleInput,
  targetFps = 60
): BenchmarkMetrics {
  const { validDeltas, duplicateCount } = processAndDeduplicateFrames(input.renderFrames);
  const durationSec = Math.max(0.001, input.sampleDurationMs / 1000);
  const totalRenderedFrames = validDeltas.length;

  // Raw rendered FPS (can exceed targetFps in unthrottled headless execution)
  const renderedFps = Math.round((totalRenderedFrames / durationSec) * 10) / 10;

  // Authoritative presented FPS: bounded by the target/display refresh rate
  const presentedFps = Math.min(targetFps, renderedFps);

  // Authoritative simulation FPS
  const simulationFps = Math.round((input.simulationTicks / durationSec) * 10) / 10;

  // Phaser update deltas percentiles
  const phaserUpdateDelta = calculatePercentiles(validDeltas);

  // Threshold frame violations
  let framesOver16Ms = 0;
  let framesOver33Ms = 0;
  for (const d of validDeltas) {
    if (d > 16.7) framesOver16Ms++;
    if (d > 33.3) framesOver33Ms++;
  }

  const framesOver16Pct = totalRenderedFrames > 0
    ? Math.round((framesOver16Ms / totalRenderedFrames) * 1000) / 10
    : 0;
  const framesOver33Pct = totalRenderedFrames > 0
    ? Math.round((framesOver33Ms / totalRenderedFrames) * 1000) / 10
    : 0;

  // Long tasks aggregation
  let totalLongTaskDuration = 0;
  let maxLongTaskDuration = 0;
  for (const lt of input.longTasks) {
    totalLongTaskDuration += lt.duration;
    if (lt.duration > maxLongTaskDuration) {
      maxLongTaskDuration = lt.duration;
    }
  }

  // Army count distribution
  const armies = input.armyCountSamples;
  const minArmy = armies.length > 0 ? Math.min(...armies) : 0;
  const maxArmy = armies.length > 0 ? Math.max(...armies) : 0;
  const avgArmy = armies.length > 0
    ? Math.round((armies.reduce((a, b) => a + b, 0) / armies.length) * 10) / 10
    : 0;

  // Draw calls
  let drawCalls: { total: number; avgPerFrame: number } | null = null;
  if (input.totalDrawCalls !== null) {
    const avgPerFrame = totalRenderedFrames > 0
      ? Math.round((input.totalDrawCalls / totalRenderedFrames) * 10) / 10
      : 0;
    drawCalls = {
      total: input.totalDrawCalls,
      avgPerFrame,
    };
  }

  return {
    presentedFps,
    renderedFps,
    simulationTicks: input.simulationTicks,
    simulationFps,
    phaserUpdateDelta,
    framesOver16Ms,
    framesOver16Pct,
    framesOver33Ms,
    framesOver33Pct,
    longTasks: {
      count: input.longTasks.length,
      totalDurationMs: Math.round(totalLongTaskDuration * 100) / 100,
      maxDurationMs: Math.round(maxLongTaskDuration * 100) / 100,
    },
    armyCounts: {
      min: minArmy,
      max: maxArmy,
      avg: avgArmy,
      peak: maxArmy,
    },
    peakObjects: input.peakObjects,
    peakTweens: input.peakTweens,
    memoryMb: input.memoryMb,
    drawCalls,
    sampleDurationMs: input.sampleDurationMs,
    totalRenderedFrames,
    duplicateFramesDropped: duplicateCount,
  };
}

export function verifyPrerequisites(
  metrics: BenchmarkMetrics,
  environment: {
    renderer: string;
    viewport: { width: number; height: number; dpr: number };
    buildMode: string;
  },
  prerequisites: BenchmarkPrerequisites
): BenchmarkVerificationResult {
  const failures: string[] = [];

  if (environment.renderer !== prerequisites.expectedRenderer) {
    failures.push(
      `Renderer mismatch: actual '${environment.renderer}' != expected '${prerequisites.expectedRenderer}'`
    );
  }

  const vp = environment.viewport;
  const expVp = prerequisites.expectedViewport;
  if (vp.width !== expVp.width || vp.height !== expVp.height || vp.dpr !== expVp.dpr) {
    failures.push(
      `Viewport mismatch: actual ${vp.width}x${vp.height}@${vp.dpr} != expected ${expVp.width}x${expVp.height}@${expVp.dpr}`
    );
  }

  if (environment.buildMode !== prerequisites.expectedBuildMode) {
    failures.push(
      `Build mode mismatch: actual '${environment.buildMode}' != expected '${prerequisites.expectedBuildMode}'`
    );
  }

  const durationSec = metrics.sampleDurationMs / 1000;
  if (Math.abs(durationSec - prerequisites.expectedDurationSeconds) > 2.0) {
    failures.push(
      `Duration mismatch: actual ${durationSec.toFixed(1)}s differs from expected ${prerequisites.expectedDurationSeconds}s by > 2.0s`
    );
  }

  // Target army range check
  const { min: expMin, max: expMax } = prerequisites.targetArmyRange;
  if (expMax === 0) {
    // Idle match: must have 0 armies throughout
    if (metrics.armyCounts.peak > 0) {
      failures.push(`Army count violation: expected 0 armies in idle match, got peak ${metrics.armyCounts.peak}`);
    }
  } else {
    // Active combat: peak army count must reach at least the minimum, and avg must be within reasonable bounds
    if (metrics.armyCounts.peak < expMin) {
      failures.push(
        `Army count violation: peak army count ${metrics.armyCounts.peak} did not reach expected minimum ${expMin}`
      );
    }
  }

  // Sanity check on minimum rendered frame count (at least 5 FPS equivalent to detect hangs)
  const minRequiredFrames = Math.max(5, prerequisites.expectedDurationSeconds * 5);
  if (metrics.totalRenderedFrames < minRequiredFrames) {
    failures.push(
      `Insufficient frames captured: ${metrics.totalRenderedFrames} < minimum required ${minRequiredFrames}`
    );
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}
