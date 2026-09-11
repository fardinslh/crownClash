---
name: false-green-guard
description: Prevent false-positive tests and unsupported completion claims when creating, changing, or reviewing tests, smoke scripts, CI checks, or external-system verification.
---

# False-Green Guard

Make tests prove requested behavior, not merely exit successfully.

## Build the proof

1. List each acceptance criterion and its exact observable evidence.
2. Trace each evidence path from action to assertion. Identify every fallback,
   catch, optional branch, timeout, and default along that path.
3. Make verification fail closed:
   - A helper failure must fail the test.
   - Assert prerequisites before asserting derived results.
   - Never use `if (value) assert(...)`; assert `value` first.
   - Catch only an expected failure, then assert exact error type or domain code.
4. Verify every actor and authoritative side effect named by the requirement.
   Reading a value without asserting it proves nothing.
5. Use stable interfaces. For Docker Compose, address service names through
   `docker compose`, not generated container names. Avoid shell interpolation;
   pass arguments separately and validate generated identifiers.
6. Put resource cleanup in `finally`. Limit cleanup to identifiers created by
   the current test. Never delete volumes or broad data sets as test cleanup.

## Prove test sensitivity

Before claiming a new or changed test works:

1. Run its success path and capture exit status.
2. Introduce one safe negative control that breaks the behavior or expected
   evidence without weakening the assertion.
3. Run the test and confirm it fails for the intended reason.
4. Restore the real implementation and rerun successfully.

If a negative control cannot be run safely, state why and do not claim that the
test's failure sensitivity was proven.

## Completion gate

- Re-read requirements and map each one to a concrete assertion.
- Inspect final diff for swallowed errors, conditional assertions, unused
  observations, mocks replacing required real systems, and unbounded cleanup.
- Run targeted tests, full project tests, typecheck, build, and relevant backend
  checks fresh.
- Report exact commands, outcomes, unproven behavior, and remaining risks.

