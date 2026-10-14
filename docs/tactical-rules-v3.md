# Tactical rules v3 — implementation and validation

Implemented in the main game, with local frontend, Nakama/Go backend and PostgreSQL. The user requested publication of the current version on 2026-10-14 after reviewing the local game. This is a gameplay hypothesis, not evidence of improved retention. The simulation findings and pending human/device checks below remain open; release does not establish that these checks passed.

## Rules and compatibility

- Async tickets negotiate v3 only when the client advertises `supportedGameplayRulesVersions: [1,2,3]` and `ASYNC_GAMEPLAY_RULES_VERSION=3`. Old clients receive new v2 tickets. Setting the runtime variable to `2` rolls back **new** tickets; active practice/Realm tickets retain their issued version. An old client encountering an active v3 ticket receives `client_update_required`, rather than replaying it under v2.
- Live 1v1 and 2v2 remain v2. `GAMEPLAY_RULES_VERSION` / `CurrentGameplayRulesVersion` intentionally remain `2`; the async tactical constant is separate. Capture recovery uses an explicit v2/v3 capability. 2v2 explicitly rejects v3.
- The base receives the existing starting-army calculation plus 8 (28 without modifiers). Each side's designated support receives 14; starting-army upgrades do not affect support. Existing commander, production, speed, friendly-equality and reward policies remain in effect.
- Hostile orders require one direct road. Friendly orders follow the lowest integer cost path across currently friendly towers: each edge costs `round(distance * 1000)`, ties use the lexicographic ordered ID path. Each leg lasts at least 2 seconds. The source's effective speed multiplier is locked for the journey.
- The source pays half once. Friendly waypoints neither deposit nor resend units. A hostile waypoint resolves combat and ends the journey, including when the army recaptures it. Destination ownership is evaluated at arrival.
- Army snapshots retain `routeIds`, `routeLeg`, and `routeSpeedMultiplier`. Commands still contain only source, **final destination**, timestamp and sequence. The server reconstructs the route from its replay state; client route/result data is not accepted as authority.
- Existing roads, tower roles, production, 3-second capture recovery, 90-second limit and ordinary victory rules remain. Crown Hold is removed from the menu and registered runtime scenes; its old URL enters the main menu. Existing prototype source files are left as inactive pre-task material.

## Changed modules

| Area | Implementation |
| --- | --- |
| Shared rules | `packages/game-core/src/{gameplay-rules,tactical-routes,dispatch,simulation,pvp,init2v2}.ts` |
| AI and previews | `tactical-ai.ts`, `order-preview.ts`; legal rescue, coordinated adjacent conquest, then rear-to-front reinforcement at the existing 1.8-second cadence |
| Go authority | `apps/server-nakama/{tactical,domain,store,pilot_practice,realm_store,realm_rpc,main,types,simulate2v2}.go` |
| Database | Migration 018 accepts ticket versions 1/2/3 without rewriting old tickets; migration 019 repairs schema-local analytics uniqueness |
| Gameplay UI | `GameScene.ts`, `ui/TacticalDrag.ts`: legal highlights, actual supply path, send/stay counts, conditional forecast, leg-by-leg visuals and interruption feedback |
| Entry/tutorial | `NakamaClient.ts`, `PilotClient.ts`, `main.ts`, `MenuScene.ts`, `TutorialController.ts`, `tacticalGuidance.ts` |
| Analytics | Additive rules metadata on start/end/quit, ticket ownership/version verification in `tactical_analytics.go`, comparison SQL in `docs/analytics/tactical-cohorts.sql` |

Migration 019 was necessary for the real PostgreSQL tests: the older migration checked a constraint name across all schemas, so an isolated test schema could miss its uniqueness constraint when the public schema already contained one. The repair checks the table identity too. It does not change economy or gameplay rules.

A second ingestion blocker was found by the browser-to-database assertion: the existing client emits `match_menu_opened`, `match_resumed`, `match_leave_requested`, `match_leave_cancelled` and `match_quit_confirmed`, but the server allowlist omitted them. Those exact existing names and schemas are now accepted. A versioned bot quit is also accepted and verified; Realm quit is recorded after successful abandonment. A real PostgreSQL regression first failed with `invalid_event_name`, then passed after the allowlist fix.

The estimate is conditional on the current board. It resolves the selected waves in arrival order with fortress defense, but does not promise future production, opponent orders or supply survival. No new artwork, currencies, rewards or progression systems were added.

## Reproducible checks

Run from the repository root unless stated otherwise. Local PostgreSQL uses port 5433.

```sh
npm test
npm run typecheck
npm run build
(cd apps/server-nakama && go test -count=1 ./...)
(cd apps/server-nakama && TEST_POSTGRES_DSN='postgres://crownclash:crownclash@127.0.0.1:5433/crownclash?sslmode=disable' go test -count=1 -run 'TestTacticalPostgres' -v .)
CROSS_ENGINE_GO_MODE=host npm run test:parity
CROSS_ENGINE_GO_MODE=host npm run test:parity:2v2
node scripts/tactical-parity.mjs
node scripts/tactical-balance.mjs
node scripts/tactical-cohort-report.mjs
TEST_POSTGRES_DSN='postgres://crownclash:crownclash@127.0.0.1:5433/crownclash?sslmode=disable' node scripts/tactical-negative-controls.mjs
node scripts/tactical-qa.mjs
```

`TACTICAL_BASELINE_DIR=<pre-task-snapshot> node scripts/tactical-history-check.mjs` compares full v1/v2 outputs with the original working tree, including its pre-existing edits. The snapshot location and an incremental task patch are recorded in `qa-artifacts/tactical/change-manifest.json`. The patch applies **over that snapshot**, not over clean HEAD.

