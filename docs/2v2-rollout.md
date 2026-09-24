# 2v2 rollout runbook

The 2v2 release has two server-side gates. `ENABLE_2V2` is the global kill
switch. The per-platform percentages select a stable cohort using an
authenticated Nakama user ID; clients cannot choose or forge their bucket.

```text
ENABLE_2V2=false
ENABLE_2V2_ROLLOUT_BROWSER=0
ENABLE_2V2_ROLLOUT_BALE=0
ENABLE_2V2_ROLLOUT_EITAA=0
ENABLE_2V2_ROLLOUT_TELEGRAM=0
```

Invalid, missing, negative, or greater-than-100 percentages fail closed to
zero. The client fetches `config/features` after authentication and also
fails closed. The matchmaker hook recomputes eligibility, so changing or
forging the client response cannot enter the 2v2 pool.

## Release sequence

1. Keep every production percentage at `0`; run the real-stack gate with
   `ENABLE_2V2=true ENABLE_2V2_ROLLOUT_BROWSER=100` and then execute
   `npm run test:load:2v2`.
2. Set `ENABLE_2V2=true` and `ENABLE_2V2_ROLLOUT_BALE=5`. Keep all other
   platforms at zero. Redeploy and observe for at least 24 hours and 200
   started matches.
3. Increase Bale to `100` only when every gate below passes. Observe another
   24 hours before starting Eitaa at 5%. Telegram follows Eitaa.
4. Any stop condition: set the affected platform percentage to `0`. For an
   economic, settlement, or cross-mode incident, set `ENABLE_2V2=false`.
   Existing matches may finish; no new 2v2 ticket is accepted.

## Analytics gates

Evaluate a fixed UTC window. `match_start` is the funnel denominator;
`live_match_ended`, `match_quit`, and server `settlement_failed` logs are the
terminal signals.

- Started-match volume: at least 200 before promotion from 5%.
- Queue conversion: `live_match_started(mode=2v2) / live_queue_2v2_joined`
  at least 70% within the client retry window.
- Disconnect/quit rate: 2v2 `match_quit / match_start` no more than 8% and
  no more than 2 percentage points above 1v1.
- Settlement failures: zero. Any `settlement_failed` is an immediate stop.
- Result completeness: at least 99.5% of starts have one normalized
  `match_end` per settled participant within 5 minutes.
- Queue regression: 1v1 p95 queue time must not increase by more than 10%
  against the preceding seven-day baseline.

Example PostgreSQL checks (replace the time window deliberately):

```sql
SELECT name, props->>'mode' AS mode, COUNT(*)
FROM analytics_events
WHERE created_at >= $1 AND created_at < $2
  AND name IN ('live_queue_2v2_joined', 'match_start', 'match_end', 'match_quit')
GROUP BY name, props->>'mode';

SELECT COUNT(*) AS unnormalized_2v2_results
FROM analytics_events
WHERE created_at >= $1 AND created_at < $2
  AND name = 'match_end' AND props->>'mode' = '2v2'
  AND NOT (props ? 'slot' AND props ? 'teamId' AND props ? 'battlefieldId');
```

Never enable a platform because the client bundle alone contains the 2v2 UI;
the authoritative server percentages are the release control.
