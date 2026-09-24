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
terminal signals. `match_start` and `match_end` are emitted once per client,
so a settled 2v2 match produces four rows of each — always count distinct
`props->>'matchId'` values, never raw rows.

- Started-match volume: at least 200 distinct 2v2 match IDs before promotion
  from 5% (800 `match_start` rows at four participants).
- Queue conversion: `live_match_started(mode=2v2) / live_queue_2v2_joined`
  at least 70% within the client retry window. Both events carry no match
  properties, so pair them per `session_id`.
- Disconnect/quit rate: 2v2 `match_quit / match_start` no more than 8% and
  no more than 2 percentage points above 1v1.
- Settlement failures: zero. Any `settlement_failed` is an immediate stop.
- Result completeness: at least 99.5% of started 2v2 matches have all four
  normalized `match_end` rows within 5 minutes. Normalization is server-side
  (`match_settlements_multi` + `match_replays`): a normalized row carries
  `slot`, `teamId`, and `battlefieldId`, and forged client values for
  `result`/`durationSeconds` are replaced from the stored settlement.
- Queue regression: 1v1 p95 queue time must not increase by more than 10%
  against the preceding seven-day baseline. Queue time is not a stored
  property; it is the `occurred_at` delta between `live_queue_joined` and
  `live_match_started` inside one `session_id`.

Example PostgreSQL checks (replace the time window deliberately):

```sql
SELECT name, props->>'mode' AS mode, COUNT(DISTINCT props->>'matchId') AS matches
FROM analytics_events
WHERE created_at >= $1 AND created_at < $2
  AND name IN ('match_start', 'match_end', 'match_quit')
GROUP BY name, props->>'mode';

SELECT COUNT(*) AS unnormalized_2v2_results
FROM analytics_events
WHERE created_at >= $1 AND created_at < $2
  AND name = 'match_end' AND props->>'mode' = '2v2'
  AND NOT (props ? 'slot' AND props ? 'teamId' AND props ? 'battlefieldId');
```

Queue conversion and the 1v1 queue-time baseline pair queue joins with match
starts per session (`occurred_at` is epoch milliseconds):

```sql
SELECT
  COUNT(DISTINCT s.session_id) FILTER (WHERE m.event_id IS NOT NULL) AS converted,
  COUNT(DISTINCT s.session_id) AS queued
FROM analytics_events s
LEFT JOIN LATERAL (
  SELECT 1 AS event_id FROM analytics_events m
  WHERE m.session_id = s.session_id AND m.player_id = s.player_id
    AND m.name = 'live_match_started' AND m.props->>'mode' = '2v2'
    AND m.occurred_at BETWEEN s.occurred_at AND s.occurred_at + 600000
  LIMIT 1
) m ON true
WHERE s.name = 'live_queue_2v2_joined'
  AND s.created_at >= $1 AND s.created_at < $2;
-- 1v1 baseline: identical shape with name = 'live_queue_joined' and
-- m.props->>'mode' IS NULL (1v1 live_match_started carries no mode prop).

WITH pair AS (
  SELECT s.player_id, s.session_id, s.occurred_at AS joined_at,
    (SELECT MIN(m.occurred_at) FROM analytics_events m
     WHERE m.session_id = s.session_id AND m.player_id = s.player_id
       AND m.name = 'live_match_started'
       AND m.occurred_at BETWEEN s.occurred_at AND s.occurred_at + 600000
       AND m.props->>'mode' IS DISTINCT FROM '2v2') AS started_at
  FROM analytics_events s
  WHERE s.name = 'live_queue_joined'
    AND s.created_at >= $1 AND s.created_at < $2
)
SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY started_at - joined_at) / 1000.0
  AS p95_queue_seconds
FROM pair WHERE started_at IS NOT NULL;
```

Result completeness as a per-match rate (four normalized ends per match,
within five minutes of the first start row):

```sql
WITH starts AS (
  SELECT props->>'matchId' AS match_id, MIN(created_at) AS first_start
  FROM analytics_events
  WHERE created_at >= $1 AND created_at < $2
    AND name = 'match_start' AND props->>'mode' = '2v2'
  GROUP BY 1
),
ends AS (
  SELECT props->>'matchId' AS match_id, COUNT(*) AS end_rows, MIN(created_at) AS first_end
  FROM analytics_events
  WHERE created_at >= $1 AND created_at < $2
    AND name = 'match_end' AND props->>'mode' = '2v2'
    AND props ? 'slot' AND props ? 'teamId' AND props ? 'battlefieldId'
  GROUP BY 1
)
SELECT
  100.0 * COUNT(*) FILTER (
    WHERE e.end_rows >= 4
      AND e.first_end <= s.first_start + interval '5 minutes'
  ) / NULLIF(COUNT(*), 0) AS complete_pct
FROM starts s
LEFT JOIN ends e ON e.match_id = s.match_id;
```

Never enable a platform because the client bundle alone contains the 2v2 UI;
the authoritative server percentages are the release control.
