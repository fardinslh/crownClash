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
    it('computes true unclamped presented FPS and separates steady-state army distribution', () => {
      const frameCount = 60;
      const durationMs = 1000;
      const rawFrames = Array.from({ length: frameCount }, (_, i) => ({
        timestampMs: 1000 + i * 16.66,
        deltaMs: 16.66,
      }));

      const input: RawBenchmarkSampleInput = {
        sampleDurationMs: durationMs,
        renderFrames: rawFrames,
        simulationTicks: 60,
        longTasks: [],
        armySamples: [
          { timestampMs: 1000, count: 2 }, // warmup (0s)
          { timestampMs: 2000, count: 4 }, // warmup (1s)
          { timestampMs: 5100, count: 7 }, // steady-state (4.1s >= 4.0s)
          { timestampMs: 6100, count: 8 }, // steady-state (5.1s >= 4.0s)
        ],
        peakObjects: 100,
        peakTweens: 10,
        memoryMb: { start: 20, peak: 25 },
        totalDrawCalls: 300,
      };

      const metrics = computeBenchmarkMetrics(input, 60, 4.0);

      expect(metrics.presentedFps).toBe(60);
      expect(metrics.renderedFps).toBe(60);
      expect(metrics.simulationFps).toBe(60);
      expect(metrics.warmupArmySamples).toEqual([2, 4]);
      expect(metrics.steadyStateArmySamples).toEqual([7, 8]);
      expect(metrics.steadyStateArmyCounts.min).toBe(7);
      expect(metrics.steadyStateArmyCounts.max).toBe(8);
      expect(metrics.steadyStateArmyCounts.avg).toBe(7.5);
      expect(metrics.duplicateFramesDropped).toBe(0);
    });

    it('excludes background interval from active presented FPS calculation', () => {
      // 45s total scenario: 35s active, 10s background, 2100 frames
      const totalFrames = 2100;
      const rawFrames = Array.from({ length: totalFrames }, (_, i) => ({
        timestampMs: 1000 + i * 16.66,
        deltaMs: 16.66,
      }));

      const input: RawBenchmarkSampleInput = {
        sampleDurationMs: 45000,
        backgroundDurationMs: 10000,
        renderFrames: rawFrames,
        simulationTicks: 2100,
        longTasks: [],
        armyCountSamples: [7, 7, 7],
        peakObjects: 100,
        peakTweens: 10,
        memoryMb: { start: 20, peak: 25 },
        totalDrawCalls: 10000,
      };

      const metrics = computeBenchmarkMetrics(input, 60, 4.0);

      // Raw rendered FPS over 45s is ~46.7 FPS
      expect(metrics.renderedFps).toBe(46.7);
      // Active presented FPS over 35s is 60 FPS
      expect(metrics.presentedFps).toBe(60);
      expect(metrics.activeSampleDurationMs).toBe(35000);
      expect(metrics.backgroundDurationMs).toBe(10000);
    });
  });

  describe('verifyPrerequisites', () => {
    const standardPrereqs: BenchmarkPrerequisites = {
      expectedRenderer: 'WebGL',
      expectedViewport: { width: 375, height: 667, dpr: 2 },
      expectedBuildMode: 'production',
      expectedDurationSeconds: 60,
      targetArmyRange: { min: 5, max: 10 },
      targetFps: 60,
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
      warmupArmySamples: [2, 4],
      steadyStateArmySamples: [6, 7, 8, 7],
      steadyStateArmyCounts: { min: 6, max: 8, avg: 7.0, peak: 8 },
      peakObjects: 150,
      peakTweens: 15,
      memoryMb: { start: 20, peak: 30 },
      drawCalls: { total: 3000, avgPerFrame: 50 },
      sampleDurationMs: 60000,
      activeSampleDurationMs: 60000,
      backgroundDurationMs: 0,
      lifecycleTransitions: [],
      totalRenderedFrames: 3600,
      duplicateFramesDropped: 0,
      ...overrides,
    });

    it('passes when all environment, duration, and army parameters match', () => {
      const res = verifyPrerequisites(
        makeMetrics(),
        {
          renderer: 'WebGL',
          gpuVendor: 'Google Inc. (NVIDIA)',
          gpuRenderer: 'ANGLE (NVIDIA RTX 4060 Ti)',
          isSoftwareRenderer: false,
          viewport: { width: 375, height: 667, dpr: 2 },
          buildMode: 'production',
        },
        standardPrereqs
      );

      expect(res.passed).toBe(true);
      expect(res.failures).toHaveLength(0);
    });

    it('fails when software WebGL rasterizer is detected', () => {
      const res = verifyPrerequisites(
        makeMetrics(),
        {
          renderer: 'WebGL',
          gpuVendor: 'Google Inc. (Microsoft)',
          gpuRenderer: 'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)',
          isSoftwareRenderer: true,
          viewport: { width: 375, height: 667, dpr: 2 },
          buildMode: 'production',
        },
        standardPrereqs
      );

      expect(res.passed).toBe(false);
      expect(res.failures.some(f => f.includes('SOFTWARE_WEBGL_DETECTED'))).toBe(true);
    });

    it('fails when presented FPS exceeds target bound', () => {
      const res = verifyPrerequisites(
        makeMetrics({ presentedFps: 75.0 }), // 75 FPS on 60 target
        {
          renderer: 'WebGL',
          isSoftwareRenderer: false,
          viewport: { width: 375, height: 667, dpr: 2 },
          buildMode: 'production',
        },
        standardPrereqs
      );

      expect(res.passed).toBe(false);
      expect(res.failures.some(f => f.includes('PRESENTED_FPS_EXCEEDS_TARGET_BOUND'))).toBe(true);
    });

    it('fails when duplicate postrender callbacks are detected', () => {
      const res = verifyPrerequisites(
        makeMetrics({ duplicateFramesDropped: 3 }),
        {
          renderer: 'WebGL',
          isSoftwareRenderer: false,
          viewport: { width: 375, height: 667, dpr: 2 },
          buildMode: 'production',
        },
        standardPrereqs
      );

      expect(res.passed).toBe(false);
      expect(res.failures.some(f => f.includes('POSTRENDER_DUPLICATE_DETECTED'))).toBe(true);
    });

    it('fails when steady-state army count exceeds maximum (e.g. peak 11 or 12)', () => {
      const res = verifyPrerequisites(
        makeMetrics({
          steadyStateArmySamples: [6, 7, 11, 8], // 11 > max 10
        }),
        {
          renderer: 'WebGL',
          isSoftwareRenderer: false,
          viewport: { width: 375, height: 667, dpr: 2 },
          buildMode: 'production',
        },
        standardPrereqs
      );

      expect(res.passed).toBe(false);
      expect(res.failures.some(f => f.includes('ARMY_COUNT_OUT_OF_STEADY_STATE_BOUNDS'))).toBe(true);
    });

    it('fails when steady-state army count drops below minimum', () => {
      const res = verifyPrerequisites(
        makeMetrics({
          steadyStateArmySamples: [6, 7, 4, 8], // 4 < min 5
        }),
        {
          renderer: 'WebGL',
          isSoftwareRenderer: false,
          viewport: { width: 375, height: 667, dpr: 2 },
          buildMode: 'production',
        },
        standardPrereqs
      );

      expect(res.passed).toBe(false);
      expect(res.failures.some(f => f.includes('ARMY_COUNT_OUT_OF_STEADY_STATE_BOUNDS'))).toBe(true);
    });

    it('fails when background_resume is missing lifecycle transitions', () => {
      const res = verifyPrerequisites(
        makeMetrics({
          backgroundDurationMs: 10000,
          lifecycleTransitions: [{ event: 'visibilitychange', state: 'hidden', timestampMs: 5000 }], // Missing visible transition!
        }),
        {
          renderer: 'WebGL',
          isSoftwareRenderer: false,
          viewport: { width: 375, height: 667, dpr: 2 },
          buildMode: 'production',
        },
        standardPrereqs
      );

      expect(res.passed).toBe(false);
      expect(res.failures.some(f => f.includes('INVALID_BACKGROUND_TRANSITION'))).toBe(true);
    });

    it('fails verification with EXPECTED_NO_LONG_TASKS when long tasks exceed maxAllowedLongTasks', () => {
      const res = verifyPrerequisites(
        makeMetrics({
          longTasks: { count: 1, totalDurationMs: 91, maxDurationMs: 91 },
        }),
        {
          renderer: 'WebGL',
          isSoftwareRenderer: false,
          viewport: { width: 375, height: 667, dpr: 2 },
          buildMode: 'production',
        },
        {
          ...standardPrereqs,
          maxAllowedLongTasks: 0,
        }
      );

      expect(res.passed).toBe(false);
      expect(res.failures).toContainEqual(expect.stringContaining('EXPECTED_NO_LONG_TASKS'));
      expect(res.failures[0]).toContain('observed 1 long tasks >50ms (total 91ms, max 91ms), exceeding allowed threshold of 0');
    });

    it('passes verification when long tasks are zero and maxAllowedLongTasks is 0', () => {
      const res = verifyPrerequisites(
        makeMetrics({
          longTasks: { count: 0, totalDurationMs: 0, maxDurationMs: 0 },
        }),
        {
          renderer: 'WebGL',
          isSoftwareRenderer: false,
          viewport: { width: 375, height: 667, dpr: 2 },
          buildMode: 'production',
        },
        {
          ...standardPrereqs,
          maxAllowedLongTasks: 0,
        }
      );

      expect(res.passed).toBe(true);
      expect(res.failures).toEqual([]);
    });
  });

  describe('SubsystemTimings calculation', () => {
    it('records non-zero gameObjectsCreatedTotal when provided by instrumentation', () => {
      const metrics = computeBenchmarkMetrics(
        {
          sampleDurationMs: 1000,
          renderFrames: [{ timestampMs: 1000, deltaMs: 16.6 }],
          simulationTicks: 60,
          longTasks: [],
          peakObjects: 10,
          peakTweens: 2,
          memoryMb: { start: 10, peak: 12 },
          totalDrawCalls: 100,
          subsystemTimings: {
            simulationMs: 5,
            hudMs: 2,
            territoryVisualsMs: 1,
            armyVisualsMs: 2,
            combatArrivalsMs: 1,
            tweensMs: 0.1,
            renderMs: 8,
            textureUploads: 50,
            gameObjectsCreated: 142,
            tweensCreated: 24,
          },
        },
        60
      );

      expect(metrics.subsystemTimings?.gameObjectsCreatedTotal).toBe(142);
      expect(metrics.subsystemTimings?.tweensCreatedTotal).toBe(24);
    });

    it('sets gameObjectsCreatedTotal to null when instrumentation is unavailable, never false zero', () => {
      const metrics = computeBenchmarkMetrics(
        {
          sampleDurationMs: 1000,
          renderFrames: [{ timestampMs: 1000, deltaMs: 16.6 }],
          simulationTicks: 60,
          longTasks: [],
          peakObjects: 10,
          peakTweens: 2,
          memoryMb: { start: 10, peak: 12 },
          totalDrawCalls: 100,
          subsystemTimings: {
            simulationMs: 5,
            hudMs: 2,
            territoryVisualsMs: 1,
            armyVisualsMs: 2,
            combatArrivalsMs: 1,
            tweensMs: 0.1,
            renderMs: 8,
            textureUploads: 50,
            gameObjectsCreated: null,
            tweensCreated: 24,
          },
        },
        60
      );

      expect(metrics.subsystemTimings?.gameObjectsCreatedTotal).toBeNull();
    });
  });
});

