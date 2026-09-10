package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

var (
	ErrPlayerNotFound           = errors.New("player_not_found")
	ErrPvpDefenseNotFound       = errors.New("pvp_defense_not_found")
	ErrPvpSelfAttack            = errors.New("pvp_cannot_attack_self")
	ErrPvpAttackOwnership       = errors.New("pvp_attack_id_owned_by_another_player")
	ErrUpgradePurchaseOwnership = errors.New("upgrade_purchase_id_owned_by_another_player")
	ErrUpgradePurchaseMismatch  = errors.New("upgrade_purchase_id_reused_for_different_upgrade")
	ErrDailyClaimOwnership      = errors.New("daily_claim_id_owned_by_another_player")
	ErrDailyClaimMismatch       = errors.New("daily_claim_id_reused_for_different_reward")
	ErrLeagueClaimOwnership     = errors.New("league_claim_id_owned_by_another_player")
	ErrLeagueClaimMismatch      = errors.New("league_claim_id_reused_for_different_rank")
)

type Store struct {
	db    *sql.DB
	nowFn func() time.Time
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db, nowFn: time.Now}
}

type playerRow struct {
	ID                    string
	Username              sql.NullString
	Coins                 int
	Gems                  int
	Trophies              int
	StartingGarrisonLevel int
	ProductionLevel       int
	ArmySpeedLevel        int
	TreasuryLevel         int
	MatchesPlayed         int
	MatchesWon            int
	CurrentStreak         int
	BestStreak            int
	LastMatchTimestamp    int64
}

type rowQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func (s *Store) GetOrCreateCareer(ctx context.Context, userID string) (PlayerCareer, error) {
	fresh := CreateDefaultCareer(userID)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO players (id, coins, gems, trophies)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (id) DO NOTHING
	`, userID, fresh.Coins, fresh.Gems, fresh.Trophies)
	if err != nil {
		return PlayerCareer{}, err
	}
	return getCareer(ctx, s.db, userID)
}

func getCareer(ctx context.Context, queryer rowQuerier, userID string) (PlayerCareer, error) {
	row := queryer.QueryRowContext(ctx, `
		SELECT id, coins, gems, trophies,
		       starting_garrison_level, production_level, army_speed_level, treasury_level,
		       matches_played, matches_won, current_streak, best_streak,
		       last_match_timestamp
		FROM players WHERE id = $1
	`, userID)
	var value playerRow
	if err := row.Scan(
		&value.ID, &value.Coins, &value.Gems, &value.Trophies,
		&value.StartingGarrisonLevel, &value.ProductionLevel, &value.ArmySpeedLevel, &value.TreasuryLevel,
		&value.MatchesPlayed, &value.MatchesWon, &value.CurrentStreak, &value.BestStreak,
		&value.LastMatchTimestamp,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return PlayerCareer{}, fmt.Errorf("%w:%s", ErrPlayerNotFound, userID)
		}
		return PlayerCareer{}, err
	}
	return careerFromRow(value), nil
}

func careerFromRow(row playerRow) PlayerCareer {
	return PlayerCareer{
		PlayerID: row.ID, Coins: row.Coins, Gems: row.Gems, Trophies: row.Trophies,
		StartingGarrisonLevel: row.StartingGarrisonLevel,
		ProductionLevel:       row.ProductionLevel, ArmySpeedLevel: row.ArmySpeedLevel, TreasuryLevel: row.TreasuryLevel,
		MatchesPlayed: row.MatchesPlayed, MatchesWon: row.MatchesWon,
		CurrentStreak: row.CurrentStreak, BestStreak: row.BestStreak,
		LastMatchTimestamp: row.LastMatchTimestamp,
	}
}

func (s *Store) GetLedger(ctx context.Context, userID string, limit int) ([]EconomyLedgerEntry, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, player_id, currency, amount, reason, source,
		       previous_balance, resulting_balance, timestamp
		FROM economy_ledger
		WHERE player_id = $1
		ORDER BY timestamp DESC
		LIMIT $2
	`, userID, limit)
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

func (s *Store) GetPlayerDisplayName(ctx context.Context, userID string) (string, error) {
	var displayName string
	err := s.db.QueryRowContext(ctx, `SELECT display_name FROM player_names WHERE player_id = $1`, userID).Scan(&displayName)
	if errors.Is(err, sql.ErrNoRows) {
		return userID, nil
	}
	if err != nil {
		return "", err
	}
	return displayName, nil
}

