package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

// Weekly Challenge: three fixed bot battles per week (Bronze, Silver, Gold)
// played like campaign levels. The week starts Saturday 00:00 UTC, the first
// day of the Iranian week. The slot sets the enemy and the reward; the week
// only rotates which battlefield each slot uses, so every (slot, battlefield)
// pair is one of nine fixed battles. weekly_wins.json holds a recorded winning
// run for each, replayed by TestRecordedClientWinsVerifyOnEverySlotAndMap.

const (
	weeklySeconds          = int64(7 * 24 * 60 * 60)
	weeklyEpochOffset      = int64(2 * 24 * 60 * 60) // 1970-01-03 was a Saturday
	weeklySlotCount        = 3
	weeklyClaimIDMaxLength = 128
)

var (
	ErrWeeklyInvalid   = errors.New("invalid_weekly_challenge")
	weeklyBattlefields = []string{"crown_cross", "twin_passes", "royal_ring"}
)

// weeklySlot is the part of a challenge that does not change week to week.
type weeklySlot struct {
	Slot       int
	Difficulty string
	Enemy      PlayerUpgradeModifiers
	CoinReward int
}

var weeklySlots = []weeklySlot{
	{1, "normal", levelEnemy(20, 1), 50},
	{2, "hard", levelEnemy(20, 0.95), 80},
	{3, "hard", levelEnemy(22, 1.05), 120},
}

// weeklyWeekIndex counts whole weeks since the first Saturday of 1970.
func weeklyWeekIndex(now time.Time) int64 {
	seconds := now.Unix() - weeklyEpochOffset
	if seconds < 0 {
		return 0
	}
	return seconds / weeklySeconds
}

func weeklyEndsAt(week int64) time.Time {
	return time.Unix((week+1)*weeklySeconds+weeklyEpochOffset, 0).UTC()
}

// weeklyDef returns the battle for a slot in a week as a levelDef, so the
// level replay and its tests serve it unchanged. ID is the slot number.
func weeklyDef(week int64, slot int) (levelDef, bool) {
	if week < 0 || slot < 1 || slot > weeklySlotCount {
		return levelDef{}, false
	}
	row := weeklySlots[slot-1]
	return levelDef{
		ID: slot, Battlefield: weeklyBattlefields[(week+int64(slot)-1)%int64(len(weeklyBattlefields))],
		Difficulty: row.Difficulty, Enemy: row.Enemy, CoinReward: row.CoinReward,
	}, true
}

// WeeklySlotView is what the client needs to start and show one challenge.
type WeeklySlotView struct {
	Slot        int                    `json:"slot"`
	Battlefield string                 `json:"battlefieldId"`
	Difficulty  string                 `json:"botDifficulty"`
	Enemy       PlayerUpgradeModifiers `json:"enemy"`
	CoinReward  int                    `json:"coinReward"`
	Claimed     bool                   `json:"claimed"`
}

type WeeklyState struct {
	WeekIndex int64            `json:"weekIndex"`
	EndsAt    int64            `json:"endsAt"` // unix milliseconds
	Slots     []WeeklySlotView `json:"slots"`
}

// WeeklyClaimResult is the stored, replayable outcome of a weekly claim.
type WeeklyClaimResult struct {
	ClaimID     string              `json:"claimId"`
	Success     bool                `json:"success"`
	Reason      string              `json:"reason,omitempty"`
	WeekIndex   int64               `json:"weekIndex"`
	Slot        int                 `json:"slot"`
	Reward      int                 `json:"reward"`
	Replayed    bool                `json:"replayed"`
	NewCareer   PlayerCareer        `json:"newCareer"`
	LedgerEntry *EconomyLedgerEntry `json:"ledgerEntry,omitempty"`
}

func (s *Store) WeeklyState(ctx context.Context, userID string) (WeeklyState, error) {
	week := weeklyWeekIndex(s.nowFn())
	rows, err := s.db.QueryContext(ctx, `SELECT slot FROM weekly_challenge_claims WHERE player_id = $1 AND week_index = $2`, userID, week)
	if err != nil {
		return WeeklyState{}, err
	}
	defer rows.Close()
	claimed := map[int]bool{}
	for rows.Next() {
		var slot int
		if err := rows.Scan(&slot); err != nil {
			return WeeklyState{}, err
		}
		claimed[slot] = true
	}
	if err := rows.Err(); err != nil {
		return WeeklyState{}, err
	}
	state := WeeklyState{WeekIndex: week, EndsAt: weeklyEndsAt(week).UnixMilli()}
	for slot := 1; slot <= weeklySlotCount; slot++ {
		def, _ := weeklyDef(week, slot)
		state.Slots = append(state.Slots, WeeklySlotView{
			Slot: slot, Battlefield: def.Battlefield, Difficulty: def.Difficulty, Enemy: def.Enemy,
			CoinReward: def.CoinReward, Claimed: claimed[slot],
		})
	}
	return state, nil
}

func findStoredWeeklyClaim(ctx context.Context, tx *sql.Tx, userID string, week int64, slot int, claimID string) (*WeeklyClaimResult, error) {
	var storedUserID string
	var storedWeek int64
	var storedSlot int
	var encoded []byte
	err := tx.QueryRowContext(ctx, `
		SELECT player_id, week_index, slot, result FROM weekly_challenge_claims WHERE claim_id = $1
	`, claimID).Scan(&storedUserID, &storedWeek, &storedSlot, &encoded)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if storedUserID != userID {
		return nil, ErrLevelClaimOwnership
	}
	if storedWeek != week || storedSlot != slot {
		return nil, ErrLevelClaimMismatch
	}
	var result WeeklyClaimResult
	if err := json.Unmarshal(encoded, &result); err != nil {
		return nil, errors.New("invalid_stored_weekly_claim")
	}
	result.Replayed = true
	return &result, nil
}

