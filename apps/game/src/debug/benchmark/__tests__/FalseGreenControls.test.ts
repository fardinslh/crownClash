import { describe, expect, it } from 'vitest';
import { verifyPrerequisites } from '../BenchmarkMetricsCalculator.js';
import { compareBenchmarks } from '../BenchmarkComparator.js';
import type { BenchmarkMetrics, BenchmarkPrerequisites, BenchmarkReport } from '../BenchmarkTypes.js';

function createMockValidMetrics(overrides: Partial<BenchmarkMetrics> = {}): BenchmarkMetrics {
  return {
    presentedFps: 59.5,
    renderedFps: 59.5,
    simulationTicks: 1800,
    simulationFps: 60,
    phaserUpdateDelta: { avgMs: 16.8, p50Ms: 16.5, p95Ms: 22.0, p99Ms: 25.0, maxMs: 40.0 },
    framesOver16Ms: 200,
    framesOver16Pct: 11.1,
    framesOver33Ms: 2,
    framesOver33Pct: 0.1,
    longTasks: { count: 0, totalDurationMs: 0, maxDurationMs: 0 },
    armyCounts: { min: 5, max: 9, avg: 7.2, peak: 9 },
    warmupArmySamples: [2, 4],
    steadyStateArmySamples: [6, 7, 8, 7],
    steadyStateArmyCounts: { min: 6, max: 8, avg: 7.0, peak: 8 },
    peakObjects: 100,
    peakTweens: 20,
    memoryMb: { start: 20, peak: 25 },
    drawCalls: { total: 2000, avgPerFrame: 50 },
    sampleDurationMs: 30000,
    activeSampleDurationMs: 30000,
    backgroundDurationMs: 0,
    lifecycleTransitions: [],
    totalRenderedFrames: 1785,
    duplicateFramesDropped: 0,
    ...overrides,
  };
}

const validPrerequisites: BenchmarkPrerequisites = {
  expectedRenderer: 'WebGL',
  expectedViewport: { width: 375, height: 667, dpr: 2 },
  expectedBuildMode: 'production',
  expectedDurationSeconds: 30,
  targetArmyRange: { min: 5, max: 10 },
  targetFps: 60,
};

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
      durationSeconds: 30,
      warmupDurationSeconds: 4.0,
      seed: 12345,
      scheduleHash: 'a1b2c3d4',
      targetArmyRange: { min: 5, max: 10 },
      description: 'Deterministic 5-10 army combat',
    },
    metrics: createMockValidMetrics(),
    verification: { passed: true, failures: [] },
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

