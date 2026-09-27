-- 2v2 launch gate: 7-day Bale 1v1 queue audit (read-only).
-- Run against the PRODUCTION crownclash database, e.g.:
--   psql "$PROD_DSN" -f scripts/prod-audit-2v2-launch.sql
-- Output is aggregate-only: no user IDs are selected.
-- Nakama stores the verified platform in users.custom_id as platform:id.
-- The Bale filter is essential: an all-platform queue count cannot justify a
-- Bale-only cohort. Run with ON_ERROR_STOP=1 so a failed statement cannot
-- produce a partial, misleading launch decision.

BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';

-- 0) Ingestion sanity — the rollout gates are blind without analytics.
SELECT name, COUNT(*) AS rows,
       MIN(created_at)::date AS first_day, MAX(created_at)::date AS last_day
FROM analytics_events
WHERE created_at >= now() - interval '7 days'
GROUP BY name ORDER BY rows DESC;

-- 1) Daily active players (pilot-size framing).
SELECT a.created_at::date AS day, COUNT(DISTINCT a.player_id) AS active_players
FROM analytics_events a
JOIN users u ON u.id::text = a.player_id AND u.custom_id LIKE 'bale:%'
WHERE a.created_at >= now() - interval '7 days' AND a.name = 'session_start'
GROUP BY 1 ORDER BY 1;

-- 2) Daily 1v1 queue volume.
SELECT a.created_at::date AS day, COUNT(*) AS queue_joins
FROM analytics_events a
JOIN users u ON u.id::text = a.player_id AND u.custom_id LIKE 'bale:%'
WHERE a.name = 'live_queue_joined' AND a.created_at >= now() - interval '7 days'
GROUP BY 1 ORDER BY 1;

-- 3) 1v1 queue conversion and wait times (join -> match start per session).
WITH pair AS (
  SELECT s.player_id, s.session_id, s.occurred_at AS joined_at,
    (SELECT MIN(m.occurred_at) FROM analytics_events m
     WHERE m.session_id = s.session_id AND m.player_id = s.player_id
       AND m.name = 'live_match_started'
       AND m.occurred_at >= s.occurred_at
       AND m.occurred_at <= s.occurred_at + 600000) AS started_at
  FROM analytics_events s
  JOIN users u ON u.id::text = s.player_id AND u.custom_id LIKE 'bale:%'
  WHERE s.name = 'live_queue_joined' AND s.created_at >= now() - interval '7 days'
)
SELECT COUNT(*) AS joins,
       COUNT(started_at) AS matched,
       ROUND(100.0 * COUNT(started_at) / NULLIF(COUNT(*), 0), 1) AS conv_pct,
       ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY started_at - joined_at) / 1000.0)::numeric, 1) AS p50_wait_s,
       ROUND((percentile_cont(0.95) WITHIN GROUP (ORDER BY started_at - joined_at) / 1000.0)::numeric, 1) AS p95_wait_s
FROM pair;

-- 4) Peak-hour 1v1 concurrency estimate (Little's law: joins * avg_wait / 3600).
--    Caveat: waits use matched pairs only (right-censoring underestimated);
--    treat the result as a lower bound for pool depth.
WITH pair AS (
  SELECT s.player_id, s.session_id, s.occurred_at AS joined_at,
    (SELECT MIN(m.occurred_at) FROM analytics_events m
     WHERE m.session_id = s.session_id AND m.player_id = s.player_id
       AND m.name = 'live_match_started'
       AND m.occurred_at >= s.occurred_at
       AND m.occurred_at <= s.occurred_at + 600000) AS started_at
  FROM analytics_events s
  JOIN users u ON u.id::text = s.player_id AND u.custom_id LIKE 'bale:%'
  WHERE s.name = 'live_queue_joined' AND s.created_at >= now() - interval '7 days'
),
hr AS (
  SELECT date_trunc('hour', to_timestamp(joined_at / 1000.0)) AS hour,
         COUNT(*) AS joins,
         AVG(started_at - joined_at) / 1000.0 AS avg_wait_s
  FROM pair WHERE started_at IS NOT NULL
  GROUP BY 1
)
SELECT to_char(hour, 'MM-DD HH24:00') AS hour, joins,
       ROUND(avg_wait_s::numeric, 1) AS avg_wait_s,
       ROUND((joins * avg_wait_s / 3600.0)::numeric, 2) AS est_concurrent_1v1
FROM hr ORDER BY est_concurrent_1v1 DESC LIMIT 30;

-- 5) Mode baselines: starts and quits per mode (the quit gate is 2v2 within
--    +2pp of the 1v1 live baseline).
SELECT a.props->>'mode' AS mode,
       COUNT(DISTINCT a.props->>'matchId') FILTER (WHERE a.name = 'match_start') AS starts,
       COUNT(DISTINCT a.props->>'matchId') FILTER (WHERE a.name = 'match_quit') AS quits
FROM analytics_events a
JOIN users u ON u.id::text = a.player_id AND u.custom_id LIKE 'bale:%'
WHERE a.name IN ('match_start', 'match_quit')
  AND a.created_at >= now() - interval '7 days'
  AND a.props->>'mode' IN ('live', '2v2')
GROUP BY 1;

-- 6) Bale 2v2 baseline (expected: zero rows everywhere pre-launch). Queue
-- joins have no mode property, so they must be selected by event name.
SELECT a.name, COUNT(*) FROM analytics_events a
JOIN users u ON u.id::text = a.player_id AND u.custom_id LIKE 'bale:%'
WHERE a.created_at >= now() - interval '7 days'
  AND (a.name = 'live_queue_2v2_joined'
       OR (a.name IN ('match_start', 'match_end', 'match_quit')
           AND a.props->>'mode' = '2v2'))
GROUP BY a.name;

ROLLBACK;
