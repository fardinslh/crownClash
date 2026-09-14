#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This bootstrap script is for macOS."
  exit 1
fi

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "Warning: expected Apple Silicon (arm64), found $(uname -m)."
fi

missing=0
for command_name in git node npm docker; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name"
    missing=1
  fi
done

if [[ "$missing" -ne 0 ]]; then
  echo "Install the missing tools using docs/MACBOOK_HANDOFF.md, then rerun this script."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop is installed but not running. Start it, then rerun this script."
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env. Replace the local Nakama console password before starting Docker."
fi

if [[ ! -f apps/game/.env ]]; then
  cp apps/game/.env.example apps/game/.env
  echo "Created apps/game/.env from its development template."
fi

npm ci
docker compose config --quiet

echo
echo "Bootstrap complete. Next commands:"
echo "  docker compose up -d --build"
echo "  npm run dev -- --host 0.0.0.0"
echo
echo "Then validate with:"
echo "  npm test && npm run typecheck && npm run build"
