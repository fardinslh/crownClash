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

  // 1. Fail closed on missing required comparison identity metadata
  const requiredIdentityFields: Array<{
    name: string;
    bVal: unknown;
    cVal: unknown;
  }> = [
    { name: 'scenario.name', bVal: baseline.scenario?.name, cVal: candidate.scenario?.name },
    { name: 'scenario.seed', bVal: baseline.scenario?.seed, cVal: candidate.scenario?.seed },
    { name: 'scenario.scheduleHash', bVal: baseline.scenario?.scheduleHash, cVal: candidate.scenario?.scheduleHash },
    { name: 'scenario.durationSeconds', bVal: baseline.scenario?.durationSeconds, cVal: candidate.scenario?.durationSeconds },
    { name: 'scenario.warmupDurationSeconds', bVal: baseline.scenario?.warmupDurationSeconds, cVal: candidate.scenario?.warmupDurationSeconds },
    { name: 'environment.host', bVal: baseline.environment?.host, cVal: candidate.environment?.host },
    { name: 'environment.renderer', bVal: baseline.environment?.renderer, cVal: candidate.environment?.renderer },
    { name: 'environment.gpuVendor', bVal: baseline.environment?.gpuVendor, cVal: candidate.environment?.gpuVendor },
    { name: 'environment.gpuRenderer', bVal: baseline.environment?.gpuRenderer, cVal: candidate.environment?.gpuRenderer },
    { name: 'environment.browserVersion', bVal: baseline.environment?.browserVersion, cVal: candidate.environment?.browserVersion },
    { name: 'environment.viewport.width', bVal: baseline.environment?.viewport?.width, cVal: candidate.environment?.viewport?.width },
    { name: 'environment.viewport.height', bVal: baseline.environment?.viewport?.height, cVal: candidate.environment?.viewport?.height },
    { name: 'environment.viewport.dpr', bVal: baseline.environment?.viewport?.dpr, cVal: candidate.environment?.viewport?.dpr },
    { name: 'environment.cpuThrottling', bVal: baseline.environment?.cpuThrottling, cVal: candidate.environment?.cpuThrottling },
    { name: 'environment.network', bVal: baseline.environment?.network, cVal: candidate.environment?.network },
    { name: 'environment.buildMode', bVal: baseline.environment?.buildMode, cVal: candidate.environment?.buildMode },
    { name: 'environment.targetFps', bVal: baseline.environment?.targetFps, cVal: candidate.environment?.targetFps },
  ];

  for (const field of requiredIdentityFields) {
    const isInvalid = (val: unknown) => val === undefined || val === null || val === '';
    if (isInvalid(field.bVal) || isInvalid(field.cVal)) {
      return {
        rejected: true,
        reasonCode: 'MISSING_COMPARISON_IDENTITY',
        message: `Missing required comparison identity metadata '${field.name}' (baseline: ${field.bVal ?? 'empty'}, candidate: ${field.cVal ?? 'empty'}).`,
      };
    }
  }

  // 2. Must both have passed self-verification
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

  // 3. Reject if software WebGL is detected
  if (baseline.environment.isSoftwareRenderer || candidate.environment.isSoftwareRenderer) {
    return {
      rejected: true,
      reasonCode: 'SOFTWARE_WEBGL_DETECTED',
      message: `Software WebGL rasterizer detected (baseline: ${baseline.environment.gpuRenderer}, candidate: ${candidate.environment.gpuRenderer}). Cannot compare software WebGL.`,
    };
  }

  // 4. Reject if scenario name differs
  if (baseline.scenario.name !== candidate.scenario.name) {
    return {
      rejected: true,
      reasonCode: 'SCENARIO_NAME_MISMATCH',
      message: `Scenario name mismatch: baseline '${baseline.scenario.name}' != candidate '${candidate.scenario.name}'`,
    };
  }

  // 5. Reject if seed differs
  if (baseline.scenario.seed !== candidate.scenario.seed) {
    return {
      rejected: true,
      reasonCode: 'SEED_MISMATCH',
      message: `PRNG seed mismatch: baseline ${baseline.scenario.seed} != candidate ${candidate.scenario.seed}`,
    };
  }

  // 6. Reject if scripted dispatch schedule hash differs
  if (baseline.scenario.scheduleHash !== candidate.scenario.scheduleHash) {
    return {
      rejected: true,
      reasonCode: 'SCHEDULE_HASH_MISMATCH',
      message: `Schedule hash mismatch: baseline '${baseline.scenario.scheduleHash}' != candidate '${candidate.scenario.scheduleHash}'`,
    };
  }

  // 7. Reject if CPU throttle differs
  if (baseline.environment.cpuThrottling !== candidate.environment.cpuThrottling) {
    return {
      rejected: true,
      reasonCode: 'CPU_THROTTLE_MISMATCH',
      message: `CPU throttling mismatch: baseline ${baseline.environment.cpuThrottling}x != candidate ${candidate.environment.cpuThrottling}x`,
    };
  }

  // 8. Reject if network profile differs
  if (baseline.environment.network !== candidate.environment.network) {
    return {
      rejected: true,
      reasonCode: 'NETWORK_PROFILE_MISMATCH',
      message: `Network profile mismatch: baseline '${baseline.environment.network}' != candidate '${candidate.environment.network}'`,
    };
  }

  // 9. Reject if viewport width/height differs
  const bv = baseline.environment.viewport;
  const cv = candidate.environment.viewport;
  if (bv.width !== cv.width || bv.height !== cv.height) {
    return {
      rejected: true,
      reasonCode: 'VIEWPORT_MISMATCH',
      message: `Viewport mismatch: baseline ${bv.width}x${bv.height} != candidate ${cv.width}x${cv.height}`,
    };
  }

  // 10. Reject if DPR differs
  if (bv.dpr !== cv.dpr) {
    return {
      rejected: true,
      reasonCode: 'DPR_MISMATCH',
      message: `DPR mismatch: baseline @${bv.dpr} != candidate @${cv.dpr}`,
    };
  }

  // 11. Reject if renderer differs
  if (baseline.environment.renderer !== candidate.environment.renderer) {
    return {
      rejected: true,
      reasonCode: 'RENDERER_MISMATCH',
      message: `Renderer mismatch: baseline is '${baseline.environment.renderer}', but candidate is '${candidate.environment.renderer}'`,
    };
  }

  // 12. Reject if GPU vendor differs
  if (baseline.environment.gpuVendor !== candidate.environment.gpuVendor) {
    return {
      rejected: true,
      reasonCode: 'GPU_VENDOR_MISMATCH',
      message: `GPU vendor mismatch: baseline '${baseline.environment.gpuVendor}' != candidate '${candidate.environment.gpuVendor}'`,
    };
  }

  // 13. Reject if GPU renderer differs
  if (baseline.environment.gpuRenderer !== candidate.environment.gpuRenderer) {
    return {
      rejected: true,
      reasonCode: 'GPU_RENDERER_MISMATCH',
      message: `GPU renderer mismatch: baseline '${baseline.environment.gpuRenderer}' != candidate '${candidate.environment.gpuRenderer}'`,
    };
  }

  // 14. Reject if build mode differs
  if (baseline.environment.buildMode !== candidate.environment.buildMode) {
    return {
      rejected: true,
      reasonCode: 'BUILD_MODE_MISMATCH',
      message: `Build mode mismatch: baseline is '${baseline.environment.buildMode}', candidate is '${candidate.environment.buildMode}'`,
    };
  }

  // 15. Reject if target FPS differs
  if (baseline.environment.targetFps !== candidate.environment.targetFps) {
    return {
      rejected: true,
      reasonCode: 'TARGET_FPS_MISMATCH',
      message: `Target FPS mismatch: baseline ${baseline.environment.targetFps} != candidate ${candidate.environment.targetFps}`,
    };
  }

  // 16. Reject if scenario duration differs
  const baseDurationSec = baseline.metrics.sampleDurationMs / 1000;
  const candDurationSec = candidate.metrics.sampleDurationMs / 1000;
  if (Math.abs(baseDurationSec - candDurationSec) > maxDurationDiff) {
    return {
      rejected: true,
      reasonCode: 'DURATION_MISMATCH',
      message: `Duration difference (${Math.abs(baseDurationSec - candDurationSec).toFixed(2)}s) exceeds tolerance of ${maxDurationDiff}s`,
    };
  }

  // 17. Reject if warm-up duration differs
  if (baseline.scenario.warmupDurationSeconds !== candidate.scenario.warmupDurationSeconds) {
    return {
      rejected: true,
      reasonCode: 'WARMUP_DURATION_MISMATCH',
      message: `Warmup duration mismatch: baseline ${baseline.scenario.warmupDurationSeconds}s != candidate ${candidate.scenario.warmupDurationSeconds}s`,
    };
  }

  // 18. Reject if browser version differs
  if (baseline.environment.browserVersion !== candidate.environment.browserVersion) {
    return {
      rejected: true,
      reasonCode: 'BROWSER_VERSION_MISMATCH',
      message: `Browser version mismatch: baseline '${baseline.environment.browserVersion}' != candidate '${candidate.environment.browserVersion}'`,
    };
  }

  // 18. Reject if host type differs
  if (baseline.environment.host !== candidate.environment.host) {
    return {
      rejected: true,
      reasonCode: 'HOST_TYPE_MISMATCH',
      message: `Host type mismatch: baseline '${baseline.environment.host}' != candidate '${candidate.environment.host}'`,
    };
  }

  // 19. Reject if physical device flag differs
  if (baseline.environment.isPhysicalDevice !== candidate.environment.isPhysicalDevice) {
    return {
      rejected: true,
      reasonCode: 'PHYSICAL_DEVICE_FLAG_MISMATCH',
      message: `Physical device flag mismatch: baseline ${baseline.environment.isPhysicalDevice} != candidate ${candidate.environment.isPhysicalDevice}`,
    };
  }

  // 20. Reject if army counts differ beyond documented tolerance
  const baseArmyAvg = baseline.metrics.steadyStateArmyCounts?.avg ?? baseline.metrics.armyCounts.avg;
  const candArmyAvg = candidate.metrics.steadyStateArmyCounts?.avg ?? candidate.metrics.armyCounts.avg;

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
    avgArmyCount: calculateMetricDelta(baseline.metrics.armyCounts.avg, candidate.metrics.armyCounts.avg, true),
    steadyStateAvgArmyCount: calculateMetricDelta(baseArmyAvg, candArmyAvg, true),
    peakObjects: calculateMetricDelta(baseline.metrics.peakObjects, candidate.metrics.peakObjects, false),
    drawCallsPerFrame,
  };
}

