package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"strings"
)

type pilotPractice struct {
	RewardTreasuryLevel int                    `json:"rewardTreasuryLevel"`
	Ticket              BotMatchTicket         `json:"ticket"`
	CreatedAt           int64                  `json:"createdAt"`
	ExpiresAt           int64                  `json:"expiresAt"`
	Modifiers           PlayerUpgradeModifiers `json:"modifiers"`
}

func (s *Store) activePilotPractice(ctx context.Context, tx *sql.Tx, user string) (*pilotPractice, error) {
	var raw []byte
	err := tx.QueryRowContext(ctx, `SELECT pilot_document FROM bot_matches WHERE player_id=$1 AND pilot_document IS NOT NULL AND settled_at IS NULL FOR UPDATE`, user).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var p pilotPractice
	if err = json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if p.ExpiresAt <= s.nowFn().UnixMilli() {
		_, err = tx.ExecContext(ctx, `UPDATE bot_matches SET settled_at=now() WHERE match_id=$1`, p.Ticket.MatchID)
		return nil, err
	}
	return &p, nil
}
func (s *Store) CreatePilotPractice(ctx context.Context, user string) (BotMatchTicket, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return BotMatchTicket{}, err
	}
	defer tx.Rollback()
	c, err := realmCareerForUpdate(ctx, tx, user)
	if err != nil {
		return BotMatchTicket{}, err
	}
	if !c.TutorialCompleted {
		return BotMatchTicket{}, errors.New("tutorial_required")
	}
	c, active, err := s.expireRealmActive(ctx, tx, c)
	if err != nil {
		return BotMatchTicket{}, err
	}
	if active != nil {
		return BotMatchTicket{}, errors.New("realm_attack_active")
	}
	old, err := s.activePilotPractice(ctx, tx, user)
	if err != nil {
		return BotMatchTicket{}, err
	}
	if old != nil {
		return old.Ticket, tx.Commit()
	}
	id, err := realmID("practice_")
	if err != nil {
		return BotMatchTicket{}, err
	}
	_, mods := realmModifiers(combatLevels(c), combatLevels(c), c.SelectedCommanderID, "bounded")
	now := s.nowFn().UnixMilli()
	ticket := BotMatchTicket{MatchID: id, BattlefieldID: "crown_cross", GameplayRulesVersion: CurrentGameplayRulesVersion, PlayerModifiers: &mods, ExpiresAt: now + realmTicketLifetimeMs}
	p := pilotPractice{RewardTreasuryLevel: c.TreasuryLevel, Ticket: ticket, CreatedAt: now, ExpiresAt: ticket.ExpiresAt, Modifiers: mods}
	raw, err := json.Marshal(p)
	if err != nil {
		return ticket, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO bot_matches(match_id,player_id,battlefield_id,gameplay_rules_version,pilot_document) VALUES($1,$2,$3,$4,$5)`, id, user, ticket.BattlefieldID, ticket.GameplayRulesVersion, raw)
	if err != nil {
		return ticket, err
	}
	return ticket, tx.Commit()
}
func (s *Store) SettlePilotPractice(ctx context.Context, user, id string, actions []PvpAction) (MatchSettlement, *BotSettlementDiagnostics, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return MatchSettlement{}, nil, err
	}
	defer tx.Rollback()
	c, err := realmCareerForUpdate(ctx, tx, user)
	if err != nil {
		return MatchSettlement{}, nil, err
	}
	var owner string
	var raw []byte
	var closed sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT player_id,pilot_document,settled_at FROM bot_matches WHERE match_id=$1 FOR UPDATE`, id).Scan(&owner, &raw, &closed)
	if err != nil {
		return MatchSettlement{}, nil, err
	}
	if owner != user {
		return MatchSettlement{}, nil, ErrBotMatchOwnership
	}
	if existing, err := findStoredSettlement(ctx, tx, id); err != nil {
		return MatchSettlement{}, nil, err
	} else if existing != nil {
		return *existing, nil, tx.Commit()
	}
	var p pilotPractice
	if err = json.Unmarshal(raw, &p); err != nil {
		return MatchSettlement{}, nil, err
	}
	if closed.Valid || p.ExpiresAt <= s.nowFn().UnixMilli() {
		return MatchSettlement{}, nil, errors.New("realm_ticket_expired")
	}
	if len(actions) == 0 {
		return MatchSettlement{}, nil, errors.New("realm_dispatch_required")
	}
	final, summary, err := simulateBattleWithRules(actions, p.Modifiers, DefaultModifiers(), p.Ticket.BattlefieldID, p.Ticket.GameplayRulesVersion)
	if err != nil {
		return MatchSettlement{}, nil, err
	}
	if summary.ActionsProcessed == 0 {
		return MatchSettlement{}, nil, errors.New("realm_dispatch_required")
	}
	if s.nowFn().UnixMilli()-p.CreatedAt < int64(math.Ceil(final.ElapsedTimeSeconds*1000)) {
		return MatchSettlement{}, nil, errors.New("realm_settlement_too_early")
	}
	rewardCareer := c
	rewardCareer.TreasuryLevel = p.RewardTreasuryLevel
	result := SettleMatchWithPolicy(rewardCareer, summary.Status, summary.Stats, id, s.nowFn().UnixMilli(), CasualPolicy)
	result.PreviousCareer = c
	result.NewCareer.TreasuryLevel = c.TreasuryLevel
	result.NewCareer.CurrentStreak = c.CurrentStreak
	result.NewCareer.BestStreak = c.BestStreak
	if err = persistCareer(ctx, tx, result.NewCareer); err != nil {
		return result, nil, err
	}
	if err = insertLedgerEntries(ctx, tx, result.LedgerEntries); err != nil {
		return result, nil, err
	}
	raw, err = json.Marshal(result)
	if err != nil {
		return result, nil, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO match_settlements(match_id,player_id,status,settlement) VALUES($1,$2,$3,$4)`, id, user, result.Status, raw); err != nil {
		return result, nil, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE bot_matches SET settled_at=now() WHERE match_id=$1`, id); err != nil {
		return result, nil, err
	}
	if err = s.advanceDailyProgress(ctx, tx, user, summary.Status, summary.Stats, s.nowFn()); err != nil {
		return result, nil, err
	}
	return result, &BotSettlementDiagnostics{BattlefieldID: p.Ticket.BattlefieldID, Modifiers: p.Modifiers, ActionsProcessed: summary.ActionsProcessed}, tx.Commit()
}
func isPilotPractice(id string) bool { return strings.HasPrefix(id, "practice_") }
