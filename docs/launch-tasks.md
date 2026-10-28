# Bale launch tasks

Status as of 2026-10-25. Source: pre-release audit (mechanic, UX, retention).

## Done
- [x] Persian UI + Vazirmatn font + RTL isolates for canvas text (Menu, Daily, League, Kingdom, Council, Live PvP lobby, difficulty picker, battle HUD/results, tutorial, loading shell).
- [x] Tutorial: finale (`destroy_base`) stalled. Guidance was resolved only on step entry/capture, so the hand hint kept showing "reinforce the frontier" forever, and the enemy HQ kept growing (10 -> 21+). Now guidance refreshes every 0.75 s (`GameScene.refreshTrainingGuidance`) and the enemy HQ is capped at its sandbox garrison (`holdTrainingEnemyBase`). Regression test in `TacticalTutorial.test.ts`.
- [x] Tutorial: a training attack that cannot take its target now shows "سرباز کافی نیست — اول برج را تقویت کن" after release.
- [x] Tutorial: guest name pill showed "…فرمانده" on 360px. The HUD candidate was cut at 7 code points; a guest handle that does not fit now drops its number instead (`formatHudName`).
- [x] Tutorial -> first match: no difficulty picker; the first real match after training starts on Easy and the celebration says it pays coins. The picker stays on the menu PLAY button. Training itself still grants no economy (server rule, `TestStoreCompleteTutorialIsIdempotentAndGrantsNoEconomy`); the first real win is the first server-settled reward.
- [x] Analytics drift (server): `destroy_base` tutorial step, `live_queue_2v2_joined` and `live_match_started.mode` were rejected by `analytics/events`. The sink retries a rejected batch, so one such event blocked all later analytics for that player. Fixed in `main.go`; `TestAnalyticsSchemaCoversClientEvents` now reads the client event list and tutorial steps and fails on drift.
- [x] Analytics: new `share_opened` event (`source`: `live_invite`, `result`, `result_2v2`), documented in `ANALYTICS.md`.
- [x] Post-match reward beat: coins count up from 0 to the server-settled total, then pop with a light haptic (skipped with reduced motion).
- [x] Legibility: 9-10px labels raised by 1px in Game/Kingdom/Menu; menu mute button has a 44x44 hit area (other menu buttons were already >= 44px tall).
- [x] Remaining English strings: loading shell status, League load/claim errors, Kingdom network error, `M0->5` milestone label (now "هدف: سطح 5" / "مرحله 5 ✓").

## Overhaul (branch `feat/gameplay-depth`, release postponed for it)
- [x] Graphify removed from the project.
- [x] Rules v4 for bot/async: commander abilities (TS + Go, server-stored commander, parity) and fog of war (presentation only). See `docs/rules-v4.md`.
- [x] Abilities tuned by simulation (`scripts/rules-v4-balance.mjs`): each shifts the probe win rate by 5-8 pp.
- [x] Visual overhaul: UI tokens, `ui/kit`, vector icon set, rebuilt Menu/Kingdom/Daily/League/Commander, rounded battle HUD and modals, result screen with icons and victory confetti, capture particles, team-coloured convoy badges, battle load bar, scene fades, master audio bus + UI click.
- [ ] Deploy order: server (migration 021, v4 negotiation) before the client.
- [x] The bot uses its own ability on normal (quartermaster) and hard (vanguard); easy has none. TS + Go parity, tests and probe numbers in `docs/rules-v4.md`. Needs a human playtest to confirm normal/hard did not get too hard (probe shift: -5.6 pp normal, -8.3 pp hard for the weakest scripted player).
- [x] Royal Ring no-contact pacing: cause was a pure ring (one hostile road per frontier tower, so a 50% send can never break a full 40-unit tower). Two centre diagonals added to `battlefields.json` (TS + Go share it) and the ground plate re-baked; probe no-contact games 22/144 -> 0/144, other maps identical, win rates within 3 pp (easy Royal Ring +12.5 pp from formerly frozen games). Details and compatibility notes in `docs/rules-v4.md`. Still needs a human look at the new roads on a real device.
- [x] MenuScene's async init no longer keeps running after the scene stops (generation guard, regression test `MenuSceneStaleInit`). Still worth a check on device.
- [x] Kingdom hero uses 256px hub-only sprites (`apps/game/public/assets/hub`, built by `scripts/export-hub-art.mjs` from the 512px masters). Battle sprites stay 128-160px.

