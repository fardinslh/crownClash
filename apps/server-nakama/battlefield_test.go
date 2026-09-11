package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestBattlefieldLayoutsStaySymmetricAndDistinct(t *testing.T) {
	ids := []string{"crown_cross", "twin_passes", "royal_ring"}
	bottomLeftX := make([]float64, 0, len(ids))
	centerUnits := make([]int, 0, len(ids))
	for _, id := range ids {
		territories := CreateTerritoriesForBattlefield(DefaultModifiers(), DefaultModifiers(), id)
		if len(territories) != 9 {
			t.Fatalf("%s: expected 9 territories, got %d", id, len(territories))
		}
		if territories["p_base"].Y+territories["e_base"].Y != 720 ||
			territories["n_bot_left"].X+territories["n_bot_right"].X != 400 ||
			territories["n_top_left"].X+territories["n_top_right"].X != 400 {
			t.Fatalf("%s: layout is not mirrored: %+v", id, territories)
		}
		bottomLeftX = append(bottomLeftX, territories["n_bot_left"].X)
		centerUnits = append(centerUnits, territories["n_center"].Units)
	}
	if bottomLeftX[0] != 85 || bottomLeftX[1] != 105 || bottomLeftX[2] != 140 ||
		centerUnits[0] != 14 || centerUnits[1] != 20 || centerUnits[2] != 10 {
		t.Fatalf("battlefields are not distinct: x=%v center=%v", bottomLeftX, centerUnits)
	}
}

func TestBotBattlefieldReplayIsDeterministic(t *testing.T) {
	actions := []PvpAction{
		{Sequence: 0, AtSeconds: 0, SourceID: "p_base", TargetID: "n_center"},
		{Sequence: 1, AtSeconds: 4, SourceID: "p_base", TargetID: "n_bot_left"},
	}
	for _, id := range []string{"crown_cross", "twin_passes", "royal_ring"} {
		firstState, firstSummary, err := SimulateBotBattleOnBattlefield(actions, DefaultModifiers(), id)
		if err != nil {
			t.Fatal(err)
		}
		secondState, secondSummary, err := SimulateBotBattleOnBattlefield(actions, DefaultModifiers(), id)
		if err != nil {
			t.Fatal(err)
		}
		if firstState.BattlefieldID != id || !reflect.DeepEqual(firstState, secondState) || !reflect.DeepEqual(firstSummary, secondSummary) {
			t.Fatalf("%s replay diverged: %+v / %+v", id, firstSummary, secondSummary)
		}
	}
}

func TestSettleMatchRejectsForeignBotTicketBeforeCareerMutation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT settlement FROM match_settlements WHERE match_id = $1")).
		WithArgs("bot_foreign").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT player_id, battlefield_id")).
		WithArgs("bot_foreign").
		WillReturnRows(sqlmock.NewRows([]string{"player_id", "battlefield_id"}).AddRow("player_1", "royal_ring"))
	mock.ExpectRollback()

	_, err = NewStore(db).SettleMatchVerified(context.Background(), "player_2", "bot_foreign", nil)
	if !errors.Is(err, ErrBotMatchOwnership) {
		t.Fatalf("expected ownership error, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("foreign ticket touched career state: %v", err)
	}
}

func TestSettleMatchRejectsMissingBotTicketBeforeCareerMutation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT settlement FROM match_settlements WHERE match_id = $1")).
		WithArgs("forged_match").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT player_id, battlefield_id")).
		WithArgs("forged_match").WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	_, err = NewStore(db).SettleMatchVerified(context.Background(), "player_1", "forged_match", nil)
	if !errors.Is(err, ErrBotMatchNotFound) {
		t.Fatalf("expected missing ticket error, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("missing ticket touched career state: %v", err)
	}
}

func TestSettleMatchReplayRejectsAnotherPlayersSettlement(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	stored, err := json.Marshal(MatchSettlement{
		MatchID:   "bot_settled",
		NewCareer: PlayerCareer{PlayerID: "player_1"},
	})
	if err != nil {
		t.Fatal(err)
	}

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT settlement FROM match_settlements WHERE match_id = $1")).
		WithArgs("bot_settled").
		WillReturnRows(sqlmock.NewRows([]string{"settlement"}).AddRow(stored))
	mock.ExpectRollback()

	_, err = NewStore(db).SettleMatchVerified(context.Background(), "player_2", "bot_settled", nil)
	if !errors.Is(err, ErrBotMatchOwnership) {
		t.Fatalf("expected ownership error, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSettleMatchReplayReturnsStoredResultWithoutCareerMutation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	stored, err := json.Marshal(MatchSettlement{
		MatchID:   "bot_settled",
		Status:    "victory",
		NewCareer: PlayerCareer{PlayerID: "player_1", Coins: 250},
	})
	if err != nil {
		t.Fatal(err)
	}

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT settlement FROM match_settlements WHERE match_id = $1")).
		WithArgs("bot_settled").
		WillReturnRows(sqlmock.NewRows([]string{"settlement"}).AddRow(stored))
	mock.ExpectRollback()

	settlement, err := NewStore(db).SettleMatchVerified(context.Background(), "player_1", "bot_settled", nil)
	if err != nil {
		t.Fatalf("unexpected replay error: %v", err)
	}
	if settlement.NewCareer.Coins != 250 || settlement.Status != "victory" {
		t.Fatalf("unexpected replayed settlement: %+v", settlement)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("replay touched career state: %v", err)
	}
}

func TestCreateBotMatchPersistsOpaqueServerSelectedTicket(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO players (id, coins, gems, trophies)")).
		WithArgs("player_1", 100, 10, 0).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM players WHERE id = $1")).
		WithArgs("player_1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "coins", "gems", "trophies", "starting_garrison_level", "production_level",
			"army_speed_level", "treasury_level", "selected_commander", "matches_played", "matches_won",
			"current_streak", "best_streak", "last_match_timestamp",
		}).AddRow("player_1", 100, 10, 0, 0, 0, 0, 0, "crown_guard", 0, 0, 0, 0, 0))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO bot_matches (match_id, player_id, battlefield_id)")).
		WithArgs(sqlmock.AnyArg(), "player_1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	ticket, err := NewStore(db).CreateBotMatch(context.Background(), "player_1")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(ticket.MatchID, "bot_") || len(ticket.MatchID) != len("bot_")+32 {
		t.Fatalf("match ID is not opaque: %q", ticket.MatchID)
	}
	if !IsBattlefieldID(ticket.BattlefieldID) {
		t.Fatalf("invalid selected battlefield: %q", ticket.BattlefieldID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestBattlefieldMigrationStoresServerSelection(t *testing.T) {
	for _, item := range migrations {
		if item.name != "010_battlefields" {
			continue
		}
		for _, clause := range []string{
			"CREATE TABLE IF NOT EXISTS bot_matches",
			"match_id TEXT PRIMARY KEY",
			"player_id TEXT NOT NULL REFERENCES players(id)",
			"'crown_cross', 'twin_passes', 'royal_ring'",
		} {
			if !strings.Contains(item.sql, clause) {
				t.Fatalf("battlefield migration missing %q", clause)
			}
		}
		return
	}
	t.Fatal("battlefield migration missing")
}
