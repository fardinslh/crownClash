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

export interface RawArmySample {
  timestampMs: number;
  count: number;
}

export interface RawBenchmarkSampleInput {
  sampleDurationMs: number;
  activeSampleDurationMs?: number;
  backgroundDurationMs?: number;
  renderFrames: RawFrameSample[];
  simulationTicks: number;
  longTasks: Array<{ duration: number }>;
  armySamples?: RawArmySample[];
  armyCountSamples?: number[];
  lifecycleTransitions?: Array<{ event: string; state: string; timestampMs: number }>;
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
  _targetFps = 60,
  warmupDurationSeconds = 4.0
): BenchmarkMetrics {
  const { validDeltas, duplicateCount } = processAndDeduplicateFrames(input.renderFrames);
  const totalRenderedFrames = validDeltas.length;
  const wallClockDurationSec = Math.max(0.001, input.sampleDurationMs / 1000);
  const backgroundDurationMs = input.backgroundDurationMs ?? 0;
  const activeDurationMs = input.activeSampleDurationMs ?? Math.max(0, input.sampleDurationMs - backgroundDurationMs);
  const activeDurationSec = Math.max(0.001, activeDurationMs / 1000);

  // Raw rendered FPS across total wall-clock time
  const renderedFps = Math.round((totalRenderedFrames / wallClockDurationSec) * 10) / 10;

  // Authoritative measured presented FPS during active gameplay (unclamped; tested against target bound in verifyPrerequisites)
  const presentedFps = Math.round((totalRenderedFrames / activeDurationSec) * 10) / 10;

  // Authoritative simulation FPS
  const simulationFps = Math.round((input.simulationTicks / wallClockDurationSec) * 10) / 10;

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

  // Army count distribution: separate warmup vs steady-state
  const warmupArmySamples: number[] = [];
  const steadyStateArmySamples: number[] = [];

  if (input.armySamples && input.armySamples.length > 0) {
    const firstTimestamp = input.armySamples[0].timestampMs;
    for (const sample of input.armySamples) {
      const elapsedSec = (sample.timestampMs - firstTimestamp) / 1000;
      if (elapsedSec < warmupDurationSeconds) {
        warmupArmySamples.push(sample.count);
      } else {
        steadyStateArmySamples.push(sample.count);
      }
    }
  } else if (input.armyCountSamples && input.armyCountSamples.length > 0) {
    // If raw array without timestamps is provided:
    const totalSamples = input.armyCountSamples.length;
    const warmupCount = warmupDurationSeconds > 0
      ? Math.min(totalSamples, Math.round((warmupDurationSeconds / wallClockDurationSec) * totalSamples))
      : 0;
    warmupArmySamples.push(...input.armyCountSamples.slice(0, warmupCount));
    steadyStateArmySamples.push(...input.armyCountSamples.slice(warmupCount));
  }

  const allArmies = [...warmupArmySamples, ...steadyStateArmySamples];
  const minArmy = allArmies.length > 0 ? Math.min(...allArmies) : 0;
  const maxArmy = allArmies.length > 0 ? Math.max(...allArmies) : 0;
  const avgArmy = allArmies.length > 0
    ? Math.round((allArmies.reduce((a, b) => a + b, 0) / allArmies.length) * 10) / 10
    : 0;

  const steadyArmies = steadyStateArmySamples.length > 0 ? steadyStateArmySamples : allArmies;
  const steadyMin = steadyArmies.length > 0 ? Math.min(...steadyArmies) : 0;
  const steadyMax = steadyArmies.length > 0 ? Math.max(...steadyArmies) : 0;
  const steadyAvg = steadyArmies.length > 0
    ? Math.round((steadyArmies.reduce((a, b) => a + b, 0) / steadyArmies.length) * 10) / 10
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
    warmupArmySamples,
    steadyStateArmySamples,
    steadyStateArmyCounts: {
      min: steadyMin,
      max: steadyMax,
      avg: steadyAvg,
      peak: steadyMax,
    },
    peakObjects: input.peakObjects,
    peakTweens: input.peakTweens,
    memoryMb: input.memoryMb,
    drawCalls,
    sampleDurationMs: input.sampleDurationMs,
    activeSampleDurationMs: activeDurationMs,
    backgroundDurationMs,
    lifecycleTransitions: input.lifecycleTransitions ?? [],
    totalRenderedFrames,
    duplicateFramesDropped: duplicateCount,
  };
}

