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

// levelCount mirrors LEVEL_COUNT in packages/game-core/src/levels.ts.
const levelCount = 10

var ErrLevelInvalid = errors.New("invalid_level")

// levelRulesVersion mirrors LEVEL_RULES_VERSION in game-core.
const levelRulesVersion = TacticalRulesVersion

// levelPlayerModifiers mirrors LEVEL_PLAYER_MODIFIERS: every level starts the
// player from the base garrison, production and speed, ignoring career upgrades.
var levelPlayerModifiers = PlayerUpgradeModifiers{StartingUnits: 20, ProductionRateMultiplier: 1, ArmySpeedMultiplier: 1}

// levelDef mirrors one LEVELS row in packages/game-core/src/levels.ts, plus the
// first-clear coin reward (CoinReward is authoritative here; the client mirrors
// it for display). TestLevelDefsMatchClient fails if the two drift.
type levelDef struct {
	ID          int
	Battlefield string
	Difficulty  string
	Enemy       PlayerUpgradeModifiers
	CoinReward  int
}

func levelEnemy(units int, production float64) PlayerUpgradeModifiers {
	return PlayerUpgradeModifiers{StartingUnits: units, ProductionRateMultiplier: production, ArmySpeedMultiplier: 1}
}

var levelDefs = []levelDef{
	{1, "crown_cross", "easy", levelEnemy(16, 0.9), 25},
	{2, "crown_cross", "easy", levelEnemy(18, 1), 25},
	{3, "twin_passes", "easy", levelEnemy(18, 1), 25},
	{4, "royal_ring", "easy", levelEnemy(20, 1), 25},
	{5, "crown_cross", "normal", levelEnemy(18, 0.95), 40},
	{6, "twin_passes", "normal", levelEnemy(20, 1), 40},
	{7, "royal_ring", "normal", levelEnemy(20, 1), 40},
	{8, "crown_cross", "hard", levelEnemy(20, 1), 60},
	{9, "twin_passes", "hard", levelEnemy(22, 1.05), 60},
	{10, "royal_ring", "hard", levelEnemy(22, 1.05), 60},
}

func levelDefByID(id int) (levelDef, bool) {
	for _, def := range levelDefs {
		if def.ID == id {
			return def, true
		}
	}
	return levelDef{}, false
}

// ReplayLevel re-simulates a campaign level from the player's recorded
// dispatches. The level, its enemy and the bot are fixed by levelDefs, so the
// client only supplies actions; it cannot choose an easier opponent.
func ReplayLevel(def levelDef, actions []PvpAction) (PvpBattleSummary, error) {
	_, summary, err := simulateBotBattleWithCommander(
		actions, levelPlayerModifiers, def.Enemy, def.Battlefield, levelRulesVersion, def.Difficulty, "",
	)
	return summary, err
}

// levelReplayFn is a seam so claim-flow tests can stub the simulation.
var levelReplayFn = ReplayLevel

// LevelClaimResult is the stored, replayable outcome of a level claim.
type LevelClaimResult struct {
	ClaimID         string              `json:"claimId"`
	Success         bool                `json:"success"`
	Reason          string              `json:"reason,omitempty"`
	LevelID         int                 `json:"levelId"`
	Reward          int                 `json:"reward"`
	Replayed        bool                `json:"replayed"`
	LevelsCompleted int                 `json:"levelsCompleted"`
	NewCareer       PlayerCareer        `json:"newCareer"`
	LedgerEntry     *EconomyLedgerEntry `json:"ledgerEntry,omitempty"`
}

// levelsCompletedAfter mirrors the game-core function of the same name:
// levels unlock in order, so a claim for a level that is not yet unlocked or
// that was already completed leaves progress unchanged.
func levelsCompletedAfter(completed, level int) int {
	if level < 1 || level > levelCount || level > completed+1 {
		return completed
	}
	if level > completed {
		return level
	}
	return completed
}

// LevelsCompleted returns the player's campaign progress (0 for a new player).
func (s *Store) LevelsCompleted(ctx context.Context, userID string) (int, error) {
	if _, err := s.GetOrCreateCareer(ctx, userID); err != nil {
		return 0, err
	}
	var completed int
	err := s.db.QueryRowContext(ctx, `SELECT levels_completed FROM players WHERE id = $1`, userID).Scan(&completed)
	return completed, err
}

// CompleteLevel records a finished level without proof (legacy payload from
// clients that predate rewards). It is idempotent and monotonic: the row is only
// ever raised, to the next level in order, under a row lock so concurrent
// retries cannot skip a level. It grants no economy value; rewards go through
// CompleteLevelVerified, which replays the win.
func (s *Store) CompleteLevel(ctx context.Context, userID string, level int) (int, error) {
	if level < 1 || level > levelCount {
		return 0, ErrLevelInvalid
	}
	if _, err := s.GetOrCreateCareer(ctx, userID); err != nil {
		return 0, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var completed int
	if err := tx.QueryRowContext(ctx, `SELECT levels_completed FROM players WHERE id = $1 FOR UPDATE`, userID).Scan(&completed); err != nil {
		return 0, err
	}
	next := levelsCompletedAfter(completed, level)
	if next != completed {
		if _, err := tx.ExecContext(ctx, `UPDATE players SET levels_completed = $2, updated_at = now() WHERE id = $1`, userID, next); err != nil {
			return 0, err
		}
	}
	return next, tx.Commit()
}

func rpcLevelsGet(store *Store) rpcFn {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
		userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
		if !ok || userID == "" {
			return "", errors.New("unauthenticated")
		}
		completed, err := store.LevelsCompleted(ctx, userID)
		if err != nil {
			return "", err
		}
		response, _ := json.Marshal(map[string]any{"levelsCompleted": completed})
		return string(response), nil
	}
}

