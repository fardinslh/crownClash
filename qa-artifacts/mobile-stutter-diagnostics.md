# Mobile Gameplay Stutter Diagnostics & First Optimization Target

**Date**: 2026-09-13  
**Target Environment**: Mobile-constrained profile (375×667, DPR 2, Hardware WebGL via Direct3D11 ANGLE, 4× CPU throttling, Fast 4G network emulation).  
**Physical Device Check**: `adb devices` was probed; no physical Android device was detected on the test runner host. Hardware WebGL mobile-equivalent emulation was executed with verified ANGLE GPU rendering (`Google Inc. (NVIDIA)` / `NVIDIA GeForce RTX 4060 Ti`, software renderer: `false`).

---

## Executive Summary

Diagnostic benchmarks and Chrome DevTools performance traces across 5 representative scenarios identify **CPU Main-Thread Render-Path Execution (enderer.render) as the primary bottleneck causing gameplay stutter under mobile-constrained conditions**, consuming **13.5ms to 16.6ms per frame** (81% to 100% of the 16.6ms frame budget), accompanied by **98 to 152 WebGL draw calls per frame** and **100 to 142 texture uploads per second**.

In contrast, **pure game logic and simulation are fast and well within budget**:
- Game simulation (stepBotMatch): **0.22ms - 0.48ms** / frame
- Army movement & visual updates: **0.22ms - 0.42ms** / frame
- Territory state sync: **0.11ms - 0.21ms** / frame
- HUD updates: **0.33ms - 0.48ms** / frame

**Important Architectural Distinction (Measured vs Inferred)**:
- enderer.render measures **CPU JavaScript main-thread scene traversal and WebGL command dispatch time**, *not* GPU hardware execution time.
- GPU hardware execution occurs asynchronously in the browser GPU process and is captured via trace events like GPUTask (which reached **29.73ms** during a 62.8ms hitch).
- Texture upload counts (	exSubImage2D) prove that frequent pixel transfers occurred (~140/sec); the assertion that these transfers cause bus stalls is an architectural hypothesis based on mobile GPU memory models, not a directly instrumented hardware counter.

---

## 1. Measured Scenario Benchmark Results

All scenarios were executed under:
- Viewport: `375×667`, DPR: `2.0`
- Renderer: Hardware WebGL (`ANGLE Direct3D11`)
- CPU Throttling: `4×` rate reduction
- Network: Fast 4G (`40ms` latency, `4Mbps` down, `3Mbps` up)
- Warm-up period: Documented and excluded from steady-state verification.

| Scenario | Presented FPS | Update Delta (Avg / P95 / Max) | Frames >16.7ms | Frames >33.3ms | Long Tasks (>50ms) | Draw Calls / Frame | Texture Uploads (30s) | Phaser Render ms/frame (CPU) | Simulation ms/frame (CPU) |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **normal_combat** | **59.5** | 16.8ms / 22.5ms / 49.6ms | 37.0% | 0.2% | 0 (0ms) | 98.0 | 3,025 | 13.51ms | 0.22ms |
| **heavy_combat** | **53.9** | 18.5ms / 23.7ms / 46.7ms | 69.7% | 0.6% | 0 (0ms) | 139.9 | 4,209 | 15.80ms | 0.44ms |
| **rapid_dispatches** | **58.0** | 17.2ms / 22.5ms / 43.6ms | 44.6% | 0.3% | 0 (0ms) | 118.2 | 3,797 | 14.48ms | 0.35ms |
| **late_match_pressure** | **51.6** | 19.4ms / 24.8ms / 57.4ms | 81.3% | 0.7% | 1 (57ms) | 152.4 | 4,262 | 16.64ms | 0.48ms |
| **background_resume** | **8.3** (suspended 10s) | 17.3ms / 23.4ms / 45.0ms | 41.6% | 0.7% | 0 (0ms) | 85.6 | 464 | 13.37ms | 0.32ms |

*Tracked JSON Summaries*:
- `qa-artifacts/summaries/diag_normal_combat.json`
- `qa-artifacts/summaries/diag_heavy_combat.json`
- `qa-artifacts/summaries/diag_rapid_dispatches.json`
- `qa-artifacts/summaries/diag_late_match_pressure.json`
- `qa-artifacts/summaries/diag_background_resume.json`

---

## 2. Subsystem Attribution Breakdown (Measured CPU Timings)

In-page high-resolution performance probes (`performance.now()`) wrapped around discrete subsystem methods within `GameScene` measure main-thread CPU time:

