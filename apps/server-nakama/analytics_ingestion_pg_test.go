package main

// Real-PostgreSQL end-to-end analytics ingestion proof: the exact payload
// shape the game client submits through the analytics/events RPC is
// validated, normalized from authoritative settlement rows, and stored in
// analytics_events. Skipped unless TEST_POSTGRES_DSN is set (see
// store_settle2v2_pg_test.go). Creates uniquely-named players and removes
// every row it created.

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/heroiclabs/nakama-common/runtime"
)

// TestAnalyticsIngestion2v2RealPostgres drives the full ingestion path:
// a real settlement, then the client-compatible analytics RPC payload
// (match_start, forged match_end, match_reward_received, live_match_ended,
// match_quit), then reads analytics_events back and asserts normalization,
// idempotency, fail-closed rejection, and identifier-free properties.
func TestAnalyticsIngestion2v2RealPostgres(t *testing.T) {
	db, _ := requireTestPostgres(t)
	defer db.Close()

	ctx := context.Background()
	if err := RunMigrations(ctx, db); err != nil {
		t.Fatalf("migrations: %v", err)
	}

	var userIDs [live2v2MaxPlayers]string
	for slot := range userIDs {
		userIDs[slot] = fmt.Sprintf("%s%s_ing", pg2v2TestPrefix, test2v2UserIDs[slot])
	}
	matchID := pg2v2TestPrefix + "match_analytics"
	sessionID := pg2v2TestPrefix + "session"
	deleteAnalyticsRows := func() {
		for _, userID := range userIDs {
			_, _ = db.ExecContext(ctx, `DELETE FROM analytics_events WHERE player_id = $1`, userID)
		}
	}
	cleanup2v2TestPlayers(ctx, db, []string{matchID}, userIDs) // pre-clean settlement fixture
	deleteAnalyticsRows()
	if err := create2v2TestPlayers(ctx, db, userIDs); err != nil {
		t.Fatalf("create players: %v", err)
	}
	defer cleanup2v2TestPlayers(ctx, db, []string{matchID}, userIDs)
	defer deleteAnalyticsRows()

	// A real authoritative settlement: team A victory, team B defeat, 42 s.
	store := NewStore(db)
	request := pg2v2Request(matchID, userIDs, [live2v2MaxPlayers]string{"victory", "victory", "defeat", "defeat"})
	if _, err := store.SettleMatch2v2(ctx, request); err != nil {
		t.Fatalf("settlement: %v", err)
	}

	// The defeat player in slot 2 submits the client-shaped batch. The
	// match_end result, duration, slot, and team are FORGED: server
	// normalization must replace every one of them from the stored
	// settlement and replay rows.
	now := nowMillis()
	ingestCtx := context.WithValue(ctx, runtime.RUNTIME_CTX_USER_ID, userIDs[2])
	events := []AnalyticsEventRecord{
		{EventID: pg2v2TestPrefix + "evt_start", Name: "match_start", SessionID: sessionID, OccurredAt: now, SchemaVersion: 1,
			Props: map[string]any{"matchId": matchID, "mode": "2v2", "source": "menu", "battlefieldId": "quad_citadel", "slot": float64(2), "teamId": "b"}},
		{EventID: pg2v2TestPrefix + "evt_end", Name: "match_end", SessionID: sessionID, OccurredAt: now, SchemaVersion: 1,
			Props: map[string]any{"matchId": matchID, "mode": "2v2", "result": "victory", "durationSeconds": float64(999), "slot": float64(0), "teamId": "a"}},
		{EventID: pg2v2TestPrefix + "evt_reward", Name: "match_reward_received", SessionID: sessionID, OccurredAt: now, SchemaVersion: 1,
			Props: map[string]any{"matchId": matchID, "mode": "2v2"}},
		{EventID: pg2v2TestPrefix + "evt_live_end", Name: "live_match_ended", SessionID: sessionID, OccurredAt: now, SchemaVersion: 1,
			Props: map[string]any{"matchId": matchID, "status": "defeat"}},
		{EventID: pg2v2TestPrefix + "evt_quit", Name: "match_quit", SessionID: sessionID, OccurredAt: now, SchemaVersion: 1,
			Props: map[string]any{"matchId": matchID, "mode": "2v2", "durationSeconds": float64(40)}},
	}
	payload, err := json.Marshal(map[string]any{"events": events})
	if err != nil {
		t.Fatalf("payload marshal: %v", err)
	}

	track := rpcTrackEvents(store)
	response, err := track(ingestCtx, nil, db, nil, string(payload))
	if err != nil {
		t.Fatalf("ingestion RPC rejected a client-shaped batch: %v", err)
	}
	var accepted struct {
		Accepted   int `json:"accepted"`
		Inserted   int `json:"inserted"`
		Duplicates int `json:"duplicates"`
	}
	if err := json.Unmarshal([]byte(response), &accepted); err != nil {
		t.Fatalf("rpc response invalid: %v", err)
	}
	if accepted.Accepted != 5 || accepted.Inserted != 5 || accepted.Duplicates != 0 {
		t.Fatalf("first submission result = %+v, want accepted 5, inserted 5, duplicates 0", accepted)
	}

	// Exactly one stored row per event id; a duplicate delivery must be
	// absorbed idempotently (no second rows).
	if got := count2v2Rows(ctx, db, `SELECT COUNT(*) FROM analytics_events WHERE player_id = $1 AND session_id = $2`, userIDs[2], sessionID); got != 5 {
		t.Fatalf("analytics_events rows = %d, want 5", got)
	}

	// A duplicate delivery must be absorbed idempotently (no second rows).
	response, err = track(ingestCtx, nil, db, nil, string(payload))
	if err != nil {
		t.Fatalf("duplicate ingestion RPC failed: %v", err)
	}
	var duplicates struct {
		Inserted   int `json:"inserted"`
		Duplicates int `json:"duplicates"`
	}
	if err := json.Unmarshal([]byte(response), &duplicates); err != nil {
		t.Fatalf("rpc response invalid: %v", err)
	}
	if duplicates.Inserted != 0 || duplicates.Duplicates != 5 {
		t.Fatalf("duplicate submission result = inserted %d, duplicates %d, want 0/5", duplicates.Inserted, duplicates.Duplicates)
	}
	if got := count2v2Rows(ctx, db, `SELECT COUNT(*) FROM analytics_events WHERE player_id = $1 AND session_id = $2`, userIDs[2], sessionID); got != 5 {
		t.Fatalf("analytics_events rows after duplicate delivery = %d, want 5", got)
	}

	// match_end must be stored normalized from the authoritative settlement
	// and replay rows: every forged field is overwritten.
	props := queryAnalyticsProps(t, db, userIDs[2], sessionID, pg2v2TestPrefix+"evt_end")
	assertAnalyticsProp(t, props, "result", "defeat")
	assertAnalyticsProp(t, props, "durationSeconds", float64(42))
	assertAnalyticsProp(t, props, "slot", float64(2))
	assertAnalyticsProp(t, props, "teamId", "b")
	assertAnalyticsProp(t, props, "battlefieldId", "quad_citadel")
	assertAnalyticsProp(t, props, "mode", "2v2")

	// match_reward_received must carry the authoritative defeat-tier
	// breakdown: 10 base coins, no bonuses, zero trophies.
	props = queryAnalyticsProps(t, db, userIDs[2], sessionID, pg2v2TestPrefix+"evt_reward")
	assertAnalyticsProp(t, props, "baseCoins", float64(10))
	assertAnalyticsProp(t, props, "totalCoins", float64(10))
	assertAnalyticsProp(t, props, "trophyDelta", float64(0))
	for _, bonus := range []string{"speedBonus", "dominationBonus", "streakBonus", "treasuryBonus"} {
		assertAnalyticsProp(t, props, bonus, float64(0))
	}

	// The 2v2 match_quit acceptance: stored with the client's shape.
	props = queryAnalyticsProps(t, db, userIDs[2], sessionID, pg2v2TestPrefix+"evt_quit")
	assertAnalyticsProp(t, props, "mode", "2v2")
	assertAnalyticsProp(t, props, "durationSeconds", float64(40))

	// No user identifiers may leak into event properties.
	for _, userID := range userIDs {
		if got := count2v2Rows(ctx, db, `SELECT COUNT(*) FROM analytics_events WHERE player_id = $1 AND props::text LIKE $2`, userID, "%"+userID+"%"); got != 0 {
			t.Fatalf("user identifier leaked into analytics properties for %s (%d rows)", userID, got)
		}
		if got := count2v2Rows(ctx, db, `SELECT COUNT(*) FROM analytics_events WHERE player_id = $1 AND props ? 'userId'`, userID); got != 0 {
			t.Fatalf("userId key present in analytics properties for %s", userID)
		}
	}

	// A forged extra property (invented reward field) is rejected outright.
	forged, err := json.Marshal(map[string]any{"events": []AnalyticsEventRecord{{
		EventID: pg2v2TestPrefix + "evt_forged", Name: "match_end", SessionID: sessionID, OccurredAt: now, SchemaVersion: 1,
		Props: map[string]any{"matchId": matchID, "mode": "2v2", "result": "victory", "durationSeconds": float64(1), "coins": float64(9999)},
	}}})
	if err != nil {
		t.Fatalf("forged payload marshal: %v", err)
	}
	if _, err := track(ingestCtx, nil, db, nil, string(forged)); err == nil {
		t.Fatal("match_end with an invented reward property must be rejected")
	}

	// A nonexistent settlement id fails closed and stores nothing.
	bogus, err := json.Marshal(map[string]any{"events": []AnalyticsEventRecord{{
		EventID: pg2v2TestPrefix + "evt_bogus", Name: "match_end", SessionID: sessionID, OccurredAt: now, SchemaVersion: 1,
		Props: map[string]any{"matchId": pg2v2TestPrefix + "match_missing", "mode": "2v2", "result": "victory", "durationSeconds": float64(1)},
	}}})
	if err != nil {
		t.Fatalf("bogus payload marshal: %v", err)
	}
	if _, err := track(ingestCtx, nil, db, nil, string(bogus)); err == nil || !strings.Contains(err.Error(), "analytics_settlement_not_found") {
		t.Fatalf("nonexistent settlement id must fail closed with analytics_settlement_not_found, got %v", err)
	}
	if got := count2v2Rows(ctx, db, `SELECT COUNT(*) FROM analytics_events WHERE player_id = $1 AND session_id = $2`, userIDs[2], sessionID); got != 5 {
		t.Fatalf("rejected events must not store rows: analytics_events = %d, want 5", got)
	}

	// Cleanup must leave zero analytics rows for the test players.
	deleteAnalyticsRows()
	for _, userID := range userIDs {
		if got := count2v2Rows(ctx, db, `SELECT COUNT(*) FROM analytics_events WHERE player_id = $1`, userID); got != 0 {
			t.Fatalf("cleanup left %d analytics rows for %s", got, userID)
		}
	}
}

func queryAnalyticsProps(t *testing.T, db *sql.DB, userID, sessionID, eventID string) map[string]any {
	t.Helper()
	var encoded []byte
	if err := db.QueryRowContext(context.Background(), `
		SELECT props FROM analytics_events WHERE player_id = $1 AND session_id = $2 AND event_id = $3
	`, userID, sessionID, eventID).Scan(&encoded); err != nil {
		t.Fatalf("analytics_events row not found for %s: %v", eventID, err)
	}
	var props map[string]any
	if err := json.Unmarshal(encoded, &props); err != nil {
		t.Fatalf("analytics props invalid for %s: %v", eventID, err)
	}
	return props
}

func assertAnalyticsProp(t *testing.T, props map[string]any, key string, want any) {
	t.Helper()
	got, exists := props[key]
	if !exists {
		t.Fatalf("analytics property %q missing (props: %v)", key, props)
	}
	if fmt.Sprintf("%v", got) != fmt.Sprintf("%v", want) {
		t.Fatalf("analytics property %q = %v, want %v", key, got, want)
	}
}
