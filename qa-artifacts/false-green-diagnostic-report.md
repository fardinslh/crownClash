# False-Green Diagnostic Verification Report

## Objective
Demonstrate that the diagnostic harness detects an injected synthetic long task on constrained hardware emulation (4x CPU throttling, DPR 2, 375x667, hardware WebGL) by failing benchmark verification with an explicit failure code (`EXPECTED_NO_LONG_TASKS`), and that removal of the synthetic injection restores clean execution with zero detected long tasks and `verification.passed = true`.

---

## 1. Negative Control (Injected 75ms Long Task)

Command:
```bash
node --experimental-strip-types scripts/run-benchmark.mjs normal_combat 15 --inject-long-task=75 --out false_green_red.json
```

Output:
```
======================================================
Deterministic Scenario: normal_combat (15s)
Viewport: 375x667@2 | CPU: 4x | Renderer: WebGL | Network: LAN
PRNG Seed: 20260912 | Host: Browser Emulation (Headless Chrome on Windows)
Synthetic Long Task Injection: 75ms
======================================================
Scenario running for 15s...

--- AUTHORITATIVE BENCHMARK SUMMARY ---
GPU Vendor: Google Inc. (NVIDIA) | GPU Renderer: ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti (0x00002803) Direct3D11 vs_5_0 ps_5_0, D3D11) (Software: false)
Presented FPS: 57.5 | Raw Rendered: 57.5 FPS
Simulation Ticks: 864 (57.5 ticks/sec)
Phaser Update Delta: avg 17.38ms | p50 16.7ms | p95 21.8ms | max 93.9ms
Frames >16.7ms: 413 (47.8%) | >33.3ms: 3 (0.3%)
Steady-State Armies: min 5 | avg 6.9 | max 8
Objects: peak 90 | Tweens: peak 37 | Heap: peak 31.3MB
Draw Calls / frame: 96.4 (total: 83306)
Long Tasks (>50ms): 1 (max: 93ms, total: 93ms)

--- SUBSYSTEM ATTRIBUTION (avg ms/frame) ---
Simulation (stepBotMatch):     0.3 ms/frame
Army Visuals (updateArmies):   0.3 ms/frame
Territory Visuals (sync):      0.15 ms/frame
HUD Updates (dominance/timer): 0.49 ms/frame
Combat Arrivals (effects):     0.22 ms/frame
Tweens Update:                 0 ms/frame
Phaser Rendering:              14.5 ms/frame
Texture Uploads (total):       1498
GameObjects Created (total):   863
Tweens Created (total):        393
--------------------------------------------
Prerequisites Verification: FAILED
Failures: [
  'EXPECTED_NO_LONG_TASKS: observed 1 long tasks >50ms (total 93ms, max 93ms), exceeding allowed threshold of 0'
]
Saved small reviewable JSON summary to: E:\MyProjects\crownClash\qa-artifacts\summaries\false_green_red.json
```

**Result & Stored JSON**:
- `verification.passed`: `false`
- `verification.failures`: `["EXPECTED_NO_LONG_TASKS: observed 1 long tasks >50ms (total 93ms, max 93ms), exceeding allowed threshold of 0"]`
- `longTasks.count`: `1`
- `longTasks.maxDurationMs`: `93`
- `longTasks.totalDurationMs`: `93`
- `gameObjectsCreatedTotal`: `863` (observed non-zero allocations)
- Stored JSON file: `qa-artifacts/summaries/false_green_red.json`

---

## 2. Restored Clean Control (No Injection)

Command:
```bash
node --experimental-strip-types scripts/run-benchmark.mjs normal_combat 15 --out false_green_restored.json
```

Output:
```
======================================================
Deterministic Scenario: normal_combat (15s)
Viewport: 375x667@2 | CPU: 4x | Renderer: WebGL | Network: LAN
PRNG Seed: 20260912 | Host: Browser Emulation (Headless Chrome on Windows)
======================================================
Scenario running for 15s...

--- AUTHORITATIVE BENCHMARK SUMMARY ---
GPU Vendor: Google Inc. (NVIDIA) | GPU Renderer: ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti (0x00002803) Direct3D11 vs_5_0 ps_5_0, D3D11) (Software: false)
Presented FPS: 57.6 | Raw Rendered: 57.6 FPS
Simulation Ticks: 866 (57.6 ticks/sec)
Phaser Update Delta: avg 17.35ms | p50 16.8ms | p95 21.6ms | max 48.4ms
Frames >16.7ms: 442 (51%) | >33.3ms: 2 (0.2%)
Steady-State Armies: min 5 | avg 6.6 | max 8
Objects: peak 90 | Tweens: peak 38 | Heap: peak 33.1MB
Draw Calls / frame: 94.6 (total: 81928)
Long Tasks (>50ms): 0 (max: 0ms, total: 0ms)

--- SUBSYSTEM ATTRIBUTION (avg ms/frame) ---
Simulation (stepBotMatch):     0.3 ms/frame
Army Visuals (updateArmies):   0.29 ms/frame
Territory Visuals (sync):      0.15 ms/frame
HUD Updates (dominance/timer): 0.48 ms/frame
Combat Arrivals (effects):     0.23 ms/frame
Tweens Update:                 0 ms/frame
Phaser Rendering:              14.59 ms/frame
Texture Uploads (total):       1497
GameObjects Created (total):   851
Tweens Created (total):        392
--------------------------------------------
Prerequisites Verification: PASSED
Saved small reviewable JSON summary to: E:\MyProjects\crownClash\qa-artifacts\summaries\false_green_restored.json
```

**Result & Stored JSON**:
- `verification.passed`: `true`
- `verification.failures`: `[]`
- `longTasks.count`: `0`
- `longTasks.maxDurationMs`: `0`
- `longTasks.totalDurationMs`: `0`
- `gameObjectsCreatedTotal`: `851`
- Stored JSON file: `qa-artifacts/summaries/false_green_restored.json`