func (s *Store) SetPlayerDisplayName(ctx context.Context, userID, displayName string) error {
	if len(displayName) > 40 {
		displayName = displayName[:40]
	}
	if displayName == "" {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO player_names (player_id, display_name)
		VALUES ($1, $2)
		ON CONFLICT (player_id) DO UPDATE SET display_name = EXCLUDED.display_name
	`, userID, displayName)
	return err
}

func findStoredSettlement(ctx context.Context, tx *sql.Tx, matchID string) (*MatchSettlement, error) {
	var stored []byte
	err := tx.QueryRowContext(ctx, `SELECT settlement FROM match_settlements WHERE match_id = $1`, matchID).Scan(&stored)
	if errors.Is(err, sql.ErrNoRows) {
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

func (s *Store) persistSettlement(ctx context.Context, tx *sql.Tx, career PlayerCareer, status string, stats MatchStats, matchID string) (MatchSettlement, error) {
	settlement := SettleMatch(career, status, stats, matchID, nowMillis())
	if err := persistCareer(ctx, tx, settlement.NewCareer); err != nil {
		return MatchSettlement{}, err
	}
	if err := insertLedgerEntries(ctx, tx, settlement.LedgerEntries); err != nil {
		return MatchSettlement{}, err
	}
	payload, _ := json.Marshal(settlement)
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO match_settlements (match_id, player_id, status, settlement)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (match_id) DO NOTHING
	`, matchID, career.PlayerID, status, payload); err != nil {
		return MatchSettlement{}, err
	}
	if err := s.advanceDailyProgress(ctx, tx, career.PlayerID, status, stats, s.nowFn()); err != nil {
		return MatchSettlement{}, err
	}
	return settlement, nil
}

// SettleMatch settles a match whose status and stats were produced by a
// server-authoritative simulation (live match handler).
func (s *Store) SettleMatch(ctx context.Context, userID, status string, stats MatchStats, matchID string) (MatchSettlement, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return MatchSettlement{}, err
	}
	defer tx.Rollback()

	if existing, err := findStoredSettlement(ctx, tx, matchID); err != nil {
		return MatchSettlement{}, err
	} else if existing != nil {
		return *existing, nil
	}

	career, err := getCareerForUpdate(ctx, tx, userID)
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

	settlement, err := s.persistSettlement(ctx, tx, career, status, stats, matchID)
	if err != nil {
		return MatchSettlement{}, err
	}
	if err := tx.Commit(); err != nil {
		return MatchSettlement{}, err
	}
	return settlement, nil
}

// SettleMatchVerified settles a single-player bot match by replaying the
// recorded player actions through the authoritative simulation. The client
// supplies only dispatch intents; status, stats, and rewards are derived
// server-side and cannot be forged.
func (s *Store) SettleMatchVerified(ctx context.Context, userID, matchID string, actions []PvpAction) (MatchSettlement, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return MatchSettlement{}, err
	}
	defer tx.Rollback()

	if existing, err := findStoredSettlement(ctx, tx, matchID); err != nil {
		return MatchSettlement{}, err
	} else if existing != nil {
		return *existing, nil
	}

	career, err := getCareerForUpdate(ctx, tx, userID)
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
	settlement, err := s.persistSettlement(ctx, tx, career, summary.Status, summary.Stats, matchID)
	if err != nil {
		return MatchSettlement{}, err
	}
	if err := tx.Commit(); err != nil {
		return MatchSettlement{}, err
	}
	return settlement, nil
}