// CompleteWeeklyVerified replays the player's actions against the fixed battle
// of this week's slot and, on a win, pays the slot's coin reward once per
// (player, week, slot). claimID makes retries idempotent. A submission for a
// week that is no longer current is refused: its battlefield may differ.
func (s *Store) CompleteWeeklyVerified(ctx context.Context, userID string, week int64, slot int, claimID string, actions []PvpAction) (WeeklyClaimResult, error) {
	def, ok := weeklyDef(week, slot)
	if !ok {
		return WeeklyClaimResult{}, ErrWeeklyInvalid
	}
	if week != weeklyWeekIndex(s.nowFn()) {
		return WeeklyClaimResult{ClaimID: claimID, Reason: "week_over", WeekIndex: week, Slot: slot}, nil
	}
	summary, err := levelReplayFn(def, actions)
	if err != nil {
		return WeeklyClaimResult{}, err
	}
	if summary.Status != "victory" {
		return WeeklyClaimResult{ClaimID: claimID, Reason: "not_victory", WeekIndex: week, Slot: slot}, nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return WeeklyClaimResult{}, err
	}
	defer tx.Rollback()

	if existing, err := findStoredWeeklyClaim(ctx, tx, userID, week, slot, claimID); err != nil {
		return WeeklyClaimResult{}, err
	} else if existing != nil {
		return *existing, nil
	}
	career, err := getCareerForUpdate(ctx, tx, userID)
	if err != nil {
		return WeeklyClaimResult{}, err
	}
	if existing, err := findStoredWeeklyClaim(ctx, tx, userID, week, slot, claimID); err != nil {
		return WeeklyClaimResult{}, err
	} else if existing != nil {
		return *existing, nil
	}

	var alreadyPaid string
	err = tx.QueryRowContext(ctx, `
		SELECT claim_id FROM weekly_challenge_claims WHERE player_id = $1 AND week_index = $2 AND slot = $3
	`, userID, week, slot).Scan(&alreadyPaid)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return WeeklyClaimResult{}, err
	}
	if err == nil {
		return WeeklyClaimResult{ClaimID: claimID, Success: true, Reason: "already_claimed", WeekIndex: week, Slot: slot, NewCareer: career}, tx.Commit()
	}

	previousCoins := career.Coins
	career.Coins += def.CoinReward
	entry := EconomyLedgerEntry{
		ID: "weekly_" + claimID, Player: userID, Currency: "coins", Amount: def.CoinReward,
		Reason: "weekly_w" + itoa(week) + "_slot_" + itoa(int64(slot)), Source: "weekly_challenge",
		PreviousBalance: previousCoins, ResultingBalance: career.Coins, Timestamp: s.nowFn().UnixMilli(),
	}
	result := WeeklyClaimResult{
		ClaimID: claimID, Success: true, WeekIndex: week, Slot: slot, Reward: def.CoinReward,
		NewCareer: career, LedgerEntry: &entry,
	}
	encoded, _ := json.Marshal(result)
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO weekly_challenge_claims (claim_id, player_id, week_index, slot, result)
		VALUES ($1, $2, $3, $4, $5)
	`, claimID, userID, week, slot, encoded); err != nil {
		return WeeklyClaimResult{}, err
	}
	if err := persistCareer(ctx, tx, career); err != nil {
		return WeeklyClaimResult{}, err
	}
	if err := insertLedgerEntries(ctx, tx, []EconomyLedgerEntry{entry}); err != nil {
		return WeeklyClaimResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return WeeklyClaimResult{}, err
	}
	return result, nil
}

func rpcWeeklyGet(store *Store) rpcFn {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
		userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
		if !ok || userID == "" {
			return "", errors.New("unauthenticated")
		}
		state, err := store.WeeklyState(ctx, userID)
		if err != nil {
			return "", err
		}
		response, _ := json.Marshal(map[string]any{"state": state})
		return string(response), nil
	}
}

func rpcWeeklyComplete(store *Store) rpcFn {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
		userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
		if !ok || userID == "" {
			return "", errors.New("unauthenticated")
		}
		var request struct {
			WeekIndex int64       `json:"weekIndex"`
			Slot      int         `json:"slot"`
			ClaimID   string      `json:"claimId"`
			Actions   []PvpAction `json:"actions"`
		}
		decoder := json.NewDecoder(strings.NewReader(payload))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			return "", errors.New("invalid_payload")
		}
		if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
			return "", errors.New("invalid_payload")
		}
		if len(request.ClaimID) < 1 || len(request.ClaimID) > weeklyClaimIDMaxLength {
			return "", errors.New("invalid_claim_id")
		}
		if len(request.Actions) > MaxPvpActions {
			return "", errors.New("invalid_actions")
		}
		for index := range request.Actions {
			if request.Actions[index].Sequence != index {
				return "", errors.New("invalid_action_sequence")
			}
		}
		result, err := store.CompleteWeeklyVerified(ctx, userID, request.WeekIndex, request.Slot, request.ClaimID, request.Actions)
		if err != nil {
			return "", err
		}
		response, _ := json.Marshal(map[string]any{"result": result})
		return string(response), nil
	}
}
