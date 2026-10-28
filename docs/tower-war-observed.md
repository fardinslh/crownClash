# Tower War, observed on a real device

Date: 2026-10-28. Device: Poco X7 Pro (Android 16, 1220x2712) driven over `adb`
(screenshots and `screenrecord`, tap/swipe injection). Build: Google Play
"Tower War - Tactical Conquest" (package `games.vaveda.militaryoverturn`).
Unlike `docs/tower-war-gap-analysis.md`, this is first-hand, but it covers only
the first session of level 1 on a fresh install. Nothing was bought and notification
permission was declined. Captures stay out of the repository (third-party art).

## First session, level 1

- Cold start goes straight into level 1: no menu, no account step. The only prompt before
  play is the OS notification permission.
- Level 1 is one blue tower (15 troops) and one small neutral tower (3). The caption is
  "Capture the tower" with a drag hand. A translucent circle marks the tower's reach.
- Step 2 caption: "Swipe to cut the path". Step 3: "Conquer all buildings to win", with two
  more neutral towers. Three captions in total, a pointing hand each time.
- The whole level took about 25 seconds and three gestures.
- A captured tower flashes yellow and then counts up (18, 19, 21 ... 62, 63, then "Max"): a
  tower has a garrison cap and shows "Max" at it.

## The core difference from Crown Clash

A drag does not send one batch. It opens a **lane**: a translucent blue beam from the
source tower to the target, along which single soldiers walk in file, **continuously**,
until the lane is cut. Observed:

- Troops are released one by one at a steady rate, so the target's count drops by 1 at a time
  (3, 2, 1, captured).
- The lane persists after the target is captured and keeps feeding it (the captured tower
  climbed to Max). Cutting means swiping across the beam; the stream stops at once.
- Several lanes can leave one tower at the same time (two drags gave two beams).
- The source tower's count stayed flat (23) while the stream ran, so it is a flow, not a
  50% send.

Crown Clash today: a drag sends 50% of a tower in one batch along roads, with fog of war,
commander abilities and capture recovery. That is a different game feel. Matching it means a
new rules version with lanes (see "What a lane version needs").

## Result screen

- "VICTORY" banner over a winged soldier badge, star icons, confetti, a coin counter
  that ticks up (0, 23, 28).
- "REWARDS" panel with the coin reward (28 for level 1).
- A green "X3" button with an ad icon (rewarded ad to triple the reward). The "NO THANKS"
  link appears only after a delay. Crown Clash must not copy the delayed decline: it is a dark
  pattern under `AGENTS.md`, and ad availability inside Bale/Eitaa is unverified.
- A round "New Region 3% -> 5%" badge: long-term map progress per win.

## What a lane version needs (not built)

1. Rules version v5 for bot/async only, negotiated like v4. The existing 50% dispatch rules
   stay for live PvP and old clients.
2. Simulation: a lane is (source, target, owner). While it exists the source emits one
   soldier every N ms, a source never goes below 1, and arrivals reinforce friendly or
   attack hostile towers. A "cut" action removes a lane. Both the TS and the Go simulation
   must implement it identically; `test:parity` and the recorded-win replays cover it.
3. Replay: actions gain a `cut` type (lane id or the segment the swipe crossed), `MaxPvpActions`
   and the settlement replay accept it, and the bot AI opens and cuts lanes.
4. Client: drag opens a lane, swipe across a lane cuts it, soldier file animation, garrison
   cap ("Max").
5. Balance by simulation: levels and the weekly challenge would need re-tuning (the recorded
   winning runs are specific to the 50% rules).

This is a multi-day change with real regression risk. It should be built behind the v5 flag,
proven by simulation first, and not shipped on the strength of one observed level.

## Lane feasibility, by simulation (2026-10-28)

`packages/game-core/src/lanes.ts` is a prototype of the lane mechanic on top of the existing
tower, road and production model. It is **not wired** into any ticket, the Go server or the
client, and rules versions 1-4 are untouched. Rules: a drag opens a lane; the source sends one
soldier every 0.2 s and never drops below 1 unit; an arriving soldier adds 1 to a friendly tower
(up to `maxUnits`) or removes 1 defender from a hostile one, and captures it at zero; a cut stops
the stream. `scripts/lanes-sim.mjs` plays the four probe policies at three reaction delays against
a lane-using bot:

| Bot | Map | Probe win rate | Avg win time | Avg orders in a win |
|---|---|---|---|---|
| easy | crown_cross | 0.42 | 61 s | 37 |
| easy | twin_passes | 0.67 | 41 s | 25 |
| easy | royal_ring | 0.67 | 39 s | 26 |
| normal | crown_cross | 0.00 | | |
| normal | twin_passes | 0.17 | 61 s | 25 |
| normal | royal_ring | 0.33 | 41 s | 22 |
| hard | crown_cross | 0.17 | 60 s | 45 |
| hard | twin_passes | 0.08 | 24 s | 14 |
| hard | royal_ring | 0.33 | 36 s | 16 |

What it shows: the mechanic runs to a result on every map (no stalled matches), wins take 25-60 s,
and a win needs 14-45 orders instead of up to the 120-action cap. What it does not show: the bot
here is the existing 50% bot reused for lanes (not tuned for streams), normal on `crown_cross` is
unwinnable for the probes, difficulty is not monotonic, and nothing says a human finds it fun. The
remaining work is the list above (Go port, `cut` action, replay, bot, client lane drawing and
soldier file, re-tuning, parity), not tuning of this prototype.
