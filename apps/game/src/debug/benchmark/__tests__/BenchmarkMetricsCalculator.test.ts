import { describe, expect, it } from 'vitest';
import {
  calculatePercentiles,
  computeBenchmarkMetrics,
  processAndDeduplicateFrames,
  verifyPrerequisites,
  type RawBenchmarkSampleInput,
} from '../BenchmarkMetricsCalculator.js';
import type { BenchmarkPrerequisites } from '../BenchmarkTypes.js';

describe('BenchmarkMetricsCalculator', () => {
  describe('calculatePercentiles', () => {
    it('calculates correct percentiles and averages for known sample distribution', () => {
      // 100 samples from 1 to 100
      const samples = Array.from({ length: 100 }, (_, i) => i + 1);
      const res = calculatePercentiles(samples);

      expect(res.avgMs).toBe(50.5);
      expect(res.p50Ms).toBe(50);
      expect(res.p95Ms).toBe(95);
      expect(res.p99Ms).toBe(99);
      expect(res.maxMs).toBe(100);
    });

    it('handles empty input gracefully', () => {
      const res = calculatePercentiles([]);
      expect(res.avgMs).toBe(0);
      expect(res.p50Ms).toBe(0);
      expect(res.maxMs).toBe(0);
    });
  });

  describe('processAndDeduplicateFrames', () => {
    it('detects and drops duplicate frame callbacks with identical timestamps', () => {
      const rawFrames = [
        { timestampMs: 1000, deltaMs: 16.6 },
        { timestampMs: 1000, deltaMs: 0 }, // Duplicate callback in same RAF
        { timestampMs: 1016.6, deltaMs: 16.6 },
        { timestampMs: 1033.2, deltaMs: 16.6 },
        { timestampMs: 1033.2, deltaMs: 0 }, // Another duplicate callback
        { timestampMs: 1050.0, deltaMs: 16.8 },
      ];

      const { validDeltas, duplicateCount } = processAndDeduplicateFrames(rawFrames);

      expect(duplicateCount).toBe(2);
      expect(validDeltas).toEqual([16.6, 16.6, 16.6, 16.8]);
    });
  });

  describe('computeBenchmarkMetrics', () => {
    it('separates presented FPS (clamped to target bound) from raw unthrottled rendered FPS', () => {
      // Emulate headless canvas firing 150 times per second
      const frameCount = 150;
      const durationMs = 1000;
      const rawFrames = Array.from({ length: frameCount }, (_, i) => ({
        timestampMs: 1000 + i * 6.66,
        deltaMs: 6.66,
      }));

      const input: RawBenchmarkSampleInput = {
        sampleDurationMs: durationMs,
        renderFrames: rawFrames,
        simulationTicks: 60, // exactly 60 simulation steps
        longTasks: [],
        armyCountSamples: [5, 6, 7],
        peakObjects: 100,
        peakTweens: 10,
        memoryMb: { start: 20, peak: 25 },
        totalDrawCalls: 300,
      };

      const metrics = computeBenchmarkMetrics(input, 60);

      // Raw render count is 150 FPS
      expect(metrics.renderedFps).toBe(150);
      // Authoritative presented FPS MUST be bounded by targetFps (60)
      expect(metrics.presentedFps).toBe(60);
      // Simulation ticks rate is 60 FPS
      expect(metrics.simulationFps).toBe(60);
      expect(metrics.simulationTicks).toBe(60);
      expect(metrics.drawCalls?.avgPerFrame).toBe(2);
      expect(metrics.duplicateFramesDropped).toBe(0);
    });

    it('aggregates threshold violations and long tasks', () => {
      const input: RawBenchmarkSampleInput = {
        sampleDurationMs: 1000,
        renderFrames: [
          { timestampMs: 100, deltaMs: 10 },
          { timestampMs: 120, deltaMs: 20 }, // > 16.7
          { timestampMs: 160, deltaMs: 40 }, // > 33.3 and > 16.7
          { timestampMs: 200, deltaMs: 40 }, // > 33.3 and > 16.7
        ],
        simulationTicks: 4,
        longTasks: [
          { duration: 55.4 },
          { duration: 82.1 },
        ],
        armyCountSamples: [8, 9, 8],
        peakObjects: 50,
        peakTweens: 5,
        memoryMb: { start: 10, peak: 15 },
        totalDrawCalls: 80,
      };

      const metrics = computeBenchmarkMetrics(input, 60);

      expect(metrics.framesOver16Ms).toBe(3);
      expect(metrics.framesOver16Pct).toBe(75);
      expect(metrics.framesOver33Ms).toBe(2);
      expect(metrics.framesOver33Pct).toBe(50);
      expect(metrics.longTasks.count).toBe(2);
      expect(metrics.longTasks.maxDurationMs).toBe(82.1);
      expect(metrics.longTasks.totalDurationMs).toBe(137.5);
    });
  });

  describe('verifyPrerequisites', () => {
    const standardPrereqs: BenchmarkPrerequisites = {
      expectedRenderer: 'WebGL',
      expectedViewport: { width: 375, height: 667, dpr: 2 },
      expectedBuildMode: 'production',
      expectedDurationSeconds: 60,
      targetArmyRange: { min: 5, max: 10 },
    };

    const makeMetrics = (overrides: Partial<ReturnType<typeof computeBenchmarkMetrics>> = {}) => ({
      presentedFps: 60,
      renderedFps: 60,
      simulationTicks: 3600,
      simulationFps: 60,
      phaserUpdateDelta: { avgMs: 16.6, p50Ms: 16.6, p95Ms: 16.7, p99Ms: 16.8, maxMs: 17.0 },
      framesOver16Ms: 0,
      framesOver16Pct: 0,
      framesOver33Ms: 0,
      framesOver33Pct: 0,
      longTasks: { count: 0, totalDurationMs: 0, maxDurationMs: 0 },
      armyCounts: { min: 5, max: 9, avg: 7.2, peak: 9 },
      peakObjects: 150,
      peakTweens: 15,
      memoryMb: { start: 20, peak: 30 },
      drawCalls: { total: 3000, avgPerFrame: 50 },
      sampleDurationMs: 60000,
      totalRenderedFrames: 3600,
      duplicateFramesDropped: 0,
      ...overrides,
    });

    it('passes when all environment, duration, and army parameters match', () => {
      const res = verifyPrerequisites(
        makeMetrics(),
        {
          renderer: 'WebGL',
          viewport: { width: 375, height: 667, dpr: 2 },
          buildMode: 'production',
        },
        standardPrereqs
      );

      expect(res.passed).toBe(true);
      expect(res.failures).toHaveLength(0);
    });

    it('fails when renderer mismatches', () => {
      const res = verifyPrerequisites(
        makeMetrics(),
        {
          renderer: 'Canvas', // Wrong renderer!
          viewport: { width: 375, height: 667, dpr: 2 },
          buildMode: 'production',
        },
        standardPrereqs
      );

      expect(res.passed).toBe(false);
      expect(res.failures).toContain("Renderer mismatch: actual 'Canvas' != expected 'WebGL'");
    });

    it('fails when army count range is not reached', () => {
      const res = verifyPrerequisites(
        makeMetrics({
          armyCounts: { min: 0, max: 2, avg: 1.1, peak: 2 }, // peak 2 < expected min 5
        }),
        {
          renderer: 'WebGL',
          viewport: { width: 375, height: 667, dpr: 2 },
          buildMode: 'production',
        },
        standardPrereqs
      );

      expect(res.passed).toBe(false);
      expect(res.failures[0]).toContain('Army count violation: peak army count 2 did not reach expected minimum 5');
    });

    it('fails when duration differs beyond tolerance', () => {
      const res = verifyPrerequisites(
        makeMetrics({ sampleDurationMs: 50000 }), // 50s vs 60s
        {
          renderer: 'WebGL',
          viewport: { width: 375, height: 667, dpr: 2 },
          buildMode: 'production',
        },
        standardPrereqs
      );

      expect(res.passed).toBe(false);
      expect(res.failures[0]).toContain('Duration mismatch');
    });
  });
});