## Needs the owner (cannot be done from code)
- [ ] Real-device test in Bale: initData validation (`auth.go`, shared Telegram HMAC path), the query-string/`bale_guest` fallback in `BalePlatformAdapter.ts`, `bale://share`, `openInvoice` payment.
- [ ] Decide `ENABLE_REALM_PILOT` / `ENABLE_COIN_PAYMENTS` (both off by default, so revenge/shop/starter pack do not exist in the default build).
- [ ] Review Persian copy (hand-written) and check mixed Persian+number lines on a real WebView.
- [ ] Re-entry hook: Bale bot message for revenge / daily chest. Needs the bot token, a decision on message frequency, and server-side sending; not started.
- [ ] Replace emoji/rectangle UI with real icon art (Blender pipeline per the Art Bible). The daily chest (closed/open) is now a Blender render (`art/blender/hub_props_kit.py`, exported by `scripts/export-hub-art.mjs`); a crown emblem render exists as an authoring asset but is not used in the UI yet.

- [x] Campaign levels (10, `packages/game-core/src/levels.ts`, `LevelsScene`, RPCs `levels/get` and `levels/complete`, migrations 023 and 024) pay a one-time first-clear coin reward: 25 (easy), 40 (normal), 60 (hard), 400 in total. `levels/complete` now takes `{levelId, claimId, actions}`, replays the recorded dispatches on the server (`ReplayLevel`, rules v3, `levelDefs` in `levels.go` mirrored from `levels.ts` and checked by `TestLevelDefsMatchClient`), then pays once per (player, level) through the ledger (`Source: level_reward`). Old `{levelId}` payloads still advance progress but pay nothing. Existing players are paid when they next win a level they have not been paid for. `scripts/levels-record-wins.mjs` records a TS winning run per level into `apps/server-nakama/testdata/level_wins.json`; the Go test replays them to prove TS/Go parity. Deploy the server (migration 024) before the client. Still needs human playtests for level count/difficulty (`scripts/levels-balance.mjs` only proves probe-winnability), and a real-device check of the result card and level cards. Known limit: levels are deterministic, so a recorded winning run can be shared or scripted; the reward is small and first-clear only, and there is no server-issued attempt ticket or wall-clock gate yet. The legacy `{levelId}` path should be removed once old clients are gone.

## Later
- [x] Client error reporting: `client_error` event (uncaught errors and unhandled rejections, 5 distinct per session, scrubbed message, top-frame location only, no stack). Server allowlist and validation in `main.go`; documented in `ANALYTICS.md`.
- [ ] Checkout analytics only matter once coin payments are on (`ENABLE_COIN_PAYMENTS`).
- [x] Chest open is `daily_reward_claimed` with `rewardType=crown_chest` (server-confirmed). FTUE timing is `docs/analytics/ftue-timing.sql`, built from existing `tutorial_*` events; it has not been run against a database yet.
- [x] Haptics toggle: menu icon button and a pause-menu row; the choice persists per device and is enforced once in `createPlatformAdapter` (`withHapticsPreference`), so every scene and messenger adapter honours it.
- [x] Emoji removed from in-canvas battle copy (result screen, 2v2 result, hints, difficulty picker); the result rank banner uses the vector rank icon. Share-sheet text keeps its emoji on purpose: the messenger renders it natively.
- [x] Retired Crown Hold prototype removed: `PrototypeScene.ts`, `src/prototype/`, `scripts/crown-prototype-qa.mjs` and `docs/crown-prototype.md` (none were in the bundle; history stays in git). Analytics names stay in the server allowlist.
- [x] Hub scenes (Realm, Kingdom, Daily, League, Commander) are lazy chunks, prefetched when the menu is idle (`scenes/lazyScenes.ts`). Main JS chunk went from 533 kB to 482 kB (gzip 135 to 122) plus Phaser 381 kB gzip. `GameScene` (6.7k lines) is still in the main chunk because new players go straight into it.
- [x] Seed opponents for the empty-game problem: 34 bot defenders with natural Persian/Latin names (`seed_bots.go`, migration 022 `players.is_bot`), used only for public Realm attacks (`ENABLE_SEED_BOTS`, on by default). 
- [x] Live 1v1 queue falls back to a bot match after `LIVE_QUEUE_BOT_FALLBACK_SECONDS` (15, `config/liveQueue.ts`) with the notice "no opponent online, starting a bot match"; emits `live_queue_fallback`. Verified end to end against a real Nakama stack. 2v2 has no fallback (needs 3 other players) and invite rooms never fall back.
