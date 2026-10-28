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

// Saturday 2026-10-31 00:00 UTC starts a week (1970-01-03 was a Saturday).
var weeklyTestNow = time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)

const findWeeklyClaimSQL = "SELECT player_id, week_index, slot, result FROM weekly_challenge_claims WHERE claim_id"

func weeklyStore(t *testing.T, db *sql.DB) *Store {
	t.Helper()
	store := NewStore(db)
	store.nowFn = func() time.Time { return weeklyTestNow }
	return store
}

func TestWeeklyRewardsRiseBySlotAndTotal250(t *testing.T) {
	total, previous := 0, 0
	for _, slot := range weeklySlots {
		if slot.CoinReward <= previous {
			t.Errorf("slot %d reward %d must exceed the previous slot's %d", slot.Slot, slot.CoinReward, previous)
		}
		previous = slot.CoinReward
		total += slot.CoinReward
	}
	if len(weeklySlots) != weeklySlotCount || total != 250 {
		t.Fatalf("slots=%d total=%d, want %d slots and 250 coins", len(weeklySlots), total, weeklySlotCount)
	}
}

func TestWeeklyWeekStartsOnSaturdayUTC(t *testing.T) {
	saturday := time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC)
	if saturday.Weekday() != time.Saturday {
		t.Fatal("test date is not a Saturday")
	}
	week := weeklyWeekIndex(saturday)
	if weeklyWeekIndex(saturday.Add(-time.Second)) != week-1 {
		t.Error("the second before Saturday 00:00 UTC must belong to the previous week")
	}
	if weeklyWeekIndex(saturday.Add(6*24*time.Hour+23*time.Hour)) != week {
		t.Error("Friday evening must still be in the same week")
	}
	if got := weeklyEndsAt(week); !got.Equal(saturday.Add(7 * 24 * time.Hour)) {
		t.Errorf("week ends at %v, want next Saturday", got)
	}
	if weeklyWeekIndex(time.Unix(0, 0)) != 0 {
		t.Error("times before the first Saturday clamp to week 0")
	}
}

func TestWeeklyDefRotatesEveryMapThroughEverySlot(t *testing.T) {
	for slot := 1; slot <= weeklySlotCount; slot++ {
		seen := map[string]bool{}
		for week := int64(0); week < int64(len(weeklyBattlefields)); week++ {
			def, ok := weeklyDef(week, slot)
			if !ok {
				t.Fatalf("week %d slot %d missing", week, slot)
			}
			seen[def.Battlefield] = true
		}
		if len(seen) != len(weeklyBattlefields) {
			t.Errorf("slot %d visits %d maps in %d weeks, want all of them", slot, len(seen), len(weeklyBattlefields))
		}
	}
	for week := int64(0); week < 6; week++ {
		maps := map[string]bool{}
		for slot := 1; slot <= weeklySlotCount; slot++ {
			def, _ := weeklyDef(week, slot)
			maps[def.Battlefield] = true
		}
		if len(maps) != len(weeklyBattlefields) {
			t.Errorf("week %d should play every map once across its slots, got %v", week, maps)
		}
	}
	for _, bad := range []struct {
		week int64
		slot int
	}{{-1, 1}, {0, 0}, {0, weeklySlotCount + 1}} {
		if _, ok := weeklyDef(bad.week, bad.slot); ok {
			t.Errorf("weeklyDef(%d, %d) must be rejected", bad.week, bad.slot)
		}
	}
}

// scripts/weekly-record-wins.mjs records the wins from its own SLOTS table.
// Parse it so the Go table cannot drift from what the recorded wins were played on.
func TestWeeklySlotsMatchRecordingScript(t *testing.T) {
	source, err := os.ReadFile("../../scripts/weekly-record-wins.mjs")
	if err != nil {
		t.Fatal(err)
	}
	row := regexp.MustCompile(`\{ slot: (\d+), botDifficulty: '(\w+)', enemy: enemy\(([\d.]+), ([\d.]+)\) \}`)
	matches := row.FindAllStringSubmatch(string(source), -1)
	if len(matches) != len(weeklySlots) {
		t.Fatalf("script has %d parsable slots, Go has %d", len(matches), len(weeklySlots))
	}
	for index, m := range matches {
		slot, _ := strconv.Atoi(m[1])
		units, _ := strconv.Atoi(m[3])
		production, _ := strconv.ParseFloat(m[4], 64)
		want := weeklySlots[index]
		if want.Slot != slot || want.Difficulty != m[2] || want.Enemy != levelEnemy(units, production) {
			t.Errorf("slot %d differs: script %v vs Go %+v", slot, m[1:], want)
		}
	}
}

