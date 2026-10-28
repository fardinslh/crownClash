package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/heroiclabs/nakama-common/runtime"
)

// Lane battle first-clear coin rewards (candidate rules v5). Like campaign levels, the server
// replays the recorded orders (ReplayLaneBattle) and pays once per (player, lane level), idempotent
// by claim id, through the ledger. There is no unlock order: a win on a harder battle is a win.
var laneRewardByDifficulty = map[string]int{"easy": 15, "normal": 25, "hard": 40}

var ErrLaneInvalidLevel = errors.New("invalid_lane_level")

// laneReplayFn is a seam so claim-flow tests can stub the simulation.
var laneReplayFn = func(def laneLevelDef, actions []LaneAction) (LaneBattleSummary, error) {
	_, summary, err := ReplayLaneBattle(def, actions)
	return summary, err
}

// LaneClaimResult is the stored, replayable outcome of a lane claim.
type LaneClaimResult struct {
	ClaimID     string              `json:"claimId"`
	Success     bool                `json:"success"`
	Reason      string              `json:"reason,omitempty"`
	LevelID     int                 `json:"levelId"`
	Reward      int                 `json:"reward"`
	Replayed    bool                `json:"replayed"`
	NewCareer   PlayerCareer        `json:"newCareer"`
	LedgerEntry *EconomyLedgerEntry `json:"ledgerEntry,omitempty"`
}

func findStoredLaneClaim(ctx context.Context, tx *sql.Tx, userID string, levelID int, claimID string) (*LaneClaimResult, error) {
	var storedUserID string
	var storedLevelID int
	var encoded []byte
	err := tx.QueryRowContext(ctx, `
		SELECT player_id, level_id, result FROM lane_reward_claims WHERE claim_id = $1
	`, claimID).Scan(&storedUserID, &storedLevelID, &encoded)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if storedUserID != userID {
		return nil, ErrLevelClaimOwnership
	}
	if storedLevelID != levelID {
		return nil, ErrLevelClaimMismatch
	}
	var result LaneClaimResult
	if err := json.Unmarshal(encoded, &result); err != nil {
		return nil, errors.New("invalid_stored_lane_claim")
	}
	result.Replayed = true
	return &result, nil
}

// CompleteLaneVerified replays the player's orders against the fixed lane battle and, on a win,
// pays its first-clear coin reward exactly once per (player, level).
func (s *Store) CompleteLaneVerified(ctx context.Context, userID string, levelID int, claimID string, actions []LaneAction) (LaneClaimResult, error) {
	def, ok := laneLevelDefByID(levelID)
	if !ok {
		return LaneClaimResult{}, ErrLaneInvalidLevel
	}
	summary, err := laneReplayFn(def, actions)
	if err != nil {
		return LaneClaimResult{}, err
	}
	if summary.Status != "victory" {
		return LaneClaimResult{ClaimID: claimID, Reason: "not_victory", LevelID: levelID}, nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return LaneClaimResult{}, err
	}
	defer tx.Rollback()

	if existing, err := findStoredLaneClaim(ctx, tx, userID, levelID, claimID); err != nil {
		return LaneClaimResult{}, err
	} else if existing != nil {
		return *existing, nil
	}
	career, err := getCareerForUpdate(ctx, tx, userID)
	if err != nil {
		return LaneClaimResult{}, err
	}
	if existing, err := findStoredLaneClaim(ctx, tx, userID, levelID, claimID); err != nil {
		return LaneClaimResult{}, err
	} else if existing != nil {
		return *existing, nil
	}

	var alreadyPaid string
	err = tx.QueryRowContext(ctx, `SELECT claim_id FROM lane_reward_claims WHERE player_id = $1 AND level_id = $2`, userID, levelID).Scan(&alreadyPaid)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return LaneClaimResult{}, err
	}
	if err == nil {
		return LaneClaimResult{ClaimID: claimID, Success: true, Reason: "already_claimed", LevelID: levelID, NewCareer: career}, tx.Commit()
	}

	reward := laneRewardByDifficulty[def.Difficulty]
	previousCoins := career.Coins
	career.Coins += reward
	entry := EconomyLedgerEntry{
		ID: "lane_" + claimID, Player: userID, Currency: "coins", Amount: reward,
		Reason: "lane_" + itoa(int64(levelID)) + "_first_clear", Source: "lane_reward",
		PreviousBalance: previousCoins, ResultingBalance: career.Coins, Timestamp: s.nowFn().UnixMilli(),
	}
	result := LaneClaimResult{ClaimID: claimID, Success: true, LevelID: levelID, Reward: reward, NewCareer: career, LedgerEntry: &entry}
	encoded, _ := json.Marshal(result)
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO lane_reward_claims (claim_id, player_id, level_id, result)
		VALUES ($1, $2, $3, $4)
	`, claimID, userID, levelID, encoded); err != nil {
		return LaneClaimResult{}, err
	}
	if err := persistCareer(ctx, tx, career); err != nil {
		return LaneClaimResult{}, err
	}
	if err := insertLedgerEntries(ctx, tx, []EconomyLedgerEntry{entry}); err != nil {
		return LaneClaimResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return LaneClaimResult{}, err
	}
	return result, nil
}

func rpcLaneComplete(store *Store) rpcFn {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
		userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
		if !ok || userID == "" {
			return "", errors.New("unauthenticated")
		}
		var request struct {
			LevelID int          `json:"levelId"`
			ClaimID string       `json:"claimId"`
			Actions []LaneAction `json:"actions"`
		}
		decoder := json.NewDecoder(strings.NewReader(payload))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			return "", errors.New("invalid_payload")
		}
		if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
			return "", errors.New("invalid_payload")
		}
		if len(request.ClaimID) < 1 || len(request.ClaimID) > 128 {
			return "", errors.New("invalid_claim_id")
		}
		if len(request.Actions) > MaxPvpActions {
			return "", errors.New("invalid_actions")
		}
		result, err := store.CompleteLaneVerified(ctx, userID, request.LevelID, request.ClaimID, request.Actions)
		if err != nil {
			return "", err
		}
		response, _ := json.Marshal(map[string]any{"result": result})
		return string(response), nil
	}
}
