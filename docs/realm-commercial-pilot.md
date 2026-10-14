# Realm acquisition and coin purchase pilot

This pilot gives players a visible realm, a real named asynchronous opponent,
revenge, and a concrete next upgrade. Coin purchases remain voluntary. No ads,
messages, real payment requests, production deployment, or pricing changes to
existing upgrades are performed by the implementation.

## Product decisions and acceptance evidence

| Player problem | Small implementation | Metric | Evidence |
|---|---|---|---|
| Cannot see why to return | Realm tier, next upgrade effect and cost, incoming/outgoing battles | Second match, D1/D7 | RealmView tests and mobile QA |
| Cannot challenge a friend | Seven-day reusable server invitation, retained through tutorial, named defense preview | Invitation activation | Real Nakama challenge/dispatch/reload QA |
| Payment could buy friend wins | Equal base combat; all three temporary commander choices; public power clipped independently to opponent +2 | Fairness, referral repeat play | TS/Go policy tests, 270 combat parity fixtures |
| Attack results can be forged or replayed | Server-pinned defense/modifiers, action replay, 15-minute ticket, one active offline battle, real elapsed-time gate | Valid match completion, abuse rate | PostgreSQL replay/concurrency/expiry tests |
| Rewards can inflate through social loops | 20 coins, no trophies, max three social rewards/day, once per opponent/day | Coin supply and repeat play | PostgreSQL quota/ledger tests |
| Purchase lacks an understandable purpose | Goal deficit and inline upgrade; earned coins or optional starter/refill | Goal→checkout, verified payer7 | UI/client order tests, ledger tests |
| Checkout callbacks or retries might double credit | Persisted order IDs, native invoice unchanged, pre-checkout transaction binding, server inquiry, recovery | Paid→fulfilled, stuck orders | Provider contract and concurrent PostgreSQL fulfillment tests |
| Acquisition success is unknown | Anonymous visit→authenticated association, server cohorts, verified revenue, uncertainty intervals | Activation, CAC, observed net D30 | Cohort SQL/report tests; empty real cohort remains inconclusive |

The existing Go Nakama backend is retained. Crown Hold is still a separate local
prototype. Existing balances, four upgrade tracks, finite 132,400-coin sink,
commander ownership, daily/league systems and gameplay assets are retained.

## Rules

The original Phaser main menu and Kingdom screen remain the default navigation.
The gold card opens Realm; PLAY starts or resumes a server ticket immediately
(with clearly labelled bot practice when no real opponent is available). On startup, only a
friend invitation enters Realm directly. Realm has a return-to-menu button.

### Immediate replay loop

A settled offline match keeps the original Phaser result panel over the arena.
It shows the **server** outcome, coins and trophies; positive rewards have brief
sound/scale feedback and reduced-effects devices skip the extra motion. One
upgrade goal shows its next effect, cost and coin progress with a mobile touch
target; the goal is carried into the next battle. PLAY AGAIN is the primary action for
both wins and losses: one touch selects/resumes an authoritative public battle,
with explicit bot practice only when no player opponent exists. A next-match
error keeps the result and exposes retry; it never silently grants another reward.
Sharing a pilot result opens a real seven-day challenge link.

This change targets result→next-match friction. Existing `match_end` and
`match_start` (`source=rematch`) events record completion and successful replay
entry; server cohorts count first-day second completions. Judge the effect with
actual second-match completion, session match count and D1/D7 returns. Local
verification demonstrates the loop, not an increase in player retention.

- Public attacks select an actual published player defense within 250 trophies.
  If none is available, the UI explicitly offers a **bot practice**, not a fake
  human. There is no passive trophy loss, stolen currency or building damage.
- Public attacks use Crown Cross and bounded base levels per combat track.
  Friend battles and friend revenge chains use equal base levels. Public revenge
  retains the bounded combat policy but has social rewards. Live 1v1/2v2 also
  normalize base combat progression when the pilot is enabled.
- Upgrade/commander changes after entry do not alter a pinned battle. The client
  uses the pinned modifiers and displays the server's settled result.
- Incoming completed attacks permit one revenge within seven days. Repeats stay
  playable but cannot re-award that opponent that day. The daily social quota is
  three. Quotas use the Tehran calendar. Only rewarded completions advance daily
  missions. Social battles preserve the ranked streak.
- Ranked abandonment/expiry costs up to 12 trophies once. Social and practice
  exits do not cost trophies. Abandoned attempts do not count toward shop access.
- Bot practice has pinned modifiers, a 15-minute ticket, verified replay and no
  trophies. It resumes through the same local battle snapshot. Closing the app
  preserves the active ticket; an explicit social exit closes it.
