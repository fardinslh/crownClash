# Mobile Gameplay Stutter Diagnostics & First Optimization Target

**Date**: 2026-09-13  
**Target Environment**: Mobile-constrained profile (375×667, DPR 2, Hardware WebGL via Direct3D11 ANGLE, 4× CPU throttling, Fast 4G network emulation).  
**Physical Device Check**: `adb devices` was probed; no physical Android device was detected on the test runner host. Hardware WebGL mobile-equivalent emulation was executed with verified ANGLE GPU rendering (`Google Inc. (NVIDIA)` / `NVIDIA GeForce RTX 4060 Ti`, software renderer: `false`).

---

## Executive Summary

Diagnostic benchmarks and Chrome DevTools performance traces across 5 representative scenarios reveal that **Phaser WebGL Rendering (enderer.render) is the single dominant bottleneck causing mobile gameplay stutter**, consuming **81% to 105% of the total 16.6ms frame budget** (averaging 17.03ms - 17.83ms in combat scenarios, with draw call counts reaching 143 to 157 per frame).

In contrast, **pure game logic and simulation are fast and well within budget**:
- Game simulation (stepBotMatch): **0.23ms - 0.56ms** / frame
- Army Visuals (updateArmies): **0.23ms - 0.51ms** / frame
- Territory state sync: **0.12ms - 0.25ms** / frame
- HUD updates: **0.35ms - 0.45ms** / frame

The stutter and framerate degradation (dropping from 60 FPS to 47.3 FPS under heavy combat and late-match pressure) is driven by two specific rendering pipeline defects:
1. **Draw Call Explosion via Batch-Breaking Visual Hierarchy**: Armies and territories interleave `Phaser.GameObjects.Shape` primitives (elliptical shadows, circular auras, rectangular badge backgrounds) with `Phaser.GameObjects.Image` sprites from texture atlases. This repeatedly flushes the WebGL batch 8 to 11 times *per army*, driving draw calls to **157 calls/frame**.
2. **Offscreen Canvas Texture Upload Churn (gl.texSubImage2D)**: Dynamic troop badges, tower counters, and floating combat text use `Phaser.GameObjects.Text`. Updating these strings redraws an offscreen HTML `<canvas>` and issues `gl.texSubImage2D` calls to the GPU—generating **over 4,190 texture uploads in 30 seconds (~140 uploads/second)** and causing GPU pipeline stalls.

---

## 1. Scenario Benchmark Results

All scenarios were executed under:
- Viewport: `375×667`, DPR: `2.0`
- Renderer: Hardware WebGL (`ANGLE Direct3D11`)
- CPU Throttling: `4×` rate reduction
- Network: Fast 4G (`40ms` latency, `4Mbps` down, `3Mbps` up)
- Warm-up period: Documented and excluded from steady-state verification.

| Scenario | Presented FPS | Update Delta (Avg / P95 / Max) | Frames >16.7ms | Frames >33.3ms | Long Tasks (>50ms) | Draw Calls / Frame | Texture Uploads (30s) | Phaser Render ms/frame | Simulation ms/frame |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **normal_combat** | **59.6** | 16.8ms / 22.3ms / 44.8ms | 38.1% | 0.2% | 0 (0ms) | 98.3 | 3,034 | 13.62ms | 0.23ms |
| **heavy_combat** | **49.4** | 20.2ms / 26.1ms / 62.4ms | 90.7% | 0.8% | 4 (229ms) | 143.5 | 4,102 | 17.03ms | 0.53ms |
| **rapid_dispatches** | **54.6** | 18.3ms / 23.2ms / 48.5ms | 71.4% | 0.4% | 0 (0ms) | 118.4 | 3,680 | 15.47ms | 0.40ms |
| **late_match_pressure** | **47.3** | 21.1ms / 26.9ms / 61.2ms | 95.4% | 1.2% | 3 (172ms) | 157.1 | 4,193 | 17.83ms | 0.56ms |
| **background_resume** | **8.3** (suspended 10s) | 17.2ms / 23.7ms / 45.7ms | 43.2% | 1.0% | 0 (0ms) | 86.1 | 472 | 13.34ms | 0.34ms |

*Tracked raw summary files*:
- `qa-artifacts/summaries/diag_normal_combat.json`
- `qa-artifacts/summaries/diag_heavy_combat.json`
- `qa-artifacts/summaries/diag_rapid_dispatches.json`
- `qa-artifacts/summaries/diag_late_match_pressure.json`
- `qa-artifacts/summaries/diag_background_resume.json`

---

## 2. Subsystem Attribution Breakdown

In-page high-resolution performance probes (`performance.now()`) wrapped around discrete subsystem methods within `GameScene` reveal where frame time is spent:

