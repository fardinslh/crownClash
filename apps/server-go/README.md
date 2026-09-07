# Crown Clash Go backend

This is the Docker-deployed backend for Crown Clash. It preserves the API and
PostgreSQL schema used by `apps/game`, including server-authoritative economy
settlement and deterministic async PvP replay.

## Docker

From the repository root:

```bash
docker compose up --build -d
```

The service listens on `http://127.0.0.1:8787`. Configure the game client with:

```text
VITE_API_URL=http://127.0.0.1:8787
```

Required production variables:

- `DATABASE_URL`
- `JWT_SECRET`
- `CLIENT_ORIGINS`
- `ALLOW_GUEST_AUTH=false`
- `TELEGRAM_BOT_TOKEN` and/or `BALE_BOT_TOKEN`

The service runs migrations on startup and shuts down gracefully on `SIGTERM`.
The existing TypeScript service remains available as a rollback reference while
the Go service is validated.

## Validation

The Docker image is built with a static Go binary and a non-root distroless
runtime. Run the Go tests with:

```bash
docker build -f apps/server-go/Dockerfile -t crown-clash-server .
docker run --rm crown-clash-server
```
