# Army Visuals Rendering Optimization Report

## Executive Summary

This report validates the **Shape-pipeline batch-breaking hypothesis** diagnosed in `qa-artifacts/mobile-stutter-diagnostics.md`.

By replacing `Phaser.GameObjects.Shape` objects in army visuals (`roleAura`, follower `shadow`, `leaderShadow`, and `badgeBg`) with batch-friendly `Phaser.GameObjects.Image` objects sharing runtime-generated textures on `MultiPipeline`, and grouping army container children by pipeline, we achieved:

- **-56% to -71% reduction in draw calls per frame** across all tested combat scenarios (dropping from ~98-152 to a flat ~43-44 draw calls/frame).
- **-2.05ms to -4.13ms per-frame rendering time reduction** in Phaser's WebGL render loop under 4x CPU mobile throttling.
- **FPS increased to a solid ~60 FPS** (59.6 - 60.0 FPS) across normal, heavy, rapid dispatch, and late-match pressure scenarios.
- **Long tasks (>50ms) dropped to 0** across all candidate scenarios.
- **Zero visual regressions or compromises**: Troop badges retain crisp borders, rounded styling, and high-contrast text; unit shadows and role auras render with exact alpha and color tints.

## Controlled Benchmark Results (375x667@2, 4x CPU Throttling, Hardware WebGL, Fast 4G)

| Scenario | Draw Calls/frame (Base → Cand) | Draw Call Δ | Render Loop ms (Base → Cand) | Render ms Δ | Presented FPS (Base → Cand) | P95 Delta (Base → Cand) | Verdict |
|---|---|---|---|---|---|---|---|
| `normal_combat` | 98 → 43 | **-56.1%** | 13.51ms → 11.46ms | **-15.2%** | 59.5 → 60 | 22.5ms → 22.9ms | PASS (Improved) |
| `heavy_combat` | 139.9 → 43.6 | **-68.8%** | 15.8ms → 12.32ms | **-22%** | 53.9 → 59.6 | 23.7ms → 22.7ms | PASS (Improved) |
| `rapid_dispatches` | 118.2 → 43.4 | **-63.3%** | 14.48ms → 12.12ms | **-16.3%** | 58 → 59.7 | 22.5ms → 23.4ms | PASS (Improved) |
| `late_match_pressure` | 152.4 → 44 | **-71.1%** | 16.64ms → 12.51ms | **-24.8%** | 51.6 → 59.6 | 24.8ms → 22.8ms | PASS (Improved) |

## Subsystem Attribution Comparison (avg ms/frame)

| Scenario | Subsystem | Baseline ms/frame | Candidate ms/frame | Absolute Δ |
|---|---|---|---|---|
| `normal_combat` | **Phaser Rendering** | 13.51 ms | **11.46 ms** | **-2.05 ms** |
| `normal_combat` | Army Visuals Update | 0.22 ms | 0.21 ms | -0.01 ms |
| `normal_combat` | Simulation (stepBotMatch) | 0.22 ms | 0.24 ms | 0.02 ms |
| `normal_combat` | HUD Updates | 0.33 ms | 0.33 ms | 0.00 ms |
| `heavy_combat` | **Phaser Rendering** | 15.8 ms | **12.32 ms** | **-3.48 ms** |
| `heavy_combat` | Army Visuals Update | 0.42 ms | 0.34 ms | -0.08 ms |
| `heavy_combat` | Simulation (stepBotMatch) | 0.44 ms | 0.42 ms | -0.02 ms |
| `heavy_combat` | HUD Updates | 0.34 ms | 0.33 ms | -0.01 ms |
| `rapid_dispatches` | **Phaser Rendering** | 14.48 ms | **12.12 ms** | **-2.36 ms** |
| `rapid_dispatches` | Army Visuals Update | 0.32 ms | 0.29 ms | -0.03 ms |
| `rapid_dispatches` | Simulation (stepBotMatch) | 0.35 ms | 0.34 ms | -0.01 ms |
| `rapid_dispatches` | HUD Updates | 0.33 ms | 0.33 ms | 0.00 ms |
| `late_match_pressure` | **Phaser Rendering** | 16.64 ms | **12.51 ms** | **-4.13 ms** |
| `late_match_pressure` | Army Visuals Update | 0.42 ms | 0.35 ms | -0.07 ms |
| `late_match_pressure` | Simulation (stepBotMatch) | 0.48 ms | 0.44 ms | -0.04 ms |
| `late_match_pressure` | HUD Updates | 0.34 ms | 0.34 ms | 0.00 ms |

## False-Green Verification Proof

In compliance with the mandatory delivery guardrails:
1. **Positive Control**: All 6 tests in `apps/game/src/scenes/__tests__/ArmyVisualsBatching.test.ts` passed.
2. **Negative Control**: Replaced `leaderShadow` with the former Shape-based `this.add.ellipse(0, 9, 18, 7, 0x000000, 0.38)`.
   - **Result**: Exactly 2 tests failed with: `AssertionError: expected 'Ellipse' to be 'Image'`.
3. **Restoration**: Restored the batch-friendly Image implementation.
   - **Result**: All 6 tests returned to green with 0 errors.

## Visual Inspection Verification

Visual rendering was verified in headless Chrome under hardware WebGL across two key mobile viewports during active multi-lane combat:
- **375×667 @ DPR 2 (iPhone SE / compact mobile)**: Saved to `qa-artifacts/screenshots/visual_check_375x667.png`.
- **430×932 @ DPR 2 (iPhone 16 Pro Max / large mobile)**: Saved to `qa-artifacts/screenshots/visual_check_430x932.png`.
- Both viewports exhibited 0 console errors, 0 missing visuals, 0 clipping, and sharp readable troop count badges.
