package main

// Unit tests for the atomic multi-participant settlement
// (docs/2v2-architecture.md §9.3): all four participants plus the replay row
// commit in one transaction; every failure stage rolls everything back;
// retries are idempotent; partial stored sets fail closed.

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func test2v2SettleRequest() Settle2v2Request {
	request := Settle2v2Request{
		MatchID:       "live2v2_deadbeef_1725000000000",
		BattlefieldID: live2v2BattlefieldID,
		ReplayPayload: json.RawMessage(`{"schemaVersion":2,"mode":"2v2","actions":[]}`),
	}
	userIDs := [live2v2MaxPlayers]string{"winner_a", "winner_b", "loser_c", "loser_d"}
	for slot := range request.Participants {
		userID := userIDs[slot]
		status := "defeat"
		if TeamIDForSlot(slot) == TeamIDA {
			status = "victory"
		}
		request.Participants[slot] = TwoVTwoParticipantOutcome{
			Slot: slot, UserID: userID, TeamID: TeamIDForSlot(slot),
			Status: status, Stats: MatchStats{MatchDurationSeconds: 42},
		}
	}
	return request
}

// mock2v2HappyPath sets ordered expectations for one full settlement:
// fast-path probe, career locks, re-check, then per participant
// (career persist, ledger insert, settlement insert, daily progress), then
// the replay insert, then commit.
func mock2v2HappyPath(mock sqlmock.Sqlmock, request Settle2v2Request) {
	// 0. transaction begin
	mock.ExpectBegin()
	// 1. fast-path probe -> no stored settlements
	mock.ExpectQuery("SELECT slot, user_id, settlement FROM match_settlements_multi").WithArgs(request.MatchID).WillReturnRows(sqlmock.NewRows([]string{"slot", "user_id", "settlement"}))
	// 2. career locks in one statement
	careerRows := sqlmock.NewRows([]string{
		"id", "coins", "gems", "trophies",
		"starting_garrison_level", "production_level", "army_speed_level", "treasury_level", "selected_commander",
		"matches_played", "matches_won", "current_streak", "best_streak", "last_match_timestamp",
	})
	for _, participant := range request.Participants {
		careerRows.AddRow(participant.UserID, 100, 10, 50, 0, 0, 0, 0, "crown_guard", 0, 0, 0, 0, 0)
	}
	mock.ExpectQuery("FROM players").WithArgs("loser_c", "loser_d", "winner_a", "winner_b").WillReturnRows(careerRows)
	// 3. re-check inside the lock
	mock.ExpectQuery("SELECT slot, user_id, settlement FROM match_settlements_multi").WithArgs(request.MatchID).WillReturnRows(sqlmock.NewRows([]string{"slot", "user_id", "settlement"}))
	for range request.Participants {
		mock.ExpectExec("UPDATE players SET").WillReturnResult(sqlmock.NewResult(1, 1))
		mock.ExpectExec("INSERT INTO economy_ledger").WillReturnResult(sqlmock.NewResult(1, 1))
		mock.ExpectExec("INSERT INTO match_settlements_multi").WillReturnResult(sqlmock.NewResult(1, 1))
		mock.ExpectExec("INSERT INTO player_daily_progress").WillReturnResult(sqlmock.NewResult(1, 1))
	}
	// 7. replay row
	mock.ExpectExec("INSERT INTO match_replays").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
}

