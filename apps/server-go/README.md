# Crown Clash Go backend

This is the Docker-deployed backend for Crown Clash. It preserves the API and
PostgreSQL schema used by `apps/game`, including server-authoritative economy
settlement and live 1v1 PvP matches over WebSockets.

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
The Go service is the only production backend.

## Live PvP

`GET /pvp/live` upgrades to an authenticated WebSocket. The first client frame
contains the session token, followed by `join` with `queue`, `create`, or
`join` mode. The backend owns match ticks, command validation, disconnect
surrenders, and transactional settlement. This first version requires one Go
backend instance because queue and invite-room state are held in memory.

## Validation

The Docker image is built with a static Go binary and a non-root distroless
runtime. Run the Go tests with:

```bash
docker build -f apps/server-go/Dockerfile -t crown-clash-server .
docker run --rm crown-clash-server
```
