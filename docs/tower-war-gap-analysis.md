# Tower War vs Crown Clash: gap analysis

Date: 2026-10-28. Status: analysis only, nothing implemented.

## Evidence and its limits

Sources: the Tower War App Store listing and version history (v1.20.1 to v1.30.0), a
price tracker for its IAPs, the SayGames five-year case study, and App Store reviews
as summarized by a fetch tool. **Nobody played the game or watched footage**; video
download was blocked and computer/browser tools were not connected. Everything below
is second-hand. Retention, revenue and conversion numbers for Tower War are not
public; do not treat any figure here as a benchmark.

## What Tower War actually did (order matters)

1. Launched ad-funded, built by a 2-person team (2021).
2. Added IAP, then a metagame (items, summons, upgrades), then LiveOps (events), then social (clans, clan wars).
3. Version history shows the monetization ladder: Battle Pass + progressive offer (1.23.3), Black Friday offers (1.23.5), Starter Pack (1.27.2), Growth Fund (1.28.0), Rewards Trail (1.30.0).
4. Events are the content engine: Christmas, Zombie, Boss + Event Center + Event Shop, Terminator 2 licence (2.5M players, IAP revenue about +40%, daily downloads up to +45%, per the publisher).
5. Pricing seen: $0.99 progressive offer, $2.99 crystal/bomb packs, $4.99 starter/pass silver/upgrade pack, $6.99 and $9.99 VIP packs, $19.99 pass gold/premium plus.

The studio itself says skill-based games are hard to monetize without hurting the fun.

## What players complain about (do not copy)

Ads after every level, "rigged" PvP that feels like bots, upgrades past level ~15 needing
real money, gacha odds (mythic guarantee) that do not match reality, repeated levels,
constant sales, progress loss on reinstall. Several of these are explicit
`AGENTS.md` violations (pay-to-win, dark patterns). Gacha summons are out: they
would also add an unapproved currency/odds system.

## Crown Clash today (from repo)

| Area | State |
|---|---|
| Core battle | Tactical territory control, fog of war, commander abilities, deterministic, TS and Go parity |
| Modes | Bot/async PvP, live 1v1, live 2v2 (flagged), 10-level campaign (client-local) |
| FTUE | Guided training battle, analytics, FTUE timing SQL |
| Progression | Coins, 4 upgrade tracks (finite sink), kingdom tiers, league road, commanders |
| Daily | Royal Orders, Crown Chest (server-confirmed) |
| Social | Invite links, revenge, realm; share events |
| Economy | Server-authoritative ledger |
| Monetization | Coin starter (19,000 tomans) and refill (49,000 tomans) built, **off by default** |
| Analytics | Solid for core loop; none yet for shop, offers, checkout, revenge, seasons |
| Platform | Bale/Eitaa/Telegram/Browser adapters |

## Gaps, ranked by AGENTS.md priority

| # | Gap | Player problem | Metric | Smallest validating step | Tower War has it |
|---|---|---|---|---|---|
| 1 | ~~Campaign levels pay nothing~~ **Done 2026-10-28**: 25/40/60 coin first-clear reward, server-replayed | Winning a level feels empty; no reason to continue | Level 1-10 completion, D1 | Server-validated coin reward per first clear, idempotent, ledgered | Yes |
| 2 | Monetization off in default build | Cannot learn anything about payers | Payer7, goal to checkout | Owner decision to enable coin payments for a pilot cohort | Yes |
| 3 | No re-entry hook | Players forget the game | D1/D7 | Bale bot message for revenge and daily chest (needs bot token, frequency policy) | Yes (push, events) |
| 4 | No events | Nothing new to return for | Weekly active share | One recurring weekly event reusing existing maps and rewards | Core engine |
| 5 | No season/pass | No long-term goal | D30, ARPPU | Only after 1-4 and enough DAU; free track first | Battle Pass, Rewards Trail |
| 6 | No clans | Weak social retention | D7/D30 | Defer; revenge and invites cover the social loop first | Clans, clan wars |
| 7 | No mailbox | Rewards have no inbox | Claim rate | Defer | Yes |
| 8 | Shop and offer analytics missing | Cannot measure monetization | n/a | Add events in `ANALYTICS.md` with the shop, not before | n/a |

## Recommendation

Do #1 first. It is the smallest change that improves core progression, it is already a
known open task, and it needs a Go port of level setup plus replay to stay
server-authoritative. Then #2 and #3 are owner decisions, not code. Events (#4) come
before any pass (#5): Tower War added the pass only after IAP, metagame and LiveOps existed.

Rewarded ads are not proposed: ad availability inside Bale/Eitaa mini apps is unverified.
