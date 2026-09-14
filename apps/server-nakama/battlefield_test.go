package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestBattlefieldLayoutsStaySymmetricAndDistinct(t *testing.T) {
	expectedCounts := map[string]int{
		"crown_cross": 9,
		"twin_passes": 8,
		"royal_ring":  10,
	}

	for id, expectedCount := range expectedCounts {
		territories := CreateTerritoriesForBattlefield(DefaultModifiers(), DefaultModifiers(), id)
		if len(territories) != expectedCount {
			t.Fatalf("%s: expected %d territories, got %d", id, expectedCount, len(territories))
		}

		pBase := territories["p_base"]
		eBase := territories["e_base"]
		if pBase.X != 200 || eBase.X != 200 || pBase.Y+eBase.Y != 720 {
			t.Fatalf("%s: bases are not symmetric: pBase=%+v, eBase=%+v", id, pBase, eBase)
		}

		// 180-degree rotational symmetry
		for tID, terr := range territories {
			rotX := 400 - terr.X
			rotY := 720 - terr.Y
			found := false
			for _, other := range territories {
				if math.Abs(other.X-rotX) < 1e-4 && math.Abs(other.Y-rotY) < 1e-4 {
					found = true
					if terr.Owner == TeamPlayer && other.Owner != TeamEnemy {
						t.Fatalf("%s: territory %s owner mismatch with counterpart %s", id, tID, other.ID)
					}
					if terr.Owner == TeamNeutral && other.Owner != TeamNeutral {
						t.Fatalf("%s: neutral territory %s counterpart is not neutral", id, tID)
					}
					if terr.Tier != other.Tier || terr.Type != other.Type || terr.Units != other.Units || terr.MaxUnits != other.MaxUnits {
						t.Fatalf("%s: territory %s attributes mismatch with counterpart %s", id, tID, other.ID)
					}
					break
				}
			}
			if !found {
				t.Fatalf("%s: territory %s at (%f, %f) has no symmetric counterpart at (%f, %f)", id, tID, terr.X, terr.Y, rotX, rotY)
			}
		}

		// Roads validation
		roads, ok := battlefieldRoads[id]
		if !ok || len(roads) == 0 {
			t.Fatalf("%s: missing road definitions", id)
		}
		seenRoads := make(map[string]bool)
		for _, road := range roads {
			a, b := road[0], road[1]
			if _, exists := territories[a]; !exists {
				t.Fatalf("%s: road endpoint %s not in territories", id, a)
			}
			if _, exists := territories[b]; !exists {
				t.Fatalf("%s: road endpoint %s not in territories", id, b)
			}
			if a == b {
				t.Fatalf("%s: self-road [%s, %s]", id, a, b)
			}
			key := a + "<->" + b
			if a > b {
				key = b + "<->" + a
			}
			if seenRoads[key] {
				t.Fatalf("%s: duplicate road %s", id, key)
			}
			seenRoads[key] = true
		}
	}
}

func TestBattlefieldAuthoritativeFieldParity(t *testing.T) {
	for id, def := range authoritativeBattlefields {
		territories := CreateTerritoriesForBattlefield(DefaultModifiers(), DefaultModifiers(), id)
		if len(territories) != len(def.Territories) {
			t.Fatalf("%s: territory count mismatch: got %d, expected %d", id, len(territories), len(def.Territories))
		}
		for _, template := range def.Territories {
			terr, exists := territories[template.ID]
			if !exists {
				t.Fatalf("%s: missing territory ID %q", id, template.ID)
			}
			if terr.ID != template.ID {
				t.Fatalf("%s: territory ID mismatch: got %q, expected %q", id, terr.ID, template.ID)
			}
			if terr.Name != template.Name {
				t.Fatalf("%s/%s: name mismatch: got %q, expected %q", id, terr.ID, terr.Name, template.Name)
			}
			if terr.X != template.X || terr.Y != template.Y {
				t.Fatalf("%s/%s: coordinates mismatch: got (%f, %f), expected (%f, %f)", id, terr.ID, terr.X, terr.Y, template.X, template.Y)
			}
			if terr.Radius != template.Radius {
				t.Fatalf("%s/%s: radius mismatch: got %f, expected %f", id, terr.ID, terr.Radius, template.Radius)
			}
			if terr.Owner != template.Owner {
				t.Fatalf("%s/%s: ownership mismatch: got %q, expected %q", id, terr.ID, terr.Owner, template.Owner)
			}
			expectedUnits := template.Units
			if template.ID == "p_base" || template.Owner == TeamPlayer {
				expectedUnits = 20
			} else if template.ID == "e_base" || template.Owner == TeamEnemy {
				expectedUnits = 20
			}
			if terr.Units != expectedUnits {
				t.Fatalf("%s/%s: units mismatch: got %d, expected %d", id, terr.ID, terr.Units, expectedUnits)
			}
			if terr.MaxUnits != template.MaxUnits {
				t.Fatalf("%s/%s: maxUnits mismatch: got %d, expected %d", id, terr.ID, terr.MaxUnits, template.MaxUnits)
			}
			expectedProd := template.ProductionRate
			if terr.ProductionRate != expectedProd {
				t.Fatalf("%s/%s: production mismatch: got %f, expected %f", id, terr.ID, terr.ProductionRate, expectedProd)
			}
			if terr.Tier != template.Tier {
				t.Fatalf("%s/%s: tier mismatch: got %d, expected %d", id, terr.ID, terr.Tier, template.Tier)
			}
			if terr.Type != template.Type {
				t.Fatalf("%s/%s: type mismatch: got %q, expected %q", id, terr.ID, terr.Type, template.Type)
			}
		}

		roads := battlefieldRoads[id]
		if len(roads) != len(def.Roads) {
			t.Fatalf("%s: road count mismatch: got %d, expected %d", id, len(roads), len(def.Roads))
		}
		for i, r := range def.Roads {
			actual := roads[i]
			if actual[0] != r[0] || actual[1] != r[1] {
				t.Fatalf("%s: road %d mismatch: got %v, expected %v", id, i, actual, r)
			}
		}
	}
}

func TestBotBattlefieldReplayIsDeterministic(t *testing.T) {
	actionsByBattlefield := map[string][]PvpAction{
		"crown_cross": {
			{Sequence: 0, AtSeconds: 0, SourceID: "p_base", TargetID: "n_center"},
			{Sequence: 1, AtSeconds: 4, SourceID: "p_base", TargetID: "n_bot_left"},
		},
		"twin_passes": {
			{Sequence: 0, AtSeconds: 0, SourceID: "p_base", TargetID: "n_west_gate_s"},
			{Sequence: 1, AtSeconds: 4, SourceID: "p_base", TargetID: "n_east_gate_s"},
		},
		"royal_ring": {
			{Sequence: 0, AtSeconds: 0, SourceID: "p_base", TargetID: "n_ring_sw"},
			{Sequence: 1, AtSeconds: 4, SourceID: "p_base", TargetID: "n_ring_se"},
		},
	}

	for _, id := range []string{"crown_cross", "twin_passes", "royal_ring"} {
		actions := actionsByBattlefield[id]
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
