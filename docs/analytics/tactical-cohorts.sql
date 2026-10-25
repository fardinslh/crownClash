-- Read-only local report. Rules are server-normalized. Old events without a
-- verified version are excluded rather than guessed into the v2 baseline.
WITH starts AS (
 SELECT DISTINCT ON (player_id,props->>'matchId') player_id,session_id,props->>'matchId' match_id,
 (props->>'gameplayRulesVersion')::int rules,props->>'source' source,
 to_timestamp(occurred_at/1000.0) at,
 (to_timestamp(occurred_at/1000.0) AT TIME ZONE 'Asia/Tehran')::date AS day
 FROM analytics_events WHERE name='match_start' AND props->>'mode' IN ('bot','async')
 AND props->>'gameplayRulesVersion' IN ('2','3','4')
 ORDER BY player_id,props->>'matchId',occurred_at
), ends AS (
 SELECT DISTINCT ON (player_id,props->>'matchId') player_id,props->>'matchId' match_id,props->>'result' result,
 (props->>'durationSeconds')::float duration,to_timestamp(occurred_at/1000.0) at
 FROM analytics_events WHERE name='match_end'
 ORDER BY player_id,props->>'matchId',occurred_at
), ordered AS (
 SELECT s.*,row_number() OVER(PARTITION BY player_id,session_id,rules ORDER BY at,match_id) position
 FROM starts s
), sessions AS (
 SELECT o.player_id,o.session_id,o.rules,COUNT(*) started,BOOL_OR(o.position=2 AND e.match_id IS NOT NULL) second_completed
 FROM ordered o LEFT JOIN ends e USING(player_id,match_id)
 GROUP BY o.player_id,o.session_id,o.rules
), first_days AS (
 SELECT player_id,rules,MIN(day) AS day FROM starts GROUP BY player_id,rules
), metrics AS (
 SELECT v.rules,
 (SELECT COUNT(*) FROM starts s WHERE s.rules=v.rules) matches_started,
 (SELECT COUNT(*) FROM sessions s WHERE s.rules=v.rules) sessions,
 (SELECT COUNT(*) FROM starts s JOIN ends e USING(player_id,match_id) WHERE s.rules=v.rules) matches_completed,
 (SELECT COUNT(*) FROM starts s JOIN ends e USING(player_id,match_id) WHERE s.rules=v.rules AND e.result='defeat') completed_losses,
 (SELECT COUNT(*) FROM sessions s WHERE s.rules=v.rules AND s.started>=2) sessions_started_second,
 (SELECT COUNT(*) FROM sessions s WHERE s.rules=v.rules AND s.second_completed) sessions_completed_second,
 (SELECT COUNT(*) FROM starts s WHERE s.rules=v.rules AND s.source='rematch' AND
   (SELECT e.result FROM ends e WHERE e.player_id=s.player_id AND e.at<=s.at ORDER BY e.at DESC LIMIT 1)='defeat') rematches_after_loss,
 (SELECT COUNT(*) FROM starts s WHERE s.rules=v.rules AND EXISTS(SELECT 1 FROM analytics_events q WHERE q.player_id=s.player_id AND q.props->>'matchId'=s.match_id AND q.name='match_quit' AND (q.props->>'durationSeconds')::float<15)) quits_before_15s,
 (SELECT AVG(e.duration) FROM starts s JOIN ends e USING(player_id,match_id) WHERE s.rules=v.rules) mean_duration_seconds,
 (SELECT COUNT(*) FROM first_days f WHERE f.rules=v.rules AND f.day<(now() AT TIME ZONE 'Asia/Tehran')::date-1) d1_eligible_players,
 (SELECT COUNT(*) FROM first_days f WHERE f.rules=v.rules AND f.day<(now() AT TIME ZONE 'Asia/Tehran')::date-1
   AND EXISTS(SELECT 1 FROM starts s WHERE s.player_id=f.player_id AND s.day=f.day+1)) d1_returned_players
 FROM (VALUES(2),(3)) v(rules)
) SELECT jsonb_pretty(jsonb_build_object('cohorts',(SELECT jsonb_agg(to_jsonb(m)) FROM metrics m),
 'interpretation','Descriptive observations only. Missing verified baseline or small samples cannot establish retention improvement.'));