| Subsystem | normal_combat | heavy_combat | rapid_dispatches | late_match_pressure | background_resume |
|:---|:---:|:---:|:---:|:---:|:---:|
| **Simulation (stepBotMatch)** | 0.23ms | 0.53ms | 0.40ms | 0.56ms | 0.34ms |
| **Army Visuals (updateArmies)** | 0.23ms | 0.49ms | 0.37ms | 0.51ms | 0.32ms |
| **Territory Visuals (sync)** | 0.12ms | 0.22ms | 0.17ms | 0.25ms | 0.16ms |
| **HUD Updates (dominance/timer)** | 0.35ms | 0.38ms | 0.36ms | 0.38ms | 0.45ms |
| **Combat Arrivals (effects/sounds)** | 0.17ms | 0.46ms | 0.34ms | 0.50ms | 0.25ms |
| **Tweens Update** | <0.01ms | <0.01ms | <0.01ms | <0.01ms | <0.01ms |
| **Phaser WebGL Rendering** | **13.62ms** | **17.03ms** | **15.47ms** | **17.83ms** | **13.34ms** |
| **Tweens Created (allocations)** | 721 | 1,580 | 1,290 | 1,745 | 129 |
| **Peak Display Objects** | 90 | 113 | 99 | 117 | 99 |

**Key Subsystem Takeaways**:
- The game simulation logic is extremely light and scalable (only **0.56ms** during 19 concurrent armies).
- Visual updates (calculating march strides, positions) are lean (only **0.51ms**).
- Phaser WebGL Rendering is the bottleneck, scaling from **13.62ms up to 17.83ms** as army counts increase.

---

## 3. Deep Trace Window Analysis (Worst Hitches)

We analyzed the collected Chrome DevTools performance traces (`qa-artifacts/traces/heavy_combat_trace.json` and `qa-artifacts/traces/late_match_pressure_trace.json`).

### Worst Match-Time Hitch in heavy_combat:
- **Timestamp**: `40469912900` µs (~24.5s into match)
- **Duration**: **62.79ms** (3.8 frame drops)
- **Top Slices**:
  - `RunTask`: 62.79ms
  - `FireAnimationFrame`: 61.39ms
  - `FunctionCall` (`phaser-BwSGr_Za.js:1022` - Phaser Game Step & Render): **61.17ms**
  - `GPUTask` (GPU process executing WebGL draw calls): **29.73ms** (48.5% of the frame)
  - `MinorGC`: 0.83ms
  - `Layout / Style`: 0.00ms
  - `Commit / PrePaint`: 0.45ms

### Worst Match-Time Hitch in late_match_pressure:
- **Timestamp**: `40653121011` µs (~17.2s into match)
- **Duration**: **94.94ms**
- **Top Slices**:
  - `FireAnimationFrame`: 92.34ms
  - `FunctionCall` (`phaser-BwSGr_Za.js:1022`): **91.51ms**
  - `GPUTask`: **37.13ms**
  - `V8.StackGuard / HandleInterrupts`: 17.16ms
  - `MinorGC`: 1.64ms
  - `Layout / Style`: 0.82ms

### Trace Attribution Conclusions:
1. **Did Garbage Collection dominate?** **NO**. Trace-wide GC pauses were short (0.8ms - 1.6ms for MinorGC, 4ms - 5.5ms for MajorGC). GC did NOT create the 62ms or 94ms frame hitches.
2. **Did Layout / Style dominate?** **NO**. DOM Layout/Style was 0ms during match playback (canvas rendering).
3. **Did Script / Compile dominate?** **NO**. Code is pre-compiled; JIT warm-up occurs before steady state.
4. **What dominated?** **The Phaser Game Loop & WebGL GPU Pipeline**. Specifically, WebGL batch flushes and GPU command stream synchronization during `game.renderer.render()`.

---

## 4. Root Causes & Ranked Bottlenecks

### Rank 1: WebGL Batch-Breaking via Interleaved Shapes and Atlas Sprites (Critical Impact)
- **Mechanism**: In `GameScene.ts` (`createArmyVisual`), each army creates:
  1. Role Aura: `Phaser.GameObjects.Arc` (`circle`) -> **Shape Pipeline**
  2. Follower 1-4: `Phaser.GameObjects.Ellipse` (shadow) -> **Shape Pipeline**
  3. Follower 1-4: `Phaser.GameObjects.Image` (unit sprite) -> **MultiPipeline (Texture Atlas)**
  4. Leader: `Phaser.GameObjects.Ellipse` (shadow) -> **Shape Pipeline**
  5. Leader: `Phaser.GameObjects.Image` (unit sprite) -> **MultiPipeline (Texture Atlas)**
  6. Troop Badge: `Phaser.GameObjects.Rectangle` (badgeBg) -> **Shape Pipeline**
  7. Troop Badge: `Phaser.GameObjects.Text` (badgeText) -> **Canvas Texture**
- **Impact**: Because Phaser renders children sequentially, each switch between `Shape` and `Sprite` flushes the WebGL batch and changes shaders. For 15 active armies, this creates **140 to 157 draw calls every single frame**. On mobile tiled GPUs (Mali, Adreno), this causes severe state thrashing and pipeline stalls.

