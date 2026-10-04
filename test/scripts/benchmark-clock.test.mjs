import { test } from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkClockFailures } from '../../scripts/benchmark-clock.mjs';

const metrics = { activeSampleDurationMs: 30000, simulationFps: 60, presentedFps: 60 };

test('a benchmark accepts the production simulation clock and matching rendered cadence', () => {
  assert.deepEqual(benchmarkClockFailures(metrics, 30), []);
});

test('a falsely green 60 FPS report with a doubled simulation clock fails', () => {
  assert.match(benchmarkClockFailures(metrics, 60).join(';'), /SIMULATION_CLOCK_MISMATCH/);
  assert.match(benchmarkClockFailures(metrics, undefined).join(';'), /SIMULATION_CLOCK_MISMATCH/);
});

test('missing or divergent game-step evidence fails even if frames are presented', () => {
  assert.match(benchmarkClockFailures({ ...metrics, simulationFps: 0 }, 30).join(';'), /SIMULATION_RENDER_CADENCE_MISMATCH/);
});

test('missing, nonfinite or nonpositive sampling duration fails closed', () => {
  for (const activeSampleDurationMs of [undefined, NaN, Infinity, 0, -1]) {
    assert.match(benchmarkClockFailures({ ...metrics, activeSampleDurationMs }, 30).join(';'), /SIMULATION_CLOCK_MISMATCH/);
  }
});

test('missing, nonfinite or nonpositive frame rates fail closed', () => {
  for (const invalidRate of [undefined, NaN, Infinity, 0, -1]) {
    for (const key of ['presentedFps', 'simulationFps']) {
      assert.match(benchmarkClockFailures({ ...metrics, [key]: invalidRate }, 30).join(';'), /SIMULATION_RENDER_CADENCE_MISMATCH/);
    }
  }
});
