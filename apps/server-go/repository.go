package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrPlayerNotFound     = errors.New("player_not_found")
	ErrPvpDefenseNotFound = errors.New("pvp_defense_not_found")
	ErrPvpSelfAttack      = errors.New("pvp_cannot_attack_self")
	ErrPvpAttackOwnership = errors.New("pvp_attack_id_owned_by_another_player")
)

type PlayerRepository struct {
	pool *pgxpool.Pool
}

type playerRow struct {
	ID                    string
	Platform              string
	Username              *string
	Coins                 int
	Gems                  int
	Trophies              int
	StartingGarrisonLevel int
	ProductionLevel       int
	ArmySpeedLevel        int
	MatchesPlayed         int
	MatchesWon            int
	CurrentStreak         int
	BestStreak            int
	LastMatchTimestamp    int64
}

func NewPlayerRepository(pool *pgxpool.Pool) *PlayerRepository {
	return &PlayerRepository{pool: pool}
}

func (r *PlayerRepository) GetOrCreateCareer(ctx context.Context, playerID, platform string, username *string) (PlayerCareer, error) {
	fresh := CreateDefaultCareer(playerID)
	_, err := r.pool.Exec(ctx, `
		INSERT INTO players (id, platform, username, coins, gems, trophies)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (id) DO NOTHING
	`, playerID, platform, username, fresh.Coins, fresh.Gems, fresh.Trophies)
	if err != nil {
		return PlayerCareer{}, err
	}
	return r.getCareer(ctx, r.pool, playerID)
}

func (r *PlayerRepository) getCareer(ctx context.Context, queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, playerID string) (PlayerCareer, error) {
	row := queryer.QueryRow(ctx, `
		SELECT id, platform, username, coins, gems, trophies,
		       starting_garrison_level, production_level, army_speed_level,
		       matches_played, matches_won, current_streak, best_streak,
		       last_match_timestamp
		FROM players WHERE id = $1
	`, playerID)
	var value playerRow
	if err := row.Scan(
		&value.ID, &value.Platform, &value.Username, &value.Coins, &value.Gems,
		&value.Trophies, &value.StartingGarrisonLevel, &value.ProductionLevel,
		&value.ArmySpeedLevel, &value.MatchesPlayed, &value.MatchesWon,
		&value.CurrentStreak, &value.BestStreak, &value.LastMatchTimestamp,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PlayerCareer{}, fmt.Errorf("%w:%s", ErrPlayerNotFound, playerID)
		}
		return PlayerCareer{}, err
	}
	return careerFromRow(value), nil
}

func careerFromRow(row playerRow) PlayerCareer {
	return PlayerCareer{
		PlayerID: row.ID, Coins: row.Coins, Gems: row.Gems, Trophies: row.Trophies,
		StartingGarrisonLevel: row.StartingGarrisonLevel,
		ProductionLevel:       row.ProductionLevel, ArmySpeedLevel: row.ArmySpeedLevel,
		MatchesPlayed: row.MatchesPlayed, MatchesWon: row.MatchesWon,
		CurrentStreak: row.CurrentStreak, BestStreak: row.BestStreak,
		LastMatchTimestamp: row.LastMatchTimestamp,
	}
}