Evidence produced under ignored `qa-artifacts/tactical/`:

- Core tests: all three openings, illegal/disconnected orders, lexical ties, no duplicate debit/deposit, JSON save/resume, waypoint interception including recapture, destination changes, recovery, multi-selection, fortress forecast, exposed-flank counterattack and AI rescue/visible intercepted supply.
- Scene/tutorial tests: five original tutorial step IDs complete with legal attacks and multi-leg supply; source/destination command recording; ticket-pinned initialization and restart cadence.
- PostgreSQL: real RPC negotiation, rollback, old-ticket continuation, old-client refusal, invalid command rejection, idempotent settlement/ledger, verified analytics version, friend/ranked/revenge tickets and equal-power policy. A fixture also verifies cohort counting, duplicate-event handling and D1 eligibility.
- Cross-engine: 24 v1/v2/v3 cases including 1,500 complete state/army/AI checkpoints and all three maps. Historical comparison: 36 exact v1/v2 replay comparisons with pre-task state.
- Negative controls: deliberately permitting remote attacks, recording a waypoint instead of the final target, and dropping RPC capabilities each fail the intended test. Original files are restored in `finally` and their tests rerun successfully.
- Browser: real temporary local accounts and real v3 tickets at 360×640 and 390×844. Touch entry, rejected remote attack, legal capture, multi-leg supply, correct recorded destination, pause/resume, resize and quit. Screenshots were visually inspected. Cleanup deletes only the test's own account/data. Browser profiles stay outside the repository.

The full JavaScript run passes 934 tests (194 core, 22 platform, 696 game and 22 script tests). Typecheck and production build pass. Go unit tests and four real PostgreSQL tactical tests pass. Legacy parity passes 68 replay scenarios for 1v1 and 29 for 2v2. The 1v1 aggregate prediction count of 67/68 includes one deliberately corrupted replay whose uncorrupted prediction is intentionally excluded from the equality requirement.

The general test command leaves its pre-existing opt-in live socket/device tests skipped. These skips are not counted as live-network or physical-device proof. Build still reports the existing large Phaser chunk warning; no low-end Android performance claim is made.

## Simulation findings and open balance issues

108 deterministic matches compare center-first, one-flank expansion, split expansion and defensive/counterattack policies on three maps, with swapped player/enemy assignments and reaction delays of 0, 0.6 and 1.2 seconds. Full issued-command traces are saved in `balance.json`. These scripted policies are probes, not models of real player skill.

| Policy | Wins / games | Win rate |
| --- | ---: | ---: |
| Center first | 5 / 54 | 9.3% |
| One flank | 29 / 54 | 53.7% |
| Split | 28 / 54 | 51.9% |
| Defense/counterattack | 46 / 54 | 85.2% |

Median first direct opponent clash: **8.6 seconds**. Six matches reached 90 seconds without a direct opponent clash; all were Royal Ring, flank/split versus counterattack. These contain neutral expansion and commands, so they are not input freezes, but they are a tactical pacing warning. The counter policy's advantage also warrants investigation. Additional idle probes lose on all three maps from both sides (0/6 idle wins).

Core replay fixtures demonstrate that withdrawing the same flank troops changes an otherwise held defense into a loss, and that cutting a supply waypoint prevents its units from reaching the destination. This establishes that those choices have consequences; it does not prove broad balance.

**Original recommendation: hold broad publication.** The user subsequently requested release on 2026-10-14. Investigate Royal Ring's non-contact endings and the policy imbalance after this release; the release decision is not evidence of resolved balance. No numbers, rewards or hidden bot bonuses were adjusted to mask these results. Changing the approved starting values is a separate product decision.

## Measurement and human validation

Event names remain unchanged. `gameplayRulesVersion` is additive and verified from the owned server ticket. The SQL reports starts/completions, second-game starts/completions per session and rules version, rematches after loss, quits before 15 seconds, mean duration, and eligible/returned D1 players using Tehran calendar days. D1 only includes players whose entire following day has elapsed. Repeated envelopes do not inflate match counts. Old events without verified rules metadata are excluded, rather than guessed into the v2 baseline.

The local report currently contains no eligible production cohorts. Zero observations and null duration are **not** evidence of zero retention or of improvement. Cohort results are descriptive, not a randomized causal comparison.

The requested 12-person in-person session remains pending. Use six participants in v2→v3 order and six in v3→v2 order; keep maps, upgrades and commanders comparable and rotate the three maps evenly. After each version, offer another round without promising a reward, and record whether they choose it. Ask them to explain their last mistake and intended next move, without suggesting an answer. Record confusion, early exits and time to meaningful action. This is early qualitative feedback; retention claims require real cohort data.

Real touch devices and messenger WebViews, especially weak Android devices, remain unverified. Desktop Chrome mobile emulation does not establish haptic quality, thermal performance or WebView behavior.

## Local delivery and change isolation

Frontend: `http://localhost:3000/`; Nakama: `http://127.0.0.1:7350/healthcheck`; PostgreSQL: `127.0.0.1:5433`.

To start the stack: `docker compose up -d --build nakama`, then `npm run dev -- --host 0.0.0.0`. The compose dependency starts PostgreSQL and runs backend migration setup. Preserve the existing local environment configuration.

The repository already contained uncommitted Realm, payment, platform and prototype work. Those changes were preserved. The task delta and before/after hashes are separated in `qa-artifacts/tactical/implementation.patch` and `change-manifest.json`. The initial local delivery did not commit, push or deploy. The later user-authorized release records its Git revision and deployment evidence separately.
