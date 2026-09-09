package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"
	_ "time/tzdata"
)

const (
	dailyPlayTarget       = 2
	dailyWinTarget        = 1
	dailyCaptureTarget    = 10
	dailyPlayReward       = 30
	dailyWinReward        = 40
	dailyCaptureReward    = 50
	dailyCrownChestReward = 75
)

var tehranLocation = mustLoadTehranLocation()

type dailyProgressRow struct {
	DayKey                    string
	MatchesPlayed             int
	MatchesWon                int
	TerritoriesCaptured       int
	PlayMatchesClaimed        bool
	WinMatchClaimed           bool
	CaptureTerritoriesClaimed bool
	CrownChestClaimed         bool
}

func mustLoadTehranLocation() *time.Location {
	location, err := time.LoadLocation("Asia/Tehran")
	if err != nil {
		panic("load Asia/Tehran timezone: " + err.Error())
	}
	return location
}

func dailyWindow(now time.Time) (string, int64) {
	local := now.In(tehranLocation)
	dayKey := local.Format("2006-01-02")
	nextMidnight := time.Date(local.Year(), local.Month(), local.Day()+1, 0, 0, 0, 0, tehranLocation)
	return dayKey, nextMidnight.UnixMilli()
}

func isDailyRewardType(value DailyRewardType) bool {
	switch value {
	case DailyPlayMatches, DailyWinMatch, DailyCaptureTerritories, DailyCrownChest:
		return true
	default:
		return false
	}
}

func rewardForDailyType(value DailyRewardType) int {
	switch value {
	case DailyPlayMatches:
		return dailyPlayReward
	case DailyWinMatch:
		return dailyWinReward
	case DailyCaptureTerritories:
		return dailyCaptureReward
	case DailyCrownChest:
		return dailyCrownChestReward
	default:
		return 0
	}
}

func buildDailyState(row dailyProgressRow, resetsAt int64) DailyState {
	missions := []DailyMissionState{
		{
			ID: DailyPlayMatches, Title: "Battle Orders", Description: "Play 2 matches",
			Progress: row.MatchesPlayed, Target: dailyPlayTarget, Reward: dailyPlayReward,
			Complete: row.MatchesPlayed >= dailyPlayTarget, Claimed: row.PlayMatchesClaimed,
		},
		{
			ID: DailyWinMatch, Title: "Claim Victory", Description: "Win 1 match",
			Progress: row.MatchesWon, Target: dailyWinTarget, Reward: dailyWinReward,
			Complete: row.MatchesWon >= dailyWinTarget, Claimed: row.WinMatchClaimed,
		},
		{
			ID: DailyCaptureTerritories, Title: "Expand the Realm", Description: "Capture 10 towers",
			Progress: row.TerritoriesCaptured, Target: dailyCaptureTarget, Reward: dailyCaptureReward,
			Complete: row.TerritoriesCaptured >= dailyCaptureTarget, Claimed: row.CaptureTerritoriesClaimed,
		},
	}
	return DailyState{
		DayKey: row.DayKey, ResetsAt: resetsAt, Missions: missions,
		Chest: DailyChestState{
			Reward:   dailyCrownChestReward,
			Unlocked: row.PlayMatchesClaimed && row.WinMatchClaimed && row.CaptureTerritoriesClaimed,
			Claimed:  row.CrownChestClaimed,
		},
	}
}

func scanDailyProgress(row *sql.Row) (dailyProgressRow, error) {
	var value dailyProgressRow
	err := row.Scan(
		&value.DayKey, &value.MatchesPlayed, &value.MatchesWon, &value.TerritoriesCaptured,
		&value.PlayMatchesClaimed, &value.WinMatchClaimed,
		&value.CaptureTerritoriesClaimed, &value.CrownChestClaimed,
	)
	return value, err
}

type sqlExecutor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func ensureDailyProgress(ctx context.Context, executor sqlExecutor, userID, dayKey string) error {
	_, err := executor.ExecContext(ctx, `
		INSERT INTO player_daily_progress (player_id, day_key)
		VALUES ($1, $2::date)
		ON CONFLICT (player_id, day_key) DO NOTHING
	`, userID, dayKey)
	return err
}

