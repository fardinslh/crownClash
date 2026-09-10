package main

import (
	"context"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestCommanderModifiersMatchClientRules(t *testing.T) {
	quartermaster := UpgradeModifiers(PlayerCareer{ProductionLevel: 5, ArmySpeedLevel: 5, SelectedCommanderID: "quartermaster"})
	if quartermaster.StartingUnits != 20 || quartermaster.ProductionRateMultiplier != 1.61 || quartermaster.ArmySpeedMultiplier != 1.17 {
		t.Fatalf("unexpected Quartermaster modifiers: %+v", quartermaster)
	}
	vanguard := UpgradeModifiers(PlayerCareer{SelectedCommanderID: "vanguard"})
	if vanguard.StartingUnits != 17 || vanguard.ProductionRateMultiplier != 1 || vanguard.ArmySpeedMultiplier != 1.15 {
		t.Fatalf("unexpected Vanguard modifiers: %+v", vanguard)
	}
}

func TestSelectCommanderRejectsLockedWithoutMutation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rows := sqlmock.NewRows([]string{
		"id", "coins", "gems", "trophies", "starting_garrison_level", "production_level", "army_speed_level", "treasury_level", "selected_commander",
		"matches_played", "matches_won", "current_streak", "best_streak", "last_match_timestamp",
	}).AddRow("p1", 100, 10, 0, 2, 2, 2, 2, "crown_guard", 0, 0, 0, 0, 0)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("FROM players WHERE id = $1 FOR UPDATE")).WithArgs("p1").WillReturnRows(rows)
	mock.ExpectRollback()
	_, err = NewStore(db).SelectCommander(context.Background(), "p1", "quartermaster")
	if err != ErrCommanderLocked {
		t.Fatalf("expected locked error, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSelectCommanderPersistsUnlockedChoice(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rows := sqlmock.NewRows([]string{
		"id", "coins", "gems", "trophies", "starting_garrison_level", "production_level", "army_speed_level", "treasury_level", "selected_commander",
		"matches_played", "matches_won", "current_streak", "best_streak", "last_match_timestamp",
	}).AddRow("p1", 100, 10, 0, 3, 3, 2, 2, "crown_guard", 0, 0, 0, 0, 0)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("FROM players WHERE id = $1 FOR UPDATE")).WithArgs("p1").WillReturnRows(rows)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE players SET selected_commander = $2")).WithArgs("p1", "quartermaster").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	result, err := NewStore(db).SelectCommander(context.Background(), "p1", "quartermaster")
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.NewCareer.SelectedCommanderID != "quartermaster" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCommanderMigrationAddsValidatedSelection(t *testing.T) {
	for _, item := range migrations {
		if item.name == "009_commanders" {
			if !strings.Contains(item.sql, "selected_commander TEXT NOT NULL DEFAULT 'crown_guard'") || !strings.Contains(item.sql, "'quartermaster', 'vanguard'") {
				t.Fatal("commander migration lacks default or validation")
			}
			return
		}
	}
	t.Fatal("commander migration missing")
}
