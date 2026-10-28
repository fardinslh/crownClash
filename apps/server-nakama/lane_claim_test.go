package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func stubLaneReplay(t *testing.T, status string) {
	t.Helper()
	previous := laneReplayFn
	laneReplayFn = func(laneLevelDef, []LaneAction) (LaneBattleSummary, error) {
		return LaneBattleSummary{Status: status}, nil
	}
	t.Cleanup(func() { laneReplayFn = previous })
}

const findLaneClaimSQL = "SELECT player_id, level_id, result FROM lane_reward_claims WHERE claim_id"

func TestLaneRewardsRiseByDifficulty(t *testing.T) {
	if !(laneRewardByDifficulty["easy"] < laneRewardByDifficulty["normal"] && laneRewardByDifficulty["normal"] < laneRewardByDifficulty["hard"]) {
		t.Fatalf("rewards must rise with difficulty: %v", laneRewardByDifficulty)
	}
	total := 0
	for _, def := range laneLevelDefs {
		total += laneRewardByDifficulty[def.Difficulty]
	}
	if total != 240 {
		t.Fatalf("one-time lane rewards total %d, want 240", total)
	}
}

func TestCompleteLaneVerifiedPaysFirstClearAndWritesLedger(t *testing.T) {
	stubLaneReplay(t, "victory")
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	store := NewStore(db)
	store.nowFn = func() time.Time { return now }

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(findLaneClaimSQL)).WithArgs("claim_1").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM players WHERE id = $1 FOR UPDATE")).WithArgs("player_1").WillReturnRows(dailyCareerRows("player_1", 100))
	mock.ExpectQuery(regexp.QuoteMeta(findLaneClaimSQL)).WithArgs("claim_1").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT claim_id FROM lane_reward_claims WHERE player_id")).WithArgs("player_1", 6).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO lane_reward_claims")).WithArgs("claim_1", "player_1", 6, sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE players SET")).WithArgs("player_1", 125, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO economy_ledger")).
		WithArgs("lane_claim_1", "player_1", "coins", 25, "lane_6_first_clear", "lane_reward", 100, 125, now.UnixMilli()).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	result, err := store.CompleteLaneVerified(context.Background(), "player_1", 6, "claim_1", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.Reward != 25 || result.NewCareer.Coins != 125 || result.LedgerEntry == nil {
		t.Fatalf("unexpected result: %+v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCompleteLaneVerifiedSecondClearReplayAndForeignClaims(t *testing.T) {
	stubLaneReplay(t, "victory")
	t.Run("second clear pays nothing", func(t *testing.T) {
		db, mock, _ := sqlmock.New()
		defer db.Close()
		mock.ExpectBegin()
		mock.ExpectQuery(regexp.QuoteMeta(findLaneClaimSQL)).WithArgs("claim_2").WillReturnError(sql.ErrNoRows)
		mock.ExpectQuery(regexp.QuoteMeta("FROM players WHERE id = $1 FOR UPDATE")).WithArgs("player_1").WillReturnRows(dailyCareerRows("player_1", 100))
		mock.ExpectQuery(regexp.QuoteMeta(findLaneClaimSQL)).WithArgs("claim_2").WillReturnError(sql.ErrNoRows)
		mock.ExpectQuery(regexp.QuoteMeta("SELECT claim_id FROM lane_reward_claims WHERE player_id")).WithArgs("player_1", 1).WillReturnRows(sqlmock.NewRows([]string{"claim_id"}).AddRow("claim_1"))
		mock.ExpectCommit()
		result, err := NewStore(db).CompleteLaneVerified(context.Background(), "player_1", 1, "claim_2", nil)
		if err != nil || !result.Success || result.Reason != "already_claimed" || result.Reward != 0 || result.LedgerEntry != nil {
			t.Fatalf("a paid level must succeed with no reward: %+v, %v", result, err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("same claim id replays the stored result", func(t *testing.T) {
		db, mock, _ := sqlmock.New()
		defer db.Close()
		encoded, _ := json.Marshal(LaneClaimResult{ClaimID: "claim_1", Success: true, LevelID: 3, Reward: 15, NewCareer: PlayerCareer{PlayerID: "player_1", Coins: 115}})
		mock.ExpectBegin()
		mock.ExpectQuery(regexp.QuoteMeta(findLaneClaimSQL)).WithArgs("claim_1").WillReturnRows(sqlmock.NewRows([]string{"player_id", "level_id", "result"}).AddRow("player_1", 3, encoded))
		mock.ExpectRollback()
		result, err := NewStore(db).CompleteLaneVerified(context.Background(), "player_1", 3, "claim_1", nil)
		if err != nil || !result.Replayed || result.Reward != 15 {
			t.Fatalf("expected stored replay: %+v, %v", result, err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	for name, row := range map[string]struct {
		player  string
		level   int
		wantErr error
	}{"other player": {"player_2", 1, ErrLevelClaimOwnership}, "other level": {"player_1", 2, ErrLevelClaimMismatch}} {
		t.Run(name, func(t *testing.T) {
			db, mock, _ := sqlmock.New()
			defer db.Close()
			mock.ExpectBegin()
			mock.ExpectQuery(regexp.QuoteMeta(findLaneClaimSQL)).WithArgs("claim_1").WillReturnRows(sqlmock.NewRows([]string{"player_id", "level_id", "result"}).AddRow(row.player, row.level, []byte(`{}`)))
			mock.ExpectRollback()
			if _, err := NewStore(db).CompleteLaneVerified(context.Background(), "player_1", 1, "claim_1", nil); !errors.Is(err, row.wantErr) {
				t.Fatalf("err = %v, want %v", err, row.wantErr)
			}
		})
	}
}

func TestCompleteLaneVerifiedLosingRunAndInvalidLevelTouchNoDatabase(t *testing.T) {
	stubLaneReplay(t, "defeat")
	db, mock, _ := sqlmock.New()
	defer db.Close()
	result, err := NewStore(db).CompleteLaneVerified(context.Background(), "player_1", 1, "claim_1", nil)
	if err != nil || result.Success || result.Reason != "not_victory" || result.Reward != 0 {
		t.Fatalf("a non-victory must not pay: %+v, %v", result, err)
	}
	for _, level := range []int{0, -1, 10} {
		if _, err := NewStore(db).CompleteLaneVerified(context.Background(), "player_1", level, "c", nil); !errors.Is(err, ErrLaneInvalidLevel) {
			t.Errorf("level %d: err = %v, want ErrLaneInvalidLevel", level, err)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The real replay (not the stub) accepts a TS-recorded winning run and pays, and refuses an empty run.
func TestCompleteLaneVerifiedUsesTheRealReplay(t *testing.T) {
	raw, err := os.ReadFile("testdata/lane_wins.json")
	if err != nil {
		t.Fatal(err)
	}
	var wins map[string]struct {
		Actions []LaneAction `json:"actions"`
	}
	if err := json.Unmarshal(raw, &wins); err != nil {
		t.Fatal(err)
	}
	db, mock, _ := sqlmock.New()
	defer db.Close()
	empty, err := NewStore(db).CompleteLaneVerified(context.Background(), "player_1", 4, "claim_empty", nil)
	if err != nil || empty.Success {
		t.Fatalf("an empty run must not win: %+v, %v", empty, err)
	}
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(findLaneClaimSQL)).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM players WHERE id = $1 FOR UPDATE")).WillReturnRows(dailyCareerRows("player_1", 100))
	mock.ExpectQuery(regexp.QuoteMeta(findLaneClaimSQL)).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT claim_id FROM lane_reward_claims WHERE player_id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO lane_reward_claims")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE players SET")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO economy_ledger")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	paid, err := NewStore(db).CompleteLaneVerified(context.Background(), "player_1", 4, "claim_win", wins["4"].Actions)
	if err != nil || !paid.Success || paid.Reward != 25 {
		t.Fatalf("a recorded winning run must pay 25: %+v, %v", paid, err)
	}
}

func TestLaneMigrationAndAnalytics(t *testing.T) {
	found := false
	for index := range migrations {
		if migrations[index].name != "026_lane_reward_claims" {
			continue
		}
		found = true
		for _, fragment := range []string{"CREATE TABLE IF NOT EXISTS lane_reward_claims", "claim_id TEXT PRIMARY KEY", "REFERENCES players(id)", "UNIQUE (player_id, level_id)", "level_id <= 9"} {
			if !strings.Contains(migrations[index].sql, fragment) {
				t.Errorf("migration 026 is missing %q", fragment)
			}
		}
	}
	if !found {
		t.Fatal("migration 026_lane_reward_claims is not registered")
	}
	if err := validateAnalyticsEvent(analyticsTestEvent("lane_reward_claimed", map[string]any{"claimId": "c1"}), analyticsTestNow); err != nil {
		t.Fatalf("claimId only should be valid: %v", err)
	}
	if err := validateAnalyticsEvent(analyticsTestEvent("lane_reward_claimed", map[string]any{"claimId": "c1", "reward": 999}), analyticsTestNow); err == nil {
		t.Fatal("client-supplied reward must be rejected")
	}
}
