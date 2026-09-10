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

func leagueCareerRows(playerID string, coins, trophies int) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "coins", "gems", "trophies",
		"starting_garrison_level", "production_level", "army_speed_level", "treasury_level",
		"matches_played", "matches_won", "current_streak", "best_streak", "last_match_timestamp",
	}).AddRow(playerID, coins, 10, trophies, 2, 3, 4, 1, 0, 0, 0, 0, 0)
}

func TestLeagueStateUsesTrophiesPowerAndPermanentClaims(t *testing.T) {
	career := PlayerCareer{
		PlayerID: "player_1", Trophies: 500,
		StartingGarrisonLevel: 2, ProductionLevel: 3, ArmySpeedLevel: 4, TreasuryLevel: 1,
	}
	state := BuildLeagueState(career, map[string]bool{"soldier": true})
	if state.CurrentRankID != "commander" || state.KingdomPower != 10 || len(state.Tiers) != 6 {
		t.Fatalf("unexpected league state: %+v", state)
	}
	if !state.Tiers[1].Claimed || !state.Tiers[3].Unlocked || state.Tiers[4].Unlocked {
		t.Fatalf("unexpected tier states: %+v", state.Tiers)
	}
}

func TestLeagueClaimAwardsCoinsAndWritesAuditLedger(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.UnixMilli(1_725_000_000_000)
	store := NewStore(db)
	store.nowFn = func() time.Time { return now }

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT player_id, rank_id, result FROM league_reward_claims WHERE claim_id = $1")).
		WithArgs("claim_1").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM players WHERE id = $1 FOR UPDATE")).
		WithArgs("player_1").WillReturnRows(leagueCareerRows("player_1", 100, 250))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT player_id, rank_id, result FROM league_reward_claims WHERE claim_id = $1")).
		WithArgs("claim_1").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT rank_id FROM league_reward_claims WHERE player_id = $1")).
		WithArgs("player_1").WillReturnRows(sqlmock.NewRows([]string{"rank_id"}).AddRow("soldier"))
	mock.ExpectQuery(regexp.QuoteMeta("INSERT INTO league_reward_claims")).
		WithArgs("claim_1", "player_1", "knight", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"claim_id"}).AddRow("claim_1"))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE players SET")).
		WithArgs("player_1", 250, 10, 250, 2, 3, 4, 1, 0, 0, 0, 0, 0).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO economy_ledger")).
		WithArgs("league_claim_1", "player_1", "coins", 150, "league_knight", "league_reward", 100, 250, now.UnixMilli()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	result, err := store.ClaimLeagueReward(context.Background(), "player_1", "knight", "claim_1")
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.Reward != 150 || result.NewCareer.Coins != 250 || result.LedgerEntry == nil {
		t.Fatalf("unexpected claim: %+v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestLeagueClaimReplayReturnsStoredResultWithoutMutation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	stored := LeagueClaimResult{
		ClaimID: "claim_1", Success: true, RankID: "soldier", Reward: 75,
		NewCareer: PlayerCareer{PlayerID: "player_1", Coins: 175},
	}
	encoded, _ := json.Marshal(stored)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT player_id, rank_id, result FROM league_reward_claims WHERE claim_id = $1")).
		WithArgs("claim_1").WillReturnRows(sqlmock.NewRows([]string{"player_id", "rank_id", "result"}).
		AddRow("player_1", "soldier", encoded))
	mock.ExpectRollback()

	result, err := NewStore(db).ClaimLeagueReward(context.Background(), "player_1", "soldier", "claim_1")
	if err != nil || !result.Success || !result.Replayed || result.NewCareer.Coins != 175 {
		t.Fatalf("unexpected replay: %+v, %v", result, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("replay mutated state: %v", err)
	}
}

func TestLeagueClaimRejectsAnotherPlayersClaimID(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT player_id, rank_id, result FROM league_reward_claims WHERE claim_id = $1")).
		WithArgs("claim_1").WillReturnRows(sqlmock.NewRows([]string{"player_id", "rank_id", "result"}).
		AddRow("player_1", "soldier", []byte(`{"success":true}`)))
	mock.ExpectRollback()

	_, err = NewStore(db).ClaimLeagueReward(context.Background(), "player_2", "soldier", "claim_1")
	if err != ErrLeagueClaimOwnership {
		t.Fatalf("expected ownership error, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("foreign claim touched state: %v", err)
	}
}

func TestLeagueMigrationAddsUniquePermanentClaims(t *testing.T) {
	var leagueMigration *migration
	for index := range migrations {
		if migrations[index].name == "007_league_rewards" {
			leagueMigration = &migrations[index]
			break
		}
	}
	if leagueMigration == nil {
		t.Fatal("league migration missing")
	}
	for _, clause := range []string{
		"CREATE TABLE IF NOT EXISTS league_reward_claims",
		"claim_id TEXT PRIMARY KEY",
		"UNIQUE (player_id, rank_id)",
	} {
		if !strings.Contains(leagueMigration.sql, clause) {
			t.Fatalf("migration missing %q", clause)
		}
	}
}
