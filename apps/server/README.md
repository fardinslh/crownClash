# @crown-clash/server (TypeScript reference)

The production backend is now the Dockerized Go service in `apps/server-go`.
This TypeScript service remains as a reference implementation and rollback
option while the Go service is validated.

## Why this exists

The client can no longer be trusted to compute its own rewards or upgrade
costs (see `AGENTS.md`, Security & Economy sections). This service owns the
ledger, applies the same pure domain logic already used client-side
(`@crown-clash/game-core`'s `settleMatch` / `purchaseUpgrade`), and persists
results in Postgres with idempotency keys so retried requests can't double
pay a player.

## Production setup

Use the Go backend through Docker Compose:

```bash
# from repository root
docker compose up --build -d
```

The Go service listens on port `8787` and runs database migrations on startup.
See `apps/server-go/README.md` for environment and deployment details.

## TypeScript reference setup

The reference service can still be run locally when needed:

```bash
npm run db:up
cp apps/server/.env.example apps/server/.env
npm --workspace=apps/server run migrate
npm --workspace=apps/server run dev
```

The game client reads its backend URL from `apps/game/.env`:

```bash
VITE_API_URL=http://127.0.0.1:8787
```

Production builds require `VITE_API_URL`; the local URL is only a development
default. Configure `CLIENT_ORIGINS` to include the deployed game origin.

## Endpoints

All endpoints except `/health` and `/auth/login` require `Authorization: Bearer <token>`.

- `POST /auth/login` — body `{ platform, initData }`. `platform` is one of
  `telegram | bale | eitaa | browser | mock`. `initData` is whatever
  `PlatformAdapter.getInitDataRaw()` returns. Telegram/Bale are cryptographically
  verified (HMAC-SHA256 per Telegram's Mini App spec — Bale mirrors the same
  bridge/format). Eitaa and browser/mock are accepted unverified (see
  Limitations). Returns `{ token, career, rank }`.
- `GET /career` — current player career + rank tier.
- `GET /ledger?limit=50` — most recent economy ledger entries for the player.
- `POST /matches/settle` — body `{ matchId, status, stats }`. Idempotent on
  `matchId`: replaying the same id returns the original settlement instead of
  re-applying rewards.
- `POST /upgrades/purchase` — body `{ type, purchaseId }`. Idempotent on
  `purchaseId`. `type` is one of `starting_garrison | production | army_speed`.
- `POST /pvp/defense/publish` — refreshes the authenticated player's
  deterministic defensive snapshot.
- `GET /pvp/opponents?limit=8` — returns nearby-rank defensive snapshots,
  including opponents eligible for Revenge.
- `POST /pvp/attacks` — body `{ attackId, defenderId, actions }`. The server
  replays timestamped dispatch intents against deterministic AI defense and
  settles the result through the economy ledger. Idempotent on `attackId`.
- `GET /pvp/history?limit=20` — returns the player's recent attacks and
  defenses.

## Known limitations

- **Eitaa auth is unverified.** No documented signature scheme was found for
  Eitaa Mini Apps, so its login trusts the client-declared id, same as the
  browser/dev guest path. Revisit if/when Eitaa publishes a spec.
- **The original bot-match endpoint still accepts client-reported stats.**
  Async PvP uses the safer replay path: the client submits only bounded,
  timestamped dispatch intents and the server derives combat, stats, status,
  rewards, and the ledger. Move the remaining bot flow to the same replay path
  before treating it as competitive.
- **Defenses are deterministic AI snapshots.** Custom defensive choreography
  and real-time multiplayer are intentionally deferred.
- **The TypeScript service is not the production runtime.** Use
  `apps/server-go` and Docker Compose for deployment. Keep this service for
  rollback and contract comparison until the Go migration soak period ends.

## Tests

Unit tests (`validation.test.ts`, `verifyInitData.test.ts`) always run.
`integration.test.ts` talks to a real Postgres and skips automatically if
`DATABASE_URL` isn't set:

```bash
npm run db:up
$env:DATABASE_URL = 'postgresql://crownclash:crownclash@127.0.0.1:5433/crownclash'
npm --workspace=apps/server run test
```

The Go service tests and Docker image are validated with:

```bash
docker run --rm -v "$PWD/apps/server-go:/src" -w /src golang:1.23-alpine go test ./...
docker build -f apps/server-go/Dockerfile -t crown-clash-server .
```
