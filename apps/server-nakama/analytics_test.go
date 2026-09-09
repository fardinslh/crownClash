package main

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

const analyticsTestNow = int64(1_725_000_000_000)

func analyticsTestEvent(name string, props map[string]any) AnalyticsEventRecord {
	return AnalyticsEventRecord{
		EventID:       "event_test",
		Name:          name,
		SessionID:     "session_test",
		OccurredAt:    analyticsTestNow,
		SchemaVersion: 1,
		Props:         props,
	}
}

func analyticsPayload(events []AnalyticsEventRecord) string {
	payload, _ := json.Marshal(map[string]any{"events": events})
	return string(payload)
}

func analyticsPropsJSON(t *testing.T, props map[string]any) []byte {
	t.Helper()
	encoded, err := json.Marshal(props)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func TestAnalyticsPayloadRejectsMalformedAndInvalidEvents(t *testing.T) {
	valid := analyticsTestEvent("match_start", map[string]any{
		"matchId": "match_1", "mode": "bot", "source": "menu",
	})
	tooMany := make([]AnalyticsEventRecord, analyticsBatchMaxSize+1)
	for index := range tooMany {
		tooMany[index] = valid
	}
	tests := []struct {
		name    string
		payload string
		wantErr string
	}{
		{name: "malformed JSON", payload: "{", wantErr: "invalid_payload"},
		{name: "client player ID", payload: `{"events":[],"playerId":"forged"}`, wantErr: "invalid_payload"},
		{name: "unknown name", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("unknown_event", map[string]any{}),
		}), wantErr: "invalid_event_name"},
		{name: "too many events", payload: analyticsPayload(tooMany), wantErr: "invalid_events"},
		{name: "unexpected property", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("session_start", map[string]any{"coins": 999}),
		}), wantErr: "invalid_event_props"},
		{name: "null properties", payload: `{"events":[{"eventId":"event_1","name":"session_start","sessionId":"session_1","occurredAt":1725000000000,"schemaVersion":1,"props":null}]}`, wantErr: "invalid_event_props"},
		{name: "nested property", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("live_queue_joined", map[string]any{"nested": map[string]any{}}),
		}), wantErr: "invalid_event_props"},
		{name: "missing required property", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("match_start", map[string]any{"matchId": "match_1"}),
		}), wantErr: "invalid_event_props"},
		{name: "missing upgrade panel source", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("upgrade_panel_viewed", map[string]any{}),
		}), wantErr: "invalid_event_props"},
		{name: "invalid upgrade panel source enum", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("upgrade_panel_viewed", map[string]any{"source": "shop"}),
		}), wantErr: "invalid_event_props"},
		{name: "invalid envelope", payload: analyticsPayload([]AnalyticsEventRecord{{
			Name: "session_start", SessionID: "session_test", OccurredAt: analyticsTestNow, SchemaVersion: 1, Props: map[string]any{},
		}}), wantErr: "invalid_event_envelope"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := parseAnalyticsEventsPayload(test.payload, analyticsTestNow)
			if err == nil || err.Error() != test.wantErr {
				t.Fatalf("expected %q, got %v", test.wantErr, err)
			}
		})
	}
}

func TestAnalyticsPayloadAcceptsValidEvent(t *testing.T) {
	events, err := parseAnalyticsEventsPayload(analyticsPayload([]AnalyticsEventRecord{
		analyticsTestEvent("match_end", map[string]any{
			"matchId": "match_1", "mode": "bot", "result": "victory", "durationSeconds": 42,
		}),
	}), analyticsTestNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].EventID != "event_test" {
		t.Fatalf("unexpected events: %+v", events)
	}
}

func TestTrackAnalyticsEventsRejectsUnauthenticatedRequest(t *testing.T) {
	_, err := rpcTrackEvents(nil)(context.Background(), nil, nil, nil, "")
	if err == nil || err.Error() != "unauthenticated" {
		t.Fatalf("expected unauthenticated, got %v", err)
	}
}