func rpcLevelsComplete(store *Store) rpcFn {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
		userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
		if !ok || userID == "" {
			return "", errors.New("unauthenticated")
		}
		var request struct {
			LevelID int         `json:"levelId"`
			ClaimID string      `json:"claimId"`
			Actions []PvpAction `json:"actions"`
		}
		decoder := json.NewDecoder(strings.NewReader(payload))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			return "", errors.New("invalid_payload")
		}
		if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
			return "", errors.New("invalid_payload")
		}
		// Legacy clients send only {levelId}: record progress, no reward.
		if request.ClaimID == "" && request.Actions == nil {
			completed, err := store.CompleteLevel(ctx, userID, request.LevelID)
			if err != nil {
				return "", err
			}
			response, _ := json.Marshal(map[string]any{"levelsCompleted": completed})
			return string(response), nil
		}
		if len(request.ClaimID) < 1 || len(request.ClaimID) > 128 {
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
		result, err := store.CompleteLevelVerified(ctx, userID, request.LevelID, request.ClaimID, request.Actions)
		if err != nil {
			return "", err
		}
		response, _ := json.Marshal(map[string]any{"levelsCompleted": result.LevelsCompleted, "result": result})
		return string(response), nil
	}
}

func findStoredLevelClaim(ctx context.Context, tx *sql.Tx, userID string, levelID int, claimID string) (*LevelClaimResult, error) {
	var storedUserID string
	var storedLevelID int
	var encoded []byte
	err := tx.QueryRowContext(ctx, `
		SELECT player_id, level_id, result FROM level_reward_claims WHERE claim_id = $1
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
	var result LevelClaimResult
	if err := json.Unmarshal(encoded, &result); err != nil {
		return nil, errors.New("invalid_stored_level_claim")
	}
	result.Replayed = true
	return &result, nil
}

// CompleteLevelVerified replays the player's actions against the fixed level
// and, on a win, advances campaign progress and pays the level's first-clear
// coin reward exactly once per (player, level). claimID makes retries
// idempotent; later clears of an already-rewarded level succeed with reward 0.
func (s *Store) CompleteLevelVerified(ctx context.Context, userID string, levelID int, claimID string, actions []PvpAction) (LevelClaimResult, error) {
	def, ok := levelDefByID(levelID)
	if !ok {
		return LevelClaimResult{}, ErrLevelInvalid
	}
	// Replay first: it needs no database state, so an invalid or losing
	// submission never takes the player row lock.
	summary, err := levelReplayFn(def, actions)
	if err != nil {
		return LevelClaimResult{}, err
	}
	if summary.Status != "victory" {
		return LevelClaimResult{ClaimID: claimID, Reason: "not_victory", LevelID: levelID}, nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return LevelClaimResult{}, err
	}
	defer tx.Rollback()

	if existing, err := findStoredLevelClaim(ctx, tx, userID, levelID, claimID); err != nil {
		return LevelClaimResult{}, err
	} else if existing != nil {
		return *existing, nil
	}
	career, err := getCareerForUpdate(ctx, tx, userID)
	if err != nil {
		return LevelClaimResult{}, err
	}
	if existing, err := findStoredLevelClaim(ctx, tx, userID, levelID, claimID); err != nil {
		return LevelClaimResult{}, err
	} else if existing != nil {
		return *existing, nil
	}
	var completed int
	if err := tx.QueryRowContext(ctx, `SELECT levels_completed FROM players WHERE id = $1`, userID).Scan(&completed); err != nil {
		return LevelClaimResult{}, err
	}
	if levelID > completed+1 {
		return LevelClaimResult{ClaimID: claimID, Reason: "level_locked", LevelID: levelID, LevelsCompleted: completed, NewCareer: career}, nil
	}
	next := levelsCompletedAfter(completed, levelID)
	if next != completed {
		if _, err := tx.ExecContext(ctx, `UPDATE players SET levels_completed = $2, updated_at = now() WHERE id = $1`, userID, next); err != nil {
			return LevelClaimResult{}, err
		}
	}

	var alreadyPaid string
	err = tx.QueryRowContext(ctx, `SELECT claim_id FROM level_reward_claims WHERE player_id = $1 AND level_id = $2`, userID, levelID).Scan(&alreadyPaid)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return LevelClaimResult{}, err
	}
	if err == nil {
		result := LevelClaimResult{ClaimID: claimID, Success: true, Reason: "already_claimed", LevelID: levelID, LevelsCompleted: next, NewCareer: career}
		return result, tx.Commit()
	}

	now := s.nowFn()
	previousCoins := career.Coins
	career.Coins += def.CoinReward
	entry := EconomyLedgerEntry{
		ID: "level_" + claimID, Player: userID, Currency: "coins", Amount: def.CoinReward,
		Reason: "level_" + itoa(int64(levelID)) + "_first_clear", Source: "level_reward",
		PreviousBalance: previousCoins, ResultingBalance: career.Coins, Timestamp: now.UnixMilli(),
	}
	result := LevelClaimResult{
		ClaimID: claimID, Success: true, LevelID: levelID, Reward: def.CoinReward,
		LevelsCompleted: next, NewCareer: career, LedgerEntry: &entry,
	}
	encoded, _ := json.Marshal(result)
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO level_reward_claims (claim_id, player_id, level_id, result)
		VALUES ($1, $2, $3, $4)
	`, claimID, userID, levelID, encoded); err != nil {
		return LevelClaimResult{}, err
	}
	if err := persistCareer(ctx, tx, career); err != nil {
		return LevelClaimResult{}, err
	}
	if err := insertLedgerEntries(ctx, tx, []EconomyLedgerEntry{entry}); err != nil {
		return LevelClaimResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return LevelClaimResult{}, err
	}
	return result, nil
}
