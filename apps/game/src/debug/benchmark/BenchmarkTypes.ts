export type BenchmarkRendererType = 'WebGL' | 'Canvas';
export type BenchmarkBuildMode = 'production' | 'development';
export type BenchmarkScenarioName =
  | 'idle_match'
  | 'normal_combat'
  | 'heavy_combat'
  | 'qa_stress'
  | 'background_resume';

export interface BenchmarkEnvironment {
  host: string;
  isPhysicalDevice: false;
  renderer: BenchmarkRendererType;
  viewport: {
    width: number;
    height: number;
    dpr: number;
  };
  cpuThrottling: number; // 1 = normal, 4 = 4x slowdown
  network: string; // "LAN" | "Slow 4G"
  buildMode: BenchmarkBuildMode;
  targetFps: number; // e.g. 60
}

export interface BenchmarkScenarioConfig {
  name: BenchmarkScenarioName;
  durationSeconds: number;
  seed: number;
  targetArmyRange: {
    min: number;
    max: number;
  };
  description: string;
}

export interface DeltaPercentiles {
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface BenchmarkMetrics {
  // Authoritatively separated metrics
  presentedFps: number; // clamped to targetFps (display presentation rate)
  renderedFps: number; // raw Phaser render calls per second
  simulationTicks: number; // total game step ticks
  simulationFps: number; // simulation ticks per second
  phaserUpdateDelta: DeltaPercentiles; // Phaser timeStep deltas (ms)
  framesOver16Ms: number;
  framesOver16Pct: number;
  framesOver33Ms: number;
  framesOver33Pct: number;
  longTasks: {
    count: number;
    totalDurationMs: number;
    maxDurationMs: number;
  };
  armyCounts: {
    min: number;
    max: number;
    avg: number;
    peak: number;
  };
  peakObjects: number;
  peakTweens: number;
  memoryMb: {
    start: number | null;
    peak: number | null;
  };
  drawCalls: {
    total: number;
    avgPerFrame: number;
  } | null;
  sampleDurationMs: number;
  totalRenderedFrames: number;
  duplicateFramesDropped: number;
}

export interface BenchmarkPrerequisites {
  expectedRenderer: BenchmarkRendererType;
  expectedViewport: { width: number; height: number; dpr: number };
  expectedBuildMode: BenchmarkBuildMode;
  expectedDurationSeconds: number;
  targetArmyRange: { min: number; max: number };
}

export interface BenchmarkVerificationResult {
  passed: boolean;
  failures: string[];
}

export interface BenchmarkReport {
  id: string;
  timestamp: string;
  environment: BenchmarkEnvironment;
  scenario: BenchmarkScenarioConfig;
  metrics: BenchmarkMetrics;
  verification: BenchmarkVerificationResult;
}

export interface ComparisonRejection {
  rejected: true;
  reasonCode:
    | 'RENDERER_MISMATCH'
    | 'VIEWPORT_MISMATCH'
    | 'BUILD_MODE_MISMATCH'
    | 'DURATION_MISMATCH'
    | 'ARMY_COUNT_VARIANCE_EXCEEDED'
    | 'UNVERIFIED_SAMPLE';
  message: string;
}

export interface MetricDelta {
  baseline: number;
  candidate: number;
  delta: number;
  percentChange: number;
  improved: boolean;
}

export interface BenchmarkComparisonSuccess {
  rejected: false;
  presentedFps: MetricDelta;
  renderedFps: MetricDelta;
  p95FrameTimeMs: MetricDelta;
  framesOver33Pct: MetricDelta;
  avgArmyCount: MetricDelta;
  peakObjects: MetricDelta;
  drawCallsPerFrame: MetricDelta | null;
}

export type BenchmarkComparisonResult = ComparisonRejection | BenchmarkComparisonSuccess;