func getDailyProgress(ctx context.Context, queryer rowQuerier, userID, dayKey string, forUpdate bool) (dailyProgressRow, error) {
	query := `
		SELECT day_key::text, matches_played, matches_won, territories_captured,
		       play_matches_claimed, win_match_claimed, capture_territories_claimed, crown_chest_claimed
		FROM player_daily_progress
		WHERE player_id = $1 AND day_key = $2::date
	`
	if forUpdate {
		query += " FOR UPDATE"
	}
	return scanDailyProgress(queryer.QueryRowContext(ctx, query, userID, dayKey))
}

func (s *Store) GetDailyState(ctx context.Context, userID string) (DailyState, error) {
	dayKey, resetsAt := dailyWindow(s.nowFn())
	if err := ensureDailyProgress(ctx, s.db, userID, dayKey); err != nil {
		return DailyState{}, err
	}
	row, err := getDailyProgress(ctx, s.db, userID, dayKey, false)
	if err != nil {
		return DailyState{}, err
	}
	return buildDailyState(row, resetsAt), nil
}

func (s *Store) advanceDailyProgress(
	ctx context.Context,
	tx *sql.Tx,
	userID string,
	status string,
	stats MatchStats,
	now time.Time,
) error {
	dayKey, _ := dailyWindow(now)
	wins := 0
	if status == "victory" {
		wins = 1
	}
	captures := int(math.Floor(math.Max(0, stats.TerritoriesCapturedByPlayer)))
	_, err := tx.ExecContext(ctx, `
		INSERT INTO player_daily_progress
			(player_id, day_key, matches_played, matches_won, territories_captured)
		VALUES ($1, $2::date, 1, $3, LEAST($4, 10))
		ON CONFLICT (player_id, day_key) DO UPDATE SET
			matches_played = LEAST(player_daily_progress.matches_played + 1, 2),
			matches_won = LEAST(player_daily_progress.matches_won + EXCLUDED.matches_won, 1),
			territories_captured = LEAST(player_daily_progress.territories_captured + EXCLUDED.territories_captured, 10),
			updated_at = now()
	`, userID, dayKey, wins, captures)
	return err
}

func findStoredDailyClaim(
	ctx context.Context,
	tx *sql.Tx,
	userID string,
	rewardType DailyRewardType,
	claimID string,
	dayKey string,
) (*DailyClaimResult, error) {
	var storedUserID, storedDayKey string
	var storedRewardType DailyRewardType
	var encoded []byte
	err := tx.QueryRowContext(ctx, `
		SELECT player_id, day_key::text, reward_type, result
		FROM daily_reward_claims WHERE claim_id = $1
	`, claimID).Scan(&storedUserID, &storedDayKey, &storedRewardType, &encoded)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if storedUserID != userID {
		return nil, ErrDailyClaimOwnership
	}
	if storedRewardType != rewardType || storedDayKey != dayKey {
		return nil, ErrDailyClaimMismatch
	}
	var result DailyClaimResult
	if err := json.Unmarshal(encoded, &result); err != nil {
		return nil, errors.New("invalid_stored_daily_claim")
	}
	result.Replayed = true
	return &result, nil
}

func dailyRewardAvailable(row dailyProgressRow, rewardType DailyRewardType) (bool, string) {
	switch rewardType {
	case DailyPlayMatches:
		if row.PlayMatchesClaimed {
			return false, "already_claimed"
		}
		if row.MatchesPlayed < dailyPlayTarget {
			return false, "not_complete"
		}
	case DailyWinMatch:
		if row.WinMatchClaimed {
			return false, "already_claimed"
		}
		if row.MatchesWon < dailyWinTarget {
			return false, "not_complete"
		}
	case DailyCaptureTerritories:
		if row.CaptureTerritoriesClaimed {
			return false, "already_claimed"
		}
		if row.TerritoriesCaptured < dailyCaptureTarget {
			return false, "not_complete"
		}
	case DailyCrownChest:
		if row.CrownChestClaimed {
			return false, "already_claimed"
		}
		if !row.PlayMatchesClaimed || !row.WinMatchClaimed || !row.CaptureTerritoriesClaimed {
			return false, "chest_locked"
		}
	default:
		return false, "invalid_reward_type"
	}
	return true, ""
}

