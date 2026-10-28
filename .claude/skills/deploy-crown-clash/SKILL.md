---
name: deploy-crown-clash
description: Release Crown Clash to production and verify it — push master, trigger/poll the Dokploy compose deploy through its REST API, then prove the live bundle and assets match the commit. Use when the owner says release, deploy, "is the live game the latest version", or asks why Dokploy can't be reached.
---

# Deploy and verify Crown Clash

Production is ONE Dokploy compose stack (client + Nakama server + migrations built together).

| Thing | Value |
| --- | --- |
| Game | https://crownclash.tusigame.ir |
| API | https://api-cc.tusigame.ir (`/healthcheck`) |
| Dokploy project / env | CrownClash / production |
| Compose | `crown-clash-stack`, `composeId N0EeSXF-HpprEZBqWivqZ`, file `./docker-compose.prod.yml`, `autoDeploy: true` |

## Why "Dokploy MCP can't deploy" is wrong
The `mcp__dokploy__*` tools have no compose deploy tool (only application/postgres/mysql/domain/project; `application-deploy` is NOT for compose). But the MCP server's API key works against the Dokploy REST API. Use `.claude/skills/deploy-crown-clash/dokploy.sh` (reads URL and key from `DOKPLOY_URL`/`DOKPLOY_API_KEY` or the MCP entry in `~/.claude.json`, never prints them). Do not use the `DOKPLOY_URL` in the repo `.env` (different host). Never echo or grep for the key.

## Release steps
1. Validate on the branch: `npm run typecheck && npm test && npm run build`, `cd apps/server-nakama && go test ./...`. Live smokes need the local stack (`colima start`, `ALLOW_GUEST_AUTH=true docker compose up -d --build`; rebuild first, a stale container fails `test:smoke:rewards` on lane level 4): `npm run test:smoke`, `npm run test:smoke:rewards`.
2. Fast-forward master: `git fetch && git merge-base --is-ancestor origin/master HEAD && git push origin <branch>:master`. CI (`.github/workflows/ci.yml`) only tests; it does not deploy.
3. Dokploy auto-deploys on push, but check, because a push can be missed:
   `S=.claude/skills/deploy-crown-clash/dokploy.sh; $S GET "compose.one?composeId=N0EeSXF-HpprEZBqWivqZ"` and sort `deployments` by `createdAt`. If the newest deployment's description does not carry your commit, trigger it:
   `$S POST compose.deploy '{"composeId":"N0EeSXF-HpprEZBqWivqZ","title":"<msg>","description":"Commit: <sha>"}'`
4. Poll until the newest deployment `status` is `done` (about 1 min; `error` means read the deployment log in Dokploy).

## Verify what is live (do all, not just one)
- `curl -sD- https://crownclash.tusigame.ir/` → `last-modified` should match the deploy time; the page names `/assets/index-<hash>.js`.
- Grep that bundle for markers of the change (e.g. `render_tier_downgraded`, `hd-v4`, `cartoon-meadow-v1.8`) and for build flags: the inlined env object looks like `Xs={VITE_ENABLE_LANES:"true"}`; `Xs={}` means the flag was NOT baked in.
- Compare sha256 of a few `public/assets/**` files against the live URL (grounds, `assets/hd/hub/*`).
- Hash of the main bundle never equals a local build (API host, `v0.1.0-dev` version string and chunk hashes differ); diff the two instead, only env-derived hunks are expected.
- `curl https://api-cc.tusigame.ir/healthcheck` → 200. An unsigned auth probe answers `invalid_auth_payload` (expected).
- The game cannot be seen outside Bale/Eitaa/Telegram (login needs signed init data): a headless browser only shows the splash. Final eyes-on check is on a real Bale phone.

## Build flags that must reach the client build
`docker-compose.prod.yml` `game.build.args` → `apps/game/Dockerfile` `ARG`/`ENV` → vite. A `VITE_*` variable missing from both is silently absent in production (this is how lanes were off). Currently passed: `VITE_NAKAMA_*`, `VITE_ENABLE_LANES` (default `true`; `false` hides lane battles). Server-side gates (`ENABLE_COIN_PAYMENTS`, `ENABLE_2V2*`) are compose environment variables, keep payments off until a device test and a payment token exist.

## Order and rollback
- Server migration 026 (lane rewards, `lane/complete`) ships in the same compose and `nakama-migrate` runs before Nakama starts; never enable a client flag whose server RPC is not deployed.
- Rollback: set the flag to `false` and redeploy, or redeploy the previous commit (`git revert`, push master).
