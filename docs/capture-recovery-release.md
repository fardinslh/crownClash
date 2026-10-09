# C capture recovery in production gameplay

C is the default in bot, authoritative 1v1 and authoritative 2v2 matches. Each captured territory starts at 50% production and returns linearly to full production over three simulation seconds. Recapture within that window preserves the original deadline; capture clears the previous owner's fractional production accumulator. Building roles, battlefield selection, career modifiers, dispatch amount and the existing bot remain unchanged.

The Gameplay Lab, variant selector, pilot/replay storage, experimental rule/config modules and Lab-only scripts/reports have been removed. D/E/F and investment upgrades are absent. Existing browser experiment data is left untouched. The retired `gameplay_lab=1` URL opens the ordinary game. Production session/match analytics and authoritative settlement remain active.

A short territory tap displays production, defense and marching speed. Drag and multi-select still dispatch armies. Capture indicators show the current production percentage and remaining recovery time. Panels update ownership immediately, close during match menus/results, and rebuild after viewport changes.

## Compatibility and authority

New bot tickets persist gameplay rules version 2. Migration `013_capture_recovery_rules` defaults existing rows to version 1. Settlement reads the ticket's stored version inside its existing transaction; client-submitted rules cannot change authoritative results. Old bot tickets keep instant-production replay behavior. Missing historical state/replay versions mean legacy rules; 2v2 replay callers must pass version 1 explicitly for old records. New 2v2 replay metadata contains version 2. The previous legacy 2v2 golden hash remains covered.

C bot prediction and authoritative replay use fixed 20 ms ticks; live matches use 50 ms ticks. Recovery deadlines use integer simulation milliseconds. State hashes include the version and recovery deadlines. The parity suites compare owners, units, armies, accumulators, recovery deadlines and result data; 2v2 also compares canonical actions and the final state hash.

## Verification

- `npm test`
- `npm run typecheck`
- `npm run build`
- `cd apps/server-nakama && go test -count=1 -json ./...`
- `CROSS_ENGINE_GO_MODE=host npm run test:parity`
- `CROSS_ENGINE_GO_MODE=host npm run test:parity:2v2`
- `node scripts/capture-recovery-qa.mjs` against a local production build
- `git diff --check`

Regression tests cover production recovery boundaries, both capture owners, recapture, fractional reset, independent territories, bot/live clocks, old tickets and replay versions. Safe negative controls temporarily disable TypeScript recovery, Go recovery and tap recognition; the affected tests fail at the intended assertions, then pass after restoration.

Verified results: 867 JavaScript/TypeScript tests passed (two existing opt-in skips); 192 Go tests passed (six opt-in/integration skips); typecheck and build passed. Host-Go parity passed all 68 1v1 replay scenarios and 29 2v2 scenarios. Client prediction agrees on all 67 valid 1v1 scenarios; the deliberately mutated invalid-action replay is separately checked against both authoritative replay engines. Both mobile sizes passed.

The mobile QA script uses Chrome touch emulation at 360×640 and 390×844. It checks own/neutral/enemy taps, multi-select dispatch, recovery indicators, automatic match termination and visibly rendered settlement retry, normal analytics and absence of experiment writes. Because the backend is deliberately blocked, this browser run covers the failed-settlement retry panel rather than a successful server reward/result panel. Every external request is intercepted; disposable QA fixtures never reach production accounts or settlement. Screenshots/evidence are generated under ignored `qa-artifacts/production-C/` and temporary browser profiles are removed in `finally`.

These browser checks are not physical-device/WebView testing. Local PostgreSQL integration tests require `TEST_POSTGRES_DSN` and are skipped when unavailable; SQL transaction behavior is covered by backend mocks. Actual production migration/startup and deployed revision must be checked through Dokploy and public health after deployment. The existing Phaser bundle-size warning remains. No retention or engagement improvement is claimed without player data.
