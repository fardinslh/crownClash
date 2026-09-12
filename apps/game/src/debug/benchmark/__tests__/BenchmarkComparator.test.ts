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
      viewport: { width: 375, height: 667, dpr: 2 },
      cpuThrottling: 4,
      network: 'LAN',
      buildMode: 'production',
      targetFps: 60,
    },
    scenario: {
      name: 'normal_combat',
      durationSeconds: 60,
      seed: 12345,
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
      peakObjects: 180,
      peakTweens: 20,
      memoryMb: { start: 25, peak: 32 },
      drawCalls: { total: 3000, avgPerFrame: 51.2 },
      sampleDurationMs: 60000,
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
      expect(result.p95FrameTimeMs.improved).toBe(true); // lower frame time is better
      expect(result.drawCallsPerFrame?.improved).toBe(true); // lower draw calls is better
    }
  });

  it('rejects comparison when renderer mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({
      environment: {
        ...baseline.environment,
        renderer: 'Canvas', // mismatch!
      },
    });

    const result = compareBenchmarks(baseline, candidate);

    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.reasonCode).toBe('RENDERER_MISMATCH');
      expect(result.message).toContain("Renderer mismatch: baseline is 'WebGL', but candidate is 'Canvas'");
    }
  });

  it('rejects comparison when viewport or DPR mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({
      environment: {
        ...baseline.environment,
        viewport: { width: 430, height: 932, dpr: 3 }, // mismatch!
      },
    });

    const result = compareBenchmarks(baseline, candidate);

    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.reasonCode).toBe('VIEWPORT_MISMATCH');
      expect(result.message).toContain('Viewport/DPR mismatch');
    }
  });

  it('rejects comparison when build mode mismatches', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({
      environment: {
        ...baseline.environment,
        buildMode: 'development',
      },
    });

    const result = compareBenchmarks(baseline, candidate);

    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.reasonCode).toBe('BUILD_MODE_MISMATCH');
    }
  });

  it('rejects comparison when scenario duration difference exceeds 1s tolerance', () => {
    const baseline = createMockReport();
    const candidate = createMockReport({
      metrics: {
        ...baseline.metrics,
        sampleDurationMs: 65000, // 65s vs 60s
      },
    });

    const result = compareBenchmarks(baseline, candidate);

    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.reasonCode).toBe('DURATION_MISMATCH');
      expect(result.message).toContain('Duration difference (5.00s) exceeds tolerance of 1s');
    }
  });

  it('rejects comparison when army count variance exceeds tolerance', () => {
    const baseline = createMockReport({
      metrics: {
        ...createMockReport().metrics,
        armyCounts: { min: 5, max: 9, avg: 7.0, peak: 9 },
      },
    });
    const candidate = createMockReport({
      metrics: {
        ...baseline.metrics,
        armyCounts: { min: 1, max: 3, avg: 2.0, peak: 3 }, // 2.0 vs 7.0 -> variance > 70%
      },
    });

    const result = compareBenchmarks(baseline, candidate, { maxArmyVarianceRatio: 0.25 });

    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.reasonCode).toBe('ARMY_COUNT_VARIANCE_EXCEEDED');
      expect(result.message).toContain('Army count variance ratio');
    }
  });

  it('rejects comparison when either sample failed internal verification', () => {
    const baseline = createMockReport({
      verification: {
        passed: false,
        failures: ['Renderer mismatch'],
      },
    });
    const candidate = createMockReport();

    const result = compareBenchmarks(baseline, candidate);

    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.reasonCode).toBe('UNVERIFIED_SAMPLE');
    }
  });
});
