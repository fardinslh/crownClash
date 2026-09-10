package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func dailyCareerRows(playerID string, coins int) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "coins", "gems", "trophies",
		"starting_garrison_level", "production_level", "army_speed_level", "treasury_level", "selected_commander",
		"matches_played", "matches_won", "current_streak", "best_streak", "last_match_timestamp",
	}).AddRow(playerID, coins, 10, 0, 0, 0, 0, 0, "crown_guard", 0, 0, 0, 0, 0)
}

func dailyProgressRows(dayKey string, played, won, captured int, playClaimed, winClaimed, captureClaimed, chestClaimed bool) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"day_key", "matches_played", "matches_won", "territories_captured",
		"play_matches_claimed", "win_match_claimed", "capture_territories_claimed", "crown_chest_claimed",
	}).AddRow(dayKey, played, won, captured, playClaimed, winClaimed, captureClaimed, chestClaimed)
}

func TestDailyWindowUsesTehranMidnight(t *testing.T) {
	before := time.Date(2026, 9, 9, 20, 29, 0, 0, time.UTC)
	dayKey, resetsAt := dailyWindow(before)
	if dayKey != "2026-09-09" {
		t.Fatalf("expected Tehran day 2026-09-09, got %s", dayKey)
	}
	if got := time.UnixMilli(resetsAt).UTC(); !got.Equal(time.Date(2026, 9, 9, 20, 30, 0, 0, time.UTC)) {
		t.Fatalf("unexpected reset: %s", got)
	}
	after := time.Date(2026, 9, 9, 20, 31, 0, 0, time.UTC)
	if key, _ := dailyWindow(after); key != "2026-09-10" {
		t.Fatalf("expected next Tehran day, got %s", key)
	}
}

func TestDailyStateUnlocksChestOnlyAfterAllMissionClaims(t *testing.T) {
	row := dailyProgressRow{
		DayKey: "2026-09-09", MatchesPlayed: 2, MatchesWon: 1, TerritoriesCaptured: 10,
		PlayMatchesClaimed: true, WinMatchClaimed: true,
	}
	state := buildDailyState(row, 123)
	if !state.Missions[0].Complete || !state.Missions[1].Complete || !state.Missions[2].Complete {
		t.Fatalf("completed progress did not produce completed missions: %+v", state.Missions)
	}
	if state.Chest.Unlocked {
		t.Fatal("chest unlocked before all three rewards were claimed")
	}
	row.CaptureTerritoriesClaimed = true
	if !buildDailyState(row, 123).Chest.Unlocked {
		t.Fatal("chest stayed locked after all three rewards were claimed")
	}
}

func TestDailyClaimAwardsCoinsAndWritesAuditLedger(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	store := NewStore(db)
	store.nowFn = func() time.Time { return now }

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT player_id, day_key::text, reward_type, result")).
		WithArgs("claim_1").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM players WHERE id = $1 FOR UPDATE")).
		WithArgs("player_1").WillReturnRows(dailyCareerRows("player_1", 100))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT player_id, day_key::text, reward_type, result")).
		WithArgs("claim_1").WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO player_daily_progress")).
		WithArgs("player_1", "2026-09-09").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT day_key::text, matches_played, matches_won, territories_captured")).
		WithArgs("player_1", "2026-09-09").
		WillReturnRows(dailyProgressRows("2026-09-09", 2, 0, 4, false, false, false, false))
	mock.ExpectExec("UPDATE player_daily_progress SET play_matches_claimed = true").
		WithArgs("player_1", "2026-09-09").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO daily_reward_claims")).
		WithArgs("claim_1", "player_1", "2026-09-09", DailyPlayMatches, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE players SET")).
		WithArgs("player_1", 130, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO economy_ledger")).
		WithArgs("daily_claim_1", "player_1", "coins", 30, "daily_play_matches", "daily_reward", 100, 130, now.UnixMilli()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	result, err := store.ClaimDailyReward(context.Background(), "player_1", DailyPlayMatches, "claim_1")
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.Reward != 30 || result.NewCareer.Coins != 130 || result.LedgerEntry == nil {
		t.Fatalf("unexpected claim result: %+v", result)
	}
	if !result.State.Missions[0].Claimed || result.State.Chest.Unlocked {
		t.Fatalf("unexpected state after first claim: %+v", result.State)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDailyClaimReplayReturnsStoredResultWithoutMutation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	stored := DailyClaimResult{
		ClaimID: "claim_1", Success: true, RewardType: DailyWinMatch, Reward: 40,
		NewCareer: PlayerCareer{PlayerID: "player_1", Coins: 140},
	}
	encoded, _ := json.Marshal(stored)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT player_id, day_key::text, reward_type, result")).
		WithArgs("claim_1").
		WillReturnRows(sqlmock.NewRows([]string{"player_id", "day_key", "reward_type", "result"}).
			AddRow("player_1", "2026-09-09", DailyWinMatch, encoded))
	mock.ExpectRollback()
	store := NewStore(db)
	store.nowFn = func() time.Time { return now }

	result, err := store.ClaimDailyReward(context.Background(), "player_1", DailyWinMatch, "claim_1")
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || !result.Replayed || result.NewCareer.Coins != 140 {
		t.Fatalf("unexpected replay: %+v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("replay mutated career or ledger: %v", err)
	}
}

func TestDailyClaimRejectsAnotherPlayersClaimID(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT player_id, day_key::text, reward_type, result")).
		WithArgs("claim_1").
		WillReturnRows(sqlmock.NewRows([]string{"player_id", "day_key", "reward_type", "result"}).
			AddRow("player_1", "2026-09-09", DailyWinMatch, []byte(`{"success":true}`)))
	mock.ExpectRollback()
	store := NewStore(db)
	store.nowFn = func() time.Time { return time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC) }

	_, err = store.ClaimDailyReward(context.Background(), "player_2", DailyWinMatch, "claim_1")
	if err != ErrDailyClaimOwnership {
		t.Fatalf("expected ownership error, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("foreign claim touched player state: %v", err)
	}
}

func TestStoredSettlementReplayDoesNotAdvanceDailyProgress(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	stored := MatchSettlement{MatchID: "match_1", Status: "victory"}
	encoded, _ := json.Marshal(stored)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT settlement FROM match_settlements WHERE match_id = $1")).
		WithArgs("match_1").WillReturnRows(sqlmock.NewRows([]string{"settlement"}).AddRow(encoded))
	mock.ExpectRollback()

	result, err := NewStore(db).SettleMatch(context.Background(), "player_1", "victory", MatchStats{}, "match_1")
	if err != nil || result.MatchID != "match_1" {
		t.Fatalf("unexpected replay: %+v, %v", result, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("replayed settlement advanced daily progress: %v", err)
	}
}

func TestDailyMigrationAddsProgressAndIdempotentClaims(t *testing.T) {
	var dailyMigration *migration
	for index := range migrations {
		if migrations[index].name == "006_daily_missions" {
			dailyMigration = &migrations[index]
			break
		}
	}
	if dailyMigration == nil {
		t.Fatal("daily mission migration is missing")
	}
	for _, clause := range []string{
		"CREATE TABLE IF NOT EXISTS player_daily_progress",
		"PRIMARY KEY (player_id, day_key)",
		"CREATE TABLE IF NOT EXISTS daily_reward_claims",
		"UNIQUE (player_id, day_key, reward_type)",
	} {
		if !strings.Contains(dailyMigration.sql, clause) {
			t.Fatalf("migration does not contain %q", clause)
		}
	}
}
