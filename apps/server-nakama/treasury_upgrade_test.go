package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestTreasuryPurchaseReplayReturnsStoredResult(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	cost := 50
	stored := UpgradePurchaseResult{
		Success: true,
		Cost:    &cost,
		NewCareer: PlayerCareer{
			PlayerID: "player_1", Coins: 50, TreasuryLevel: 1,
		},
	}
	encoded, _ := json.Marshal(stored)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT player_id, upgrade_type, result")).
		WithArgs("purchase_1").
		WillReturnRows(sqlmock.NewRows([]string{"player_id", "upgrade_type", "result"}).AddRow("player_1", UpgradeTreasury, encoded))
	mock.ExpectRollback()

	result, err := NewStore(db).PurchaseUpgrade(context.Background(), "player_1", UpgradeTreasury, "purchase_1")
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.NewCareer.TreasuryLevel != 1 || result.NewCareer.Coins != 50 {
		t.Fatalf("unexpected replayed Treasury purchase: %+v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTreasuryPurchaseRejectsAnotherPlayersPurchaseIDWithoutMutation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT player_id, upgrade_type, result")).
		WithArgs("purchase_1").
		WillReturnRows(sqlmock.NewRows([]string{"player_id", "upgrade_type", "result"}).
			AddRow("player_1", UpgradeTreasury, []byte(`{"success":true}`)))
	mock.ExpectRollback()

	_, err = NewStore(db).PurchaseUpgrade(context.Background(), "player_2", UpgradeTreasury, "purchase_1")
	if err != ErrUpgradePurchaseOwnership {
		t.Fatalf("expected ownership error, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("player_2 career or ledger was queried or mutated: %v", err)
	}
}

func TestTreasuryPurchaseClaimsIDBeforeCareerAndLedgerWrites(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	careerRow := sqlmock.NewRows([]string{
		"id", "coins", "gems", "trophies",
		"starting_garrison_level", "production_level", "army_speed_level", "treasury_level", "selected_commander",
		"matches_played", "matches_won", "current_streak", "best_streak", "last_match_timestamp",
	}).AddRow("player_1", 100, 10, 0, 0, 0, 0, 0, "crown_guard", 0, 0, 0, 0, 0)

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT player_id, upgrade_type, result")).
		WithArgs("purchase_1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM players WHERE id = $1 FOR UPDATE")).
		WithArgs("player_1").
		WillReturnRows(careerRow)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT player_id, upgrade_type, result")).
		WithArgs("purchase_1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("INSERT INTO upgrade_purchases")).
		WithArgs("purchase_1", "player_1", UpgradeTreasury, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"purchase_id"}).AddRow("purchase_1"))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE players SET")).
		WithArgs("player_1", 50, 10, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO economy_ledger")).
		WithArgs("purchase_1", "player_1", "coins", -50, "upgrade_treasury", "upgrade_purchase", 100, 50, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	result, err := NewStore(db).PurchaseUpgrade(context.Background(), "player_1", UpgradeTreasury, "purchase_1")
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.NewCareer.TreasuryLevel != 1 || result.NewCareer.Coins != 50 {
		t.Fatalf("unexpected Treasury purchase: %+v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTreasuryMigrationAddsBoundedPersistedLevel(t *testing.T) {
	var treasuryMigration *migration
	for index := range migrations {
		if migrations[index].name == "005_add_treasury_upgrade" {
			treasuryMigration = &migrations[index]
			break
		}
	}
	if treasuryMigration == nil {
		t.Fatal("Treasury migration is missing")
	}
	for _, clause := range []string{
		"ADD COLUMN IF NOT EXISTS treasury_level INTEGER NOT NULL DEFAULT 0",
		"treasury_level BETWEEN 0 AND 20",
	} {
		if !strings.Contains(treasuryMigration.sql, clause) {
			t.Fatalf("migration does not contain %q", clause)
		}
	}
}
