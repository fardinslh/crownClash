-- Read only. Server receipt times define calendar-day cohorts in Tehran.
-- Anonymous visits and client-observed sessions are diagnostic; purchases and
-- activation come exclusively from verified orders / authoritative settlements.
WITH entries AS (
 SELECT DISTINCT ON (v.player_id) v.player_id,v.campaign,v.experiment_version,v.received_at AS entered_at,
 (v.received_at AT TIME ZONE 'Asia/Tehran')::date AS cohort_day
 FROM pilot_visits v JOIN users u ON u.id::text=v.player_id
 WHERE v.player_id IS NOT NULL AND u.custom_id LIKE 'bale:%'
 ORDER BY v.player_id,v.received_at,v.id
), completed AS (
 SELECT m.player_id,m.match_id,m.created_at
 FROM match_settlements m LEFT JOIN realm_tickets r ON r.id=m.match_id
 LEFT JOIN bot_matches b ON b.match_id=m.match_id
 WHERE r.state='settled' OR (b.pilot_document IS NOT NULL AND b.settled_at IS NOT NULL)
), player_metrics AS (
 SELECT e.*,
 (SELECT count(*) FROM completed c WHERE c.player_id=e.player_id AND c.created_at>=e.entered_at AND c.created_at<e.entered_at+interval '1 day') AS first_day_matches,
 EXISTS(SELECT 1 FROM completed c WHERE c.player_id=e.player_id AND c.created_at>=e.entered_at) AS activated,
 EXISTS(SELECT 1 FROM pilot_visits a WHERE a.player_id=e.player_id AND (a.received_at AT TIME ZONE 'Asia/Tehran')::date=e.cohort_day+1) AS d1,
 EXISTS(SELECT 1 FROM pilot_visits a WHERE a.player_id=e.player_id AND (a.received_at AT TIME ZONE 'Asia/Tehran')::date=e.cohort_day+7) AS d7,
 (SELECT count(*) FROM coin_orders o WHERE o.player_id=e.player_id AND NOT o.test_mode AND o.fulfilled_at>=extract(epoch FROM e.entered_at)*1000 AND o.state IN ('fulfilled','refunded') AND o.fulfilled_at < extract(epoch FROM e.entered_at+interval '7 days')*1000) AS orders7,
 (SELECT count(*) FROM coin_orders o WHERE o.player_id=e.player_id AND NOT o.test_mode AND o.fulfilled_at>=extract(epoch FROM e.entered_at)*1000 AND o.state IN ('fulfilled','refunded') AND o.fulfilled_at < extract(epoch FROM e.entered_at+interval '30 days')*1000) AS orders30,
 COALESCE((SELECT sum(CASE WHEN o.state='refunded' THEN 0 ELSE o.amount_rials END) FROM coin_orders o WHERE o.player_id=e.player_id AND NOT o.test_mode AND o.fulfilled_at>=extract(epoch FROM e.entered_at)*1000 AND o.state IN ('fulfilled','refunded') AND o.fulfilled_at < extract(epoch FROM e.entered_at+interval '30 days')*1000),0) AS net_revenue30_rials
 FROM entries e
), cohorts AS (
 SELECT campaign,experiment_version,cohort_day,count(*) AS authenticated,
 count(*) FILTER(WHERE activated) AS activated,
 count(*) FILTER(WHERE first_day_matches>=1) AS first_complete,
 count(*) FILTER(WHERE first_day_matches>=2) AS second_match,
 count(*) FILTER(WHERE activated AND cohort_day <= (now() AT TIME ZONE 'Asia/Tehran')::date-2) AS d1_eligible,
 count(*) FILTER(WHERE activated AND d1 AND cohort_day <= (now() AT TIME ZONE 'Asia/Tehran')::date-2) AS d1_returned,
 count(*) FILTER(WHERE activated AND cohort_day <= (now() AT TIME ZONE 'Asia/Tehran')::date-8) AS d7_eligible,
 count(*) FILTER(WHERE activated AND d7 AND cohort_day <= (now() AT TIME ZONE 'Asia/Tehran')::date-8) AS d7_returned,
 count(*) FILTER(WHERE activated AND entered_at<=now()-interval '7 days') AS payer7_eligible,
 count(*) FILTER(WHERE activated AND orders7>=1 AND entered_at<=now()-interval '7 days') AS payers7,
 count(*) FILTER(WHERE activated AND entered_at<=now()-interval '30 days') AS d30_eligible,
 count(*) FILTER(WHERE orders30>=1 AND entered_at<=now()-interval '30 days') AS buyers30,
 count(*) FILTER(WHERE orders30>=2 AND entered_at<=now()-interval '30 days') AS repeat_buyers30,
 sum(net_revenue30_rials) FILTER(WHERE entered_at<=now()-interval '30 days') AS net_revenue30_rials
 FROM player_metrics GROUP BY campaign,experiment_version,cohort_day
)
SELECT json_build_object('generatedAt',now(),'cohorts',COALESCE((SELECT json_agg(cohorts ORDER BY cohort_day,campaign) FROM cohorts),'[]'::json),
 'anonymousVisits',COALESCE((SELECT json_agg(x) FROM(SELECT campaign,count(*) AS visits,count(*) FILTER(WHERE player_id IS NOT NULL) AS associated FROM pilot_visits GROUP BY campaign)x),'[]'::json));