func (r *PlayerRepository) GetLedger(ctx context.Context, playerID string, limit int) ([]EconomyLedgerEntry, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, player_id, currency, amount, reason, source,
		       previous_balance, resulting_balance, timestamp
		FROM economy_ledger
		WHERE player_id = $1
		ORDER BY timestamp DESC
		LIMIT $2
	`, playerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := make([]EconomyLedgerEntry, 0)
	for rows.Next() {
		var entry EconomyLedgerEntry
		if err := rows.Scan(
			&entry.ID, &entry.Player, &entry.Currency, &entry.Amount, &entry.Reason,
			&entry.Source, &entry.PreviousBalance, &entry.ResultingBalance, &entry.Timestamp,
		); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (r *PlayerRepository) InsertAnalyticsEvents(ctx context.Context, playerID string, events []AnalyticsEventRecord) error {
	for _, event := range events {
		props := event.Props
		if props == nil {
			props = map[string]any{}
		}
		encoded, err := json.Marshal(props)
		if err != nil {
			return err
		}
		if _, err := r.pool.Exec(ctx, `
			INSERT INTO analytics_events (player_id, name, props)
			VALUES ($1, $2, $3)
		`, playerID, event.Name, encoded); err != nil {
			return err
		}
	}
	return nil
}

func (r *PlayerRepository) GetPlayerDisplayName(ctx context.Context, playerID string) (string, error) {
	var username *string
	if err := r.pool.QueryRow(ctx, `SELECT username FROM players WHERE id = $1`, playerID).Scan(&username); err != nil {
		return "", err
	}
	if username != nil && *username != "" {
		return *username, nil
	}
	return playerID, nil
}

func findStoredSettlement(ctx context.Context, tx pgx.Tx, matchID string) (*MatchSettlement, error) {
	var stored []byte
	err := tx.QueryRow(ctx, `SELECT settlement FROM match_settlements WHERE match_id = $1`, matchID).Scan(&stored)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var settlement MatchSettlement
	if err := json.Unmarshal(stored, &settlement); err != nil {
		return nil, errors.New("invalid_stored_settlement")
	}
	return &settlement, nil
}

func (r *PlayerRepository) persistSettlement(ctx context.Context, tx pgx.Tx, career PlayerCareer, status string, stats MatchStats, matchID string) (MatchSettlement, error) {
	settlement := SettleMatch(career, status, stats, matchID, nowMillis())
	if err := r.persistCareer(ctx, tx, settlement.NewCareer); err != nil {
		return MatchSettlement{}, err
	}
	if err := r.insertLedgerEntries(ctx, tx, settlement.LedgerEntries); err != nil {
		return MatchSettlement{}, err
	}
	payload, _ := json.Marshal(settlement)
	if _, err := tx.Exec(ctx, `
		INSERT INTO match_settlements (match_id, player_id, status, settlement)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (match_id) DO NOTHING
	`, matchID, career.PlayerID, status, payload); err != nil {
		return MatchSettlement{}, err
	}
	return settlement, nil
}

// SettleMatch settles a match whose status and stats were produced by a
// server-authoritative simulation (live WebSocket rooms).
func (r *PlayerRepository) SettleMatch(ctx context.Context, playerID, status string, stats MatchStats, matchID string) (MatchSettlement, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return MatchSettlement{}, err
	}
	defer tx.Rollback(ctx)

	if existing, err := findStoredSettlement(ctx, tx, matchID); err != nil {
		return MatchSettlement{}, err
	} else if existing != nil {
		return *existing, nil
	}

	career, err := r.getCareerForUpdate(ctx, tx, playerID)
	if err != nil {
		return MatchSettlement{}, err
	}
	// A concurrent request may have committed while this transaction waited
	// for the player's row lock.
	if existing, err := findStoredSettlement(ctx, tx, matchID); err != nil {
		return MatchSettlement{}, err
	} else if existing != nil {
		return *existing, nil
	}

	settlement, err := r.persistSettlement(ctx, tx, career, status, stats, matchID)
	if err != nil {
		return MatchSettlement{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return MatchSettlement{}, err
	}
	return settlement, nil
}

// SettleMatchVerified settles a single-player bot match by replaying the
// recorded player actions through the authoritative simulation. The client
// supplies only dispatch intents; status, stats, and rewards are derived
// server-side and cannot be forged.
func (r *PlayerRepository) SettleMatchVerified(ctx context.Context, playerID, matchID string, actions []PvpAction) (MatchSettlement, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return MatchSettlement{}, err
	}
	defer tx.Rollback(ctx)

	if existing, err := findStoredSettlement(ctx, tx, matchID); err != nil {
		return MatchSettlement{}, err
	} else if existing != nil {
		return *existing, nil
	}

	career, err := r.getCareerForUpdate(ctx, tx, playerID)
	if err != nil {
		return MatchSettlement{}, err
	}
	// A concurrent request may have committed while this transaction waited
	// for the player's row lock.
	if existing, err := findStoredSettlement(ctx, tx, matchID); err != nil {
		return MatchSettlement{}, err
	} else if existing != nil {
		return *existing, nil
	}

	_, summary, err := SimulateBotBattle(actions, UpgradeModifiers(career))
	if err != nil {
		return MatchSettlement{}, err
	}
	settlement, err := r.persistSettlement(ctx, tx, career, summary.Status, summary.Stats, matchID)
	if err != nil {
		return MatchSettlement{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return MatchSettlement{}, err
	}
	return settlement, nil
}

func (r *PlayerRepository) PurchaseUpgrade(ctx context.Context, playerID string, upgrade UpgradeType, purchaseID string) (UpgradePurchaseResult, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return UpgradePurchaseResult{}, err
	}
	defer tx.Rollback(ctx)

	var stored []byte
	err = tx.QueryRow(ctx, `SELECT result FROM upgrade_purchases WHERE purchase_id = $1`, purchaseID).Scan(&stored)
	if err == nil {
		var result UpgradePurchaseResult
		if unmarshalJSON(stored, &result) != nil {
			return UpgradePurchaseResult{}, errors.New("invalid_stored_upgrade_result")
		}
		return result, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return UpgradePurchaseResult{}, err
	}

	career, err := r.getCareerForUpdate(ctx, tx, playerID)
	if err != nil {
		return UpgradePurchaseResult{}, err
	}
	// A concurrent request may have committed while this transaction waited
	// for the player's row lock.
	err = tx.QueryRow(ctx, `SELECT result FROM upgrade_purchases WHERE purchase_id = $1`, purchaseID).Scan(&stored)
	if err == nil {
		var result UpgradePurchaseResult
		if unmarshalJSON(stored, &result) != nil {
			return UpgradePurchaseResult{}, errors.New("invalid_stored_upgrade_result")
		}
		return result, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return UpgradePurchaseResult{}, err
	}
	result := PurchaseUpgrade(career, upgrade, purchaseID, nowMillis())
	if !result.Success {
		return result, nil
	}
	if err := r.persistCareer(ctx, tx, result.NewCareer); err != nil {
		return UpgradePurchaseResult{}, err
	}
	if result.LedgerEntry != nil {
		if err := r.insertLedgerEntries(ctx, tx, []EconomyLedgerEntry{*result.LedgerEntry}); err != nil {
			return UpgradePurchaseResult{}, err
		}
	}
	payload, _ := json.Marshal(result)
	if _, err := tx.Exec(ctx, `
		INSERT INTO upgrade_purchases (purchase_id, player_id, upgrade_type, result)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (purchase_id) DO NOTHING
	`, purchaseID, playerID, upgrade, payload); err != nil {
		return UpgradePurchaseResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return UpgradePurchaseResult{}, err
	}
	return result, nil
}

func (r *PlayerRepository) PublishDefense(ctx context.Context, playerID, displayName string, career PlayerCareer, publishedAt int64) (PvpDefenseSnapshot, error) {
	if len(displayName) > 40 {
		displayName = displayName[:40]
	}
	if displayName == "" {
		displayName = playerID
	}
	snapshot := PvpDefenseSnapshot{
		PlayerID: playerID, DisplayName: displayName, Trophies: career.Trophies,
		MatchesWon: career.MatchesWon, Modifiers: UpgradeModifiers(career), PublishedAt: publishedAt,
	}
	modifiers, _ := json.Marshal(snapshot.Modifiers)
	_, err := r.pool.Exec(ctx, `
		INSERT INTO pvp_defenses
			(player_id, display_name, trophies, matches_won, modifiers, published_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (player_id) DO UPDATE SET
			display_name = EXCLUDED.display_name,
			trophies = EXCLUDED.trophies,
			matches_won = EXCLUDED.matches_won,
			modifiers = EXCLUDED.modifiers,
			published_at = EXCLUDED.published_at,
			updated_at = now()
	`, playerID, displayName, snapshot.Trophies, snapshot.MatchesWon, modifiers, publishedAt)
	return snapshot, err
}

func (r *PlayerRepository) GetPvpOpponents(ctx context.Context, playerID string, trophies, limit int) ([]PvpOpponent, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT d.player_id, d.display_name, d.trophies, d.matches_won, d.modifiers, d.published_at,
		       EXISTS (
		         SELECT 1 FROM pvp_attacks revenge_check
		         WHERE revenge_check.attacker_id = d.player_id
		           AND revenge_check.defender_id = $1
		       ) AS is_revenge
		FROM pvp_defenses d
		WHERE d.player_id <> $1
		ORDER BY ABS(d.trophies - $2), d.published_at DESC
		LIMIT $3
	`, playerID, trophies, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	opponents := make([]PvpOpponent, 0)
	for rows.Next() {
		var opponent PvpOpponent
		if err := rows.Scan(
			&opponent.PlayerID, &opponent.DisplayName, &opponent.Trophies,
			&opponent.MatchesWon, &opponent.Modifiers, &opponent.DefensePublishedAt, &opponent.IsRevenge,
		); err != nil {
			return nil, err
		}
		opponent.RankID = GetRankTier(opponent.Trophies).ID
		opponents = append(opponents, opponent)
	}
	return opponents, rows.Err()
}

func (r *PlayerRepository) GetPvpHistory(ctx context.Context, playerID string, limit int) ([]PvpAttackHistoryEntry, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT a.attack_id, a.attacker_id, a.defender_id,
		       a.summary->>'status', a.is_revenge,
		       (a.summary->>'durationSeconds')::integer, a.created_at,
		       COALESCE(defender_defense.display_name, a.defender_id),
		       COALESCE(attacker_defense.display_name, a.attacker_id)
		FROM pvp_attacks a
		LEFT JOIN pvp_defenses defender_defense ON defender_defense.player_id = a.defender_id
		LEFT JOIN pvp_defenses attacker_defense ON attacker_defense.player_id = a.attacker_id
		WHERE a.attacker_id = $1 OR a.defender_id = $1
		ORDER BY a.created_at DESC
		LIMIT $2
	`, playerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	history := make([]PvpAttackHistoryEntry, 0)
	for rows.Next() {
		var entry PvpAttackHistoryEntry
		var defenderName, attackerName string
		if err := rows.Scan(
			&entry.AttackID, &entry.AttackerID, &entry.DefenderID, &entry.Status,
			&entry.IsRevenge, &entry.DurationSeconds, &entry.CreatedAt,
			&defenderName, &attackerName,
		); err != nil {
			return nil, err
		}
		if entry.AttackerID == playerID {
			entry.OpponentName = defenderName
		} else {
			entry.OpponentName = attackerName
		}
		history = append(history, entry)
	}
	return history, rows.Err()
}

func (r *PlayerRepository) SettlePvpAttack(ctx context.Context, attackerID, defenderID, attackID string, actions []PvpAction) (PvpAttackResult, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return PvpAttackResult{}, err
	}
	defer tx.Rollback(ctx)

	var existingAttacker string
	var existingDefender string
	var existingRevenge bool
	var existingSummary, existingSettlement []byte
	err = tx.QueryRow(ctx, `
		SELECT attacker_id, defender_id, is_revenge, summary, settlement
		FROM pvp_attacks WHERE attack_id = $1
	`, attackID).Scan(&existingAttacker, &existingDefender, &existingRevenge, &existingSummary, &existingSettlement)
	if err == nil {
		if existingAttacker != attackerID {
			return PvpAttackResult{}, ErrPvpAttackOwnership
		}
		var summary PvpBattleSummary
		var settlement MatchSettlement
		if unmarshalJSON(existingSummary, &summary) != nil || unmarshalJSON(existingSettlement, &settlement) != nil {
			return PvpAttackResult{}, errors.New("invalid_stored_pvp_result")
		}
		return PvpAttackResult{
			AttackID: attackID, AttackerID: existingAttacker, DefenderID: existingDefender,
			IsRevenge: existingRevenge, Summary: summary, Settlement: settlement,
		}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return PvpAttackResult{}, err
	}
	if attackerID == defenderID {
		return PvpAttackResult{}, ErrPvpSelfAttack
	}

	attackerCareer, err := r.getCareerForUpdate(ctx, tx, attackerID)
	if err != nil {
		return PvpAttackResult{}, err
	}
	// A concurrent request may have committed while this transaction waited
	// for the attacker's row lock.
	err = tx.QueryRow(ctx, `
		SELECT attacker_id, defender_id, is_revenge, summary, settlement
		FROM pvp_attacks WHERE attack_id = $1
	`, attackID).Scan(&existingAttacker, &existingDefender, &existingRevenge, &existingSummary, &existingSettlement)
	if err == nil {
		if existingAttacker != attackerID {
			return PvpAttackResult{}, ErrPvpAttackOwnership
		}
		var summary PvpBattleSummary
		var settlement MatchSettlement
		if unmarshalJSON(existingSummary, &summary) != nil || unmarshalJSON(existingSettlement, &settlement) != nil {
			return PvpAttackResult{}, errors.New("invalid_stored_pvp_result")
		}
		return PvpAttackResult{
			AttackID: attackID, AttackerID: existingAttacker, DefenderID: existingDefender,
			IsRevenge: existingRevenge, Summary: summary, Settlement: settlement,
		}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return PvpAttackResult{}, err
	}
	var defenseID, displayName string
	var trophies, matchesWon int
	var modifiersJSON []byte
	var publishedAt int64
	err = tx.QueryRow(ctx, `
		SELECT player_id, display_name, trophies, matches_won, modifiers, published_at
		FROM pvp_defenses WHERE player_id = $1 FOR SHARE
	`, defenderID).Scan(&defenseID, &displayName, &trophies, &matchesWon, &modifiersJSON, &publishedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return PvpAttackResult{}, ErrPvpDefenseNotFound
	}
	if err != nil {
		return PvpAttackResult{}, err
	}
	var modifiers PlayerUpgradeModifiers
	if err := json.Unmarshal(modifiersJSON, &modifiers); err != nil {
		return PvpAttackResult{}, err
	}
	var isRevenge bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM pvp_attacks
			WHERE attacker_id = $1 AND defender_id = $2
		)
	`, defenderID, attackerID).Scan(&isRevenge); err != nil {
		return PvpAttackResult{}, err
	}
	_, summary, err := SimulatePvpBattle(actions, UpgradeModifiers(attackerCareer), modifiers)
	if err != nil {
		return PvpAttackResult{}, err
	}
	settlement := SettleMatch(attackerCareer, summary.Status, summary.Stats, attackID, nowMillis())
	result := PvpAttackResult{
		AttackID: attackID, AttackerID: attackerID, DefenderID: defenderID,
		IsRevenge: isRevenge, Summary: summary, Settlement: settlement,
	}
	if err := r.persistCareer(ctx, tx, settlement.NewCareer); err != nil {
		return PvpAttackResult{}, err
	}
	if err := r.insertLedgerEntries(ctx, tx, settlement.LedgerEntries); err != nil {
		return PvpAttackResult{}, err
	}
	actionJSON, _ := json.Marshal(actions)
	summaryJSON, _ := json.Marshal(summary)
	settlementJSON, _ := json.Marshal(settlement)
	if _, err := tx.Exec(ctx, `
		INSERT INTO pvp_attacks
			(attack_id, attacker_id, defender_id, is_revenge, actions, summary, settlement, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, attackID, attackerID, defenderID, isRevenge, actionJSON, summaryJSON, settlementJSON, settlement.NewCareer.LastMatchTimestamp); err != nil {
		return PvpAttackResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PvpAttackResult{}, err
	}
	return result, nil
}

func (r *PlayerRepository) getCareerForUpdate(ctx context.Context, tx pgx.Tx, playerID string) (PlayerCareer, error) {
	row := tx.QueryRow(ctx, `
		SELECT id, platform, username, coins, gems, trophies,
		       starting_garrison_level, production_level, army_speed_level,
		       matches_played, matches_won, current_streak, best_streak,
		       last_match_timestamp
		FROM players WHERE id = $1 FOR UPDATE
	`, playerID)
	var value playerRow
	if err := row.Scan(
		&value.ID, &value.Platform, &value.Username, &value.Coins, &value.Gems,
		&value.Trophies, &value.StartingGarrisonLevel, &value.ProductionLevel,
		&value.ArmySpeedLevel, &value.MatchesPlayed, &value.MatchesWon,
		&value.CurrentStreak, &value.BestStreak, &value.LastMatchTimestamp,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PlayerCareer{}, fmt.Errorf("%w:%s", ErrPlayerNotFound, playerID)
		}
		return PlayerCareer{}, err
	}
	return careerFromRow(value), nil
}

func (r *PlayerRepository) persistCareer(ctx context.Context, tx pgx.Tx, career PlayerCareer) error {
	_, err := tx.Exec(ctx, `
		UPDATE players SET
			coins = $2, gems = $3, trophies = $4,
			starting_garrison_level = $5, production_level = $6, army_speed_level = $7,
			matches_played = $8, matches_won = $9, current_streak = $10, best_streak = $11,
			last_match_timestamp = $12, updated_at = now()
		WHERE id = $1
	`, career.PlayerID, career.Coins, career.Gems, career.Trophies,
		career.StartingGarrisonLevel, career.ProductionLevel, career.ArmySpeedLevel,
		career.MatchesPlayed, career.MatchesWon, career.CurrentStreak, career.BestStreak,
		career.LastMatchTimestamp)
	return err
}

func (r *PlayerRepository) insertLedgerEntries(ctx context.Context, tx pgx.Tx, entries []EconomyLedgerEntry) error {
	for _, entry := range entries {
		if _, err := tx.Exec(ctx, `
			INSERT INTO economy_ledger
				(id, player_id, currency, amount, reason, source,
				 previous_balance, resulting_balance, timestamp)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			ON CONFLICT (id) DO NOTHING
		`, entry.ID, entry.Player, entry.Currency, entry.Amount, entry.Reason,
			entry.Source, entry.PreviousBalance, entry.ResultingBalance, entry.Timestamp); err != nil {
			return err
		}
	}
	return nil
}

func unmarshalJSON(data []byte, target any) error {
	return json.Unmarshal(data, target)
}
