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
| none | 27.8% | 23.1% |
| crown_guard | 38.0% | 32.4% |
| quartermaster | 34.3% | 31.5% |
| vanguard | 35.2% | 32.4% |

By difficulty, a player with no commander: normal 13.9% → 8.3%, hard 13.9% → 5.6% (easy unchanged at 55.6%). The bot spent its ability in 144 of 144 normal games and 144 of 144 hard games. Each player commander still adds 8.4-9.3 pp over none, so the player ability keeps its value. The probe policies are scripted and weaker than people, so these are relative shifts, not expected human win rates.

Run `node scripts/rules-v4-balance.mjs`. The output goes to the git-ignored file `qa-artifacts/rules-v4/balance.json`.

The tables above are the baseline with no bot ability (`BOT_ABILITY=off`), refreshed after the Royal Ring road change below. The probe pits 4 scripted player policies × 3 player cadences against the real tactical bot. It covers every difficulty on all three 1v1 maps, with equal troops: 432 games in total. The policies are probes and do not model human skill.

**Player win rate by commander**

| Commander | Win rate | Δ vs none |
|---|---:|---:|
| none | 27.8% | — |
| crown_guard | 38.0% | +10.2 pp |
| quartermaster | 34.3% | +6.5 pp |
| vanguard | 35.2% | +7.4 pp |

**Player win rate by difficulty (none / guard / quartermaster / vanguard)**

| Difficulty | none | guard | quartermaster | vanguard |
|---|---:|---:|---:|---:|
| easy | 55.6% | 61.1% | 66.7% | 63.9% |
| normal | 13.9% | 25.0% | 16.7% | 16.7% |
| hard | 13.9% | 27.8% | 19.4% | 25.0% |

**How the numbers were tuned**
- The target was "≤ ~10 pp shift, no dominant commander". The Royal Ring diagonals moved crown_guard from +7.4 to +10.2 pp in the no-bot-ability baseline (other commanders +1 pp), still at the edge of that target.
- First pass: supply +10 gave +12.9 pp, and the old 100% all-in charge gave 0 pp (the empty source tower got counterattacked).
- Final values: supply +5, and a charge that is a 50% send arriving ×2 stronger and ×1.5 faster.

**Still open**
- Human playtests and real-device checks are pending, including a feel check of the two Royal Ring diagonals and of the re-baked ground plate.

## Royal Ring contact pacing

**Problem.** Before this change 22 of 144 Royal Ring probe games ended at the 90 s limit with no attack on an owned tower (crown_cross 0, twin_passes 0). Abilities did not help.

**Cause (measured).**
- In every such game both players took their own four neutral towers and then stalled. Final state: each side held its half of the ring at the 40-unit cap (`sw`/`se`/`w_s`/`e_s` against `nw`/`ne`/`w_n`/`e_n`).
- A send is 50% of the source, so at most 20 units leave a full tower. A full 40-unit barracks/stable defends with 40 and `20 > 40` is false.
- The ring has only two frontier roads (`w_s`-`w_n`, `e_s`-`e_n`). Hostile orders need one direct road, so a frontier tower had exactly one possible attacker. Nothing could ever concentrate force. The bases (65 units) have no road to the frontier, so their stock cannot attack either.
- crown_cross and twin_passes do not stall: their centre / pass towers touch both halves, so a target has several attackers and first contact comes at a median of 7.4 s and 12.8 s.
- It is not abilities (`BOT_ABILITY=off` also had 22) and not a slow bot. The stalled games were normal/hard bot vs the flank/split scripts at the fast 1.8 s cadence (16), plus easy-bot counter duels (6). All of them end in the same frozen ring.

**Fix.** Two roads added to `royal_ring` in `apps/server-nakama/battlefields.json` (the single source for TS and Go): `n_ring_w_s`-`n_ring_e_n` and `n_ring_e_s`-`n_ring_w_n`. They cross in the middle of the court, are 180-degree images of each other, and give each frontier tower a second attacker (`w_n` can now be hit from `w_s` and `e_s`). No economy, rule or AI code changed, so TS and Go stay identical by construction. The ground plate was re-baked from the same JSON (`ground_royal_ring.webp`), with a tiny per-road height lift in `art/blender/crown_cross_kit.py` so the crossing road beds do not render black squares.

**Result (probe, 432 games, bot ability on).**

| | Before | After |
|---|---:|---:|
| no-contact games, royal_ring | 22 / 144 | 0 / 144 |
| no-contact games, crown_cross / twin_passes | 0 / 0 | 0 / 0 (outputs identical) |
| Royal Ring first contact median / p90 / max | 14.6 / 20.0 / 23.6 s | 14.6 / 20.0 / 20.0 s |
| player win rate, none commander, easy / normal / hard | 52.8 / 8.3 / 5.6% | 55.6 / 8.3 / 5.6% |
| player win rate, all commanders, all maps | 22.2-31.5% | 23.1-32.4% |
| Royal Ring player win rate, easy / normal / hard | 43.8 / 4.2 / 0.0% | 56.3 / 2.1 / 2.1% |

First contact is not earlier; the stalled games now clash instead of waiting out the clock. Easy Royal Ring moved 12.5 pp because 6 formerly frozen games are now decided by fighting. Normal and hard Royal Ring stay near 0% for these weak scripted policies, as before, so this is not a difficulty tuning.

**Compatibility.**
- Roads are only read by tactical rules (v3 and v4). v1/v2 and live PvP ignore them.
- v3 is already live: a v3 Royal Ring match settling after this deploy replays with the new roads (new legal attacks, bot may use the diagonals, and friendly reinforcement routes can take a diagonal when it is shorter). A client running the old bundle would simulate the old roads. The window is one match (at most 90 s of play plus ticket life), the server result is authoritative, and v4 has not shipped, so the change was made in place rather than as a new rules version.
- Deploy the server and client together, as for v4.

**Not verified.** A real-device look at the diagonals and the new ground plate, and human playtests. Probe policies are scripted.
