# Crown Clash — Real-Device Gameplay & Adverse-Network QA Checklist

This document provides a repeatable, standardized testing workflow for measuring Crown Clash performance, game feel, lifecycle behavior, and network resiliency on physical Android and iOS devices, specifically targeting low-end hardware inside the **Bale Mini App** WebView.

---

## 1. Device Matrix

| Tier | Representative Hardware | OS & Webview | Primary Focus |
| :--- | :--- | :--- | :--- |
| **Low-End Android (Target)** | Samsung Galaxy A12/A14/A04, Redmi 9A/10C (2GB–3GB RAM, Mali-G52 / PowerVR) | Android 10–13, Android System WebView / Bale | Frame pacing, touch latency, heap pressure, long frames (>33.3ms) |
| **Mid-Tier Android** | Samsung Galaxy A53/A54, Redmi Note 11/12 (4GB–6GB RAM) | Android 13–14, Chrome & Bale Mini App | Sustained 60 FPS, stress mode stability, adverse network handoff |
| **Small-Screen iOS** | iPhone SE (2nd/3rd gen), iPhone 12/13 Mini (375×667, 390×844) | iOS 16–18, Safari & Telegram / Bale Web | HUD viewport fit, touch-target ergonomics, safe-area insets |

---

## 2. Preparation & Launch

### A. Local Network & Dev Server
1. Start the game server accessible to your local network:
   ```bash
   npm --workspace=apps/game run dev -- --host
   ```
2. Verify access from device via Wi-Fi: `http://<YOUR_LAN_IP>:3000/`

### B. Launch Modes & Query Parameters
- **Standard Player Build (HUD Disabled)**:
  `http://<YOUR_LAN_IP>:3000/`
  *Zero overhead: no HUD DOM created, no RAF loops, no extra allocations.*
- **Performance QA Mode**:
  `http://<YOUR_LAN_IP>:3000/?debug_performance=1`
  *Activates real-time performance overlay, rolling frame-time percentiles, memory sampling, and QA session logging.*
- **Stress Testing Mode**:
  `http://<YOUR_LAN_IP>:3000/?debug_performance=1&stress_armies=1`
  *Activates automated multi-lane army generator, displays prominent `⚠️ TEST MODE (NO PROGRESSION)` banner, and strictly isolates from career/settlement systems.*

### C. Bale Mini App Setup
When configuring the mini app in Bale Bot Father / Developer Console, provide the test URL with `?debug_performance=1`.

---

## 3. Real-Device QA Test Protocol

### Step 1: Verification of HUD Zero-Overhead Mode
- [ ] Launch `http://<YOUR_LAN_IP>:3000/` (without `debug_performance=1`).
- [ ] Inspect DOM: Confirm `#debug-perf-hud` is **not** present in the DOM tree.
- [ ] Play a bot match: Verify smooth 60 FPS baseline.

### Step 2: Overlay Usability & Touch Pass-Through
- [ ] Launch with `?debug_performance=1`.
- [ ] Verify HUD appears at top-right with:
  - Current FPS & rolling average FPS
  - P95 frame time & max frame time
  - Frames >16.7ms and >33.3ms counters
  - Phaser object count, active armies, active tweens, JS heap MB
  - Match and network status, build version
- [ ] Tap on game elements (towers, buttons) located behind transparent areas of the HUD:
  - **Pass**: Touches immediately register on the game canvas (`pointer-events: none` on text containers).
- [ ] Tap **Collapse [–]**:
  - **Pass**: HUD shrinks into an unobtrusive pill `🐞 [FPS | P95 | Heap | Armies]`.
- [ ] Tap **Expand [+]**:
  - **Pass**: Full stats panel restores cleanly.

### Step 3: Sustained Battle & Stress Mode
- [ ] Start a standard Bot Match or tap **Toggle Stress** on the HUD.
- [ ] In Stress Mode:
  - Verify floating top banner `⚠️ TEST MODE (NO PROGRESSION)` is prominently visible.
  - Observe continuous multi-lane army marches across center lanes.
  - Monitor memory heap: ensure heap remains stable (no runaway growth over 2 minutes).
  - Let match conclude or surrender:
    - **Pass**: Confirm **zero** career changes, **zero** trophy mutations, and **zero** remote match settlement requests occur.
