# Bot difficulty selection

Players can choose Easy, Normal or Hard before a new bot battle, including the first real battle after training, PLAY AGAIN and Realm practice. The last confirmed choice is saved on the device. Cancelling does not issue a ticket; a resumed practice retains its original level. Ranked, friend, revenge and live matches keep their existing automatic defense behavior.

This addresses players who need a gentler introduction or a stronger challenge. The smallest implementation changes reaction cadence and reuses the existing legal AI. Start/end/quit events retain their production names and add server-verified `botDifficulty`, so completion, early exits and second-game starts can be compared by level. This implementation does not demonstrate increased retention.

| Level | Decision interval | Troops, production and legal moves |
| --- | ---: | --- |
| Easy | 3.6 seconds | Existing shared rules |
| Normal | 1.8 seconds | Exact released behavior |
| Hard | 0.9 seconds | Existing shared rules |

There are no extra units, hidden speed/production multipliers, reward bonuses or new economy policies. AI sees only the current board and visible armies. Training itself remains the existing passive, reward-free lesson.

## Authority and compatibility

`match/start` accepts `botDifficulty`; missing values mean Normal, unknown values fail. The server pins the selected level in its ticket and `bot_matches.bot_difficulty`. Settlement derives AI timing from the owned ticket, never a client-reported level or result. Migration 020 gives historical rows the Normal default and restricts new values to the three levels. Existing rules versions and live simulations remain intact.

Active practice tickets cannot change difficulty. Clients advertise `supportsBotDifficulty` on Realm home; older clients encountering an active non-Normal practice receive `client_update_required`. Ordinary old clients continue receiving Normal tickets. The existing rules negotiation and rollback to v2 also work with the new selection.

Deploy the backend/migration before the new frontend: the previously released backend strictly rejects the new start field. This work is isolated on `feat/bot-difficulty`; master has automatic production deployment, so pushing or merging there would publish the feature.

## Verification

```sh
npm test
npm run typecheck
npm run build
(cd apps/server-nakama && TEST_POSTGRES_DSN='postgres://crownclash:crownclash@127.0.0.1:5433/crownclash?sslmode=disable' go test -count=1 ./...)
node scripts/tactical-parity.mjs
node scripts/bot-difficulty-history.mjs
node scripts/bot-difficulty-balance.mjs
TEST_POSTGRES_DSN='postgres://crownclash:crownclash@127.0.0.1:5433/crownclash?sslmode=disable' node scripts/bot-difficulty-negative-controls.mjs
node scripts/bot-difficulty-qa.mjs
node scripts/tactical-qa.mjs
```

- Real PostgreSQL tests cover RPC selection, persistence, validation, old-client defaults, active practice pinning, settlement stats derived from the level, duplicate settlement/ledger protection and correction of forged analytics metadata.
- Cross-engine replay covers 60 cases across v1/v2/v3, all maps, modifiers and levels, plus 1,500 route/army/AI checkpoints. Historical comparison covers 54 exact full-state/summary replays against `tactical-v3-2026-10-14`; default/Normal behavior is unchanged.
- Negative controls bypass the first-match choice, collapse Easy to Normal, omit the wire-level choice, and ignore the server-pinned level during settlement. Each must fail its intended assertion, then pass after restoration.
- Chrome mobile emulation at 360×640 and 390×844 exercises real touch selection, all three issued tickets and AI clocks, real settlement, remembered replay choice, cancellation without extra tickets, shutdown cleanup and analytics ingestion. The existing tactical gesture/animation checks also run. Screenshots are visually inspected. A discovered input leak to the underlying canvas was fixed by suspending scene input while the choice is open.

Evidence and full command traces are generated under ignored `qa-artifacts/bot-difficulty/`. QA advances the ordinary client simulation to finish matches quickly; it does not substitute a forged result or settlement. These are browser emulation checks, not physical Android or messenger WebView proof. The existing large Phaser build-chunk warning remains.

The final full JavaScript run passes 939 tests (197 core, 22 platform, 698 game, 22 scripts), with the two existing opt-in checks skipped. Typecheck, build and Go tests with real PostgreSQL pass. Legacy parity also passes all 68 1v1 and 29 2v2 replay scenarios; the 1v1 prediction count excludes one deliberately corrupted replay. No physical-device or live-network claim is made from the skipped checks.

## Simulation findings

216 scripted matches use center rush, one flank, split expansion and defense/counterattack on all three maps, with both sides and player decision intervals of 1.8, 2.7 and 3.6 seconds. The bot wins 44/72 (61.1%) at Easy, 60/72 (83.3%) at Normal and 64/72 (88.9%) at Hard; Normal has one draw. The same troop economy is used throughout. Full traces are replayable in `balance.json`.

The probes establish a graded aggregate challenge for these scripts. They do not predict human win rates, guarantee every individual matchup is ordered, or prove retention. Normal and Hard remain challenging against these simple policies. Human feedback and real-device checks remain open.