func TestStoreSettleMatch2v2SettlesAllFourAndReplayAtomically(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db)
	request := test2v2SettleRequest()
	mock2v2HappyPath(mock, request)

	settlements, err := store.SettleMatch2v2(context.Background(), request)
	if err != nil {
		t.Fatalf("atomic settlement failed: %v", err)
	}
	if len(settlements) != live2v2MaxPlayers {
		t.Fatalf("settlement count = %d, want 4", len(settlements))
	}
	// Casual policy: zero trophies everywhere; coins still paid.
	for index, settlement := range settlements {
		if settlement.Breakdown.TrophyDelta != 0 {
			t.Fatalf("settlement %d trophy delta = %d, want 0", index, settlement.Breakdown.TrophyDelta)
		}
		if settlement.Breakdown.TotalCoins <= 0 {
			t.Fatalf("settlement %d paid no coins", index)
		}
		// Per-participant ledger ids (the 1v1 format would collide).
		for _, entry := range settlement.LedgerEntries {
			wantID := request.MatchID + "_" + settlement.NewCareer.PlayerID + "_" + entry.Currency + "_" + itoa(entry.Timestamp)
			if entry.ID != wantID {
				t.Fatalf("ledger id = %q, want per-participant %q", entry.ID, wantID)
			}
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("SQL expectations unmet: %v", err)
	}
}

// TestStoreSettleMatch2v2BindsCareerToLocalSlot proves each participant's
// settlement is computed from THEIR OWN career (matched by user id), never
// from the sorted user-list position: the ledger balances must reflect each
// user's own previous balance.
func TestStoreSettleMatch2v2BindsCareerToLocalSlot(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db)
	request := test2v2SettleRequest()
	balances := map[string]int{"winner_a": 100, "winner_b": 220, "loser_c": 340, "loser_d": 460}

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT slot, user_id, settlement FROM match_settlements_multi").WithArgs(request.MatchID).WillReturnRows(sqlmock.NewRows([]string{"slot", "user_id", "settlement"}))
	careerRows := sqlmock.NewRows([]string{
		"id", "coins", "gems", "trophies",
		"starting_garrison_level", "production_level", "army_speed_level", "treasury_level", "selected_commander",
		"matches_played", "matches_won", "current_streak", "best_streak", "last_match_timestamp",
	})
	for _, userID := range []string{"loser_c", "loser_d", "winner_a", "winner_b"} {
		careerRows.AddRow(userID, balances[userID], 10, 50, 0, 0, 0, 0, "crown_guard", 0, 0, 0, 0, 0)
	}
	mock.ExpectQuery("FROM players").WithArgs("loser_c", "loser_d", "winner_a", "winner_b").WillReturnRows(careerRows)
	mock.ExpectQuery("SELECT slot, user_id, settlement FROM match_settlements_multi").WithArgs(request.MatchID).WillReturnRows(sqlmock.NewRows([]string{"slot", "user_id", "settlement"}))
	for range request.Participants {
		mock.ExpectExec("UPDATE players SET").WillReturnResult(sqlmock.NewResult(1, 1))
		mock.ExpectExec("INSERT INTO economy_ledger").WillReturnResult(sqlmock.NewResult(1, 1))
		mock.ExpectExec("INSERT INTO match_settlements_multi").WillReturnResult(sqlmock.NewResult(1, 1))
		mock.ExpectExec("INSERT INTO player_daily_progress").WillReturnResult(sqlmock.NewResult(1, 1))
	}
	mock.ExpectExec("INSERT INTO match_replays").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	settlements, err := store.SettleMatch2v2(context.Background(), request)
	if err != nil {
		t.Fatalf("atomic settlement failed: %v", err)
	}
	for index, participant := range request.Participants {
		settlement := settlements[index]
		if settlement.NewCareer.PlayerID != participant.UserID {
			t.Fatalf("settlement %d career belongs to %q, want %q (career must bind to the participant's own user id)", index, settlement.NewCareer.PlayerID, participant.UserID)
		}
		entry := settlement.LedgerEntries[0]
		if entry.PreviousBalance != balances[participant.UserID] {
			t.Fatalf("settlement %d (%s) previous balance = %d, want %d (own career, not another slot's)", index, participant.UserID, entry.PreviousBalance, balances[participant.UserID])
		}
		if entry.ResultingBalance != balances[participant.UserID]+entry.Amount {
			t.Fatalf("settlement %d (%s) resulting balance = %d, want %d", index, participant.UserID, entry.ResultingBalance, balances[participant.UserID]+entry.Amount)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("SQL expectations unmet: %v", err)
	}
}

