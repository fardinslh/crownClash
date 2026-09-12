import { describe, expect, it } from 'vitest';
import { compareBenchmarks } from '../BenchmarkComparator.js';
import type { BenchmarkReport } from '../BenchmarkTypes.js';

function createMockReport(overrides: Partial<BenchmarkReport> = {}): BenchmarkReport {
  const base: BenchmarkReport = {
    id: 'rep_1',
    timestamp: '2026-09-12T18:00:00Z',
    environment: {
      host: 'Browser Emulation (Headless Chrome on Windows)',
      isPhysicalDevice: false,
      renderer: 'WebGL',
      gpuVendor: 'Google Inc. (NVIDIA)',
      gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti Direct3D11)',
      isSoftwareRenderer: false,
      browserVersion: 'Chrome/130.0.0.0',
      viewport: { width: 375, height: 667, dpr: 2 },
      cpuThrottling: 4,
      network: 'LAN',
      buildMode: 'production',
      targetFps: 60,
    },
    scenario: {
      name: 'normal_combat',
      durationSeconds: 60,
      warmupDurationSeconds: 4.0,
      seed: 12345,
      scheduleHash: 'a1b2c3d4',
      targetArmyRange: { min: 5, max: 10 },
      description: 'Deterministic 5-10 army combat',
    },
    metrics: {
      presentedFps: 58.5,
      renderedFps: 58.5,
      simulationTicks: 3600,
      simulationFps: 60,
      phaserUpdateDelta: { avgMs: 17.1, p50Ms: 16.7, p95Ms: 22.4, p99Ms: 31.0, maxMs: 45.0 },
      framesOver16Ms: 250,
      framesOver16Pct: 7.1,
      framesOver33Ms: 12,
      framesOver33Pct: 0.3,
      longTasks: { count: 1, totalDurationMs: 52, maxDurationMs: 52 },
      armyCounts: { min: 5, max: 9, avg: 7.0, peak: 9 },
      warmupArmySamples: [2, 4, 6],
      steadyStateArmySamples: [6, 7, 8, 7, 7, 8],
      steadyStateArmyCounts: { min: 6, max: 8, avg: 7.2, peak: 8 },
      peakObjects: 180,
      peakTweens: 20,
      memoryMb: { start: 25, peak: 32 },
      drawCalls: { total: 3000, avgPerFrame: 51.2 },
      sampleDurationMs: 60000,
      activeSampleDurationMs: 60000,
      backgroundDurationMs: 0,
      lifecycleTransitions: [],
      totalRenderedFrames: 3510,
      duplicateFramesDropped: 0,
    },
    verification: {
      passed: true,
      failures: [],
    },
  };

  return {
    ...base,
    ...overrides,
    environment: { ...base.environment, ...overrides.environment },
    scenario: { ...base.scenario, ...overrides.scenario },
    metrics: { ...base.metrics, ...overrides.metrics },
    verification: { ...base.verification, ...overrides.verification },
  };
}

