import { describe, expect, it } from 'vitest';
import { calculateSampleStats, aggregateBenchmarkRuns, formatAggregateMarkdown } from '../BenchmarkAggregator.js';
import type { BenchmarkReport } from '../BenchmarkTypes.js';

function createMockReport(id: string, presentedFps: number, p95Ms: number, avgArmies: number): BenchmarkReport {
  return {
    id,
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
    metrics: {
      presentedFps,
      renderedFps: presentedFps,
      simulationTicks: Math.round(presentedFps * 30),
      simulationFps: presentedFps,
      phaserUpdateDelta: { avgMs: 16.7, p50Ms: 16.0, p95Ms, p99Ms: 25.0, maxMs: 45.0 },
      framesOver16Ms: 250,
      framesOver16Pct: 15.0,
      framesOver33Ms: 2,
      framesOver33Pct: 0.1,
      longTasks: { count: 1, totalDurationMs: 50, maxDurationMs: 50 },
      armyCounts: { min: 5, max: 9, avg: avgArmies, peak: 9 },
      warmupArmySamples: [2, 4],
      steadyStateArmySamples: [7, 8, 7],
      steadyStateArmyCounts: { min: 6, max: 8, avg: avgArmies, peak: 8 },
      peakObjects: 100,
      peakTweens: 20,
      memoryMb: { start: 25, peak: 32 },
      drawCalls: { total: 3000, avgPerFrame: 50.0 },
      sampleDurationMs: 30000,
      activeSampleDurationMs: 30000,
      backgroundDurationMs: 0,
      lifecycleTransitions: [],
      totalRenderedFrames: Math.round(presentedFps * 30),
      duplicateFramesDropped: 0,
    },
    verification: {
      passed: true,
      failures: [],
    },
  };
}

describe('BenchmarkAggregator', () => {
  it('calculateSampleStats correctly computes mean, min, max, sample stdDev, and CV', () => {
    // Known distribution: [59.9, 60.0, 59.9]
    // mean = 59.9333... -> 59.93
    // diffs: -0.0333, +0.0667, -0.0333
    // sum of sq diffs = 0.00111 + 0.00444 + 0.00111 = 0.00667
    // sample variance = 0.00667 / 2 = 0.00333
    // stdDev = sqrt(0.00333) = 0.0577 -> 0.06
    // cv = (0.0577 / 59.933) * 100 = 0.096% -> 0.1%
    const stats = calculateSampleStats([59.9, 60.0, 59.9], 5.0);

    expect(stats.mean).toBe(59.93);
    expect(stats.min).toBe(59.9);
    expect(stats.max).toBe(60.0);
    expect(stats.stdDev).toBeCloseTo(0.06, 2);
    expect(stats.cvPercent).toBeLessThan(1.0);
    expect(stats.passedThreshold).toBe(true);
    expect(stats.unstable).toBe(false);
  });

  it('calculateSampleStats flags metric as unstable when CV exceeds threshold', () => {
    // High variance: [50, 70]
    // mean = 60, stdDev = 14.14, cv = 23.57%
    const stats = calculateSampleStats([50, 70], 5.0);

    expect(stats.mean).toBe(60);
    expect(stats.cvPercent).toBeGreaterThan(5.0);
    expect(stats.passedThreshold).toBe(false);
    expect(stats.unstable).toBe(true);
  });

  it('aggregateBenchmarkRuns computes complete report across 3 runs and formats markdown', () => {
    const r1 = createMockReport('run1', 59.9, 22.7, 7.1);
    const r2 = createMockReport('run2', 60.0, 22.7, 7.1);
    const r3 = createMockReport('run3', 59.9, 22.7, 7.2);

    const agg = aggregateBenchmarkRuns([r1, r2, r3]);

    expect(agg.scenarioName).toBe('normal_combat');
    expect(agg.runCount).toBe(3);
    expect(agg.runsPassedVerification).toBe(true);
    expect(agg.overallPassed).toBe(true);
    expect(agg.metrics.presentedFps.cvPercent).toBeLessThan(1.0);
    expect(agg.metrics.p95FrameTimeMs.cvPercent).toBe(0);
    expect(agg.metrics.steadyStateAvgArmies.cvPercent).toBeLessThan(2.0);

    const md = formatAggregateMarkdown(agg);
    expect(md).toContain('Benchmark Multi-Run Aggregation Report: normal_combat');
    expect(md).toContain('PASSED (STABLE)');
    expect(md).toContain('Presented FPS');
  });

  it('aggregateBenchmarkRuns marks overallPassed as false if any run failed verification', () => {
    const r1 = createMockReport('run1', 59.9, 22.7, 7.1);
    const r2 = createMockReport('run2', 60.0, 22.7, 7.1);
    r2.verification.passed = false;
    r2.verification.failures = ['Some check failed'];
    const r3 = createMockReport('run3', 59.9, 22.7, 7.2);

    const agg = aggregateBenchmarkRuns([r1, r2, r3]);
    expect(agg.runsPassedVerification).toBe(false);
    expect(agg.overallPassed).toBe(false);
  });
});