describe('False-Green Negative Control Suite', () => {
  it('NEGATIVE CONTROL 1: software WebGL detected fails verification', () => {
    const metrics = createMockValidMetrics();
    const result = verifyPrerequisites(
      metrics,
      {
        renderer: 'WebGL',
        gpuRenderer: 'Google SwiftShader',
        isSoftwareRenderer: true,
        viewport: { width: 375, height: 667, dpr: 2 },
        buildMode: 'production',
      },
      validPrerequisites
    );

    expect(result.passed).toBe(false);
    expect(result.failures).toContainEqual(expect.stringContaining('SOFTWARE_WEBGL_DETECTED'));
  });

  it('NEGATIVE CONTROL 2: army count 11 against max 10 fails verification', () => {
    const metrics = createMockValidMetrics({
      steadyStateArmySamples: [6, 7, 11, 8],
      steadyStateArmyCounts: { min: 6, max: 11, avg: 8.0, peak: 11 },
    });
    const result = verifyPrerequisites(
      metrics,
      {
        renderer: 'WebGL',
        isSoftwareRenderer: false,
        viewport: { width: 375, height: 667, dpr: 2 },
        buildMode: 'production',
      },
      validPrerequisites
    );

    expect(result.passed).toBe(false);
    expect(result.failures).toContainEqual(expect.stringContaining('ARMY_COUNT_OUT_OF_STEADY_STATE_BOUNDS'));
  });

  it('NEGATIVE CONTROL 3: seed mismatch rejects comparison', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ scenario: { ...baseline.scenario, seed: 99999 } });
    const result = compareBenchmarks(baseline, candidate);

    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.reasonCode).toBe('SEED_MISMATCH');
    }
  });

  it('NEGATIVE CONTROL 4: CPU throttle mismatch rejects comparison', () => {
    const baseline = createMockReport({ environment: { ...createMockReport().environment, cpuThrottling: 1 } });
    const candidate = createMockReport({ environment: { ...createMockReport().environment, cpuThrottling: 4 } });
    const result = compareBenchmarks(baseline, candidate);

    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.reasonCode).toBe('CPU_THROTTLE_MISMATCH');
    }
  });

  it('NEGATIVE CONTROL 5: network profile mismatch rejects comparison', () => {
    const baseline = createMockReport({ environment: { ...createMockReport().environment, network: 'LAN' } });
    const candidate = createMockReport({ environment: { ...createMockReport().environment, network: 'Slow 4G' } });
    const result = compareBenchmarks(baseline, candidate);

    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.reasonCode).toBe('NETWORK_PROFILE_MISMATCH');
    }
  });

  it('NEGATIVE CONTROL 6: scenario name mismatch rejects comparison', () => {
    const baseline = createMockReport({ scenario: { ...createMockReport().scenario, name: 'normal_combat' } });
    const candidate = createMockReport({ scenario: { ...createMockReport().scenario, name: 'heavy_combat' } });
    const result = compareBenchmarks(baseline, candidate);

    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.reasonCode).toBe('SCENARIO_NAME_MISMATCH');
    }
  });

  it('NEGATIVE CONTROL 7: duplicate postrender frames fail verification', () => {
    const metrics = createMockValidMetrics({ duplicateFramesDropped: 5 });
    const result = verifyPrerequisites(
      metrics,
      {
        renderer: 'WebGL',
        isSoftwareRenderer: false,
        viewport: { width: 375, height: 667, dpr: 2 },
        buildMode: 'production',
      },
      validPrerequisites
    );

    expect(result.passed).toBe(false);
    expect(result.failures).toContainEqual(expect.stringContaining('POSTRENDER_DUPLICATE_DETECTED'));
  });

  it('NEGATIVE CONTROL 8: missing active/resumed lifecycle transition in background_resume fails verification', () => {
    const metrics = createMockValidMetrics({
      backgroundDurationMs: 10000,
      lifecycleTransitions: [{ event: 'visibilitychange', state: 'hidden', timestampMs: 5000 }],
    });
    const result = verifyPrerequisites(
      metrics,
      {
        renderer: 'WebGL',
        isSoftwareRenderer: false,
        viewport: { width: 375, height: 667, dpr: 2 },
        buildMode: 'production',
      },
      validPrerequisites
    );

    expect(result.passed).toBe(false);
    expect(result.failures).toContainEqual(expect.stringContaining('INVALID_BACKGROUND_TRANSITION'));
  });

  it('NEGATIVE CONTROL 9: missing comparison identity (empty scheduleHash) rejects comparison', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({ scenario: { ...baseline.scenario, scheduleHash: '' } });
    const result = compareBenchmarks(baseline, candidate);

    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.reasonCode).toBe('MISSING_COMPARISON_IDENTITY');
    }
  });

  it('NEGATIVE CONTROL 10: injected synthetic long task fails verification with EXPECTED_NO_LONG_TASKS', () => {
    const metricsWithLongTask = createMockValidMetrics({
      longTasks: { count: 1, totalDurationMs: 91, maxDurationMs: 91 },
    });
    const result = verifyPrerequisites(
      metricsWithLongTask,
      {
        renderer: 'WebGL',
        isSoftwareRenderer: false,
        viewport: { width: 375, height: 667, dpr: 2 },
        buildMode: 'production',
      },
      {
        ...validPrerequisites,
        maxAllowedLongTasks: 0,
      }
    );

    expect(result.passed).toBe(false);
    expect(result.failures).toContainEqual(expect.stringContaining('EXPECTED_NO_LONG_TASKS'));
    expect(result.failures[0]).toContain('observed 1 long tasks >50ms (total 91ms, max 91ms), exceeding allowed threshold of 0');
  });

  it('POSITIVE CONTROL 11: clean run with 0 long tasks passes verification with failures = []', () => {
    const cleanMetrics = createMockValidMetrics({
      longTasks: { count: 0, totalDurationMs: 0, maxDurationMs: 0 },
    });
    const result = verifyPrerequisites(
      cleanMetrics,
      {
        renderer: 'WebGL',
        isSoftwareRenderer: false,
        viewport: { width: 375, height: 667, dpr: 2 },
        buildMode: 'production',
      },
      {
        ...validPrerequisites,
        maxAllowedLongTasks: 0,
      }
    );

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });
});
