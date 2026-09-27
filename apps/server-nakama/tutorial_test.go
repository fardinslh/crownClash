package main

// Unit tests for the account-wide tutorial completion flag and the
// fail-closed entry gates around it (first-play onboarding):
//   - players.tutorial_completed is the single source of truth;
//   - match/start (ordinary bot entry) rejects tutorial_required;
//   - the matchmaker hook rejects BOTH 1v1 and 2v2 tickets while the
//     tutorial is incomplete, before any pool entry;
//   - tutorial/complete is authenticated, payload-strict, idempotent;
//   - completion grants no coins, trophies, or matches.

import (
	"context"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
)

func tutorialCareerMocks(mock sqlmock.Sqlmock, userID string, completed bool, trophies int) {
	mock.ExpectExec("INSERT INTO players").
		WithArgs(userID, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	rows := sqlmock.NewRows([]string{
		"id", "coins", "gems", "trophies",
		"starting_garrison_level", "production_level", "army_speed_level", "treasury_level", "selected_commander",
		"matches_played", "matches_won", "current_streak", "best_streak", "last_match_timestamp", "tutorial_completed",
	}).AddRow(userID, 100, 10, trophies, 0, 0, 0, 0, "crown_guard", 0, 0, 0, 0, 0, completed)
	mock.ExpectQuery("SELECT id, coins, gems, trophies").
		WithArgs(userID).
		WillReturnRows(rows)
}

func TestStoreCompleteTutorialIsIdempotentAndGrantsNoEconomy(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db)

	// GetOrCreateCareer: insert-on-conflict then read.
	mock.ExpectExec("INSERT INTO players").
		WithArgs("grad_1", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("SELECT id, coins, gems, trophies").
		WithArgs("grad_1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "coins", "gems", "trophies",
			"starting_garrison_level", "production_level", "army_speed_level", "treasury_level", "selected_commander",
			"matches_played", "matches_won", "current_streak", "best_streak", "last_match_timestamp", "tutorial_completed",
		}).AddRow("grad_1", 100, 10, 0, 0, 0, 0, 0, "crown_guard", 0, 0, 0, 0, 0, false))
	// Idempotent flag write, then the fresh career read.
	mock.ExpectExec("UPDATE players SET tutorial_completed = TRUE").
		WithArgs("grad_1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT id, coins, gems, trophies").
		WithArgs("grad_1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "coins", "gems", "trophies",
			"starting_garrison_level", "production_level", "army_speed_level", "treasury_level", "selected_commander",
			"matches_played", "matches_won", "current_streak", "best_streak", "last_match_timestamp", "tutorial_completed",
		}).AddRow("grad_1", 100, 10, 0, 0, 0, 0, 0, "crown_guard", 0, 0, 0, 0, 0, true))

	career, err := store.CompleteTutorial(context.Background(), "grad_1")
	if err != nil {
		t.Fatalf("CompleteTutorial failed: %v", err)
	}
	if !career.TutorialCompleted {
		t.Fatal("completion flag not set")
	}
	// Completion grants no economy, progression, or match counters.
	if career.Coins != 100 || career.Gems != 10 || career.Trophies != 0 {
		t.Fatalf("completion mutated economy: %+v", career)
	}
	if career.MatchesPlayed != 0 || career.MatchesWon != 0 {
		t.Fatalf("completion mutated match counters: %+v", career)
	}
}

func TestRpcTutorialCompleteRequiresAuthentication(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	ctx := context.Background() // no RUNTIME_CTX_USER_ID
	if _, err := rpcTutorialComplete(NewStore(db))(ctx, &stubLogger{}, db, nil, ""); err == nil {
		t.Fatal("unauthenticated tutorial/complete accepted")
	} else if err.Error() != "unauthenticated" {
		t.Fatalf("unexpected error %q", err.Error())
	}
}

