# Gameplay rules v4: commander abilities and fog of war

v4 = v3 tactics (one-road attacks, routed supply, tactical opening, capture recovery) plus two additions. It is negotiated only for async/bot tickets. Live 1v1/2v2 stay on v2, Realm/pilot tickets are capped at v3, and the training battle is forced to v3.

## Negotiation and rollout

- The client advertises `supportedGameplayRulesVersions: [1,2,3,4]`. The server issues the highest version both sides support, capped by `ASYNC_GAMEPLAY_RULES_VERSION`:
  - unset or `4` → v4
  - `3` → v3
  - anything else → v2
- **Deploy the server before the client.** A v3 server rejects a 4-entry version list with `invalid_payload`.
- Migration `021_rules_v4_commander`:
  - widens `bot_matches.gameplay_rules_version` to 1–4
  - adds `commander_id`
- A v4 ticket stores the player's selected commander at issue and returns it as `commanderId`.

## Commander abilities (shared simulation, TS + Go)

Each ability can be used once per match, from 15 s of match time. It is recorded as a `{ kind: 'ability' }` action. Shield and supply use `targetId === sourceId`.

| Commander | Ability | Effect |
|---|---|---|
| `crown_guard` | سپر سلطنتی (royal shield) | Own tower defence ×2 for 8 s (`shieldedUntilMs`, integer match ms) |
| `quartermaster` | تدارکات (supply drop) | +5 units on an own tower |
| `vanguard` | یورش (charge) | A legal 50% send whose army arrives ×2 stronger and ×1.5 faster. The source pays only the usual half. Short legs stay capped by the 2 s minimum leg time. |

**Authority**
- The settlement replays abilities with the commander stored on the ticket and never with a client value.
- These uses are ignored:
  - an ability on v3
  - a second use
  - a use before 15 s
  - a use on a tower the player does not own
  - a use with no commander
- An unknown `kind` rejects the whole payload with `invalid_action_kind`.

**Code**
- TS: `packages/game-core/src/abilities.ts`, with constants in `ABILITY_CONFIG` (`gameplay-rules.ts`).
- Go: `apps/server-nakama/abilities.go`. Its constants must match the TS ones.

**The bot's ability**
- Easy has none, so new players meet a gentler opponent. Normal brings `quartermaster`, hard brings `vanguard` (`BOT_COMMANDER`). The choice depends only on the pinned difficulty, so the server replays it with no extra ticket field.
- One use per match, from 15 s, decided at the bot's own AI ticks before that tick's dispatches (`chooseBotAbility`):
  - vanguard: the first planned attack becomes the charge;
  - quartermaster: +5 on a tower that the incoming armies would capture and the extra units save; otherwise on the source of the first planned attack;
  - royal shield (supported by the engine, unused by the default mapping): only on a threatened tower that a shield would save, and only once the first hostile army is within the shield window.
- The client shows the cue "دشمن ..." with a floating label, a warning haptic and sound and a red ring for a shield. It does not add an analytics event: it is not a player action.
- Code: TS `packages/game-core/src/bot-abilities.ts`, Go `apps/server-nakama/bot_abilities.go`. `scripts/tactical-parity.mjs` checks both engines agree.

**Analytics**
- `ability_used` with `matchId`, `commanderId` and `atSeconds`.

## Fog of war (presentation only)

**Rule**
- A garrison count is visible on the player's own towers and on towers one road away.
- Hostile convoys show their count only on a leg that touches a visible tower.
- Ownership and tower type are always shown.
- Fogged towers get a dark veil and show "?".

**Why it is safe**
- Hostile orders already need one direct road, so every legal attack target stays visible (tested).
- The simulation never reads fog. Replay and settlement are therefore unchanged and need no Go code.

**Limits**
- The bot still reads the full state. Its tactical decisions only use towers adjacent to its own, so it gains little, but it is not fog-bound.
- Fog is client-side. It would not be secure for future real-time human-vs-human play.
- The dominance bar still reflects total units on both sides.

## Balance probe

`BOT_ABILITY=off node scripts/rules-v4-balance.mjs` reproduces the old baseline where the bot had no ability and writes `balance-no-bot-ability.json`.

**With the bot's ability (current default)**

| Player commander | No bot ability | Bot ability |
|---|---:|---:|
| none | 26.9% | 22.2% |
| crown_guard | 34.3% | 31.5% |
| quartermaster | 32.4% | 28.7% |
| vanguard | 35.2% | 31.5% |

By difficulty, a player with no commander: normal 13.9% → 8.3%, hard 13.9% → 5.6% (easy unchanged at 52.8%). The bot spent its ability in 144 of 144 normal games and 144 of 144 hard games. Each player commander still adds 6.5-9.3 pp over none, so the player ability keeps its value. The probe policies are scripted and weaker than people, so these are relative shifts, not expected human win rates.

Run `node scripts/rules-v4-balance.mjs`. The output goes to the git-ignored file `qa-artifacts/rules-v4/balance.json`.

The probe pits 4 scripted player policies × 3 player cadences against the real tactical bot. It covers every difficulty on all three 1v1 maps, with equal troops: 432 games in total. The policies are probes and do not model human skill.

**Player win rate by commander**

| Commander | Win rate | Δ vs none |
|---|---:|---:|
| none | 26.9% | — |
| crown_guard | 34.3% | +7.4 pp |
| quartermaster | 32.4% | +5.5 pp |
| vanguard | 35.2% | +8.3 pp |

**Player win rate by difficulty (none / guard / quartermaster / vanguard)**

| Difficulty | none | guard | quartermaster | vanguard |
|---|---:|---:|---:|---:|
| easy | 52.8% | 55.6% | 58.3% | 63.9% |
| normal | 13.9% | 25.0% | 19.4% | 16.7% |
| hard | 13.9% | 22.2% | 19.4% | 25.0% |

**How the numbers were tuned**
- The target was "≤ ~10 pp shift, no dominant commander".
- First pass: supply +10 gave +12.9 pp, and the old 100% all-in charge gave 0 pp (the empty source tower got counterattacked).
- Final values: supply +5, and a charge that is a 50% send arriving ×2 stronger and ×1.5 faster.

**Still open**
- Royal Ring still has 22 of 144 probe games with no direct clash between the two sides. This matches the v3 pacing warning, and abilities do not fix it.
- Human playtests and real-device checks are pending.