func (s *Store) PurchaseUpgrade(ctx context.Context, userID string, upgrade UpgradeType, purchaseID string) (UpgradePurchaseResult, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return UpgradePurchaseResult{}, err
	}
	defer tx.Rollback()

	if existing, err := findStoredUpgradePurchase(ctx, tx, userID, upgrade, purchaseID); err != nil {
		return UpgradePurchaseResult{}, err
	} else if existing != nil {
		return *existing, nil
	}

	career, err := getCareerForUpdate(ctx, tx, userID)
	if err != nil {
		return UpgradePurchaseResult{}, err
	}
	// A concurrent request may have committed while this transaction waited
	// for the player's row lock.
	if existing, err := findStoredUpgradePurchase(ctx, tx, userID, upgrade, purchaseID); err != nil {
		return UpgradePurchaseResult{}, err
	} else if existing != nil {
		return *existing, nil
	}
	result := PurchaseUpgrade(career, upgrade, purchaseID, nowMillis())
	if !result.Success {
		return result, nil
	}
	payload, _ := json.Marshal(result)
	var claimedPurchaseID string
	err = tx.QueryRowContext(ctx, `
		INSERT INTO upgrade_purchases (purchase_id, player_id, upgrade_type, result)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (purchase_id) DO NOTHING
		RETURNING purchase_id
	`, purchaseID, userID, upgrade, payload).Scan(&claimedPurchaseID)
	if errors.Is(err, sql.ErrNoRows) {
		existing, readErr := findStoredUpgradePurchase(ctx, tx, userID, upgrade, purchaseID)
		if readErr != nil {
			return UpgradePurchaseResult{}, readErr
		}
		if existing == nil {
			return UpgradePurchaseResult{}, errors.New("upgrade_purchase_claim_lost")
		}
		return *existing, nil
	}
	if err != nil {
		return UpgradePurchaseResult{}, err
	}
	if err := persistCareer(ctx, tx, result.NewCareer); err != nil {
		return UpgradePurchaseResult{}, err
	}
	if result.LedgerEntry != nil {
		if err := insertLedgerEntries(ctx, tx, []EconomyLedgerEntry{*result.LedgerEntry}); err != nil {
			return UpgradePurchaseResult{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return UpgradePurchaseResult{}, err
	}
	return result, nil
}

func findStoredUpgradePurchase(ctx context.Context, tx *sql.Tx, userID string, upgrade UpgradeType, purchaseID string) (*UpgradePurchaseResult, error) {
	var storedUserID string
	var storedUpgrade UpgradeType
	var stored []byte
	err := tx.QueryRowContext(ctx, `
		SELECT player_id, upgrade_type, result
		FROM upgrade_purchases WHERE purchase_id = $1
	`, purchaseID).Scan(&storedUserID, &storedUpgrade, &stored)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if storedUserID != userID {
		return nil, ErrUpgradePurchaseOwnership
	}
	if storedUpgrade != upgrade {
		return nil, ErrUpgradePurchaseMismatch
	}
	var result UpgradePurchaseResult
	if json.Unmarshal(stored, &result) != nil {
		return nil, errors.New("invalid_stored_upgrade_result")
	}
	return &result, nil
}

func (s *Store) PublishDefense(ctx context.Context, userID, displayName string, career PlayerCareer, publishedAt int64) (PvpDefenseSnapshot, error) {
	if len(displayName) > 40 {
		displayName = displayName[:40]
	}
	if displayName == "" {
		displayName = userID
	}
	snapshot := PvpDefenseSnapshot{
		PlayerID: userID, DisplayName: displayName, Trophies: career.Trophies,
		MatchesWon: career.MatchesWon, Modifiers: UpgradeModifiers(career), PublishedAt: publishedAt,
	}
	modifiers, _ := json.Marshal(snapshot.Modifiers)
	_, err := s.db.ExecContext(ctx, `
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
	`, userID, displayName, snapshot.Trophies, snapshot.MatchesWon, modifiers, publishedAt)
	return snapshot, err
}

func (s *Store) GetPvpOpponents(ctx context.Context, userID string, trophies, limit int) ([]PvpOpponent, error) {
	rows, err := s.db.QueryContext(ctx, `
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
	`, userID, trophies, limit)
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

func (s *Store) GetPvpHistory(ctx context.Context, userID string, limit int) ([]PvpAttackHistoryEntry, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT a.attack_id, a.attacker_id, a.defender_id,
		       a.summary->>'status', a.is_revenge,
		       (a.summary->>'durationSeconds')::integer, a.created_at,
		       COALESCE(defender_name.display_name, a.defender_id),
		       COALESCE(attacker_name.display_name, a.attacker_id)
		FROM pvp_attacks a
		LEFT JOIN player_names defender_name ON defender_name.player_id = a.defender_id
		LEFT JOIN player_names attacker_name ON attacker_name.player_id = a.attacker_id
		WHERE a.attacker_id = $1 OR a.defender_id = $1
		ORDER BY a.created_at DESC
		LIMIT $2
	`, userID, limit)
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
		if entry.AttackerID == userID {
			entry.OpponentName = defenderName
		} else {
			entry.OpponentName = attackerName
		}
		history = append(history, entry)
	}
	return history, rows.Err()
}

func (s *Store) SettlePvpAttack(ctx context.Context, attackerID, defenderID, attackID string, actions []PvpAction) (PvpAttackResult, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return PvpAttackResult{}, err
	}
	defer tx.Rollback()

	var existingAttacker string
	var existingDefender string
	var existingRevenge bool
	var existingSummary, existingSettlement []byte
	err = tx.QueryRowContext(ctx, `
		SELECT attacker_id, defender_id, is_revenge, summary, settlement
		FROM pvp_attacks WHERE attack_id = $1
	`, attackID).Scan(&existingAttacker, &existingDefender, &existingRevenge, &existingSummary, &existingSettlement)
	if err == nil {
		if existingAttacker != attackerID {
			return PvpAttackResult{}, ErrPvpAttackOwnership
		}
		var summary PvpBattleSummary
		var settlement MatchSettlement
		if json.Unmarshal(existingSummary, &summary) != nil || json.Unmarshal(existingSettlement, &settlement) != nil {
			return PvpAttackResult{}, errors.New("invalid_stored_pvp_result")
		}
		return PvpAttackResult{
			AttackID: attackID, AttackerID: existingAttacker, DefenderID: existingDefender,
			IsRevenge: existingRevenge, Summary: summary, Settlement: settlement,
		}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PvpAttackResult{}, err
	}
	if attackerID == defenderID {
		return PvpAttackResult{}, ErrPvpSelfAttack
	}

	attackerCareer, err := getCareerForUpdate(ctx, tx, attackerID)
	if err != nil {
		return PvpAttackResult{}, err
	}
	// A concurrent request may have committed while this transaction waited
	// for the attacker's row lock.
	err = tx.QueryRowContext(ctx, `
		SELECT attacker_id, defender_id, is_revenge, summary, settlement
		FROM pvp_attacks WHERE attack_id = $1
	`, attackID).Scan(&existingAttacker, &existingDefender, &existingRevenge, &existingSummary, &existingSettlement)
	if err == nil {
		if existingAttacker != attackerID {
			return PvpAttackResult{}, ErrPvpAttackOwnership
		}
		var summary PvpBattleSummary
		var settlement MatchSettlement
		if json.Unmarshal(existingSummary, &summary) != nil || json.Unmarshal(existingSettlement, &settlement) != nil {
			return PvpAttackResult{}, errors.New("invalid_stored_pvp_result")
		}
		return PvpAttackResult{
			AttackID: attackID, AttackerID: existingAttacker, DefenderID: existingDefender,
			IsRevenge: existingRevenge, Summary: summary, Settlement: settlement,
		}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PvpAttackResult{}, err
	}
	var defenseID, displayName string
	var trophies, matchesWon int
	var modifiersJSON []byte
	var publishedAt int64
	err = tx.QueryRowContext(ctx, `
		SELECT player_id, display_name, trophies, matches_won, modifiers, published_at
		FROM pvp_defenses WHERE player_id = $1 FOR SHARE
	`, defenderID).Scan(&defenseID, &displayName, &trophies, &matchesWon, &modifiersJSON, &publishedAt)
	if errors.Is(err, sql.ErrNoRows) {
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
	if err := tx.QueryRowContext(ctx, `
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
	if err := persistCareer(ctx, tx, settlement.NewCareer); err != nil {
		return PvpAttackResult{}, err
	}
	if err := insertLedgerEntries(ctx, tx, settlement.LedgerEntries); err != nil {
		return PvpAttackResult{}, err
	}
	actionJSON, _ := json.Marshal(actions)
	summaryJSON, _ := json.Marshal(summary)
	settlementJSON, _ := json.Marshal(settlement)
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO pvp_attacks
			(attack_id, attacker_id, defender_id, is_revenge, actions, summary, settlement, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, attackID, attackerID, defenderID, isRevenge, actionJSON, summaryJSON, settlementJSON, settlement.NewCareer.LastMatchTimestamp); err != nil {
		return PvpAttackResult{}, err
	}
	if err := s.advanceDailyProgress(ctx, tx, attackerID, summary.Status, summary.Stats, s.nowFn()); err != nil {
		return PvpAttackResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return PvpAttackResult{}, err
	}
	return result, nil
}

func (s *Store) InsertAnalyticsEvents(ctx context.Context, userID string, events []AnalyticsEventRecord) (AnalyticsInsertResult, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return AnalyticsInsertResult{}, err
	}
	defer tx.Rollback()

	result := AnalyticsInsertResult{}
	for _, event := range events {
		normalized, err := normalizeAnalyticsEvent(ctx, tx, userID, event)
		if err != nil {
			return AnalyticsInsertResult{}, err
		}
		encoded, err := json.Marshal(normalized.Props)
		if err != nil {
			return AnalyticsInsertResult{}, err
		}
		execution, err := tx.ExecContext(ctx, `
			INSERT INTO analytics_events
				(player_id, event_id, session_id, name, occurred_at, schema_version, props)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (player_id, event_id) DO NOTHING
		`, userID, normalized.EventID, normalized.SessionID, normalized.Name, normalized.OccurredAt, normalized.SchemaVersion, encoded)
		if err != nil {
			return AnalyticsInsertResult{}, err
		}
		inserted, err := execution.RowsAffected()
		if err != nil {
			return AnalyticsInsertResult{}, err
		}
		result.Inserted += int(inserted)
	}
	if err := tx.Commit(); err != nil {
		return AnalyticsInsertResult{}, err
	}
	return result, nil
}

func normalizeAnalyticsEvent(ctx context.Context, tx *sql.Tx, userID string, event AnalyticsEventRecord) (AnalyticsEventRecord, error) {
	switch event.Name {
	case "match_end", "match_reward_received":
		matchID, _ := event.Props["matchId"].(string)
		mode, _ := event.Props["mode"].(string)
		var encoded []byte
		if err := tx.QueryRowContext(ctx, `
			SELECT settlement FROM match_settlements
			WHERE match_id = $1 AND player_id = $2
		`, matchID, userID).Scan(&encoded); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return AnalyticsEventRecord{}, errors.New("analytics_settlement_not_found")
			}
			return AnalyticsEventRecord{}, err
		}
		var settlement MatchSettlement
		if err := json.Unmarshal(encoded, &settlement); err != nil {
			return AnalyticsEventRecord{}, errors.New("invalid_stored_settlement")
		}
		if event.Name == "match_end" {
			event.Props = map[string]any{
				"matchId": matchID, "mode": mode, "result": settlement.Status,
				"durationSeconds": settlement.Stats.MatchDurationSeconds,
			}
		} else {
			event.Props = map[string]any{
				"matchId":           matchID,
				"mode":              mode,
				"baseCoins":         settlement.Breakdown.BaseCoins,
				"speedBonus":        settlement.Breakdown.SpeedBonus,
				"dominationBonus":   settlement.Breakdown.DominationBonus,
				"streakBonus":       settlement.Breakdown.StreakBonus,
				"treasuryBonus":     settlement.Breakdown.TreasuryBonus,
				"totalCoins":        settlement.Breakdown.TotalCoins,
				"trophyDelta":       settlement.Breakdown.TrophyDelta,
				"resultingCoins":    settlement.NewCareer.Coins,
				"resultingTrophies": settlement.NewCareer.Trophies,
			}
		}
	case "upgrade_purchase_succeeded":
		purchaseID, _ := event.Props["purchaseId"].(string)
		var upgradeType UpgradeType
		var encoded []byte
		if err := tx.QueryRowContext(ctx, `
			SELECT upgrade_type, result FROM upgrade_purchases
			WHERE purchase_id = $1 AND player_id = $2
		`, purchaseID, userID).Scan(&upgradeType, &encoded); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return AnalyticsEventRecord{}, errors.New("analytics_purchase_not_found")
			}
			return AnalyticsEventRecord{}, err
		}
		var result UpgradePurchaseResult
		if err := json.Unmarshal(encoded, &result); err != nil || !result.Success || result.Cost == nil {
			return AnalyticsEventRecord{}, errors.New("invalid_stored_upgrade_result")
		}
		event.Props = map[string]any{
			"purchaseId":     purchaseID,
			"upgradeType":    string(upgradeType),
			"level":          UpgradeLevel(result.NewCareer, upgradeType),
			"cost":           *result.Cost,
			"resultingCoins": result.NewCareer.Coins,
			"kingdomLevel":   KingdomLevel(result.NewCareer),
			"kingdomTierId":  KingdomTierID(KingdomLevel(result.NewCareer)),
		}
	case "daily_reward_claimed":
		claimID, _ := event.Props["claimId"].(string)
		var encoded []byte
		if err := tx.QueryRowContext(ctx, `
			SELECT result FROM daily_reward_claims
			WHERE claim_id = $1 AND player_id = $2
		`, claimID, userID).Scan(&encoded); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return AnalyticsEventRecord{}, errors.New("analytics_daily_claim_not_found")
			}
			return AnalyticsEventRecord{}, err
		}
		var result DailyClaimResult
		if err := json.Unmarshal(encoded, &result); err != nil || !result.Success {
			return AnalyticsEventRecord{}, errors.New("invalid_stored_daily_claim")
		}
		event.Props = map[string]any{
			"claimId": claimID, "rewardType": string(result.RewardType),
			"reward": result.Reward, "resultingCoins": result.NewCareer.Coins,
		}
	case "league_reward_claimed":
		claimID, _ := event.Props["claimId"].(string)
		var encoded []byte
		if err := tx.QueryRowContext(ctx, `
			SELECT result FROM league_reward_claims
			WHERE claim_id = $1 AND player_id = $2
		`, claimID, userID).Scan(&encoded); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return AnalyticsEventRecord{}, errors.New("analytics_league_claim_not_found")
			}
			return AnalyticsEventRecord{}, err
		}
		var result LeagueClaimResult
		if err := json.Unmarshal(encoded, &result); err != nil || !result.Success {
			return AnalyticsEventRecord{}, errors.New("invalid_stored_league_claim")
		}
		event.Props = map[string]any{
			"claimId": claimID, "rankId": result.RankID,
			"reward": result.Reward, "resultingCoins": result.NewCareer.Coins,
		}
	case "rank_promoted":
		matchID, _ := event.Props["matchId"].(string)
		var encoded []byte
		if err := tx.QueryRowContext(ctx, `
			SELECT settlement FROM match_settlements
			WHERE match_id = $1 AND player_id = $2
		`, matchID, userID).Scan(&encoded); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return AnalyticsEventRecord{}, errors.New("analytics_settlement_not_found")
			}
			return AnalyticsEventRecord{}, err
		}
		var settlement MatchSettlement
		if err := json.Unmarshal(encoded, &settlement); err != nil || !settlement.RankPromoted {
			return AnalyticsEventRecord{}, errors.New("invalid_rank_promotion")
		}
		event.Props = map[string]any{
			"matchId": matchID, "rankId": settlement.NewRank.ID,
			"resultingTrophies": settlement.NewCareer.Trophies,
		}
	}
	return event, nil
}

