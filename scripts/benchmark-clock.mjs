export function benchmarkClockFailures(metrics, elapsedSimulationSeconds) {
  const failures = [];
  const activeSeconds = metrics.activeSampleDurationMs / 1000;
  if (!Number.isFinite(elapsedSimulationSeconds) || !Number.isFinite(activeSeconds) || activeSeconds <= 0 ||
      Math.abs(elapsedSimulationSeconds / activeSeconds - 1) > 0.1) {
    failures.push(`SIMULATION_CLOCK_MISMATCH: ${elapsedSimulationSeconds}s simulation over ${activeSeconds}s active sampling`);
  }
  if (!Number.isFinite(metrics.presentedFps) || metrics.presentedFps <= 0 ||
      !Number.isFinite(metrics.simulationFps) || metrics.simulationFps <= 0 ||
      Math.abs(metrics.simulationFps / metrics.presentedFps - 1) > 0.1) {
    failures.push('SIMULATION_RENDER_CADENCE_MISMATCH: game steps and presented frames differ by more than 10%');
  }
  return failures;
}