- Starter: 750 coins, 19,000 tomans (190,000 IRR), once/account. Refill: 1,500
  coins, 49,000 tomans (490,000 IRR). Server access requires tutorial completion,
  three completed matches and a viewed upgrade goal. There is no client credit.
- The WALLET-TEST token is persisted as `test_mode`; its orders never contribute
  to real revenue or payer metrics. Do not switch provider tokens with open orders.

## Activation

Defaults are disabled. Configure server runtime variables, never `VITE_*` secrets:

```
ENABLE_REALM_PILOT=true
ENABLE_COIN_PAYMENTS=false
BALE_BOT_USERNAME=<actual main-miniapp bot username>
BALE_BOT_TOKEN=<server-only bot token>
BALE_WALLET_TOKEN=<wallet token from BotFather>
BALE_PAYMENT_WEBHOOK_SECRET=<random 32–80 URL-safe characters>
COIN_REFUND_OPERATOR_SECRET=<different random 32–80 URL-safe characters, optional>
ALLOW_GUEST_AUTH=false
```

Production pilot access is verified Bale only. Browser access requires explicit
local guest auth. Eitaa and Telegram cannot enter the commercial pilot. Eitaa's
existing unverified authentication is outside this pilot and must be replaced
before an Eitaa commercial launch.

Deploy via the existing pipeline with explicit migrations 014–017. Register the
Bale webhook with HTTPS on port 443 at `/pilot/bale/<secret>` using the merchant's
normal bot webhook setup. If the bot already has a webhook, route payments from
that existing receiver; do not replace it without preserving its other updates.
Keep proxy/body/access logs from recording webhook or operator secrets.