describe('BenchmarkComparator', () => {
  it('successfully compares two valid reports and computes metric deltas', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({
      id: 'rep_2',
      metrics: {
        ...baseline.metrics,
        presentedFps: 59.8,
        renderedFps: 59.8,
        phaserUpdateDelta: { ...baseline.metrics.phaserUpdateDelta, p95Ms: 18.2 },
        framesOver33Pct: 0.1,
        drawCalls: { total: 2400, avgPerFrame: 41.0 },
      },
    });

    const result = compareBenchmarks(baseline, candidate);

    expect(result.rejected).toBe(false);
    if (!result.rejected) {
      expect(result.presentedFps.baseline).toBe(58.5);
      expect(result.presentedFps.candidate).toBe(59.8);
      expect(result.presentedFps.improved).toBe(true);
      expect(result.p95FrameTimeMs.baseline).toBe(22.4);
      expect(result.p95FrameTimeMs.candidate).toBe(18.2);
      expect(result.p95FrameTimeMs.improved).toBe(true);
      expect(result.drawCallsPerFrame?.improved).toBe(true);
    }
  });

  it('rejects comparison when software WebGL is detected', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({
      environment: { ...baseline.environment, isSoftwareRenderer: true, gpuRenderer: 'Google SwiftShader' },
    });
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.reasonCode).toBe('SOFTWARE_WEBGL_DETECTED');
    }
  });

  it('rejects comparison when scenario name mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ scenario: { ...baseline.scenario, name: 'heavy_combat' } });
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('SCENARIO_NAME_MISMATCH');
  });

  it('rejects comparison when seed mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ scenario: { ...baseline.scenario, seed: 99999 } });
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('SEED_MISMATCH');
  });

  it('rejects comparison when schedule hash mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ scenario: { ...baseline.scenario, scheduleHash: 'different_hash' } });
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('SCHEDULE_HASH_MISMATCH');
  });

  it('rejects comparison when CPU throttle mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ environment: { ...baseline.environment, cpuThrottling: 1 } });
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('CPU_THROTTLE_MISMATCH');
  });

  it('rejects comparison when network profile mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ environment: { ...baseline.environment, network: 'Slow 4G' } });
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('NETWORK_PROFILE_MISMATCH');
  });

  it('rejects comparison when viewport width/height mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ environment: { ...baseline.environment, viewport: { width: 430, height: 932, dpr: 2 } } });
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('VIEWPORT_MISMATCH');
  });

  it('rejects comparison when DPR mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ environment: { ...baseline.environment, viewport: { width: 375, height: 667, dpr: 3 } } });
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('DPR_MISMATCH');
  });

  it('rejects comparison when renderer mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ environment: { ...baseline.environment, renderer: 'Canvas' } });
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('RENDERER_MISMATCH');
  });

  it('rejects comparison when GPU vendor mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ environment: { ...baseline.environment, gpuVendor: 'Apple Inc.' } });
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('GPU_VENDOR_MISMATCH');
  });

  it('rejects comparison when GPU renderer mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ environment: { ...baseline.environment, gpuRenderer: 'ANGLE (AMD Radeon)' } });
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('GPU_RENDERER_MISMATCH');
  });

  it('rejects comparison when build mode mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ environment: { ...baseline.environment, buildMode: 'development' } });
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('BUILD_MODE_MISMATCH');
  });

  it('rejects comparison when target FPS mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ environment: { ...baseline.environment, targetFps: 120 } });
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('TARGET_FPS_MISMATCH');
  });

  it('rejects comparison when scenario duration difference exceeds 1s tolerance', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ metrics: { ...baseline.metrics, sampleDurationMs: 65000 } });
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('DURATION_MISMATCH');
  });

  it('rejects comparison when warmup duration mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ scenario: { ...baseline.scenario, warmupDurationSeconds: 8.0 } });
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('WARMUP_DURATION_MISMATCH');
  });

  it('rejects comparison when browser version mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ environment: { ...baseline.environment, browserVersion: 'Chrome/131.0.0.0' } });
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('BROWSER_VERSION_MISMATCH');
  });

  it('rejects comparison when host type mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ environment: { ...baseline.environment, host: 'Physical Device (Pixel 7)' } });
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('HOST_TYPE_MISMATCH');
  });

  it('rejects comparison when physical device flag mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ environment: { ...baseline.environment, isPhysicalDevice: true } });
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('PHYSICAL_DEVICE_FLAG_MISMATCH');
  });

  it('rejects comparison when army count variance exceeds tolerance', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({
      metrics: {
        ...baseline.metrics,
        steadyStateArmyCounts: { min: 2, max: 3, avg: 2.5, peak: 3 },
      },
    });
    const result = compareBenchmarks(baseline, candidate, { maxArmyVarianceRatio: 0.25 });
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('ARMY_COUNT_VARIANCE_EXCEEDED');
  });

  it('rejects comparison when either sample failed internal verification', () => {
    const baseline = createMockReport({
      verification: { passed: false, failures: ['Renderer mismatch'] },
    });
    const candidate = createMockReport();
    const result = compareBenchmarks(baseline, candidate);
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.reasonCode).toBe('UNVERIFIED_SAMPLE');
  });
});

