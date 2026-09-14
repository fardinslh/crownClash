# M1 MacBook development handoff

This repository contains all Crown Clash source code, project agent rules, and the
`false-green-guard` and `verification-before-completion` skills. Machine secrets are
intentionally excluded.

## Install prerequisites

Install Xcode Command Line Tools:

```bash
xcode-select --install
```

Install Homebrew from <https://brew.sh>, then install the command-line tools:

```bash
brew install node@24 git ripgrep gh
brew install --cask docker android-platform-tools
echo 'export PATH="/opt/homebrew/opt/node@24/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile
```

The handoff workstation used Node 24 and npm 11. Authenticate GitHub with:

```bash
gh auth login
```

Use a new Mac SSH key rather than copying a private key from another computer.

## Clone and bootstrap

```bash
mkdir -p ~/Projects
cd ~/Projects
git clone git@github.com:fardinslh/crownClash.git
cd crownClash
chmod +x scripts/setup-macos.sh
./scripts/setup-macos.sh
```

Edit `.env` and replace `NAKAMA_CONSOLE_PASSWORD`. Local browser testing does not
need messenger bot tokens. Store real tokens in a password manager and never commit
them.

Start the stack and client:

```bash
docker compose up -d --build
npm run dev -- --host 0.0.0.0
```

Open <http://localhost:3000>. To test from a phone on the same Wi-Fi, find the Mac IP:

```bash
ipconfig getifaddr en0
```

Then open `http://MAC_IP:3000` in the phone browser. Bale itself should continue to
use the stable production URL: <https://crownclash.tusigame.ir>.

## Verify the environment

```bash
docker compose ps
npm test
npm run typecheck
npm run build
npm run test:smoke
git status
```

The smoke test requires the Docker services to be running.

## Machine-local configuration that GitHub must not contain

Configure these independently on the Mac:

- Graphify installation and Google API key;
- Dokploy MCP endpoint and credential;
- Bale and Telegram bot tokens when real authentication testing is required;
- GitHub and server SSH private keys;
- Cloudflare or DNS credentials;
- any other MCP tokens.

The Graphify hook uses `graphify` from `PATH`, so confirm this succeeds after installation:

```bash
graphify --help
graphify update .
```

## Normal work cycle

```bash
git pull --ff-only
git status --short
docker compose up -d
npm run dev -- --host 0.0.0.0
```

Give coding agents one small task at a time. Review `git diff` and select files
explicitly; avoid `git add .` after agent work. Before committing:

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Stop containers without deleting local database data:

```bash
docker compose stop
```

Never run `docker compose down -v` unless deleting the local database is intentional.

## Apple Silicon and limited-memory notes

Normal Docker builds should use Apple Silicon images. Only if an architecture error
occurs, enable Rosetta in Docker Desktop and retry with:

```bash
DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose build
```

On an 8 GB Mac, give Docker about 3-4 GB RAM, run one coding agent at a time, close
unused browser tabs, and keep at least 25 GB of disk space free. Inspect Docker usage
with `docker system df`; do not blindly prune volumes.

## Bot result mismatch investigation

The client/server mismatch diagnostic is present from commit `63e383e`. Rebuild
Nakama, fully reload the browser, reproduce the problem, then inspect:

```bash
docker compose logs nakama --since 30m 2>&1 | grep bot_result_status_mismatch
```

Preserve the matching log line and the approximate match time. Do not include tokens
or credentials in reports.