func TestPassiveReplayNeverWinsAnyWeeklyBattle(t *testing.T) {
	for week := int64(0); week < int64(len(weeklyBattlefields)); week++ {
		for slot := 1; slot <= weeklySlotCount; slot++ {
			def, _ := weeklyDef(week, slot)
			summary, err := ReplayLevel(def, nil)
			if err != nil {
				t.Fatal(err)
			}
			if summary.Status == "victory" {
				t.Errorf("week %d slot %d: an empty action list must not win", week, slot)
			}
		}
	}
}

// testdata/weekly_wins.json holds a TS-recorded winning run for each slot on
// each map (scripts/weekly-record-wins.mjs). Replaying them through the real
// weekly battles proves the Go simulator agrees with the client on all nine.
func TestRecordedClientWinsVerifyOnEverySlotAndMap(t *testing.T) {
	raw, err := os.ReadFile("testdata/weekly_wins.json")
	if err != nil {
		t.Fatal(err)
	}
	var wins map[string]struct {
		Actions []PvpAction `json:"actions"`
	}
	if err := json.Unmarshal(raw, &wins); err != nil {
		t.Fatal(err)
	}
	covered := 0
	for week := int64(0); week < int64(len(weeklyBattlefields)); week++ {
		for slot := 1; slot <= weeklySlotCount; slot++ {
			def, _ := weeklyDef(week, slot)
			win, ok := wins[strconv.Itoa(slot)+":"+def.Battlefield]
			if !ok {
				t.Errorf("slot %d on %s has no recorded winning run", slot, def.Battlefield)
				continue
			}
			covered++
			summary, err := ReplayLevel(def, win.Actions)
			if err != nil {
				t.Errorf("slot %d on %s: %v", slot, def.Battlefield, err)
			} else if summary.Status != "victory" {
				t.Errorf("slot %d on %s: recorded TS win replays as %q in Go (simulator drift)", slot, def.Battlefield, summary.Status)
			}
		}
	}
	if covered != weeklySlotCount*len(weeklyBattlefields) {
		t.Fatalf("covered %d slot/map pairs, want %d", covered, weeklySlotCount*len(weeklyBattlefields))
	}
}