func TestStoreSettleMatch2v2NoTrophyLedgerEntryForCasual(t *testing.T) {	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db)
	request := test2v2SettleRequest()
	mock2v2HappyPath(mock, request)

	settlements, err := store.SettleMatch2v2(context.Background(), request)
	if err != nil {
		t.Fatalf("atomic settlement failed: %v", err)
	}
	for index, settlement := range settlements {
		if len(settlement.LedgerEntries) != 1 || settlement.LedgerEntries[0].Currency != "coins" {
			t.Fatalf("settlement %d ledger = %+v, want exactly one coins entry (no trophy entry)", index, settlement.LedgerEntries)
		}
	}
}

func TestStoreSettleMatch2v2IdempotentRetryReturnsStoredResults(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db)
	request := test2v2SettleRequest()

	storedRows := sqlmock.NewRows([]string{"slot", "user_id", "settlement"})
	for slot, participant := range request.Participants {
		settlement := SettleMatchWithPolicy(CreateDefaultCareer(participant.UserID), participant.Status, participant.Stats, request.MatchID, 1725000100000, CasualPolicy)
		payload, _ := json.Marshal(settlement)
		storedRows.AddRow(slot, participant.UserID, payload)
	}
	// Retry path: ONLY the fast-path probe runs, then the stored rows return.
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT slot, user_id, settlement FROM match_settlements_multi").WithArgs(request.MatchID).WillReturnRows(storedRows)

	settlements, err := store.SettleMatch2v2(context.Background(), request)
	if err != nil {
		t.Fatalf("idempotent retry failed: %v", err)
	}
	if len(settlements) != live2v2MaxPlayers {
		t.Fatalf("stored settlement count = %d, want 4", len(settlements))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("retry must not mutate anything: %v", err)
	}
}

func TestStoreSettleMatch2v2PartialStoredSetFailsClosed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db)
	request := test2v2SettleRequest()

	partial := sqlmock.NewRows([]string{"slot", "user_id", "settlement"})
	settlement := SettleMatchWithPolicy(CreateDefaultCareer("winner_a"), "victory", MatchStats{}, request.MatchID, 1725000100000, CasualPolicy)
	payload, _ := json.Marshal(settlement)
	partial.AddRow(0, "winner_a", payload)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT slot, user_id, settlement FROM match_settlements_multi").WithArgs(request.MatchID).WillReturnRows(partial)

	if _, err := store.SettleMatch2v2(context.Background(), request); !errors.Is(err, ErrPartial2v2Settlement) {
		t.Fatalf("partial stored set error = %v, want ErrPartial2v2Settlement", err)
	}
}

