package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func stubLevelReplay(t *testing.T, status string) {
	t.Helper()
	previous := levelReplayFn
	levelReplayFn = func(levelDef, []PvpAction) (PvpBattleSummary, error) {
		return PvpBattleSummary{Status: status}, nil
	}
	t.Cleanup(func() { levelReplayFn = previous })
}

const findLevelClaimSQL = "SELECT player_id, level_id, result FROM level_reward_claims WHERE claim_id"

func TestLevelRewardsAreTiedToDifficultyAndTotal400(t *testing.T) {
	want := map[string]int{"easy": 25, "normal": 40, "hard": 60}
	total := 0
	for _, def := range levelDefs {
		if def.CoinReward != want[def.Difficulty] {
			t.Errorf("level %d (%s) reward = %d, want %d", def.ID, def.Difficulty, def.CoinReward, want[def.Difficulty])
		}
		total += def.CoinReward
	}
	if len(levelDefs) != levelCount || total != 400 {
		t.Fatalf("levels=%d total=%d, want %d levels and 400 coins", len(levelDefs), total, levelCount)
	}
}

// The Go table is authoritative for replay and rewards; the client mirrors it.
// Any drift would make honest clients fail verification, so parse levels.ts.
func TestLevelDefsMatchClient(t *testing.T) {
	source, err := os.ReadFile("../../packages/game-core/src/levels.ts")
	if err != nil {
		t.Fatal(err)
	}
	row := regexp.MustCompile(`\{ id: (\d+), battlefieldId: '(\w+)', botDifficulty: '(\w+)', enemy: enemy\(([\d.]+), ([\d.]+)\), coinReward: (\d+) \}`)
	matches := row.FindAllStringSubmatch(string(source), -1)
	if len(matches) != len(levelDefs) {
		t.Fatalf("levels.ts has %d parsable rows, Go has %d", len(matches), len(levelDefs))
	}
	for index, m := range matches {
		id, _ := strconv.Atoi(m[1])
		units, _ := strconv.Atoi(m[4])
		production, _ := strconv.ParseFloat(m[5], 64)
		reward, _ := strconv.Atoi(m[6])
		def := levelDefs[index]
		if def.ID != id || def.Battlefield != m[2] || def.Difficulty != m[3] ||
			def.Enemy != levelEnemy(units, production) || def.CoinReward != reward {
			t.Errorf("level row %d differs: client %v vs Go %+v", index+1, m[1:], def)
		}
	}
	if !strings.Contains(string(source), "LEVEL_RULES_VERSION: GameplayRulesVersion = "+strconv.Itoa(levelRulesVersion)) {
		t.Errorf("client LEVEL_RULES_VERSION differs from Go levelRulesVersion %d", levelRulesVersion)
	}
}

func TestPassiveReplayNeverWinsAnyLevel(t *testing.T) {
	for _, def := range levelDefs {
		summary, err := ReplayLevel(def, nil)
		if err != nil {
			t.Fatalf("level %d: %v", def.ID, err)
		}
		if summary.Status == "victory" {
			t.Errorf("level %d: an empty action list must not win", def.ID)
		}
	}
}

