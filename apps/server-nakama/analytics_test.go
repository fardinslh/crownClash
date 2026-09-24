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
		{name: "invalid battlefield", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("match_start", map[string]any{"matchId": "match_1", "mode": "bot", "source": "menu", "battlefieldId": "forged_map"}),
		}), wantErr: "invalid_event_props"},
		{name: "unknown property on upgrade panel", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("upgrade_panel_viewed", map[string]any{"source": "menu", "extra": "x"}),
		}), wantErr: "invalid_event_props"},
		{name: "unknown property alone on upgrade panel", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("upgrade_panel_viewed", map[string]any{"extra": "x"}),
		}), wantErr: "invalid_event_props"},
		{name: "invalid upgrade panel source enum", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("upgrade_panel_viewed", map[string]any{"source": "shop"}),
		}), wantErr: "invalid_event_props"},
		{name: "wrong type for upgrade panel source", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("upgrade_panel_viewed", map[string]any{"source": 1}),
		}), wantErr: "invalid_event_props"},
		{name: "forged daily reward value", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("daily_reward_claimed", map[string]any{"claimId": "claim_1", "reward": 999999}),
		}), wantErr: "invalid_event_props"},
		{name: "forged league reward value", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("league_reward_claimed", map[string]any{"claimId": "claim_1", "reward": 999999}),
		}), wantErr: "invalid_event_props"},
		{name: "tutorial_started with extra property", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("tutorial_started", map[string]any{"extra": "val"}),
		}), wantErr: "invalid_event_props"},
		{name: "tutorial_step_completed missing stepId", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("tutorial_step_completed", map[string]any{}),
		}), wantErr: "invalid_event_props"},
		{name: "tutorial_step_completed invalid stepId", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("tutorial_step_completed", map[string]any{"stepId": "invalid_step"}),
		}), wantErr: "invalid_event_props"},
		{name: "tutorial_step_completed wrong type for stepId", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("tutorial_step_completed", map[string]any{"stepId": 123}),
		}), wantErr: "invalid_event_props"},
		{name: "tutorial_step_completed extra property", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("tutorial_step_completed", map[string]any{"stepId": "drag_to_attack", "extra": "val"}),
		}), wantErr: "invalid_event_props"},
		{name: "tutorial_completed with extra property", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("tutorial_completed", map[string]any{"extra": "val"}),
		}), wantErr: "invalid_event_props"},
		{name: "tutorial_skipped missing lastStepId", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("tutorial_skipped", map[string]any{}),
		}), wantErr: "invalid_event_props"},
		{name: "tutorial_skipped invalid lastStepId", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("tutorial_skipped", map[string]any{"lastStepId": "unknown"}),
		}), wantErr: "invalid_event_props"},
		{name: "tutorial_skipped wrong type for lastStepId", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("tutorial_skipped", map[string]any{"lastStepId": true}),
		}), wantErr: "invalid_event_props"},
		{name: "commander selected invalid ID", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("commander_selected", map[string]any{"commanderId": "forged"}),
		}), wantErr: "invalid_event_props"},
		{name: "commander panel extra property", payload: analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("commander_panel_viewed", map[string]any{"extra": true}),
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

func TestMatchStartAnalyticsAcceptsLegacyAndBattlefieldPayloads(t *testing.T) {
	for _, props := range []map[string]any{
		{"matchId": "match_1", "mode": "bot", "source": "menu"},
		{"matchId": "match_2", "mode": "bot", "source": "rematch", "battlefieldId": "twin_passes"},
		{"matchId": "match_3", "mode": "live", "source": "menu", "battlefieldId": "crown_cross"},
	} {
		if _, err := parseAnalyticsEventsPayload(analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("match_start", props),
		}), analyticsTestNow); err != nil {
			t.Fatalf("valid match_start rejected (%v): %v", props, err)
		}
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

func TestAnalyticsPayloadAcceptsCommanderEvents(t *testing.T) {
	events, err := parseAnalyticsEventsPayload(analyticsPayload([]AnalyticsEventRecord{
		analyticsTestEvent("commander_panel_viewed", map[string]any{}),
		analyticsTestEvent("commander_selected", map[string]any{"commanderId": "quartermaster"}),
	}), analyticsTestNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 {
		t.Fatalf("unexpected events: %+v", events)
	}
}

func TestAnalyticsPayloadAcceptsDailyEvents(t *testing.T) {
	events, err := parseAnalyticsEventsPayload(analyticsPayload([]AnalyticsEventRecord{
		analyticsTestEvent("daily_panel_viewed", map[string]any{}),
		analyticsTestEvent("daily_reward_claimed", map[string]any{"claimId": "claim_1"}),
	}), analyticsTestNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 {
		t.Fatalf("unexpected daily events: %+v", events)
	}
}

func TestAnalyticsPayloadAcceptsLeagueEvents(t *testing.T) {
	events, err := parseAnalyticsEventsPayload(analyticsPayload([]AnalyticsEventRecord{
		analyticsTestEvent("league_panel_viewed", map[string]any{}),
		analyticsTestEvent("league_reward_claimed", map[string]any{"claimId": "claim_1"}),
		analyticsTestEvent("rank_promoted", map[string]any{"matchId": "match_1"}),
	}), analyticsTestNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 {
		t.Fatalf("unexpected league events: %+v", events)
	}
}

func TestAnalyticsPayloadAcceptsTutorialEvents(t *testing.T) {
	steps := []string{"drag_to_attack", "preview_result", "tower_roles", "multi_dispatch"}
	var eventRecords []AnalyticsEventRecord

	eventRecords = append(eventRecords, analyticsTestEvent("tutorial_started", map[string]any{}))
	for _, step := range steps {
		eventRecords = append(eventRecords, analyticsTestEvent("tutorial_step_completed", map[string]any{"stepId": step}))
	}
	eventRecords = append(eventRecords, analyticsTestEvent("tutorial_completed", map[string]any{}))
	for _, step := range steps {
		eventRecords = append(eventRecords, analyticsTestEvent("tutorial_skipped", map[string]any{"lastStepId": step}))
	}

	events, err := parseAnalyticsEventsPayload(analyticsPayload(eventRecords), analyticsTestNow)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(events) != len(eventRecords) {
		t.Fatalf("expected %d events, got %d", len(eventRecords), len(events))
	}
}

func TestAnalyticsPayloadAcceptsUpgradePanelViewedWithLegacyAndSourcedProps(t *testing.T) {
	// Schema-version-1 clients shipped before the Kingdom hub send this event
	// with no properties; newer clients always include a source. Both shapes
	// must keep validating so old builds never get their analytics dropped.
	cases := []struct {
		name  string
		props map[string]any
	}{
		{name: "legacy empty props", props: map[string]any{}},
		{name: "menu source", props: map[string]any{"source": "menu"}},
		{name: "result source", props: map[string]any{"source": "result"}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			events, err := parseAnalyticsEventsPayload(analyticsPayload([]AnalyticsEventRecord{
				analyticsTestEvent("upgrade_panel_viewed", test.props),
			}), analyticsTestNow)
			if err != nil {
				t.Fatalf("expected acceptance, got %v", err)
			}
			if len(events) != 1 {
				t.Fatalf("unexpected events: %+v", events)
			}
		})
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
			Coins:                 325,
			StartingGarrisonLevel: 3,
			ProductionLevel:       3,
			ArmySpeedLevel:        2,
			TreasuryLevel:         2,
		},
	}
	purchaseJSON, _ := json.Marshal(purchase)
	expectedProps := map[string]any{
		"purchaseId": "purchase_1", "upgradeType": "production", "level": 3,
		"cost": 175, "resultingCoins": 325, "kingdomLevel": 10, "kingdomTierId": "stone_fort",
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

func TestInsertAnalyticsEventsNormalizesDailyRewardFromClaim(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	claim := DailyClaimResult{
		ClaimID: "claim_1", Success: true, RewardType: DailyCrownChest, Reward: 75,
		NewCareer: PlayerCareer{Coins: 275},
	}
	claimJSON, _ := json.Marshal(claim)
	expectedProps := map[string]any{
		"claimId": "claim_1", "rewardType": "crown_chest", "reward": 75, "resultingCoins": 275,
	}
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT result FROM daily_reward_claims")).
		WithArgs("claim_1", "player_1").
		WillReturnRows(sqlmock.NewRows([]string{"result"}).AddRow(claimJSON))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO analytics_events")).
		WithArgs("player_1", "event_1", "session_test", "daily_reward_claimed", analyticsTestNow, 1, analyticsPropsJSON(t, expectedProps)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	_, err = NewStore(db).InsertAnalyticsEvents(context.Background(), "player_1", []AnalyticsEventRecord{{
		EventID: "event_1", Name: "daily_reward_claimed", SessionID: "session_test", OccurredAt: analyticsTestNow, SchemaVersion: 1,
		Props: map[string]any{"claimId": "claim_1", "reward": 999_999, "resultingCoins": 999_999},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestInsertAnalyticsEventsNormalizesLeagueRewardFromClaim(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	claim := LeagueClaimResult{
		ClaimID: "claim_1", Success: true, RankID: "knight", Reward: 150,
		NewCareer: PlayerCareer{Coins: 350},
	}
	claimJSON, _ := json.Marshal(claim)
	expectedProps := map[string]any{
		"claimId": "claim_1", "rankId": "knight", "reward": 150, "resultingCoins": 350,
	}
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT result FROM league_reward_claims")).
		WithArgs("claim_1", "player_1").
		WillReturnRows(sqlmock.NewRows([]string{"result"}).AddRow(claimJSON))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO analytics_events")).
		WithArgs("player_1", "event_1", "session_test", "league_reward_claimed", analyticsTestNow, 1, analyticsPropsJSON(t, expectedProps)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	_, err = NewStore(db).InsertAnalyticsEvents(context.Background(), "player_1", []AnalyticsEventRecord{{
		EventID: "event_1", Name: "league_reward_claimed", SessionID: "session_test", OccurredAt: analyticsTestNow, SchemaVersion: 1,
		Props: map[string]any{"claimId": "claim_1", "reward": 999_999, "resultingCoins": 999_999},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestInsertAnalyticsEventsNormalizesRankPromotionFromSettlement(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	settlement := MatchSettlement{
		MatchID: "match_1", RankPromoted: true,
		NewRank: RankTierInfo{ID: "soldier"}, NewCareer: PlayerCareer{Trophies: 115},
	}
	settlementJSON, _ := json.Marshal(settlement)
	expectedProps := map[string]any{
		"matchId": "match_1", "rankId": "soldier", "resultingTrophies": 115,
	}
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT settlement FROM match_settlements")).
		WithArgs("match_1", "player_1").
		WillReturnRows(sqlmock.NewRows([]string{"settlement"}).AddRow(settlementJSON))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO analytics_events")).
		WithArgs("player_1", "event_1", "session_test", "rank_promoted", analyticsTestNow, 1, analyticsPropsJSON(t, expectedProps)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	_, err = NewStore(db).InsertAnalyticsEvents(context.Background(), "player_1", []AnalyticsEventRecord{{
		EventID: "event_1", Name: "rank_promoted", SessionID: "session_test", OccurredAt: analyticsTestNow, SchemaVersion: 1,
		Props: map[string]any{"matchId": "match_1", "rankId": "forged"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAnalyticsPayloadAccepts2v2EventShapes(t *testing.T) {
	valid := []AnalyticsEventRecord{
		analyticsTestEvent("match_start", map[string]any{
			"matchId": "live2v2_deadbeef_1", "mode": "2v2", "source": "menu",
			"slot": float64(2), "teamId": "b", "battlefieldId": "quad_citadel",
		}),
		analyticsTestEvent("match_start", map[string]any{
			"matchId": "live2v2_deadbeef_1", "mode": "2v2", "source": "rematch",
		}),
		analyticsTestEvent("match_end", map[string]any{
			"matchId": "live2v2_deadbeef_1", "mode": "2v2", "result": "victory",
			"durationSeconds": float64(42), "slot": float64(2), "teamId": "b",
		}),
		analyticsTestEvent("match_end", map[string]any{
			"matchId": "match_1", "mode": "bot", "result": "victory", "durationSeconds": float64(1),
		}),
		analyticsTestEvent("match_reward_received", map[string]any{
			"matchId": "live2v2_deadbeef_1", "mode": "2v2",
		}),
	}
	if _, err := parseAnalyticsEventsPayload(analyticsPayload(valid), analyticsTestNow); err != nil {
		t.Fatalf("valid 2v2 analytics shapes rejected: %v", err)
	}
}

func TestAnalyticsPayloadRejectsForged2v2ParticipantProps(t *testing.T) {
	tests := []struct {
		name  string
		props map[string]any
	}{
		{name: "match_start 2v2 unknown teamId", props: map[string]any{
			"matchId": "live2v2_deadbeef_1", "mode": "2v2", "source": "menu", "teamId": "c",
		}},
		{name: "match_start 2v2 out-of-range slot", props: map[string]any{
			"matchId": "live2v2_deadbeef_1", "mode": "2v2", "source": "menu", "slot": float64(4),
		}},
		{name: "match_start 2v2 fractional slot", props: map[string]any{
			"matchId": "live2v2_deadbeef_1", "mode": "2v2", "source": "menu", "slot": 1.5,
		}},
		{name: "match_start forged battlefield", props: map[string]any{
			"matchId": "live2v2_deadbeef_1", "mode": "2v2", "source": "menu", "battlefieldId": "quad_citadel_forged",
		}},
		{name: "match_end 2v2 out-of-range slot", props: map[string]any{
			"matchId": "live2v2_deadbeef_1", "mode": "2v2", "result": "victory",
			"durationSeconds": float64(42), "slot": float64(-1),
		}},
	}
	for _, test := range tests {
		if _, err := parseAnalyticsEventsPayload(analyticsPayload([]AnalyticsEventRecord{analyticsTestEvent("match_start", test.props)}), analyticsTestNow); err == nil {
			t.Fatalf("%s: forged props accepted", test.name)
		}
	}
}

func TestInsertAnalyticsEventsNormalizes2v2MatchEndFromMultiSettlement(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	// Stored settlement says victory/42s for slot 2 (team b); the client
	// payload claims defeat/1s. Normalization must overwrite every
	// reward-relevant field from the stored row.
	settlement := MatchSettlement{
		MatchID: "live2v2_deadbeef_1",
		Status:  "victory",
		Stats:   MatchStats{MatchDurationSeconds: 42},
	}
	settlementJSON, _ := json.Marshal(settlement)
	expectedProps := map[string]any{
		"matchId": "live2v2_deadbeef_1", "mode": "2v2", "result": "victory",
		"durationSeconds": 42, "slot": 2, "teamId": "b", "battlefieldId": "quad_citadel",
	}
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT slot, team_id, settlement FROM match_settlements_multi")).
		WithArgs("live2v2_deadbeef_1", "player_1").
		WillReturnRows(sqlmock.NewRows([]string{"slot", "team_id", "settlement"}).AddRow(2, "b", settlementJSON))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT battlefield_id FROM match_replays")).
		WithArgs("live2v2_deadbeef_1").
		WillReturnRows(sqlmock.NewRows([]string{"battlefield_id"}).AddRow("quad_citadel"))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO analytics_events")).
		WithArgs("player_1", "event_1", "session_test", "match_end", analyticsTestNow, 1, analyticsPropsJSON(t, expectedProps)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	_, err = NewStore(db).InsertAnalyticsEvents(context.Background(), "player_1", []AnalyticsEventRecord{{
		EventID: "event_1", Name: "match_end", SessionID: "session_test", OccurredAt: analyticsTestNow, SchemaVersion: 1,
		Props: map[string]any{
			"matchId": "live2v2_deadbeef_1", "mode": "2v2", "result": "defeat",
			"durationSeconds": float64(1), "slot": float64(2), "teamId": "b",
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestInsertAnalyticsEventsNormalizes2v2RewardFromSettlement(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	settlement := MatchSettlement{
		MatchID: "live2v2_deadbeef_1",
		Breakdown: MatchRewardBreakdown{
			BaseCoins: 40, SpeedBonus: 10, DominationBonus: 15, StreakBonus: 0,
			TreasuryBonus: 8, TotalCoins: 73, TrophyDelta: 0,
		},
		NewCareer: PlayerCareer{Coins: 173, Trophies: 340},
	}
	settlementJSON, _ := json.Marshal(settlement)
	expectedProps := map[string]any{
		"matchId": "live2v2_deadbeef_1", "mode": "2v2",
		"baseCoins": 40, "speedBonus": 10, "dominationBonus": 15, "streakBonus": 0,
		"treasuryBonus": 8, "totalCoins": 73, "trophyDelta": 0,
		"resultingCoins": 173, "resultingTrophies": 340,
	}
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT slot, team_id, settlement FROM match_settlements_multi")).
		WithArgs("live2v2_deadbeef_1", "player_1").
		WillReturnRows(sqlmock.NewRows([]string{"slot", "team_id", "settlement"}).AddRow(0, "a", settlementJSON))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT battlefield_id FROM match_replays")).
		WithArgs("live2v2_deadbeef_1").
		WillReturnRows(sqlmock.NewRows([]string{"battlefield_id"}).AddRow("quad_citadel"))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO analytics_events")).
		WithArgs("player_1", "event_1", "session_test", "match_reward_received", analyticsTestNow, 1, analyticsPropsJSON(t, expectedProps)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	_, err = NewStore(db).InsertAnalyticsEvents(context.Background(), "player_1", []AnalyticsEventRecord{{
		EventID: "event_1", Name: "match_reward_received", SessionID: "session_test", OccurredAt: analyticsTestNow, SchemaVersion: 1,
		Props: map[string]any{
			"matchId": "live2v2_deadbeef_1", "mode": "2v2", "totalCoins": float64(9999),
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestInsertAnalyticsEventsRejects2v2ResultWithoutStoredSettlement(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	// A client cannot claim 2v2 results that the settlement store does not
	// hold: the multi-settlement lookup fails closed.
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT slot, team_id, settlement FROM match_settlements_multi")).
		WithArgs("live2v2_forged_1", "player_1").
		WillReturnRows(sqlmock.NewRows([]string{"slot", "team_id", "settlement"}))
	mock.ExpectRollback()

	if _, err := NewStore(db).InsertAnalyticsEvents(context.Background(), "player_1", []AnalyticsEventRecord{{
		EventID: "event_1", Name: "match_end", SessionID: "session_test", OccurredAt: analyticsTestNow, SchemaVersion: 1,
		Props: map[string]any{
			"matchId": "live2v2_forged_1", "mode": "2v2", "result": "victory", "durationSeconds": float64(9),
		},
	}}); err == nil {
		t.Fatal("2v2 match_end without a stored settlement must be rejected")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAnalyticsPayloadAccepts2v2MatchQuit(t *testing.T) {
	// The exact shape GameScene's 2v2 terminal close handler emits, plus
	// the 1v1 "live" mode which must keep working unchanged.
	events, err := parseAnalyticsEventsPayload(analyticsPayload([]AnalyticsEventRecord{
		analyticsTestEvent("match_quit", map[string]any{
			"matchId": "live2v2_deadbeef_1725000000000", "mode": "2v2", "durationSeconds": float64(37),
		}),
		analyticsTestEvent("match_quit", map[string]any{
			"matchId": "live_deadbeef_1725000000000", "mode": "live", "durationSeconds": float64(12),
		}),
	}), analyticsTestNow)
	if err != nil {
		t.Fatalf("valid 2v2/live match_quit rejected: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("accepted events = %d, want 2", len(events))
	}
}

func TestAnalyticsPayloadRejectsInvalidMatchQuitShapes(t *testing.T) {
	matchQuit := func(props map[string]any) map[string]any {
		return props
	}
	cases := []struct {
		name  string
		props map[string]any
	}{
		{"invalid_mode_bot", matchQuit(map[string]any{"matchId": "m", "mode": "bot", "durationSeconds": float64(1)})},
		{"invalid_mode_ranked", matchQuit(map[string]any{"matchId": "m", "mode": "ranked", "durationSeconds": float64(1)})},
		{"invalid_mode_empty", matchQuit(map[string]any{"matchId": "m", "mode": "", "durationSeconds": float64(1)})},
		{"missing_mode", matchQuit(map[string]any{"matchId": "m", "durationSeconds": float64(1)})},
		{"missing_duration_2v2", matchQuit(map[string]any{"matchId": "m", "mode": "2v2"})},
		{"missing_duration_live", matchQuit(map[string]any{"matchId": "m", "mode": "live"})},
		{"unexpected_slot_prop", matchQuit(map[string]any{"matchId": "m", "mode": "2v2", "durationSeconds": float64(1), "slot": float64(2)})},
		{"unexpected_team_id_prop", matchQuit(map[string]any{"matchId": "m", "mode": "2v2", "durationSeconds": float64(1), "teamId": "a"})},
		{"unexpected_user_id_prop", matchQuit(map[string]any{"matchId": "m", "mode": "2v2", "durationSeconds": float64(1), "userId": "intruder"})},
		{"unexpected_result_prop", matchQuit(map[string]any{"matchId": "m", "mode": "2v2", "durationSeconds": float64(1), "result": "victory"})},
	}
	for _, caseItem := range cases {
		if _, err := parseAnalyticsEventsPayload(analyticsPayload([]AnalyticsEventRecord{
			analyticsTestEvent("match_quit", caseItem.props),
		}), analyticsTestNow); err == nil {
			t.Fatalf("match_quit case %q must be rejected", caseItem.name)
		}
	}
}
