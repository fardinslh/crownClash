package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

type leagueRowsQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func getClaimedLeagueRanks(ctx context.Context, queryer leagueRowsQuerier, userID string) (map[string]bool, error) {
	rows, err := queryer.QueryContext(ctx, `
		SELECT rank_id FROM league_reward_claims WHERE player_id = $1
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	claimed := map[string]bool{}
	for rows.Next() {
		var rankID string
		if err := rows.Scan(&rankID); err != nil {
			return nil, err
		}
		claimed[rankID] = true
	}
	return claimed, rows.Err()
}

func (s *Store) GetLeagueState(ctx context.Context, userID string) (LeagueState, error) {
	career, err := getCareer(ctx, s.db, userID)
	if err != nil {
		return LeagueState{}, err
	}
	claimed, err := getClaimedLeagueRanks(ctx, s.db, userID)
	if err != nil {
		return LeagueState{}, err
	}
	return BuildLeagueState(career, claimed), nil
}

func findStoredLeagueClaim(
	ctx context.Context,
	tx *sql.Tx,
	userID, rankID, claimID string,
) (*LeagueClaimResult, error) {
	var storedUserID, storedRankID string
	var encoded []byte
	err := tx.QueryRowContext(ctx, `
		SELECT player_id, rank_id, result FROM league_reward_claims WHERE claim_id = $1
	`, claimID).Scan(&storedUserID, &storedRankID, &encoded)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if storedUserID != userID {
		return nil, ErrLeagueClaimOwnership
	}
	if storedRankID != rankID {
		return nil, ErrLeagueClaimMismatch
	}
	var result LeagueClaimResult
	if err := json.Unmarshal(encoded, &result); err != nil {
		return nil, errors.New("invalid_stored_league_claim")
	}
	result.Replayed = true
	return &result, nil
}

func (s *Store) ClaimLeagueReward(
	ctx context.Context,
	userID, rankID, claimID string,
) (LeagueClaimResult, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return LeagueClaimResult{}, err
	}
	defer tx.Rollback()

	if existing, err := findStoredLeagueClaim(ctx, tx, userID, rankID, claimID); err != nil {
		return LeagueClaimResult{}, err
	} else if existing != nil {
		return *existing, nil
	}
	career, err := getCareerForUpdate(ctx, tx, userID)
	if err != nil {
		return LeagueClaimResult{}, err
	}
	if existing, err := findStoredLeagueClaim(ctx, tx, userID, rankID, claimID); err != nil {
		return LeagueClaimResult{}, err
	} else if existing != nil {
		return *existing, nil
	}
	claimed, err := getClaimedLeagueRanks(ctx, tx, userID)
	if err != nil {
		return LeagueClaimResult{}, err
	}
	state := BuildLeagueState(career, claimed)
	reward, valid := leagueRewards[rankID]
	if !valid || reward <= 0 {
		return LeagueClaimResult{ClaimID: claimID, Reason: "invalid_rank", RankID: rankID, State: state, NewCareer: career}, nil
	}
	if claimed[rankID] {
		return LeagueClaimResult{ClaimID: claimID, Reason: "already_claimed", RankID: rankID, State: state, NewCareer: career}, nil
	}
	if career.Trophies < getRankTierForID(rankID).MinTrophies {
		return LeagueClaimResult{ClaimID: claimID, Reason: "not_unlocked", RankID: rankID, State: state, NewCareer: career}, nil
	}

	now := s.nowFn()
	previousCoins := career.Coins
	career.Coins += reward
	claimed[rankID] = true
	entry := EconomyLedgerEntry{
		ID: "league_" + claimID, Player: userID, Currency: "coins", Amount: reward,
		Reason: "league_" + rankID, Source: "league_reward",
		PreviousBalance: previousCoins, ResultingBalance: career.Coins, Timestamp: now.UnixMilli(),
	}
	result := LeagueClaimResult{
		ClaimID: claimID, Success: true, RankID: rankID, Reward: reward,
		State: BuildLeagueState(career, claimed), NewCareer: career, LedgerEntry: &entry,
	}
	encoded, _ := json.Marshal(result)
	var inserted string
	err = tx.QueryRowContext(ctx, `
		INSERT INTO league_reward_claims (claim_id, player_id, rank_id, result)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (claim_id) DO NOTHING
		RETURNING claim_id
	`, claimID, userID, rankID, encoded).Scan(&inserted)
	if errors.Is(err, sql.ErrNoRows) {
		existing, readErr := findStoredLeagueClaim(ctx, tx, userID, rankID, claimID)
		if readErr != nil {
			return LeagueClaimResult{}, readErr
		}
		if existing == nil {
			return LeagueClaimResult{}, errors.New("league_claim_lost")
		}
		return *existing, nil
	}
	if err != nil {
		return LeagueClaimResult{}, err
	}
	if err := persistCareer(ctx, tx, career); err != nil {
		return LeagueClaimResult{}, err
	}
	if err := insertLedgerEntries(ctx, tx, []EconomyLedgerEntry{entry}); err != nil {
		return LeagueClaimResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return LeagueClaimResult{}, err
	}
	return result, nil
}

func getRankTierForID(rankID string) RankTierInfo {
	for _, tier := range rankTiers {
		if tier.ID == rankID {
			return tier
		}
	}
	return RankTierInfo{MinTrophies: int(^uint(0) >> 1)}
}
