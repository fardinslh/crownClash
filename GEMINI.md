@./AGENTS.md

# Mandatory Delivery Guardrails

For any task that creates, changes, or reviews tests, validation scripts, CI,
backend authority, economy, or PvP behavior, activate `false-green-guard` before
editing.

Before any success claim, commit, push, or move to another task, activate
`verification-before-completion`.

If skill activation is unavailable, apply their rules manually. In particular:

- Map every acceptance criterion to a mandatory assertion or direct evidence.
- Never treat a failed verification helper as an empty or successful result.
- Never hide an assertion behind a condition that can skip it.
- Expected failures must assert the exact error code or type.
- Prove new tests can fail using a safe negative control, then restore and rerun.
- Re-read the final diff after tests pass and report anything not proven.