func TestRpcTutorialCompleteRejectsNonEmptyPayloads(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	ctx := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "user_t")
	for name, payload := range map[string]string{
		"json body":  `{"completed":true}`,
		"garbage":    "x",
		"whitespace": " ",
	} {
		_, err := rpcTutorialComplete(NewStore(db))(ctx, &stubLogger{}, db, nil, payload)
		if err == nil || err.Error() != "invalid_payload" {
			t.Fatalf("%s: expected invalid_payload, got %v", name, err)
		}
	}

	// "{}" is tolerated as an empty payload (same contract as other
	// payload-free RPCs); on the empty mock DB it fails at the store read,
	// not at payload validation.
	_, err = rpcTutorialComplete(NewStore(db))(ctx, &stubLogger{}, db, nil, "{}")
	if err == nil || err.Error() == "invalid_payload" {
		t.Fatalf("empty object wrongly rejected at payload validation: %v", err)
	}
}

func TestRpcStartBotMatchRejectsIncompleteTutorial(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db)
	tutorialCareerMocks(mock, "rookie_1", false, 0)

	ctx := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "rookie_1")
	_, err = rpcStartBotMatch(store)(ctx, &stubLogger{}, db, nil, "")
	if err == nil || err.Error() != "tutorial_required" {
		t.Fatalf("incomplete tutorial started a bot match: %v", err)
	}
	// No bot ticket may be inserted while gated.
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled expectations (unexpected bot match insert?): %v", err)
	}
}

func TestRpcStartBotMatchAllowsCompletedTutorial(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db)
	tutorialCareerMocks(mock, "grad_2", true, 12)

	mock.ExpectExec("INSERT INTO players").
		WithArgs("grad_2", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	rows := sqlmock.NewRows([]string{
		"id", "coins", "gems", "trophies",
		"starting_garrison_level", "production_level", "army_speed_level", "treasury_level", "selected_commander",
		"matches_played", "matches_won", "current_streak", "best_streak", "last_match_timestamp", "tutorial_completed",
	}).AddRow("grad_2", 100, 10, 12, 0, 0, 0, 0, "crown_guard", 0, 0, 0, 0, 0, true)
	mock.ExpectQuery("SELECT id, coins, gems, trophies").
		WithArgs("grad_2").
		WillReturnRows(rows)
	mock.ExpectExec("INSERT INTO bot_matches").
		WithArgs(sqlmock.AnyArg(), "grad_2", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	ctx := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "grad_2")
	response, err := rpcStartBotMatch(store)(ctx, &stubLogger{}, db, nil, "")
	if err != nil {
		t.Fatalf("completed tutorial still gated bot match: %v", err)
	}
	if !strings.Contains(response, "ticket") {
		t.Fatalf("response missing ticket: %s", response)
	}
}

func TestBeforeMatchmakerAddRejectsTicketsWhileTutorialIncomplete(t *testing.T) {
	serverConfig.Enable2v2 = true
	serverConfig.TwoVTwoRollout = map[string]int{"browser": 100}
	defer func() { serverConfig.Enable2v2 = false; serverConfig.TwoVTwoRollout = nil }()

	for name, add := range map[string]*rtapi.MatchmakerAdd{
		"1v1 ticket": {MinCount: 2, MaxCount: 2},
		"2v2 ticket": {MinCount: 4, MaxCount: 4},
	} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		store := NewStore(db)
		tutorialCareerMocks(mock, "rookie_2", false, 0)
		ctx := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "rookie_2")
		ctx = context.WithValue(ctx, runtime.RUNTIME_CTX_VARS, map[string]string{"platform": "browser"})

		_, err = beforeMatchmakerAdd(store)(ctx, &stubLogger{}, db, nil, testEnvelopeWithTicket(add))
		if err == nil || err.Error() != "matchmaker_tutorial_required" {
			t.Fatalf("%s: expected matchmaker_tutorial_required, got %v", name, err)
		}
		db.Close()
	}
}