func getCareerForUpdate(ctx context.Context, tx *sql.Tx, userID string) (PlayerCareer, error) {
	row := tx.QueryRowContext(ctx, `
		SELECT id, coins, gems, trophies,
		       starting_garrison_level, production_level, army_speed_level, treasury_level,
		       matches_played, matches_won, current_streak, best_streak,
		       last_match_timestamp
		FROM players WHERE id = $1 FOR UPDATE
	`, userID)
	var value playerRow
	if err := row.Scan(
		&value.ID, &value.Coins, &value.Gems, &value.Trophies,
		&value.StartingGarrisonLevel, &value.ProductionLevel, &value.ArmySpeedLevel, &value.TreasuryLevel,
		&value.MatchesPlayed, &value.MatchesWon, &value.CurrentStreak, &value.BestStreak,
		&value.LastMatchTimestamp,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return PlayerCareer{}, fmt.Errorf("%w:%s", ErrPlayerNotFound, userID)
		}
		return PlayerCareer{}, err
	}
	return careerFromRow(value), nil
}

func persistCareer(ctx context.Context, tx *sql.Tx, career PlayerCareer) error {
	_, err := tx.ExecContext(ctx, `
		UPDATE players SET
			coins = $2, gems = $3, trophies = $4,
			starting_garrison_level = $5, production_level = $6, army_speed_level = $7, treasury_level = $8,
			matches_played = $9, matches_won = $10, current_streak = $11, best_streak = $12,
			last_match_timestamp = $13, updated_at = now()
		WHERE id = $1
	`, career.PlayerID, career.Coins, career.Gems, career.Trophies,
		career.StartingGarrisonLevel, career.ProductionLevel, career.ArmySpeedLevel, career.TreasuryLevel,
		career.MatchesPlayed, career.MatchesWon, career.CurrentStreak, career.BestStreak,
		career.LastMatchTimestamp)
	return err
}

func insertLedgerEntries(ctx context.Context, tx *sql.Tx, entries []EconomyLedgerEntry) error {
	for _, entry := range entries {
		if _, err := tx.ExecContext(ctx, `
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

func nowMillis() int64 {
	return time.Now().UnixMilli()
}

// submitTrophies pushes the settled trophy balance to the Nakama leaderboard.
func submitTrophies(ctx context.Context, nk runtime.NakamaModule, userID string, trophies int64) {
	if _, err := nk.LeaderboardRecordWrite(ctx, "trophies", userID, "", trophies, 0, nil, nil); err != nil {
		// Leaderboard is a projection; settlement already succeeded.
		_ = err
	}
}