func TestInsertAnalyticsEventsCommitsWholeBatch(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO analytics_events")).
		WithArgs("player_1", "event_1", "session_test", "live_queue_joined", analyticsTestNow, 1, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO analytics_events")).
		WithArgs("player_1", "event_2", "session_test", "live_queue_joined", analyticsTestNow, 1, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(2, 1))
	mock.ExpectCommit()

	result, err := NewStore(db).InsertAnalyticsEvents(context.Background(), "player_1", []AnalyticsEventRecord{
		{EventID: "event_1", Name: "live_queue_joined", SessionID: "session_test", OccurredAt: analyticsTestNow, SchemaVersion: 1, Props: map[string]any{}},
		{EventID: "event_2", Name: "live_queue_joined", SessionID: "session_test", OccurredAt: analyticsTestNow, SchemaVersion: 1, Props: map[string]any{}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Inserted != 2 {
		t.Fatalf("expected two inserted rows, got %d", result.Inserted)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestInsertAnalyticsEventsIsIdempotentByPlayerAndEventID(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	event := AnalyticsEventRecord{
		EventID: "event_1", Name: "live_queue_joined", SessionID: "session_test",
		OccurredAt: analyticsTestNow, SchemaVersion: 1, Props: map[string]any{},
	}
	for _, rows := range []int64{1, 0} {
		mock.ExpectBegin()
		mock.ExpectExec(regexp.QuoteMeta("INSERT INTO analytics_events")).
			WithArgs("player_1", event.EventID, event.SessionID, event.Name, event.OccurredAt, event.SchemaVersion, sqlmock.AnyArg()).
			WillReturnResult(sqlmock.NewResult(1, rows))
		mock.ExpectCommit()
	}

	store := NewStore(db)
	first, err := store.InsertAnalyticsEvents(context.Background(), "player_1", []AnalyticsEventRecord{event})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.InsertAnalyticsEvents(context.Background(), "player_1", []AnalyticsEventRecord{event})
	if err != nil {
		t.Fatal(err)
	}
	if first.Inserted != 1 || second.Inserted != 0 {
		t.Fatalf("expected insert then duplicate no-op, got %+v then %+v", first, second)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestInsertAnalyticsEventsRollsBackFailedBatch(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO analytics_events")).
		WithArgs("player_1", "event_1", "session_test", "live_queue_joined", analyticsTestNow, 1, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO analytics_events")).
		WithArgs("player_1", "event_2", "session_test", "live_queue_joined", analyticsTestNow, 1, sqlmock.AnyArg()).
		WillReturnError(errors.New("database unavailable"))
	mock.ExpectRollback()

	_, err = NewStore(db).InsertAnalyticsEvents(context.Background(), "player_1", []AnalyticsEventRecord{
		{EventID: "event_1", Name: "live_queue_joined", SessionID: "session_test", OccurredAt: analyticsTestNow, SchemaVersion: 1, Props: map[string]any{}},
		{EventID: "event_2", Name: "live_queue_joined", SessionID: "session_test", OccurredAt: analyticsTestNow, SchemaVersion: 1, Props: map[string]any{}},
	})
	if err == nil {
		t.Fatal("expected insert failure")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestInsertAnalyticsEventsNormalizesMatchEndFromSettlement(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	settlement := MatchSettlement{
		MatchID: "match_1",
		Status:  "victory",
		Stats:   MatchStats{MatchDurationSeconds: 48},
	}
	settlementJSON, _ := json.Marshal(settlement)
	expectedProps := map[string]any{
		"matchId": "match_1", "mode": "bot", "result": "victory", "durationSeconds": 48,
	}
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT settlement FROM match_settlements")).
		WithArgs("match_1", "player_1").
		WillReturnRows(sqlmock.NewRows([]string{"settlement"}).AddRow(settlementJSON))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO analytics_events")).
		WithArgs("player_1", "event_1", "session_test", "match_end", analyticsTestNow, 1, analyticsPropsJSON(t, expectedProps)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	_, err = NewStore(db).InsertAnalyticsEvents(context.Background(), "player_1", []AnalyticsEventRecord{{
		EventID: "event_1", Name: "match_end", SessionID: "session_test", OccurredAt: analyticsTestNow, SchemaVersion: 1,
		Props: map[string]any{
			"matchId": "match_1", "mode": "bot", "result": "defeat", "durationSeconds": 1,
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestInsertAnalyticsEventsNormalizesRewardFromSettlement(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	settlement := MatchSettlement{
		MatchID: "match_1",
		Breakdown: MatchRewardBreakdown{
			BaseCoins: 40, SpeedBonus: 15, DominationBonus: 15, StreakBonus: 5,
			TreasuryBonus: 8, TotalCoins: 83, TrophyDelta: 30,
		},
		NewCareer: PlayerCareer{Coins: 175, Trophies: 30},
	}
	settlementJSON, _ := json.Marshal(settlement)
	expectedProps := map[string]any{
		"matchId": "match_1", "mode": "bot", "baseCoins": 40, "speedBonus": 15,
		"dominationBonus": 15, "streakBonus": 5, "treasuryBonus": 8, "totalCoins": 83, "trophyDelta": 30,
		"resultingCoins": 175, "resultingTrophies": 30,
	}
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT settlement FROM match_settlements")).
		WithArgs("match_1", "player_1").
		WillReturnRows(sqlmock.NewRows([]string{"settlement"}).AddRow(settlementJSON))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO analytics_events")).
		WithArgs("player_1", "event_1", "session_test", "match_reward_received", analyticsTestNow, 1, analyticsPropsJSON(t, expectedProps)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	_, err = NewStore(db).InsertAnalyticsEvents(context.Background(), "player_1", []AnalyticsEventRecord{{
		EventID: "event_1", Name: "match_reward_received", SessionID: "session_test", OccurredAt: analyticsTestNow, SchemaVersion: 1,
		Props: map[string]any{
			"matchId": "match_1", "mode": "bot", "totalCoins": 999_999, "resultingCoins": 999_999,
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestInsertAnalyticsEventsNormalizesUpgradeSuccessFromPurchase(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	cost := 175
	purchase := UpgradePurchaseResult{
		Success: true,
		Cost:    &cost,
		NewCareer: PlayerCareer{
			Coins:           325,
			ProductionLevel: 3,
		},
	}
	purchaseJSON, _ := json.Marshal(purchase)
	expectedProps := map[string]any{
		"purchaseId": "purchase_1", "upgradeType": "production", "level": 3,
		"cost": 175, "resultingCoins": 325,
	}
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT upgrade_type, result FROM upgrade_purchases")).
		WithArgs("purchase_1", "player_1").
		WillReturnRows(sqlmock.NewRows([]string{"upgrade_type", "result"}).AddRow("production", purchaseJSON))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO analytics_events")).
		WithArgs("player_1", "event_1", "session_test", "upgrade_purchase_succeeded", analyticsTestNow, 1, analyticsPropsJSON(t, expectedProps)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	_, err = NewStore(db).InsertAnalyticsEvents(context.Background(), "player_1", []AnalyticsEventRecord{{
		EventID: "event_1", Name: "upgrade_purchase_succeeded", SessionID: "session_test", OccurredAt: analyticsTestNow, SchemaVersion: 1,
		Props: map[string]any{
			"purchaseId": "purchase_1", "cost": 999_999, "level": 99, "resultingCoins": 999_999,
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
