package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/heroiclabs/nakama-common/runtime"
)

// levelCount mirrors LEVEL_COUNT in packages/game-core/src/levels.ts.
const levelCount = 10

var ErrLevelInvalid = errors.New("invalid_level")

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

// CompleteLevel records a finished level. It is idempotent and monotonic: the
// row is only ever raised, to the next level in order, under a row lock so
// concurrent retries cannot skip a level. Honest-client trust boundary like
// tutorial/complete: the client reports the win (the level is a client-local
// bot match) and the claim grants no rewards or economy value; it only unlocks
// the next level for this player.
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
			LevelID int `json:"levelId"`
		}
		if err := json.Unmarshal([]byte(payload), &request); err != nil {
			return "", errors.New("invalid_payload")
		}
		completed, err := store.CompleteLevel(ctx, userID, request.LevelID)
		if err != nil {
			return "", err
		}
		response, _ := json.Marshal(map[string]any{"levelsCompleted": completed})
		return string(response), nil
	}
}
