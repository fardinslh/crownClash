package main

import (
	"context"
	"database/sql"
	"errors"
)

// Opt-in additive metadata: legacy event shapes still normalize identically.
func normalizeVersionedAnalyticsEvent(ctx context.Context, tx *sql.Tx, userID string, event AnalyticsEventRecord) (AnalyticsEventRecord, error) {
	_, requested := event.Props["gameplayRulesVersion"]
	_, difficultyRequested := event.Props["botDifficulty"]
	normalized, err := normalizeAnalyticsEvent(ctx, tx, userID, event)
	if err != nil || (!requested && !difficultyRequested) {
		return normalized, err
	}
	mode, _ := event.Props["mode"].(string)
	if (event.Name != "match_start" && event.Name != "match_end" && event.Name != "match_quit") || (mode != "bot" && mode != "async") {
		return AnalyticsEventRecord{}, errors.New("invalid_event_props")
	}
	id, _ := event.Props["matchId"].(string)
	var version int
	err = tx.QueryRowContext(ctx, `SELECT gameplay_rules_version FROM bot_matches WHERE match_id=$1 AND player_id=$2
 UNION ALL SELECT (document->>'gameplayRulesVersion')::integer FROM realm_tickets WHERE id=$1 AND player_id=$2`, id, userID).Scan(&version)
	if err != nil {
		return AnalyticsEventRecord{}, errors.New("analytics_match_not_found")
	}
	if !supportedGameplayRules(version) {
		return AnalyticsEventRecord{}, errors.New("unsupported_gameplay_rules_version")
	}
	if requested {
		normalized.Props["gameplayRulesVersion"] = version
	}
	if difficultyRequested {
		var difficulty string
		if mode != "bot" {
			return AnalyticsEventRecord{}, errors.New("invalid_event_props")
		}
		if err := tx.QueryRowContext(ctx, `SELECT bot_difficulty FROM bot_matches WHERE match_id=$1 AND player_id=$2`, id, userID).Scan(&difficulty); err != nil {
			return AnalyticsEventRecord{}, errors.New("analytics_match_not_found")
		}
		normalized.Props["botDifficulty"] = difficulty
	}
	return normalized, nil
}
