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
| `upgrade_purchase_succeeded` | Server purchase succeeds | `purchaseId`, server-enriched `upgradeType`, `level`, `cost`, `resultingCoins` | Server-confirmed purchase | Upgrade conversion |
| `upgrade_purchase_failed` | Server purchase rejects request | `upgradeType`, `reason` | Server response | Upgrade failure rate |
| `live_queue_joined` | Server accepts queue entry | None | Server-confirmed client response | Live queue starts |
| `live_invite_created` | Server creates and joins invite | None | Server-confirmed client response | Invite creation |
| `live_invite_joined` | Server accepts invite join | None | Server-confirmed client response | Invite conversion |
| `live_match_started` | Nakama match starts | `matchId` | Nakama match event | Live matches started |
| `live_match_ended` | Server live result arrives | `matchId`, `status` | Server-confirmed result | Live completion and win rate |
| `live_match_disconnected` | Connection ends before a result | `matchId` | Client connection state | Live connection reliability |

Live events use the player-specific settlement ID, `live_<startedAt>_<playerId>`,
while Nakama keeps its internal socket match ID unchanged. `match_end` and `match_quit` are mutually exclusive per match ID. Raw platform
init data, tokens, contact data, player IDs, and client-calculated economy
values are never included. Nakama loads the stored settlement for
`match_end`/`match_reward_received` and the stored purchase for upgrade success,
then overwrites those properties before insertion.

## Future event families

Do not emit these until their flows exist: tutorial progression; shop and offer
views; checkout and purchase outcomes; daily missions; seasons; referrals; and
revenge actions.