export function verifyPrerequisites(
  metrics: BenchmarkMetrics,
  environment: {
    renderer: string;
    gpuVendor?: string;
    gpuRenderer?: string;
    isSoftwareRenderer?: boolean;
    viewport: { width: number; height: number; dpr: number };
    buildMode: string;
  },
  prerequisites: BenchmarkPrerequisites
): BenchmarkVerificationResult {
  const failures: string[] = [];

  // 1. Renderer mismatch
  if (environment.renderer !== prerequisites.expectedRenderer) {
    failures.push(
      `Renderer mismatch: actual '${environment.renderer}' != expected '${prerequisites.expectedRenderer}'`
    );
  }

  // 2. Software WebGL rejection (SwiftShader, Microsoft Basic Render Driver, llvmpipe)
  if (environment.renderer === 'WebGL' && environment.isSoftwareRenderer) {
    failures.push(
      `SOFTWARE_WEBGL_DETECTED: Software rasterizer detected ('${environment.gpuRenderer ?? 'unknown'}'). Hardware WebGL is required.`
    );
  }

  // 3. Viewport & DPR
  const vp = environment.viewport;
  const expVp = prerequisites.expectedViewport;
  if (vp.width !== expVp.width || vp.height !== expVp.height || vp.dpr !== expVp.dpr) {
    failures.push(
      `Viewport mismatch: actual ${vp.width}x${vp.height}@${vp.dpr} != expected ${expVp.width}x${expVp.height}@${expVp.dpr}`
    );
  }

  // 4. Build mode
  if (environment.buildMode !== prerequisites.expectedBuildMode) {
    failures.push(
      `Build mode mismatch: actual '${environment.buildMode}' != expected '${prerequisites.expectedBuildMode}'`
    );
  }

  // 5. Duration
  const durationSec = metrics.sampleDurationMs / 1000;
  if (Math.abs(durationSec - prerequisites.expectedDurationSeconds) > 2.0) {
    failures.push(
      `Duration mismatch: actual ${durationSec.toFixed(1)}s differs from expected ${prerequisites.expectedDurationSeconds}s by > 2.0s`
    );
  }

  // 6. Presented FPS sanity: fail if it exceeds target FPS + tolerance (uncalibrated clock/infinite loop)
  const targetBound = prerequisites.targetFps + (prerequisites.targetFpsTolerance ?? 1.5);
  if (metrics.presentedFps > targetBound) {
    failures.push(
      `PRESENTED_FPS_EXCEEDS_TARGET_BOUND: measured presented FPS ${metrics.presentedFps} exceeds target ${prerequisites.targetFps} + ${prerequisites.targetFpsTolerance ?? 1.5} tolerance`
    );
  }

  // 7. Duplicate postrender frames
  if (metrics.duplicateFramesDropped > 0) {
    failures.push(
      `POSTRENDER_DUPLICATE_DETECTED: ${metrics.duplicateFramesDropped} duplicate or non-monotonic postrender frame(s) detected`
    );
  }

  // 8. Target army range check: during steady-state window, army count must remain strictly within [min, max]
  const { min: expMin, max: expMax } = prerequisites.targetArmyRange;
  if (expMax === 0) {
    // Idle match: must have 0 armies throughout
    if (metrics.armyCounts.peak > 0) {
      failures.push(
        `ARMY_COUNT_OUT_OF_STEADY_STATE_BOUNDS: expected 0 armies in idle match, got peak ${metrics.armyCounts.peak}`
      );
    }
  } else {
    // Active combat: steady-state samples must exist and all lie within [expMin, expMax]
    if (metrics.steadyStateArmySamples.length === 0) {
      failures.push(
        `ARMY_COUNT_OUT_OF_STEADY_STATE_BOUNDS: no steady-state army count samples recorded`
      );
    } else {
      for (const count of metrics.steadyStateArmySamples) {
        if (count < expMin || count > expMax) {
          failures.push(
            `ARMY_COUNT_OUT_OF_STEADY_STATE_BOUNDS: steady-state army count ${count} outside allowed range [${expMin}, ${expMax}]`
          );
          break;
        }
      }
    }
  }

  // 9. Background lifecycle transitions (for background_resume)
  if (metrics.backgroundDurationMs > 0) {
    const hasHidden = metrics.lifecycleTransitions.some((t) => t.state === 'hidden');
    const hasVisible = metrics.lifecycleTransitions.some((t) => t.state === 'visible');
    if (!hasHidden || !hasVisible) {
      failures.push(
        `INVALID_BACKGROUND_TRANSITION: background_resume scenario missing required transitions (hidden: ${hasHidden}, visible: ${hasVisible})`
      );
    }
  }

  // 10. Sanity check on minimum rendered frame count (at least 5 FPS equivalent to detect hangs)
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
