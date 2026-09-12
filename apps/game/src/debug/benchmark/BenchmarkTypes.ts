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
  isPhysicalDevice: boolean;
  renderer: BenchmarkRendererType;
  gpuVendor: string;
  gpuRenderer: string;
  isSoftwareRenderer: boolean;
  browserVersion: string;
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
  warmupDurationSeconds: number;
  seed: number;
  scheduleHash: string;
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

export interface SteadyStateArmyMetrics {
  min: number;
  max: number;
  avg: number;
  peak: number;
}

export interface LifecycleTransition {
  event: string;
  state: string;
  timestampMs: number;
}

export interface BenchmarkMetrics {
  // Authoritatively separated metrics
  presentedFps: number; // true measured presented frames per active second (unclamped)
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
  warmupArmySamples: number[];
  steadyStateArmySamples: number[];
  steadyStateArmyCounts: SteadyStateArmyMetrics;
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
  activeSampleDurationMs: number;
  backgroundDurationMs: number;
  lifecycleTransitions: LifecycleTransition[];
  totalRenderedFrames: number;
  duplicateFramesDropped: number;
}

export interface BenchmarkPrerequisites {
  expectedRenderer: BenchmarkRendererType;
  expectedGpuVendor?: string;
  expectedGpuRenderer?: string;
  disallowSoftwareRenderer?: boolean;
  expectedViewport: { width: number; height: number; dpr: number };
  expectedBuildMode: BenchmarkBuildMode;
  expectedDurationSeconds: number;
  expectedWarmupDurationSeconds?: number;
  targetArmyRange: { min: number; max: number };
  targetFps: number;
  targetFpsTolerance?: number; // default 1.5
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

export type ComparisonRejectionReasonCode =
  | 'SCENARIO_NAME_MISMATCH'
  | 'SEED_MISMATCH'
  | 'SCHEDULE_HASH_MISMATCH'
  | 'CPU_THROTTLE_MISMATCH'
  | 'NETWORK_PROFILE_MISMATCH'
  | 'VIEWPORT_MISMATCH'
  | 'DPR_MISMATCH'
  | 'RENDERER_MISMATCH'
  | 'GPU_VENDOR_MISMATCH'
  | 'GPU_RENDERER_MISMATCH'
  | 'GPU_BACKEND_MISMATCH'
  | 'BUILD_MODE_MISMATCH'
  | 'TARGET_FPS_MISMATCH'
  | 'DURATION_MISMATCH'
  | 'WARMUP_DURATION_MISMATCH'
  | 'BROWSER_VERSION_MISMATCH'
  | 'HOST_TYPE_MISMATCH'
  | 'PHYSICAL_DEVICE_FLAG_MISMATCH'
  | 'ARMY_COUNT_VARIANCE_EXCEEDED'
  | 'UNVERIFIED_SAMPLE'
  | 'SOFTWARE_WEBGL_DETECTED';

export interface ComparisonRejection {
  rejected: true;
  reasonCode: ComparisonRejectionReasonCode;
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
  steadyStateAvgArmyCount: MetricDelta;
  peakObjects: MetricDelta;
  drawCallsPerFrame: MetricDelta | null;
}

export type BenchmarkComparisonResult = ComparisonRejection | BenchmarkComparisonSuccess;