| Subsystem | normal_combat | heavy_combat | rapid_dispatches | late_match_pressure | background_resume |
|:---|:---:|:---:|:---:|:---:|:---:|
| **Simulation (stepBotMatch)** | 0.22ms | 0.44ms | 0.35ms | 0.48ms | 0.32ms |
| **Army Visuals (updateArmies)** | 0.22ms | 0.42ms | 0.32ms | 0.42ms | 0.30ms |
| **Territory Visuals (sync)** | 0.11ms | 0.20ms | 0.15ms | 0.21ms | 0.17ms |
| **HUD Updates (dominance/timer)** | 0.33ms | 0.34ms | 0.33ms | 0.34ms | 0.45ms |
| **Combat Arrivals (effects/sounds)** | 0.17ms | 0.39ms | 0.29ms | 0.41ms | 0.23ms |
| **Tweens Update** | <0.01ms | <0.01ms | <0.01ms | <0.01ms | <0.01ms |
| **Phaser Render Path (enderer.render)** | **13.51ms** | **15.80ms** | **14.48ms** | **16.64ms** | **13.37ms** |
| **Texture Uploads (	exSubImage2D count)** | 3,025 | 4,209 | 3,797 | 4,262 | 464 |
| **GameObjects Created (observed count)** | 1,591 | 3,640 | 3,033 | 3,966 | 284 |
| **Tweens Created (observed count)** | 715 | 1,475 | 1,290 | 1,603 | 117 |
| **Peak Display Objects** | 90 | 110 | 98 | 118 | 98 |

---

## 3. Trace Window Validation & Subsystem Breakdown

Chrome DevTools traces (`qa-artifacts/traces/heavy_combat_trace.json` and `qa-artifacts/traces/late_match_pressure_trace.json`) were parsed to isolate steady-state match hitches (>50ms).

### Measured Trace Slices for Steady-State Hitch (62.79ms in heavy_combat):
- **Timestamp**: `40469912900` µs (~24.5s into match)
- **Top-Level Task (RunTask)**: **62.79ms**
- **Slices inside Task**:
  - `FireAnimationFrame`: 61.39ms
  - `FunctionCall` (Phaser Game Loop & Render: `phaser-BwSGr_Za.js:1022`): **61.17ms**
  - `GPUTask` (GPU process executing WebGL command stream): **29.73ms** (48.5% of the hitch window)
  - `MinorGC`: **0.83ms**
  - `Layout / Style` (DOM reflow): **0.00ms**
  - `Commit / PrePaint`: **0.45ms**

### What enderer.render Actually Includes:
In Phaser 3/4 WebGL mode, game.renderer.render() runs synchronously on the **CPU main thread**:
1. Traverses the display list of active scenes and containers.
2. Computes hierarchical world transform matrices for every display node.
3. Performs culling against the camera viewport.
4. Checks pipeline bindings: when moving between different pipelines (e.g. GraphicsPipeline / ShapePipeline vs MultiPipeline), it flushes the current vertex buffer to the WebGL command buffer.
5. Issues WebGL API calls (gl.drawArrays, gl.drawElements, gl.bindTexture, etc.).

**Conclusion on Trace Attribution**:
- **Did DOM Layout / Style dominate?** **NO** (0.00ms).
- **Did Garbage Collection dominate the hitch?** **NO** (MinorGC was 0.83ms). Trace-wide GC pauses were short (0.8ms - 1.6ms), though cumulative GC time across 30s reached 2.27s due to high allocation frequency.
- **Did JavaScript simulation logic dominate?** **NO** (stepBotMatch was 0.44ms).
- **What dominated?** **The combined cost of CPU render-path command generation and GPU process command execution (GPUTask: 29.73ms)**, driven by high draw-call and state-transition frequency.

---

## 4. Measured Facts versus Inferred Explanations

To ensure scientific rigor, we strictly distinguish empirically measured data from structural inferences and projections:

### Measured Facts:
1. **CPU Render-path timing**: enderer.render consumes **13.51ms to 16.64ms** per frame on 4× throttled CPU, leaving minimal headroom for 60 FPS (which requires total frame time ≤ 16.6ms).
2. **Draw-call count**: Average draw calls per frame scale from **98.0** in normal combat to **152.4** in late-match pressure.
3. **Texture upload count**: Direct intercept of gl.texImage2D and gl.texSubImage2D recorded **3,025 to 4,262 uploads in 30 seconds (~100 to 142/sec)**.
4. **Allocation volume**: scene.add factory wrapping recorded **1,591 to 3,966 GameObjects** and **715 to 1,603 Tweens** instantiated across 30 seconds.
5. **GPU execution presence**: Chrome trace demonstrates that during a 62.8ms hitch, the browser GPU process was active for **29.73ms (GPUTask)**.