The implementation follows the official [Bale payment API](https://docs.bale.ai/)
and [Mini App invoice/launch API](https://docs.bale.ai/miniapp). The exact invoice
string returned by `createInvoiceLink` is passed to `openInvoice`. Pre-checkout
binds transaction, order, payer, IRR and amount before approval. Successful
receipts and recovered orders must pass `inquireTransaction`; SDK callbacks do
not grant anything. Pre-checkout has a ten-second platform deadline; server HTTP
calls have an eight-second timeout. Monitor timeout/rejection rates.

Before setting `ENABLE_COIN_PAYMENTS=true`, verify the test-wallet flow on actual
Bale Android, then a real merchant transaction on an explicitly authorized test
account. Check payer, amount, order state and exactly one ledger row. Test cancel,
provider timeout, repeated callback, lost successful-payment webhook, reopen,
duplicate requests and refund. Real merchant credentials and device verification
have not been supplied by this code change.

## Payment support

A player may reopen the same pending invoice or request order status. Status
inquires the stored pre-checkout transaction and fulfills paid receipts even if
its success webhook was lost. An invoice creation response lost before saving it
can leave an unused provider invoice; its local order ID is unchanged and its
pre-checkout binding prevents a second paid transaction from crediting twice.
A failed/rejected pre-checkout may be replaced; a pending/paid one may not.

Investigate an unresolved order using its server ID and transaction binding.
Never grant coins from a screenshot or client status. For a confirmed wallet
refund, the optional operator endpoint accepts `orderId`, provider refund
`reference`, and a mandatory `note` at `/pilot/operator/<separate-secret>`.
It records compensation and an auditable refund; it does **not** execute a
provider refund. Obtain provider refund evidence first. Duplicate evidence is
idempotent. If coins were spent, only the remaining grant is removed, balances
stay nonnegative, and support must document the absorbed portion. Keep this
operator credential outside clients, messenger links and campaign files.

Disabling coin payments prevents new checkout. Keep the secret webhook receiver
available during incident recovery; existing `order/get` recovery can still
verify paid orders. Do not delete tables/ledgers to roll back a rollout.

## Acquisition experiment

Prepare 12 Persian-speaking players on actual Bale Android, without coaching:

1. Enter from a friend's link. Can they name whose defense they are attacking?
2. Complete the short attack/capture tutorial and their first meaningful battle.
3. Explain automatic defense, result, reward and next upgrade in their own words.
4. Return to the realm, play again, then invite a friend.
5. Receive a completed attack and find revenge; inspect equal-power commander choice.
6. Select an upgrade goal, earn enough coins, upgrade, and notice realm progress.
7. After three valid matches, inspect both coin packs and the exact toman price.
8. Cancel checkout, reopen, finish an authorized test purchase, and find credited coins.
9. Close/reopen midbattle and midpayment; verify the same ticket/order resumes.
10. Repeat reward/purchase actions; verify no double credit or pressure to buy.
11. Run at 320×568 and low-end Android with effects reduced; record load/frame behavior.
12. Ask what would make them return tomorrow and what they would voluntarily pay for.

Record actual completion/time/confusion; do not infer retention from these interviews.

Tracked messages in [realm-campaign-creatives.md](realm-campaign-creatives.md) use
`ad_revenge` and `ad_growth`. Allocate the proposed 5M toman pilot in stages: 1M to
compare the two messages, 2M to the stronger activation message, then 2M only after
D7 evidence. Placement selection, payment and publishing require the owner's
real campaign action; no placement has been purchased or message sent.

Use `node scripts/realm-cohort-report.mjs <campaign-costs.json>`, where the optional
JSON maps campaign IDs to **total** actual spend in tomans. Costs are counted once
per campaign, not per daily cohort. Raw output is in `qa-artifacts`, outside Git.
Cohorts use first server entry, verified Bale identity and server receipt dates.
D1/D7 require the entire corresponding Tehran calendar day to finish. Returns
come from authenticated entries; activation and revenue come from authoritative
settlements and paid non-test orders. Anonymous visits remain diagnostic and can
include retries/bots. Full refunds contribute zero net revenue. Provider fees,
taxes and advertising attribution leakage are not estimated by this report.

Pilot checkpoints: first complete ≥70%, second match ≥40%, D1 ≥25%, D7 ≥10%,
verified payer7 ≥2%. Conversion is exploratory until ≥500 activated players;
repeat purchase needs ≥20 verified buyers and completed 30-day windows. Wilson
95% intervals accompany rates; empty/immature/small cohorts are inconclusive.
The automatic economic gate requires mature sample and observed net D30 ≥1.2×CAC;
these product checkpoints and fee-adjusted economics must also be reviewed before
scaling. There is no claim that the pilot has acquired users or generated revenue.

## Verification

```
npm run typecheck
npm test
npm run build
node scripts/realm-balance.mjs
TEST_POSTGRES_DSN=<disposable test database URL> REALM_PARITY_FIXTURE=<absolute path to qa-artifacts/realm-balance.json> go test -count=1 ./...  # in apps/server-nakama
node scripts/realm-pilot-qa.mjs  # local Nakama + dev app; payments disabled
node scripts/realm-cohort-report.mjs
```

The PostgreSQL tests create/drop only their generated schemas. Browser QA creates
only disposable local identities and profiles, tests real APIs and touch input,
and asserts server state/economy/resume. Screenshots are local artifacts. A missing
backend, control, settlement or expected observation fails verification.

The balance model runs 270 cross-runtime battle cases and 1,000 synthetic players
for 30 days at 15 matches/day, 55% wins and three unique social rewards/day. It
excludes daily/league claims and purchases, and assumes enough public opponents.
It is a sensitivity baseline with one fixed opening, not a forecast of strategy,
conversion, retention or income. Under that model mean earned coins are ~14,960,
mean realm level ~35 and no player reaches all 80 upgrade levels in 30 days.

### Local verification evidence

The implementation was checked with full workspace typecheck, tests and build,
real PostgreSQL isolated-schema tests, 270 TypeScript/Go replay comparisons, and
real local Nakama browser QA at 320×568, 360×640 and 390×844. Mobile QA includes
native touch dispatch, reload/resume, disabled browser checkout, authoritative
battle settlement, incoming revenge, and inline upgrade debit plus server-normalized
analytics. Analytics uses authenticated HTTP so retiring the shared live socket
during scene navigation cannot block the persisted retry queue. Main-menu rendering, the original Kingdom screen, PLAY resume, and
Realm return navigation are also asserted. CSS positioning is asserted before
screenshots are accepted.

The replay-loop check waits for a natural 90-second battle, verifies the selected
upgrade goal and result-panel bounds at all three mobile sizes, then uses native
touch to start another server ticket. The coin balance stays unchanged on replay
entry and `match_start` with `source=rematch` reaches server analytics. The latest
workspace run passes 914 JS tests (two skips), typecheck and build; fresh Go tests
also pass against the disposable PostgreSQL database. Result screenshots were
visually inspected at 320×568 and 390×844.

Negative controls detected broken power caps, missing purchase credit, altered
invoice strings, lost analytics persistence, broken tutorial advancement, disabled
challenge input, inclusion of test-wallet revenue, wrong Bale back events, missing
realm CSS and invalid upgrade analytics IDs. Controls were restored and the final
checks rerun. Replay regression controls also detect a return to the Realm hub
after settlement and a next-match network error incorrectly hidden by bot practice.
Two checks in the general JS suite remain skipped: the opt-in external live 2v2
check, and the missing-cwebp branch because cwebp is installed. Neither skipped
check is evidence of that branch passing.

The build retains a large Phaser chunk (about 381 KB gzip); startup time, FPS and
memory on a low-end physical Android device remain unmeasured. Local browser QA
and provider contract fixtures do not establish real Bale merchant/payment behavior,
user acquisition, retention, or revenue. The current real cohort report is empty
and explicitly inconclusive.
