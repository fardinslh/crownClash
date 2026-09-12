# False-Green Diagnostic Verification Report

## Objective
Demonstrate that the diagnostic harness detects an injected synthetic long task on constrained hardware emulation (4x CPU throttling, DPR 2, 375x667, hardware WebGL), and that removal of the synthetic injection restores clean execution with zero detected long tasks.

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
Presented FPS: 59.2 | Raw Rendered: 59.2 FPS
Simulation Ticks: 890 (59.2 ticks/sec)
Phaser Update Delta: avg 16.88ms | p50 15.9ms | p95 23.3ms | max 91.3ms
Frames >16.7ms: 323 (36.3%) | >33.3ms: 3 (0.3%)
Steady-State Armies: min 6 | avg 7 | max 9
Objects: peak 90 | Tweens: peak 37 | Heap: peak 30.9MB
Draw Calls / frame: 97.7 (total: 86946)
Long Tasks (>50ms): 1 (max: 91ms, total: 91ms)

--- SUBSYSTEM ATTRIBUTION (avg ms/frame) ---
Simulation (stepBotMatch):     0.25 ms/frame
Army Visuals (updateArmies):   0.25 ms/frame
Territory Visuals (sync):      0.12 ms/frame
HUD Updates (dominance/timer): 0.36 ms/frame
Combat Arrivals (effects):     0.2 ms/frame
Tweens Update:                 0 ms/frame
Phaser Rendering:              13.38 ms/frame
Texture Uploads (total):       1514
GameObjects Created (total):   0
Tweens Created (total):        381
--------------------------------------------
Prerequisites Verification: PASSED
Saved small reviewable JSON summary to: E:\MyProjects\crownClash\qa-artifacts\summaries\false_green_red.json
```

**Result**: Detected exactly 1 long task (>50ms) of duration 91ms (75ms injected synchronous block + frame overhead). Max delta spiked to 91.3ms.

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
Presented FPS: 59.5 | Raw Rendered: 59.5 FPS
Simulation Ticks: 893 (59.5 ticks/sec)
Phaser Update Delta: avg 16.81ms | p50 15.9ms | p95 23.3ms | max 45.2ms
Frames >16.7ms: 311 (34.8%) | >33.3ms: 2 (0.2%)
Steady-State Armies: min 6 | avg 7 | max 8
Objects: peak 98 | Tweens: peak 45 | Heap: peak 35.7MB
Draw Calls / frame: 98.1 (total: 87620)
Long Tasks (>50ms): 0 (max: 0ms, total: 0ms)

--- SUBSYSTEM ATTRIBUTION (avg ms/frame) ---
Simulation (stepBotMatch):     0.26 ms/frame
Army Visuals (updateArmies):   0.25 ms/frame
Territory Visuals (sync):      0.12 ms/frame
HUD Updates (dominance/timer): 0.35 ms/frame
Combat Arrivals (effects):     0.2 ms/frame
Tweens Update:                 0 ms/frame
Phaser Rendering:              13.55 ms/frame
Texture Uploads (total):       1517
GameObjects Created (total):   0
Tweens Created (total):        381
--------------------------------------------
Prerequisites Verification: PASSED
Saved small reviewable JSON summary to: E:\MyProjects\crownClash\qa-artifacts\summaries\false_green_restored.json
```

**Result**: Zero long tasks (>50ms). Max delta was 45.2ms. All criteria cleanly validated.