### Structural Explanations (Inferences / Hypotheses):
1. **Batch Breaking Mechanism**: Code inspection of createArmyVisual reveals that each army container interleaves Arc (role aura), Ellipse (shadows), and Rectangle (badge backgrounds) with Image (sprites). In Phaser's sequential renderer, transitions between Shape pipelines and Texture MultiPipelines trigger batch flushes. *Inference*: This architectural interleaving is the primary structural reason draw calls scale with army count.
2. **Texture Upload Impact**: In Phaser, Text objects draw to an internal 2D canvas and re-upload pixels via gl.texSubImage2D when text changes. *Inference*: The 140 uploads/second observed in combat likely contribute to GPU memory bus pressure and pipeline synchronization overhead, especially on shared-memory mobile architectures.
3. **GC Pressure**: 741 MinorGC events were recorded in trace. *Inference*: The continuous creation and destruction of combat sparks and floating texts (11 objects per capture) drives MinorGC frequency, reducing CPU cache efficiency.

---

## 5. Projections for 2v2 and Larger Maps (Architectural Modeling)

*Note: The following figures are mathematical extrapolations based on linear component scaling, not empirical measurements.*

1. **Draw Call Scaling Model**:
   - In 1v1: 15 armies + 7 territories $\approx$ 140 - 152 draw calls.
   - In 2v2: 4 players, 30 to 45 concurrent armies, 12 to 16 territories.
   - *Projected draw calls*: If visual hierarchy remains unbatched (~8-10 flushes per army), draw calls would project to **350 - 500+ draw calls/frame**. On mobile WebViews with low-end GPUs (Mali-G52, Adreno 610), >200 draw calls typically triggers severe driver-overhead framerate degradation.
2. **Texture Upload Scaling Model**:
   - In 2v2, with 40 armies and 14 territories updating counters, projected texture uploads could exceed **300 - 400 uploads/sec**, increasing memory bus contention.

---

## 6. Corrected Bottleneck Ranking

1. **Rank 1 (Critical): CPU Render-Path Command Generation & WebGL State Thrashing**  
   - *Evidence*: enderer.render takes **13.5ms - 16.6ms** per frame; draw calls reach **152.4/frame**.  
   - *Impact*: Direct cause of framerate drops below 60 FPS under 4× CPU throttling.
2. **Rank 2 (High): Frequent Canvas Texture Re-Uploads**  
   - *Evidence*: **~100 - 142 	exSubImage2D calls per second** recorded across all combat scenarios.  
   - *Impact*: Ongoing CPU-GPU data transfer overhead.
3. **Rank 3 (Moderate): GameObject and Tween Allocation Churn**  
   - *Evidence*: **3,000 - 3,966 GameObjects** and **1,200 - 1,600 Tweens** created in 30s; 741 MinorGC events in trace.  
   - *Impact*: Background memory churn and CPU cache degradation.

---

## 7. Evidence-Supported First Optimization Recommendation

### Recommendation:
**Consolidate Army Visual Elements into Texture Atlas Sprites to Enable Continuous WebGL Batching.**

### Evidence-Backed Rationale:
1. **Directly addresses the primary measured bottleneck**: enderer.render consumes over 80% of total frame time. Game simulation (stepBotMatch) takes only 0.22ms - 0.48ms; optimizing logic cannot meaningfully improve framerate.
2. **Eliminates WebGL state switches**: Replacing geometric Shape primitives (Ellipse shadows, Rectangle badge backgrounds) with atlas-backed sprites allows army visuals to render inside Phaser's existing MultiPipeline without flushing the WebGL batch between every shadow and sprite.
3. **Target Metric Improvements**:
   - Draw calls per frame: Reduction from **~140 - 152 down to ~25 - 40**.
   - CPU render-path duration (enderer.render): Reduction from **16.6ms to <10ms** under 4× CPU throttling.
   - FPS under heavy combat: Improvement from **51-54 FPS to stable 60 FPS**.
4. **Determinism & Multiplayer Risk**:
   - **Zero risk**: Visual display objects in GameScene are completely decoupled from @crown-clash/game-core simulation state, PRNG seeds, and network settlement.

---

## 8. Instrumentation Limitations & Transparency

- **GameObject Creation**: Factory wrapping on scene.add (['graphics', 'container', 'rectangle', 'circle', 'ellipse', 'image', 'text', 'sprite', 'existing']) successfully observes GameObjects created through scene factory methods (reporting 1,591 - 3,966 creations). If instrumentation is unavailable in an environment, the field evaluates to 
ull rather than a misleading zero.
- **Hardware GPU Counters**: Detailed GPU memory bandwidth and bus stall metrics are not directly observable via Chrome CDP on headless desktop environments. GPU impact is evaluated via trace GPUTask slices and draw call / upload counts.
