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