func TestCompleteLevelVerifiedPaysFirstClearAndWritesLedger(t *testing.T) {
	stubLevelReplay(t, "victory")
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	store := NewStore(db)
	store.nowFn = func() time.Time { return now }

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(findLevelClaimSQL)).WithArgs("claim_1").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM players WHERE id = $1 FOR UPDATE")).
		WithArgs("player_1").WillReturnRows(dailyCareerRows("player_1", 100))
	mock.ExpectQuery(regexp.QuoteMeta(findLevelClaimSQL)).WithArgs("claim_1").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT levels_completed FROM players WHERE id = $1")).
		WithArgs("player_1").WillReturnRows(sqlmock.NewRows([]string{"levels_completed"}).AddRow(0))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE players SET levels_completed")).
		WithArgs("player_1", 1).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT claim_id FROM level_reward_claims WHERE player_id")).
		WithArgs("player_1", 1).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO level_reward_claims")).
		WithArgs("claim_1", "player_1", 1, sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE players SET")).
		WithArgs("player_1", 125, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO economy_ledger")).
		WithArgs("level_claim_1", "player_1", "coins", 25, "level_1_first_clear", "level_reward", 100, 125, now.UnixMilli()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	result, err := store.CompleteLevelVerified(context.Background(), "player_1", 1, "claim_1", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.Reward != 25 || result.NewCareer.Coins != 125 || result.LevelsCompleted != 1 || result.LedgerEntry == nil {
		t.Fatalf("unexpected result: %+v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCompleteLevelVerifiedReplayReturnsStoredResultWithoutMutation(t *testing.T) {
	stubLevelReplay(t, "victory")
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	stored := LevelClaimResult{ClaimID: "claim_1", Success: true, LevelID: 3, Reward: 25, LevelsCompleted: 3, NewCareer: PlayerCareer{PlayerID: "player_1", Coins: 150}}
	encoded, _ := json.Marshal(stored)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(findLevelClaimSQL)).WithArgs("claim_1").
		WillReturnRows(sqlmock.NewRows([]string{"player_id", "level_id", "result"}).AddRow("player_1", 3, encoded))
	mock.ExpectRollback()

	result, err := NewStore(db).CompleteLevelVerified(context.Background(), "player_1", 3, "claim_1", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Replayed || result.Reward != 25 || result.NewCareer.Coins != 150 {
		t.Fatalf("expected stored replay, got %+v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCompleteLevelVerifiedRejectsAnotherPlayersOrAnotherLevelsClaimID(t *testing.T) {
	stubLevelReplay(t, "victory")
	cases := []struct {
		name     string
		stored   func() *sqlmock.Rows
		wantErr  error
		levelArg int
	}{
		{"other player", func() *sqlmock.Rows {
			return sqlmock.NewRows([]string{"player_id", "level_id", "result"}).AddRow("player_2", 1, []byte(`{}`))
		}, ErrLevelClaimOwnership, 1},
		{"other level", func() *sqlmock.Rows {
			return sqlmock.NewRows([]string{"player_id", "level_id", "result"}).AddRow("player_1", 2, []byte(`{}`))
		}, ErrLevelClaimMismatch, 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			mock.ExpectQuery(regexp.QuoteMeta(findLevelClaimSQL)).WithArgs("claim_1").WillReturnRows(c.stored())
			mock.ExpectRollback()
			_, err = NewStore(db).CompleteLevelVerified(context.Background(), "player_1", c.levelArg, "claim_1", nil)
			if !errors.Is(err, c.wantErr) {
				t.Fatalf("err = %v, want %v", err, c.wantErr)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCompleteLevelVerifiedLosingReplayTouchesNoDatabase(t *testing.T) {
	stubLevelReplay(t, "defeat")
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	result, err := NewStore(db).CompleteLevelVerified(context.Background(), "player_1", 1, "claim_1", nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Success || result.Reason != "not_victory" || result.Reward != 0 {
		t.Fatalf("a non-victory replay must not succeed or pay: %+v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCompleteLevelVerifiedRejectsInvalidLevelAndBadActions(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db)
	for _, level := range []int{0, -1, levelCount + 1} {
		if _, err := store.CompleteLevelVerified(context.Background(), "player_1", level, "c", nil); !errors.Is(err, ErrLevelInvalid) {
			t.Errorf("level %d: err = %v, want ErrLevelInvalid", level, err)
		}
	}
	tooMany := make([]PvpAction, MaxPvpActions+1)
	for i := range tooMany {
		tooMany[i] = PvpAction{Sequence: i}
	}
	if _, err := store.CompleteLevelVerified(context.Background(), "player_1", 1, "c", tooMany); err == nil {
		t.Error("more than MaxPvpActions actions must be rejected")
	}
}

func TestCompleteLevelVerifiedLockedLevelPaysNothing(t *testing.T) {
	stubLevelReplay(t, "victory")
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(findLevelClaimSQL)).WithArgs("claim_1").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM players WHERE id = $1 FOR UPDATE")).
		WithArgs("player_1").WillReturnRows(dailyCareerRows("player_1", 100))
	mock.ExpectQuery(regexp.QuoteMeta(findLevelClaimSQL)).WithArgs("claim_1").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT levels_completed FROM players WHERE id = $1")).
		WithArgs("player_1").WillReturnRows(sqlmock.NewRows([]string{"levels_completed"}).AddRow(1))
	mock.ExpectRollback()

	result, err := NewStore(db).CompleteLevelVerified(context.Background(), "player_1", 5, "claim_1", nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Success || result.Reason != "level_locked" || result.Reward != 0 {
		t.Fatalf("a locked level must not pay: %+v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCompleteLevelVerifiedSecondClearOfPaidLevelPaysNothing(t *testing.T) {
	stubLevelReplay(t, "victory")
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(findLevelClaimSQL)).WithArgs("claim_2").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM players WHERE id = $1 FOR UPDATE")).
		WithArgs("player_1").WillReturnRows(dailyCareerRows("player_1", 125))
	mock.ExpectQuery(regexp.QuoteMeta(findLevelClaimSQL)).WithArgs("claim_2").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT levels_completed FROM players WHERE id = $1")).
		WithArgs("player_1").WillReturnRows(sqlmock.NewRows([]string{"levels_completed"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT claim_id FROM level_reward_claims WHERE player_id")).
		WithArgs("player_1", 1).WillReturnRows(sqlmock.NewRows([]string{"claim_id"}).AddRow("claim_1"))
	mock.ExpectCommit()

	result, err := NewStore(db).CompleteLevelVerified(context.Background(), "player_1", 1, "claim_2", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.Reward != 0 || result.Reason != "already_claimed" || result.LedgerEntry != nil || result.NewCareer.Coins != 125 {
		t.Fatalf("a repeat clear must succeed without paying: %+v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestLevelRewardMigrationCreatesOncePerLevelGuard(t *testing.T) {
	for index := range migrations {
		if migrations[index].name != "024_level_reward_claims" {
			continue
		}
		for _, fragment := range []string{
			"CREATE TABLE IF NOT EXISTS level_reward_claims",
			"claim_id TEXT PRIMARY KEY",
			"REFERENCES players(id)",
			"UNIQUE (player_id, level_id)",
		} {
			if !strings.Contains(migrations[index].sql, fragment) {
				t.Errorf("migration 024 is missing %q", fragment)
			}
		}
		return
	}
	t.Fatal("migration 024_level_reward_claims is not registered")
}

func TestLevelRewardClaimedAnalyticsAcceptsOnlyClaimID(t *testing.T) {
	if err := validateAnalyticsEvent(analyticsTestEvent("level_reward_claimed", map[string]any{"claimId": "c1"}), analyticsTestNow); err != nil {
		t.Fatalf("claimId only should be valid: %v", err)
	}
	forged := map[string]any{"claimId": "c1", "reward": 999999}
	if err := validateAnalyticsEvent(analyticsTestEvent("level_reward_claimed", forged), analyticsTestNow); err == nil {
		t.Fatal("client-supplied reward must be rejected")
	}
}

// testdata/level_wins.json is recorded from the TS simulation by
// scripts/levels-record-wins.mjs (one winning probe run per level). Replaying
// it through the server verifier proves the Go simulator agrees with the client
// on every level, so honest wins are never refused their reward.
func TestRecordedClientWinsVerifyOnEveryLevel(t *testing.T) {
	raw, err := os.ReadFile("testdata/level_wins.json")
	if err != nil {
		t.Fatal(err)
	}
	var wins map[string]struct {
		Actions []PvpAction `json:"actions"`
	}
	if err := json.Unmarshal(raw, &wins); err != nil {
		t.Fatal(err)
	}
	for _, def := range levelDefs {
		win, ok := wins[strconv.Itoa(def.ID)]
		if !ok {
			t.Errorf("level %d has no recorded winning run", def.ID)
			continue
		}
		summary, err := ReplayLevel(def, win.Actions)
		if err != nil {
			t.Errorf("level %d: %v", def.ID, err)
			continue
		}
		if summary.Status != "victory" {
			t.Errorf("level %d: recorded TS win replays as %q in Go (simulator drift)", def.ID, summary.Status)
		}
	}
}