- [ ] Tap **Reset Stats**:
  - Verify frame sample ring buffer, max frame time, and army peak counts reset cleanly to 0.

### Step 4: Exporting Session QA Report
- [ ] After 60+ seconds of active gameplay, tap **Copy QA Report**:
  - Toast confirmation appears.
  - Paste into notes or chat: Confirm JSON payload contains hardware specs, renderer, framerate percentiles, peaks, lifecycle stats, and zero PII.
- [ ] Tap **Export JSON**:
  - File `cc-qa-report-<timestamp>.json` downloads directly to device storage.

---

## 4. Adverse Network Verification

Execute the following network stress tests on the physical device:

| Scenario | Procedure | Expected Behavior | Pass/Fail |
| :--- | :--- | :--- | :--- |
| **1. 100ms / 300ms Latency** | Enable Chrome DevTools throttling (Slow 4G / 300ms RTT) or proxy. Dispatch army. | Tower units deduct immediately (optimistic prediction). Authoritative state confirms cleanly without visual glitch. | [ ] |
| **2. Temporary Drop (3s)** | During active match, toggle Airplane Mode ON for 3s, then OFF. | HUD displays `Net: offline (1 drops)`. Game presents syncing/reconnecting indicator. Match reconnects seamlessly. | [ ] |
| **3. Extended Drop (10s)** | Toggle Airplane Mode ON for 10s, then OFF. | State reconciles cleanly upon socket restore. Career rewards and settlements are strictly idempotent (no double rewards). | [ ] |
| **4. Short Backgrounding (10s)** | Switch to home screen or another app for 10s, then return to Crown Clash. | Audio pauses; game loop pauses. HUD records +1 pause, +1 resume, and ~10s background time. Animation smoothly catches up. | [ ] |
| **5. Long Backgrounding (60s)** | Switch away for 60s, then return. | Authoritative snapshot re-syncs. If match ended during absence, settlement screen displays canonical outcome once. | [ ] |
| **6. Network Switch (Wi-Fi ➔ 4G)** | Turn off Wi-Fi during match to force cellular handoff. | Socket reconnects with new session. In-flight commands are not duplicated. Match continues uninterrupted. | [ ] |

---

## 5. Performance Acceptance Thresholds

| Metric | Target (Low-End Android) | Target (Mid-Tier / iOS) | Unacceptable Threshold |
| :--- | :--- | :--- | :--- |
| **Average FPS** | ≥ 50 FPS | ≥ 58 FPS | < 40 FPS |
| **P95 Frame Time** | ≤ 24.0 ms | ≤ 18.0 ms | > 33.3 ms |
| **Frames > 33.3ms** | ≤ 3.0 % | ≤ 1.0 % | > 5.0 % |
| **Max Frame Time (non-load)** | ≤ 65.0 ms | ≤ 45.0 ms | > 100.0 ms |
| **Heap Growth (2 min battle)** | < 15 MB net growth | < 10 MB net growth | Continuous linear increase |
| **Console Errors** | 0 uncaught errors | 0 uncaught errors | Any uncaught exception |

---

## 6. QA Session Report Template

Submit this template with test runs:

```markdown
### Device QA Run
- **Tester**:
- **Date / Time**:
- **Device Model**: (e.g., Samsung Galaxy A14)
- **OS / Webview**: (e.g., Android 13, Bale Mini App v8.4.1)
- **Build Version**: (from HUD, e.g., v0.1.0-5001532)

#### Results
- **Average FPS**:
- **P95 Frame Time**:
- **Frames > 16.7ms**:       %
- **Frames > 33.3ms**:       %
- **Peak Objects**:
- **Peak Armies**:
- **JS Heap (Start / Peak)**:
- **Network Drops Observed**:
- **Adverse Network Pass**: YES / NO

#### Attached QA JSON Report
```json
<Paste generated JSON report here>
```
```