func markDailyRewardClaimed(ctx context.Context, tx *sql.Tx, userID, dayKey string, rewardType DailyRewardType) error {
	column := map[DailyRewardType]string{
		DailyPlayMatches:        "play_matches_claimed",
		DailyWinMatch:           "win_match_claimed",
		DailyCaptureTerritories: "capture_territories_claimed",
		DailyCrownChest:         "crown_chest_claimed",
	}[rewardType]
	if column == "" {
		return errors.New("invalid_reward_type")
	}
	// column comes only from the closed server-side map above.
	_, err := tx.ExecContext(ctx, fmt.Sprintf(`
		UPDATE player_daily_progress SET %s = true, updated_at = now()
		WHERE player_id = $1 AND day_key = $2::date
	`, column), userID, dayKey)
	return err
}

func applyClaimToDailyRow(row *dailyProgressRow, rewardType DailyRewardType) {
	switch rewardType {
	case DailyPlayMatches:
		row.PlayMatchesClaimed = true
	case DailyWinMatch:
		row.WinMatchClaimed = true
	case DailyCaptureTerritories:
		row.CaptureTerritoriesClaimed = true
	case DailyCrownChest:
		row.CrownChestClaimed = true
	}
}

func (s *Store) ClaimDailyReward(
	ctx context.Context,
	userID string,
	rewardType DailyRewardType,
	claimID string,
) (DailyClaimResult, error) {
	now := s.nowFn()
	dayKey, resetsAt := dailyWindow(now)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return DailyClaimResult{}, err
	}
	defer tx.Rollback()

	if existing, err := findStoredDailyClaim(ctx, tx, userID, rewardType, claimID, dayKey); err != nil {
		return DailyClaimResult{}, err
	} else if existing != nil {
		return *existing, nil
	}

	// Settlement locks the player before daily progress. Keep the same order.
	career, err := getCareerForUpdate(ctx, tx, userID)
	if err != nil {
		return DailyClaimResult{}, err
	}
	if existing, err := findStoredDailyClaim(ctx, tx, userID, rewardType, claimID, dayKey); err != nil {
		return DailyClaimResult{}, err
	} else if existing != nil {
		return *existing, nil
	}
	if err := ensureDailyProgress(ctx, tx, userID, dayKey); err != nil {
		return DailyClaimResult{}, err
	}
	row, err := getDailyProgress(ctx, tx, userID, dayKey, true)
	if err != nil {
		return DailyClaimResult{}, err
	}
	available, reason := dailyRewardAvailable(row, rewardType)
	if !available {
		return DailyClaimResult{
			ClaimID: claimID, Success: false, Reason: reason, RewardType: rewardType,
			State: buildDailyState(row, resetsAt), NewCareer: career,
		}, nil
	}

	reward := rewardForDailyType(rewardType)
	previousCoins := career.Coins
	career.Coins += reward
	entry := EconomyLedgerEntry{
		ID: "daily_" + claimID, Player: userID, Currency: "coins", Amount: reward,
		Reason: "daily_" + string(rewardType), Source: "daily_reward",
		PreviousBalance: previousCoins, ResultingBalance: career.Coins, Timestamp: now.UnixMilli(),
	}
	if err := markDailyRewardClaimed(ctx, tx, userID, dayKey, rewardType); err != nil {
		return DailyClaimResult{}, err
	}
	applyClaimToDailyRow(&row, rewardType)
	result := DailyClaimResult{
		ClaimID: claimID, Success: true, RewardType: rewardType, Reward: reward,
		State: buildDailyState(row, resetsAt), NewCareer: career, LedgerEntry: &entry,
	}
	encoded, _ := json.Marshal(result)
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO daily_reward_claims (claim_id, player_id, day_key, reward_type, result)
		VALUES ($1, $2, $3::date, $4, $5)
	`, claimID, userID, dayKey, rewardType, encoded); err != nil {
		return DailyClaimResult{}, err
	}
	if err := persistCareer(ctx, tx, career); err != nil {
		return DailyClaimResult{}, err
	}
	if err := insertLedgerEntries(ctx, tx, []EconomyLedgerEntry{entry}); err != nil {
		return DailyClaimResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return DailyClaimResult{}, err
	}
	return result, nil
}
