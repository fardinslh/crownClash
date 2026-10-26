-- Read-only local report: first-session experience timing.
-- Uses only existing events (session_start, menu_viewed, tutorial_*,
-- match_start) and their client `occurred_at` (ms), so no schema change is
-- needed. Clocks are the player's own: compare durations, not absolute times.
-- Each player is measured once, on their first tutorial_started.
WITH first_start AS (
 SELECT DISTINCT ON (player_id) player_id, session_id, occurred_at AS started_at
 FROM analytics_events WHERE name = 'tutorial_started'
 ORDER BY player_id, occurred_at
), boot AS (
 -- Time from app start to the guided battle beginning.
 SELECT f.player_id,
  (f.started_at - MIN(e.occurred_at)) / 1000.0 AS seconds_to_tutorial
 FROM first_start f
 JOIN analytics_events e
  ON e.player_id = f.player_id AND e.session_id = f.session_id AND e.name = 'session_start'
 GROUP BY f.player_id, f.started_at
), steps AS (
 SELECT f.player_id, e.props->>'stepId' AS step_id,
  (MIN(e.occurred_at) - f.started_at) / 1000.0 AS seconds_from_start
 FROM first_start f
 JOIN analytics_events e
  ON e.player_id = f.player_id AND e.session_id = f.session_id
  AND e.name = 'tutorial_step_completed' AND e.occurred_at >= f.started_at
 GROUP BY f.player_id, f.started_at, e.props->>'stepId'
), outcome AS (
 SELECT f.player_id,
  MIN(e.occurred_at) FILTER (WHERE e.name = 'tutorial_completed') AS completed_at,
  MIN(e.occurred_at) FILTER (WHERE e.name = 'tutorial_skipped') AS skipped_at,
  f.started_at
 FROM first_start f
 LEFT JOIN analytics_events e
  ON e.player_id = f.player_id AND e.session_id = f.session_id
  AND e.name IN ('tutorial_completed', 'tutorial_skipped') AND e.occurred_at >= f.started_at
 GROUP BY f.player_id, f.started_at
)
SELECT 'to_tutorial' AS metric, NULL::text AS step_id, COUNT(*) AS players,
 percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds_to_tutorial) AS median_seconds,
 percentile_cont(0.9) WITHIN GROUP (ORDER BY seconds_to_tutorial) AS p90_seconds
FROM boot
UNION ALL
SELECT 'step', step_id, COUNT(*),
 percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds_from_start),
 percentile_cont(0.9) WITHIN GROUP (ORDER BY seconds_from_start)
FROM steps GROUP BY step_id
UNION ALL
SELECT 'completed', NULL, COUNT(*) FILTER (WHERE completed_at IS NOT NULL),
 percentile_cont(0.5) WITHIN GROUP (ORDER BY (completed_at - started_at) / 1000.0),
 percentile_cont(0.9) WITHIN GROUP (ORDER BY (completed_at - started_at) / 1000.0)
FROM outcome
UNION ALL
SELECT 'skipped', NULL, COUNT(*) FILTER (WHERE skipped_at IS NOT NULL),
 percentile_cont(0.5) WITHIN GROUP (ORDER BY (skipped_at - started_at) / 1000.0),
 percentile_cont(0.9) WITHIN GROUP (ORDER BY (skipped_at - started_at) / 1000.0)
FROM outcome
ORDER BY 1, 2;