### Rank 2: Offscreen HTML Canvas Texture Re-Uploads (gl.texSubImage2D) (High Impact)
- **Mechanism**: `Phaser.GameObjects.Text` creates an invisible `<canvas>` element. When `.setText()` is called on:
  - Tower unit counts (`vis.unitText.setText` in `syncTerritoryVisuals`)
  - Army troop counts (`visual.badgeText.setText` in `updateArmyVisuals`)
  - Floating damage/capture numbers (`spawnFloatingText` in `onCombatArrival`)
  Phaser re-renders the string on the 2D canvas and calls `gl.texSubImage2D` to upload pixels to GPU memory.
- **Impact**: **4,193 texture uploads per 30 seconds (~140/sec)**. Each upload forces CPU-GPU memory bus synchronization, creating stutter during intense combat.

### Rank 3: Ephemeral GameObject and Tween Churn on Combat Arrivals (Moderate Impact)
- **Mechanism**: On every territory capture, `onCombatArrival` instantiates:
  - 8 spark rectangles + 8 Tweens (`spawnCaptureBurst`)
  - 1 impact ring circle + 1 Tween (`spawnImpactRing`)
  - 1 flash circle + 1 Tween (`spawnCaptureFlash`)
  - 1 floating Text + 1 Tween (`spawnFloatingText`)
  - 1 container scale pop Tween
  Total: **11 GameObjects and 11 Tweens created and destroyed per capture**.
- **Impact**: In 30s of `late_match_pressure`, **1,745 tweens were allocated**. Across the trace, V8 executed 741 MinorGC cycles totaling **2.27 seconds of GC time** (7.5% of total runtime). While individual GC pauses are 1ms, the cumulative allocation pressure degrades CPU cache locality and raises mobile thermals.

---

## 5. Scaling Hazards: 2v2 and Larger Maps

1. **2v2 Combat Explosion**:
   - In 2v2, with 4 active commanders and expanded 12-16 node maps, concurrent armies will routinely reach **35 to 50 armies**.
   - Under current architecture (11 draw calls/army + 6 draw calls/tower):
     \text{Draw Calls}_{2v2} = (40 \times 11) + (14 \times 6) = 440 + 84 = 524 \text{ draw calls/frame}
   - On low-end mobile devices (e.g. Android WebViews with Mali-G52 or Adreno 610), >200 draw calls causes catastrophic framerate drops to 15-20 FPS.
2. **Texture Upload Flooding**:
   - 40 armies constantly updating unit counts + 14 towers producing troops will push texture uploads to **>350 uploads/sec**, completely saturating mobile memory bus bandwidth.

---

## 6. Recommended First Optimization Target

### Recommendation:
**Batch the Army Visuals by Replacing Geometric Shapes with Atlas Sprites and Eliminating Batch Breaks.**

### Why This Must Come First:
1. **Directly addresses the #1 bottleneck (Phaser Rendering: 17.8ms)**: Rendering accounts for >80% of frame time. Optimizing game simulation (which is already 0.5ms) would yield zero perceptible gain.
2. **Smallest high-impact change**:
   - Instead of instantiating `Phaser.GameObjects.Ellipse` for unit shadows and `Rectangle` for badge backgrounds, render shadows and badges as sprites from the existing game texture atlas (or a single white-pixel texture batchable in `MultiPipeline`).
   - Group the rendering order: all shadows together, all sprites together, or render as a unified sprite hierarchy that doesn't switch WebGL pipelines.
3. **Paves the way for 2v2**: Decouples army count from draw call count. 40 armies can render in **under 20-30 draw calls** instead of 524 draw calls.
4. **Metric Target**:
   - Draw calls per frame: **157 -> ~25-35** (75-80% reduction).
   - Render time per frame: **17.8ms -> 6-8ms** under 4× CPU throttle.
   - Heavy combat FPS: **47.3 FPS -> 60.0 FPS**.
   - Zero long tasks (>50ms).
5. **Determinism & Multiplayer Risk**:
   - **ZERO risk**: The visual representation in `GameScene` is completely decoupled from `@crown-clash/game-core` simulation state and server authority. No network packets, RNG seeds, or combat math are affected.

---

## 7. False-Green Guard Verification Summary

As recorded in `qa-artifacts/false-green-diagnostic-report.md`:
1. **Deliberate Negative Injection**: Injected a 75ms synthetic blocking task into `normal_combat 15`.
   - Result: Prerequisite failed (`EXPECTED_NO_LONG_TASKS: observed 1 long tasks >50ms (total 91ms)`), max frame delta 91.3ms. Output: `qa-artifacts/summaries/false_green_red.json`.
2. **Clean Restoration**: Removed injection and re-ran `normal_combat 15`.
   - Result: Prerequisite passed cleanly (`failures: []`), 0 long tasks, max frame delta 45.2ms. Output: `qa-artifacts/summaries/false_green_restored.json`.
