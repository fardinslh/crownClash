# Analytics event catalog

All client events use schema version 1 and include a generated `eventId`,
app-lifecycle `sessionId`, and client `occurredAt` (milliseconds). Nakama
derives player identity from authentication and records receipt time separately.

| Event | Trigger | Required properties | Source of truth | Funnel / metric |
| --- | --- | --- | --- | --- |
| `session_start` | App startup | None | Client lifecycle | Session starts |
| `menu_viewed` | Menu finishes loading | `rankId` | Client view | Session to play |
| `match_start` | Bot or live match starts | `matchId`, `mode`, `source` | Client action | Play starts |
| `match_end` | Server settlement received | `matchId`, `mode`, `result`, `durationSeconds` | Server-confirmed result | Completion and win rate |
| `match_quit` | Live connection ends before a result | `matchId`, `mode`, `durationSeconds` | Client connection state | Live abandonment |
| `match_reward_received` | Server settlement applied | Client: `matchId`, `mode`. Server: `baseCoins`, `speedBonus`, `dominationBonus`, `streakBonus`, `treasuryBonus`, `totalCoins`, `trophyDelta`, `resultingCoins`, `resultingTrophies` | Server-confirmed settlement | Result to reward |
| `upgrade_panel_viewed` | Upgrade panel opens, from the result screen or the Kingdom hub | `source` (`menu` or `result`). Optional for backward compatibility: schema-version-1 clients shipped before the Kingdom hub send empty props, and the server accepts both shapes. Unknown properties and invalid `source` values are still rejected | Client view | Reward to progress |
| `upgrade_purchase_succeeded` | Server purchase succeeds | `purchaseId`, server-enriched `upgradeType`, `level`, `cost`, `resultingCoins`, `kingdomLevel`, `kingdomTierId` | Server-confirmed purchase | Upgrade and kingdom-tier conversion |
| `upgrade_purchase_failed` | Server purchase rejects request | `upgradeType`, `reason` | Server response | Upgrade failure rate |
| `daily_panel_viewed` | Royal Orders screen opens | None | Client view | Daily-loop discovery |
| `daily_reward_claimed` | Server confirms a mission or Crown Chest claim | Client: `claimId`. Server: `rewardType`, `reward`, `resultingCoins` | Server-confirmed claim | Daily completion and reward conversion |
| `league_panel_viewed` | League Road opens | None | Client view | League discovery |
| `league_reward_claimed` | Server confirms a league milestone claim | Client: `claimId`. Server: `rankId`, `reward`, `resultingCoins` | Server-confirmed claim | League reward conversion |
| `rank_promoted` | A settled match crosses a rank boundary | Client: `matchId`. Server: `rankId`, `resultingTrophies` | Server-confirmed settlement | Rank progression |
| `live_queue_joined` | Server accepts queue entry | None | Server-confirmed client response | Live queue starts |
| `live_invite_created` | Server creates and joins invite | None | Server-confirmed client response | Invite creation |
| `live_invite_joined` | Server accepts invite join | None | Server-confirmed client response | Invite conversion |
| `live_match_started` | Nakama match starts | `matchId` | Nakama match event | Live matches started |
| `live_match_ended` | Server live result arrives | `matchId`, `status` | Server-confirmed result | Live completion and win rate |
| `live_match_disconnected` | Connection ends before a result | `matchId` | Client connection state | Live connection reliability |
| `tutorial_started` | First-time player opens War Academy | None | Client action | Onboarding start |
| `tutorial_step_completed` | Each War Academy lesson is acknowledged | `stepId` (`drag_to_attack`, `preview_result`, `tower_roles`, `multi_dispatch`) | Client action | Onboarding step progression |
| `tutorial_completed` | Player finishes all lessons and starts the practice battle | None | Client action | Onboarding completion |
| `tutorial_skipped` | Player leaves War Academy before completion | `lastStepId` (`drag_to_attack`, `preview_result`, `tower_roles`, `multi_dispatch`) | Client action | Onboarding abandonment |

Live events use the player-specific settlement ID, `live_<startedAt>_<playerId>`,
while Nakama keeps its internal socket match ID unchanged. `match_end` and `match_quit` are mutually exclusive per match ID. Raw platform
init data, tokens, contact data, player IDs, and client-calculated economy
values are never included. Nakama loads the stored settlement for
`match_end`/`match_reward_received` and the stored purchase for upgrade success,
then overwrites those properties before insertion.

Daily mission progress and rewards use the server's `Asia/Tehran` calendar day.
Nakama loads the stored idempotent claim for `daily_reward_claimed` and replaces
all reward and resulting-balance values before analytics insertion.

League rewards are permanent one-time claims. Nakama loads the stored claim for
`league_reward_claimed`, and rank promotion analytics are normalized from the
stored match settlement.

## Future event families

Do not emit these until their flows exist: shop and offer views; checkout and purchase outcomes; seasons; referrals; and
revenge actions.
