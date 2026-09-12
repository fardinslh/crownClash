# False-Green Guard Verification Report

This report documents the negative control proofs and sensitivity verification for the Crown Clash benchmark harness, in accordance with the mandatory delivery guardrails.

## Sensitivity Proofs & Negative Controls

| Control # | Condition Tested | Injected Fault | Expected Reason / Code | Verification Outcome |
| :--- | :--- | :--- | :--- | :--- |
| **NC-1** | Software WebGL Detection | `isSoftwareRenderer: true` (SwiftShader) | `SOFTWARE_WEBGL_DETECTED` | **FAILED AS EXPECTED** (Passed on hardware WebGL) |
| **NC-2** | Steady-State Army Bound | Army count 11 vs allowed [5, 10] | `ARMY_COUNT_OUT_OF_STEADY_STATE_BOUNDS` | **FAILED AS EXPECTED** (Passed on 6-9 armies) |
| **NC-3** | PRNG Seed Identity | Candidate seed `99999` != baseline `12345` | `SEED_MISMATCH` | **REJECTED AS EXPECTED** (Accepted on identical seed) |
| **NC-4** | CPU Throttle Identity | Candidate `4x` != baseline `1x` | `CPU_THROTTLE_MISMATCH` | **REJECTED AS EXPECTED** (Accepted on identical throttle) |
| **NC-5** | Network Profile Identity | Candidate `Slow 4G` != baseline `LAN` | `NETWORK_PROFILE_MISMATCH` | **REJECTED AS EXPECTED** (Accepted on identical network) |
| **NC-6** | Scenario Name Identity | Candidate `heavy_combat` != baseline `normal_combat` | `SCENARIO_NAME_MISMATCH` | **REJECTED AS EXPECTED** (Accepted on identical scenario) |
| **NC-7** | Duplicate Postrender | `duplicateFramesDropped: 5` | `POSTRENDER_DUPLICATE_DETECTED` | **FAILED AS EXPECTED** (Passed on 0 duplicates) |
| **NC-8** | Background Lifecycle | Missing active/resumed transition | `INVALID_BACKGROUND_TRANSITION` | **FAILED AS EXPECTED** (Passed with frozen+resumed) |
| **NC-9** | Missing Comparison Identity | Empty `scheduleHash` / `gpuVendor` | `MISSING_COMPARISON_IDENTITY` | **REJECTED AS EXPECTED** (Accepted with full metadata) |

## Exact Failure Reason Outputs

### NC-1: Software WebGL
```
Failures: [
  "SOFTWARE_WEBGL_DETECTED: Software rasterizer detected ('Google SwiftShader'). Hardware WebGL is required."
]
```

### NC-2: Army Count > 10
```
Failures: [
  "ARMY_COUNT_OUT_OF_STEADY_STATE_BOUNDS: steady-state army count 11 outside allowed range [5, 10]"
]
```

### NC-3: Seed Mismatch
```
Rejection: {
  rejected: true,
  reasonCode: "SEED_MISMATCH",
  message: "PRNG seed mismatch: baseline 12345 != candidate 99999"
}
```

### NC-4: CPU Throttle Mismatch
```
Rejection: {
  rejected: true,
  reasonCode: "CPU_THROTTLE_MISMATCH",
  message: "CPU throttling mismatch: baseline 1x != candidate 4x"
}
```

### NC-5: Network Profile Mismatch
```
Rejection: {
  rejected: true,
  reasonCode: "NETWORK_PROFILE_MISMATCH",
  message: "Network profile mismatch: baseline 'LAN' != candidate 'Slow 4G'"
}
```

### NC-6: Scenario Name Mismatch
```
Rejection: {
  rejected: true,
  reasonCode: "SCENARIO_NAME_MISMATCH",
  message: "Scenario name mismatch: baseline 'normal_combat' != candidate 'heavy_combat'"
}
```

### NC-7: Duplicate Postrender Callbacks
```
Failures: [
  "POSTRENDER_DUPLICATE_DETECTED: 5 duplicate or non-monotonic postrender frame(s) detected"
]
```

### NC-8: Invalid Background Transition
```
Failures: [
  "INVALID_BACKGROUND_TRANSITION: background_resume scenario missing required transitions (hidden/frozen: true, active/resumed: false)"
]
```

### NC-9: Missing Comparison Identity Metadata
```
Rejection: {
  rejected: true,
  reasonCode: "MISSING_COMPARISON_IDENTITY",
  message: "Missing required comparison identity metadata 'scenario.scheduleHash' (baseline: a1b2c3d4, candidate: empty)."
}
```

## Restored Test Execution Evidence

All 9 negative controls are verified as part of the automated regression suite in `apps/game/src/debug/benchmark/__tests__/FalseGreenControls.test.ts`:
```
 RUN  v3.2.7 E:/MyProjects/crownClash
 ✓ apps/game/src/debug/benchmark/__tests__/FalseGreenControls.test.ts (9 tests)
 Test Files  1 passed (1)
      Tests  9 passed (9)
```