func TestStoreSettleMatch2v2RollsBackAtEveryStage(t *testing.T) {
	request := test2v2SettleRequest()

	// Each stage: how many complete participant blocks precede the failure
	// (-1 = fail inside the career lock, 4 = fail at the replay insert).
	type failureStage struct {
		name             string
		completeBlocks   int
		failingStatement string
	}
	stages := []failureStage{
		{name: "career_lock", completeBlocks: -1, failingStatement: "FROM players"},
		{name: "career_persist", completeBlocks: 0, failingStatement: "UPDATE players SET"},
		{name: "economy_ledger", completeBlocks: 0, failingStatement: "INSERT INTO economy_ledger"},
		{name: "settlement_row", completeBlocks: 0, failingStatement: "INSERT INTO match_settlements_multi"},
		{name: "daily_progress", completeBlocks: 0, failingStatement: "INSERT INTO player_daily_progress"},
		{name: "replay_row", completeBlocks: 4, failingStatement: "INSERT INTO match_replays"},
	}

	for _, stage := range stages {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		store := NewStore(db)

		mock.ExpectBegin()
		mock.ExpectQuery("SELECT slot, user_id, settlement FROM match_settlements_multi").WillReturnRows(sqlmock.NewRows([]string{"slot", "user_id", "settlement"}))
		if stage.completeBlocks < 0 {
			// Failure while acquiring the career locks.
			mock.ExpectQuery("FROM players").WillReturnError(errors.New("lock_failed"))
		} else {
			careerRows := sqlmock.NewRows([]string{
				"id", "coins", "gems", "trophies",
				"starting_garrison_level", "production_level", "army_speed_level", "treasury_level", "selected_commander",
				"matches_played", "matches_won", "current_streak", "best_streak", "last_match_timestamp",
			})
			for _, participant := range request.Participants {
				careerRows.AddRow(participant.UserID, 100, 10, 50, 0, 0, 0, 0, "crown_guard", 0, 0, 0, 0, 0)
			}
			mock.ExpectQuery("FROM players").WillReturnRows(careerRows)
			mock.ExpectQuery("SELECT slot, user_id, settlement FROM match_settlements_multi").WillReturnRows(sqlmock.NewRows([]string{"slot", "user_id", "settlement"}))

			// Completed participant blocks (each of the four statements).
			expectParticipantBlock := func() {
				mock.ExpectExec("UPDATE players SET").WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec("INSERT INTO economy_ledger").WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec("INSERT INTO match_settlements_multi").WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec("INSERT INTO player_daily_progress").WillReturnResult(sqlmock.NewResult(1, 1))
			}
			for block := 0; block < stage.completeBlocks; block++ {
				expectParticipantBlock()
			}
			// The failing statement within the current block (or the replay).
			switch stage.failingStatement {
			case "UPDATE players SET":
				mock.ExpectExec("UPDATE players SET").WillReturnError(errors.New("stage_failed"))
			case "INSERT INTO economy_ledger":
				mock.ExpectExec("UPDATE players SET").WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec("INSERT INTO economy_ledger").WillReturnError(errors.New("stage_failed"))
			case "INSERT INTO match_settlements_multi":
				mock.ExpectExec("UPDATE players SET").WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec("INSERT INTO economy_ledger").WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec("INSERT INTO match_settlements_multi").WillReturnError(errors.New("stage_failed"))
			case "INSERT INTO player_daily_progress":
				mock.ExpectExec("UPDATE players SET").WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec("INSERT INTO economy_ledger").WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec("INSERT INTO match_settlements_multi").WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec("INSERT INTO player_daily_progress").WillReturnError(errors.New("stage_failed"))
			case "INSERT INTO match_replays":
				for block := stage.completeBlocks; block < live2v2MaxPlayers; block++ {
					expectParticipantBlock()
				}
				mock.ExpectExec("INSERT INTO match_replays").WillReturnError(errors.New("stage_failed"))
			}
		}
		mock.ExpectRollback()

		if _, err := store.SettleMatch2v2(context.Background(), request); err == nil {
			t.Fatalf("stage %q: settlement unexpectedly succeeded", stage.name)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("stage %q: transaction did not roll back cleanly: %v", stage.name, err)
		}
		db.Close()
	}
}

func TestStoreSettleMatch2v2ValidatesParticipantSet(t *testing.T) {
	base := test2v2SettleRequest()
	base.Participants[1].UserID = base.Participants[0].UserID // duplicate user
	if err := validateSettle2v2Request(base); err == nil {
		t.Fatal("duplicate participant user accepted")
	}

	base = test2v2SettleRequest()
	base.Participants[2].TeamID = TeamIDA // team/slot mismatch
	if err := validateSettle2v2Request(base); err == nil {
		t.Fatal("team/slot mismatch accepted")
	}

	base = test2v2SettleRequest()
	base.Participants[3].Status = "cancelled" // invalid status
	if err := validateSettle2v2Request(base); err == nil {
		t.Fatal("invalid status accepted")
	}

	base = test2v2SettleRequest()
	base.ReplayPayload = nil // missing replay
	if err := validateSettle2v2Request(base); err == nil {
		t.Fatal("missing replay payload accepted")
	}

	if err := validateSettle2v2Request(test2v2SettleRequest()); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}
}