func TestCompleteWeeklyVerifiedPaysOncePerSlotAndWritesLedger(t *testing.T) {
	stubLevelReplay(t, "victory")
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	week := weeklyWeekIndex(weeklyTestNow)

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(findWeeklyClaimSQL)).WithArgs("claim_1").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM players WHERE id = $1 FOR UPDATE")).
		WithArgs("player_1").WillReturnRows(dailyCareerRows("player_1", 100))
	mock.ExpectQuery(regexp.QuoteMeta(findWeeklyClaimSQL)).WithArgs("claim_1").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT claim_id FROM weekly_challenge_claims WHERE player_id")).
		WithArgs("player_1", week, 2).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO weekly_challenge_claims")).
		WithArgs("claim_1", "player_1", week, 2, sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE players SET")).
		WithArgs("player_1", 180, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO economy_ledger")).
		WithArgs("weekly_claim_1", "player_1", "coins", 80, "weekly_w"+strconv.FormatInt(week, 10)+"_slot_2", "weekly_challenge", 100, 180, weeklyTestNow.UnixMilli()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	result, err := weeklyStore(t, db).CompleteWeeklyVerified(context.Background(), "player_1", week, 2, "claim_1", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.Reward != 80 || result.NewCareer.Coins != 180 || result.LedgerEntry == nil || result.Slot != 2 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCompleteWeeklyVerifiedSecondClearOfPaidSlotPaysNothing(t *testing.T) {
	stubLevelReplay(t, "victory")
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	week := weeklyWeekIndex(weeklyTestNow)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(findWeeklyClaimSQL)).WithArgs("claim_2").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM players WHERE id = $1 FOR UPDATE")).
		WithArgs("player_1").WillReturnRows(dailyCareerRows("player_1", 100))
	mock.ExpectQuery(regexp.QuoteMeta(findWeeklyClaimSQL)).WithArgs("claim_2").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT claim_id FROM weekly_challenge_claims WHERE player_id")).
		WithArgs("player_1", week, 1).WillReturnRows(sqlmock.NewRows([]string{"claim_id"}).AddRow("claim_1"))
	mock.ExpectCommit()

	result, err := weeklyStore(t, db).CompleteWeeklyVerified(context.Background(), "player_1", week, 1, "claim_2", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.Reason != "already_claimed" || result.Reward != 0 || result.LedgerEntry != nil {
		t.Fatalf("a paid slot must succeed with no reward: %+v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCompleteWeeklyVerifiedReplayReturnsStoredResultWithoutMutation(t *testing.T) {
	stubLevelReplay(t, "victory")
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	week := weeklyWeekIndex(weeklyTestNow)
	stored := WeeklyClaimResult{ClaimID: "claim_1", Success: true, WeekIndex: week, Slot: 3, Reward: 120, NewCareer: PlayerCareer{PlayerID: "player_1", Coins: 220}}
	encoded, _ := json.Marshal(stored)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(findWeeklyClaimSQL)).WithArgs("claim_1").
		WillReturnRows(sqlmock.NewRows([]string{"player_id", "week_index", "slot", "result"}).AddRow("player_1", week, 3, encoded))
	mock.ExpectRollback()

	result, err := weeklyStore(t, db).CompleteWeeklyVerified(context.Background(), "player_1", week, 3, "claim_1", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Replayed || result.Reward != 120 || result.NewCareer.Coins != 220 {
		t.Fatalf("expected stored replay, got %+v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCompleteWeeklyVerifiedRejectsAnotherPlayersOrAnotherSlotsClaimID(t *testing.T) {
	stubLevelReplay(t, "victory")
	week := weeklyWeekIndex(weeklyTestNow)
	cases := []struct {
		name    string
		stored  func() *sqlmock.Rows
		wantErr error
	}{
		{"other player", func() *sqlmock.Rows {
			return sqlmock.NewRows([]string{"player_id", "week_index", "slot", "result"}).AddRow("player_2", week, 1, []byte(`{}`))
		}, ErrLevelClaimOwnership},
		{"other slot", func() *sqlmock.Rows {
			return sqlmock.NewRows([]string{"player_id", "week_index", "slot", "result"}).AddRow("player_1", week, 2, []byte(`{}`))
		}, ErrLevelClaimMismatch},
		{"other week", func() *sqlmock.Rows {
			return sqlmock.NewRows([]string{"player_id", "week_index", "slot", "result"}).AddRow("player_1", week-1, 1, []byte(`{}`))
		}, ErrLevelClaimMismatch},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			mock.ExpectQuery(regexp.QuoteMeta(findWeeklyClaimSQL)).WithArgs("claim_1").WillReturnRows(c.stored())
			mock.ExpectRollback()
			_, err = weeklyStore(t, db).CompleteWeeklyVerified(context.Background(), "player_1", week, 1, "claim_1", nil)
			if !errors.Is(err, c.wantErr) {
				t.Fatalf("err = %v, want %v", err, c.wantErr)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCompleteWeeklyVerifiedLosingOrStaleSubmissionTouchesNoDatabase(t *testing.T) {
	week := weeklyWeekIndex(weeklyTestNow)
	t.Run("defeat", func(t *testing.T) {
		stubLevelReplay(t, "defeat")
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		result, err := weeklyStore(t, db).CompleteWeeklyVerified(context.Background(), "player_1", week, 1, "claim_1", nil)
		if err != nil || result.Success || result.Reason != "not_victory" || result.Reward != 0 {
			t.Fatalf("a non-victory replay must not succeed or pay: %+v, %v", result, err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("past week", func(t *testing.T) {
		stubLevelReplay(t, "victory")
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		result, err := weeklyStore(t, db).CompleteWeeklyVerified(context.Background(), "player_1", week-1, 1, "claim_1", nil)
		if err != nil || result.Success || result.Reason != "week_over" {
			t.Fatalf("a finished week must not pay: %+v, %v", result, err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("future week", func(t *testing.T) {
		stubLevelReplay(t, "victory")
		db, _, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		result, err := weeklyStore(t, db).CompleteWeeklyVerified(context.Background(), "player_1", week+1, 1, "claim_1", nil)
		if err != nil || result.Success || result.Reason != "week_over" {
			t.Fatalf("a week that has not started must not pay: %+v, %v", result, err)
		}
	})
}

func TestCompleteWeeklyVerifiedRejectsInvalidSlot(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	week := weeklyWeekIndex(weeklyTestNow)
	for _, slot := range []int{0, -1, weeklySlotCount + 1} {
		if _, err := weeklyStore(t, db).CompleteWeeklyVerified(context.Background(), "player_1", week, slot, "c", nil); !errors.Is(err, ErrWeeklyInvalid) {
			t.Errorf("slot %d: err = %v, want ErrWeeklyInvalid", slot, err)
		}
	}
}

func TestWeeklyStateMarksClaimedSlots(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	week := weeklyWeekIndex(weeklyTestNow)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT slot FROM weekly_challenge_claims WHERE player_id = $1 AND week_index = $2")).
		WithArgs("player_1", week).WillReturnRows(sqlmock.NewRows([]string{"slot"}).AddRow(1).AddRow(3))
	state, err := weeklyStore(t, db).WeeklyState(context.Background(), "player_1")
	if err != nil {
		t.Fatal(err)
	}
	if state.WeekIndex != week || state.EndsAt != weeklyEndsAt(week).UnixMilli() || len(state.Slots) != weeklySlotCount {
		t.Fatalf("unexpected state: %+v", state)
	}
	claimed := []bool{state.Slots[0].Claimed, state.Slots[1].Claimed, state.Slots[2].Claimed}
	if !claimed[0] || claimed[1] || !claimed[2] {
		t.Fatalf("claimed flags = %v, want [true false true]", claimed)
	}
	for _, slot := range state.Slots {
		def, _ := weeklyDef(week, slot.Slot)
		if slot.Battlefield != def.Battlefield || slot.CoinReward != def.CoinReward {
			t.Errorf("slot view %+v differs from the authoritative battle %+v", slot, def)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestWeeklyMigrationCreatesOncePerSlotGuard(t *testing.T) {
	for index := range migrations {
		if migrations[index].name != "025_weekly_challenge_claims" {
			continue
		}
		for _, fragment := range []string{
			"CREATE TABLE IF NOT EXISTS weekly_challenge_claims",
			"claim_id TEXT PRIMARY KEY",
			"REFERENCES players(id)",
			"UNIQUE (player_id, week_index, slot)",
		} {
			if !strings.Contains(migrations[index].sql, fragment) {
				t.Errorf("migration 025 is missing %q", fragment)
			}
		}
		return
	}
	t.Fatal("migration 025_weekly_challenge_claims is not registered")
}

func TestWeeklyAnalyticsAcceptOnlyClientFacts(t *testing.T) {
	if err := validateAnalyticsEvent(analyticsTestEvent("weekly_reward_claimed", map[string]any{"claimId": "c1"}), analyticsTestNow); err != nil {
		t.Fatalf("claimId only should be valid: %v", err)
	}
	if err := validateAnalyticsEvent(analyticsTestEvent("weekly_reward_claimed", map[string]any{"claimId": "c1", "reward": 999999}), analyticsTestNow); err == nil {
		t.Fatal("client-supplied reward must be rejected")
	}
	for name, props := range map[string]map[string]any{
		"weekly_challenge_viewed":    {},
		"weekly_challenge_started":   {"slot": float64(1)},
		"weekly_challenge_completed": {"slot": float64(2), "durationSeconds": float64(40)},
		"weekly_challenge_failed":    {"slot": float64(3), "durationSeconds": float64(25)},
	} {
		if err := validateAnalyticsEvent(analyticsTestEvent(name, props), analyticsTestNow); err != nil {
			t.Errorf("%s should be valid: %v", name, err)
		}
	}
}
