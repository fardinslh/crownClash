# Crown Hold playtest

Run `npm run dev -- --host 0.0.0.0`, then open
<http://localhost:3000/?prototype=crown>. The comparison screen starts without
authentication or tutorial completion. The completed-tutorial main menu also
has a **CROWN HOLD · PLAYTEST** button; **PLAY** remains the original game.

## The experiment

The reported player problem is that the opening feels like waiting for units
and repeatedly taking towers. This prototype tests whether an immediate,
contested objective creates readable attack/defense choices and a reason to
voluntarily play another round. It is restricted to one existing map, Crown
Cross, with one local bot opponent. No new network mode, currency, assets, or
progression system is introduced.

- **Crown Hold:** own the center continuously for 12 seconds to win. A capture
  resets the clock to zero, including a capture and recapture in one simulation
  tick. Reinforcement and repelled attacks do not reset it. The center produces
  no troops. Each side starts with a 28-unit base and a symmetric 14-unit support
  tower; the neutral crown starts with 6. A 90-second stalemate is a draw,
  regardless of territory majority. A completed hold at the deadline wins;
  captures at that tick resolve first.
- **Classic:** the original simulation, AI, unit counts, capture recovery, and
  conquest/time-limit victory rules on Crown Cross. Both practice options use
  base-level modifiers, without account upgrades. This compares the complete
  proposed experience, not an isolated change to just the victory condition.
- **Controls:** the existing drag and multi-select controls. The crown ring and
  HUD show who is holding and how long remains. The pause menu stops the match
  and hold clock. Results offer **PLAY AGAIN**, a direct switch to the other
  mode, and **CHOOSE MODE**.

`apps/game/src/prototype/CrownMatch.ts` owns the experimental config, setup,
objective stepping, and objective-aware AI. It wraps the existing simulation
without changing the shared/server rules. The bot coordinates crown attacks,
reinforces its hold, and accounts for troops already in transit before expanding.
The 12-second hold and bot tuning are starting hypotheses, not validated balance.
Watch specifically for a dominant opening rush or repetitive center-only play.

## Isolation and playtest evidence

Prototype scenes never construct/connect a career manager, request match
tickets, settle matches, grant rewards, or apply account modifiers. They reject
prototype activation alongside a live payload, training, or a real bot ticket.
Server rules and production analytics schemas are unchanged.

Playtest events use the separate `crown-clash:prototype` browser event and a
bounded 100-event sessionStorage buffer, `crown_clash_prototype_events_v1`.
Events record starts (menu/rematch/compare), first dispatch, crown captures,
results, and quits, without user identity. They are **local to the browser tab**;
they do not go to the production analytics endpoint. These are diagnostic
observations, not trusted competitive results or retention measurements.

Useful comparisons: time to first dispatch/crown contest, whether ownership
changes create new decisions, and voluntary same-mode rematches. No engagement
improvement is claimed until people play both versions.

## Verification

- `npm test`: 892 passed; two existing opt-in/environment skips.
- `npm run typecheck`: passed.
- `npm run build`: passed; the existing Phaser chunk-size warning remains.
- `cd apps/server-nakama && go test -count=1 -json ./...`: 192 passed, six
  existing integration skips. No live backend or PostgreSQL verification claimed.
- `node scripts/crown-prototype-qa.mjs`: tests a production preview at
  `http://127.0.0.1:4181/?prototype=crown` by default; override `CC_QA_APP_URL`
  for another loopback preview. Passed at 360×640 and 390×844 with touch input,
  actual coordinated dispatch, capture/hold, pause, resize, result, rematch,
  switching to Classic, and quit. It accelerates match time through real scene
  updates for terminal checks, without forging a result. Every external request
  is intercepted; fixtures never reach a real account. A seeded upgraded career
  stays byte-for-byte unchanged, and no auth/ticket/settlement request is made.
- Unit negative controls shorten the hold and remove the settlement guard:
  the intended assertions fail, then pass after restoring the implementation.
- Additional negative controls redirect prototype analytics into the production
  event channel and open the wrong browser entry URL. Both fail at the intended
  assertions; the restored analytics tests and both mobile browser runs pass.
- `git diff --check`: passed.

Browser screenshots and evidence are generated under ignored
`qa-artifacts/crown-prototype/`; temporary Chrome profiles are created outside
the repository and removed in `finally`. Screenshots were visually inspected.
These checks use mobile emulation, not a physical Android device or messenger
WebView. The prototype is local and has not been deployed.
