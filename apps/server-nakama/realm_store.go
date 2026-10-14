package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"time"
)

func realmID(prefix string) (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(b), nil
}
func realmDay(now time.Time) (int64, int64) {
	loc, err := time.LoadLocation("Asia/Tehran")
	if err != nil {
		loc = time.FixedZone("Asia/Tehran", 12600)
	}
	d := now.In(loc)
	start := time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, loc)
	return start.UnixMilli(), start.AddDate(0, 0, 1).UnixMilli()
}
func realmDefense(ctx context.Context, tx *sql.Tx, c PlayerCareer) (RealmDefense, error) {
	var name string
	err := tx.QueryRowContext(ctx, `SELECT display_name FROM player_names WHERE player_id=$1`, c.PlayerID).Scan(&name)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return RealmDefense{}, err
	}
	if name == "" {
		name = "فرمانده"
	}
	r := []rune(name)
	if len(r) > 40 {
		name = string(r[:40])
	}
	d := RealmDefense{PlayerID: c.PlayerID, DisplayName: name, KingdomLevel: KingdomLevel(c), KingdomTierID: KingdomTierID(KingdomLevel(c)), Trophies: c.Trophies, CommanderID: c.SelectedCommanderID, Levels: combatLevels(c)}
	raw, err := json.Marshal(d)
	if err != nil {
		return d, err
	}
	hash := sha256.Sum256(raw)
	d.Version = hex.EncodeToString(hash[:12])
	raw, _ = json.Marshal(d)
	return d, nil
}
func publishRealmDefense(ctx context.Context, tx *sql.Tx, c PlayerCareer) (RealmDefense, error) {
	d, err := realmDefense(ctx, tx, c)
	if err != nil {
		return d, err
	}
	raw, err := json.Marshal(d)
	if err != nil {
		return d, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO realm_defenses(player_id,document) VALUES($1,$2) ON CONFLICT(player_id) DO UPDATE SET document=EXCLUDED.document,updated_at=now()`, c.PlayerID, raw)
	return d, err
}
func readRealmTicket(ctx context.Context, tx *sql.Tx, user, id string) (RealmTicket, string, *RealmResult, error) {
	var owner, state string
	var raw, result []byte
	err := tx.QueryRowContext(ctx, `SELECT player_id,state,document,result FROM realm_tickets WHERE id=$1 FOR UPDATE`, id).Scan(&owner, &state, &raw, &result)
	if errors.Is(err, sql.ErrNoRows) {
		return RealmTicket{}, "", nil, errors.New("realm_ticket_not_found")
	}
	if err != nil {
		return RealmTicket{}, "", nil, err
	}
	if owner != user {
		return RealmTicket{}, "", nil, errors.New("realm_ticket_ownership")
	}
	var t RealmTicket
	if err = json.Unmarshal(raw, &t); err != nil {
		return t, "", nil, err
	}
	var res *RealmResult
	if len(result) > 0 {
		res = &RealmResult{}
		if err = json.Unmarshal(result, res); err != nil {
			return t, "", nil, err
		}
	}
	return t, state, res, nil
}
func (s *Store) realmEligibility(ctx context.Context, tx *sql.Tx, user, defender, source string) (bool, error) {
	lo, hi := realmDay(s.nowFn())
	var pairs, quota int
	err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM realm_tickets WHERE player_id=$1 AND defender_id=$2 AND rewarded AND settled_at >= $3 AND settled_at < $4`, user, defender, lo, hi).Scan(&pairs)
	if err != nil {
		return false, err
	}
	if pairs > 0 {
		return false, nil
	}
	if source != "ranked" {
		err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM realm_tickets WHERE player_id=$1 AND source<>'ranked' AND rewarded AND settled_at >= $2 AND settled_at < $3`, user, lo, hi).Scan(&quota)
		if err != nil {
			return false, err
		}
		if quota >= 3 {
			return false, nil
		}
	}
	return true, nil
}
func persistRealmResult(ctx context.Context, tx *sql.Tx, user string, result RealmResult, actions []PvpAction, state string) error {
	s := result.Settlement
	if err := persistCareer(ctx, tx, s.NewCareer); err != nil {
		return err
	}
	if err := insertLedgerEntries(ctx, tx, s.LedgerEntries); err != nil {
		return err
	}
	raw, err := json.Marshal(s)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO match_settlements(match_id,player_id,status,settlement) VALUES($1,$2,$3,$4)`, s.MatchID, user, s.Status, raw); err != nil {
		return err
	}
	raw, err = json.Marshal(result)
	if err != nil {
		return err
	}
	actionJSON, err := json.Marshal(actions)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE realm_tickets SET state=$2,result=$3,actions=$4,rewarded=$5,settled_at=$6 WHERE id=$1`, s.MatchID, state, raw, actionJSON, result.Rewarded, s.NewCareer.LastMatchTimestamp)
	return err
}
func (s *Store) abandonRealmInTx(ctx context.Context, tx *sql.Tx, c PlayerCareer, t RealmTicket) (PlayerCareer, error) {
	settlement := realmSettlement(c, "defeat", MatchStats{}, t.MatchID, s.nowFn().UnixMilli(), t.Source, false)
	settlement.NewCareer.MatchesPlayed = c.MatchesPlayed
	settlement.NewCareer.MatchesWon = c.MatchesWon
	if t.Source == "ranked" {
		delta := -minInt(12, c.Trophies)
		settlement.NewCareer.Trophies = c.Trophies + delta
		settlement.NewRank = GetRankTier(settlement.NewCareer.Trophies)
		settlement.Breakdown.TrophyDelta = delta
		if delta != 0 {
			settlement.LedgerEntries = append(settlement.LedgerEntries, EconomyLedgerEntry{ID: t.MatchID + "_trophies", Player: c.PlayerID, Currency: "trophies", Amount: delta, Reason: "realm_abandoned", Source: "battle_settlement", PreviousBalance: c.Trophies, ResultingBalance: settlement.NewCareer.Trophies, Timestamp: s.nowFn().UnixMilli()})
		}
	}
	err := persistRealmResult(ctx, tx, c.PlayerID, RealmResult{Ticket: t, Settlement: settlement}, []PvpAction{}, "abandoned")
	return settlement.NewCareer, err
}
func (s *Store) expireRealmActive(ctx context.Context, tx *sql.Tx, c PlayerCareer) (PlayerCareer, *RealmTicket, error) {
	var raw []byte
	err := tx.QueryRowContext(ctx, `SELECT document FROM realm_tickets WHERE player_id=$1 AND state='active' FOR UPDATE`, c.PlayerID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return c, nil, nil
	}
	if err != nil {
		return c, nil, err
	}
	var t RealmTicket
	if err = json.Unmarshal(raw, &t); err != nil {
		return c, nil, err
	}
	if t.ExpiresAt > s.nowFn().UnixMilli() {
		return c, &t, nil
	}
	c, err = s.abandonRealmInTx(ctx, tx, c, t)
	return c, nil, err
}

type RealmHome struct {
	Defense                RealmDefense    `json:"defense"`
	Goal                   string          `json:"goal"`
	History                []RealmHistory  `json:"history"`
	ActivePractice         *BotMatchTicket `json:"activePractice,omitempty"`
	ActiveTicket           *RealmTicket    `json:"activeTicket,omitempty"`
	SocialRewardsRemaining int             `json:"socialRewardsRemaining"`
}

func (s *Store) RealmHome(ctx context.Context, user string) (RealmHome, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return RealmHome{}, err
	}
	defer tx.Rollback()
	c, err := realmCareerForUpdate(ctx, tx, user)
	if err != nil {
		return RealmHome{}, err
	}
	if !c.TutorialCompleted {
		return RealmHome{}, errors.New("tutorial_required")
	}
	c, active, err := s.expireRealmActive(ctx, tx, c)
	if err != nil {
		return RealmHome{}, err
	}
	d, err := publishRealmDefense(ctx, tx, c)
	if err != nil {
		return RealmHome{}, err
	}
	practice, err := s.activePilotPractice(ctx, tx, user)
	if err != nil {
		return RealmHome{}, err
	}
	h := RealmHome{Defense: d, Goal: "starting_garrison", History: []RealmHistory{}, ActiveTicket: active}
	if practice != nil {
		h.ActivePractice = &practice.Ticket
	}
	err = tx.QueryRowContext(ctx, `SELECT upgrade_type FROM realm_goals WHERE player_id=$1`, user).Scan(&h.Goal)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return h, err
	}
	lo, hi := realmDay(s.nowFn())
	var count int
	err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM realm_tickets WHERE player_id=$1 AND source<>'ranked' AND rewarded AND settled_at>=$2 AND settled_at<$3`, user, lo, hi).Scan(&count)
	if err != nil {
		return h, err
	}
	h.SocialRewardsRemaining = maxInt(0, 3-count)
	rows, err := tx.QueryContext(ctx, `SELECT t.id,t.player_id,t.document,t.result,t.settled_at,COALESCE(n.display_name,'فرمانده'),
 EXISTS(SELECT 1 FROM realm_tickets revenge WHERE revenge.player_id=$1 AND revenge.origin_id=t.id)
 FROM realm_tickets t LEFT JOIN player_names n ON n.player_id=CASE WHEN t.player_id=$1 THEN t.defender_id ELSE t.player_id END
 WHERE t.state='settled' AND (t.player_id=$1 OR t.defender_id=$1) ORDER BY t.settled_at DESC LIMIT 20`, user)
	if err != nil {
		return h, err
	}
	for rows.Next() {
		var id, attacker, name string
		var raw, res []byte
		var at int64
		var used bool
		if err = rows.Scan(&id, &attacker, &raw, &res, &at, &name, &used); err != nil {
			rows.Close()
			return h, err
		}
		var t RealmTicket
		var result RealmResult
		if err = json.Unmarshal(raw, &t); err != nil {
			rows.Close()
			return h, err
		}
		if err = json.Unmarshal(res, &result); err != nil {
			rows.Close()
			return h, err
		}
		h.History = append(h.History, RealmHistory{MatchID: id, Incoming: attacker != user, OpponentName: name, Status: result.Settlement.Status, CreatedAt: at, RevengeAvailable: attacker != user && !used && at+realmChallengeLifetimeMs > s.nowFn().UnixMilli(), CombatPolicy: t.CombatPolicy})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return h, err
	}
	return h, tx.Commit()
}
func (s *Store) CreateRealmChallenge(ctx context.Context, user string) (string, int64, error) {
	return s.CreateRealmChallengeWithCommander(ctx, user, "")
}
func (s *Store) CreateRealmChallengeWithCommander(ctx context.Context, user, commander string) (string, int64, error) {
	if commander != "" {
		if _, ok := CommanderUnlockLevel(commander); !ok {
			return "", 0, ErrCommanderInvalid
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", 0, err
	}
	defer tx.Rollback()
	c, err := realmCareerForUpdate(ctx, tx, user)
	if err != nil {
		return "", 0, err
	}
	if !c.TutorialCompleted {
		return "", 0, errors.New("tutorial_required")
	}
	if _, err = publishRealmDefense(ctx, tx, c); err != nil {
		return "", 0, err
	}
	if commander == "" {
		commander = c.SelectedCommanderID
	}
	var token string
	var expires int64
	err = tx.QueryRowContext(ctx, `SELECT token,expires_at FROM realm_challenges WHERE player_id=$1 AND expires_at>$2 ORDER BY expires_at DESC LIMIT 1`, user, s.nowFn().UnixMilli()).Scan(&token, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		token, err = realmID("c_")
		if err != nil {
			return "", 0, err
		}
		expires = s.nowFn().UnixMilli() + realmChallengeLifetimeMs
		_, err = tx.ExecContext(ctx, `INSERT INTO realm_challenges(token,player_id,expires_at,commander_id) VALUES($1,$2,$3,$4)`, token, user, expires, commander)
	}
	if err != nil {
		return "", 0, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE realm_challenges SET commander_id=$2 WHERE token=$1`, token, commander); err != nil {
		return "", 0, err
	}
	return token, expires, tx.Commit()
}
func resolveRealmChallenge(ctx context.Context, tx *sql.Tx, user, token string, now int64) (RealmDefense, error) {
	var defender, commander string
	var expires int64
	err := tx.QueryRowContext(ctx, `SELECT player_id,expires_at,COALESCE(commander_id,'') FROM realm_challenges WHERE token=$1`, token).Scan(&defender, &expires, &commander)
	if errors.Is(err, sql.ErrNoRows) {
		return RealmDefense{}, errors.New("challenge_not_found")
	}
	if err != nil {
		return RealmDefense{}, err
	}
	if expires <= now {
		return RealmDefense{}, errors.New("challenge_expired")
	}
	if defender == user {
		return RealmDefense{}, ErrPvpSelfAttack
	}
	c, err := getCareer(ctx, tx, defender)
	if err != nil {
		return RealmDefense{}, err
	}
	if commander != "" {
		c.SelectedCommanderID = commander
	}
	return realmDefense(ctx, tx, c)
}
func (s *Store) ResolveRealmChallenge(ctx context.Context, user, token string) (RealmDefense, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return RealmDefense{}, err
	}
	defer tx.Rollback()
	d, err := resolveRealmChallenge(ctx, tx, user, token, s.nowFn().UnixMilli())
	if err != nil {
		return d, err
	}
	eligible, err := s.realmEligibility(ctx, tx, user, d.PlayerID, "friend")
	if err != nil {
		return d, err
	}
	d.ChallengeRewardEligible = &eligible
	return d, tx.Commit()
}

type RealmStartRequest struct {
	Source         string `json:"source"`
	Token          string `json:"token"`
	OriginID       string `json:"originId"`
	CommanderID    string `json:"commanderId"`
	DefenseVersion string `json:"defenseVersion"`
}

func (s *Store) StartRealmAttack(ctx context.Context, user string, req RealmStartRequest) (RealmTicket, error) {
	if err := validateRealmSource(req.Source); err != nil {
		return RealmTicket{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return RealmTicket{}, err
	}
	defer tx.Rollback()
	c, err := realmCareerForUpdate(ctx, tx, user)
	if err != nil {
		return RealmTicket{}, err
	}
	if !c.TutorialCompleted {
		return RealmTicket{}, errors.New("tutorial_required")
	}
	c, active, err := s.expireRealmActive(ctx, tx, c)
	if err != nil {
		return RealmTicket{}, err
	}
	if active != nil {
		return *active, tx.Commit()
	}
	if _, err = publishRealmDefense(ctx, tx, c); err != nil {
		return RealmTicket{}, err
	}
	practice, err := s.activePilotPractice(ctx, tx, user)
	if err != nil {
		return RealmTicket{}, err
	}
	if practice != nil {
		return RealmTicket{}, errors.New("realm_practice_active")
	}
	var d RealmDefense
	policy := "bounded"
	origin := ""
	switch req.Source {
	case "friend":
		policy = "equal"
		d, err = resolveRealmChallenge(ctx, tx, user, req.Token, s.nowFn().UnixMilli())
		if err == nil && req.DefenseVersion != "" && d.Version != req.DefenseVersion {
			return RealmTicket{}, errors.New("defense_changed")
		}
	case "revenge":
		var alreadyUsed bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM realm_tickets WHERE player_id=$1 AND origin_id=$2)`, user, req.OriginID).Scan(&alreadyUsed); err != nil {
			return RealmTicket{}, err
		}
		if alreadyUsed {
			return RealmTicket{}, errors.New("revenge_unavailable")
		}
		var attacker, defender, state string
		var raw []byte
		var at int64
		err = tx.QueryRowContext(ctx, `SELECT player_id,defender_id,state,document,settled_at FROM realm_tickets WHERE id=$1`, req.OriginID).Scan(&attacker, &defender, &state, &raw, &at)
		if errors.Is(err, sql.ErrNoRows) {
			return RealmTicket{}, errors.New("revenge_unavailable")
		}
		if err == nil {
			if defender != user || state != "settled" || at+realmChallengeLifetimeMs <= s.nowFn().UnixMilli() {
				return RealmTicket{}, errors.New("revenge_unavailable")
			}
			var old RealmTicket
			if err = json.Unmarshal(raw, &old); err != nil {
				return RealmTicket{}, err
			}
			policy = old.CombatPolicy
			origin = req.OriginID
			var dc PlayerCareer
			dc, err = getCareer(ctx, tx, attacker)
			if err == nil {
				d, err = realmDefense(ctx, tx, dc)
			}
		}
	case "ranked":
		lo, hi := realmDay(s.nowFn())
		var raw []byte
		err = tx.QueryRowContext(ctx, `SELECT d.document FROM realm_defenses d JOIN players p ON p.id=d.player_id
   WHERE d.player_id<>$1 AND p.tutorial_completed AND ABS(p.trophies-$2)<=250
   AND NOT EXISTS(SELECT 1 FROM realm_tickets t WHERE ((t.player_id=$1 AND t.defender_id=d.player_id) OR (t.defender_id=$1 AND t.player_id=d.player_id)) AND t.state='settled' AND t.settled_at>=$3 AND t.settled_at<$4)
   ORDER BY ABS(p.trophies-$2),d.updated_at DESC LIMIT 1`, user, c.Trophies, lo, hi).Scan(&raw)
		if errors.Is(err, sql.ErrNoRows) {
			return RealmTicket{}, errors.New("no_realm_opponent")
		}
		if err == nil {
			err = json.Unmarshal(raw, &d)
			if err == nil {
				var dc PlayerCareer
				dc, err = getCareer(ctx, tx, d.PlayerID)
				if err == nil {
					d, err = realmDefense(ctx, tx, dc)
				}
			}
		}
	}
	if err != nil {
		return RealmTicket{}, err
	}
	commander := c.SelectedCommanderID
	if req.CommanderID != "" {
		if _, ok := CommanderUnlockLevel(req.CommanderID); !ok {
			return RealmTicket{}, ErrCommanderInvalid
		}
		if policy != "equal" {
			unlock, _ := CommanderUnlockLevel(req.CommanderID)
			if KingdomLevel(c) < unlock {
				return RealmTicket{}, ErrCommanderLocked
			}
		}
		commander = req.CommanderID
	}
	levels, pm := realmModifiers(combatLevels(c), d.Levels, commander, policy)
	_, em := realmModifiers(d.Levels, combatLevels(c), d.CommanderID, policy)
	eligible, err := s.realmEligibility(ctx, tx, user, d.PlayerID, req.Source)
	if err != nil {
		return RealmTicket{}, err
	}
	id, err := realmID("realm_")
	if err != nil {
		return RealmTicket{}, err
	}
	t := RealmTicket{RewardTreasuryLevel: c.TreasuryLevel, MatchID: id, Source: req.Source, CombatPolicy: policy, BattlefieldID: "crown_cross", GameplayRulesVersion: CurrentGameplayRulesVersion, ConfigVersion: realmConfigVersion, Defender: d, PlayerModifiers: pm, EnemyModifiers: em, EffectiveLevels: levels, CreatedAt: s.nowFn().UnixMilli(), ExpiresAt: s.nowFn().UnixMilli() + realmTicketLifetimeMs, RewardEligible: eligible, OriginID: origin}
	raw, err := json.Marshal(t)
	if err != nil {
		return t, err
	}
	var originArg any
	if origin != "" {
		originArg = origin
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO realm_tickets(id,player_id,defender_id,source,origin_id,document,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, id, user, d.PlayerID, req.Source, originArg, raw, t.CreatedAt, t.ExpiresAt)
	if err != nil {
		return t, err
	}
	return t, tx.Commit()
}
func (s *Store) SettleRealmAttack(ctx context.Context, user, id string, actions []PvpAction) (RealmResult, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return RealmResult{}, err
	}
	defer tx.Rollback()
	c, err := realmCareerForUpdate(ctx, tx, user)
	if err != nil {
		return RealmResult{}, err
	}
	t, state, existing, err := readRealmTicket(ctx, tx, user, id)
	if err != nil {
		return RealmResult{}, err
	}
	if existing != nil {
		return *existing, tx.Commit()
	}
	if state != "active" {
		return RealmResult{}, errors.New("realm_ticket_closed")
	}
	if t.ExpiresAt <= s.nowFn().UnixMilli() {
		return RealmResult{}, errors.New("realm_ticket_expired")
	}
	if len(actions) == 0 {
		return RealmResult{}, errors.New("realm_dispatch_required")
	}
	final, summary, err := simulateBattleWithRules(actions, t.PlayerModifiers, t.EnemyModifiers, t.BattlefieldID, t.GameplayRulesVersion)
	if err != nil {
		return RealmResult{}, err
	}
	if summary.ActionsProcessed == 0 {
		return RealmResult{}, errors.New("realm_dispatch_required")
	}
	if s.nowFn().UnixMilli()-t.CreatedAt < int64(math.Ceil(final.ElapsedTimeSeconds*1000)) {
		return RealmResult{}, errors.New("realm_settlement_too_early")
	}
	eligible, err := s.realmEligibility(ctx, tx, user, t.Defender.PlayerID, t.Source)
	if err != nil {
		return RealmResult{}, err
	}
	eligible = eligible && t.RewardEligible
	rewardCareer := c
	rewardCareer.TreasuryLevel = t.RewardTreasuryLevel
	settlement := realmSettlement(rewardCareer, summary.Status, summary.Stats, id, s.nowFn().UnixMilli(), t.Source, eligible)
	settlement.PreviousCareer = c
	settlement.NewCareer.TreasuryLevel = c.TreasuryLevel
	result := RealmResult{Ticket: t, Settlement: settlement, Rewarded: eligible}
	if err = persistRealmResult(ctx, tx, user, result, actions, "settled"); err != nil {
		return result, err
	}
	if eligible {
		if err = s.advanceDailyProgress(ctx, tx, user, summary.Status, summary.Stats, s.nowFn()); err != nil {
			return result, err
		}
	}
	return result, tx.Commit()
}
func (s *Store) AbandonRealmAttack(ctx context.Context, user, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	c, err := realmCareerForUpdate(ctx, tx, user)
	if err != nil {
		return err
	}
	t, state, _, err := readRealmTicket(ctx, tx, user, id)
	if err != nil {
		return err
	}
	if state == "active" {
		_, err = s.abandonRealmInTx(ctx, tx, c, t)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *Store) SetRealmGoal(ctx context.Context, user, goal string) error {
	if goal != "starting_garrison" && goal != "production" && goal != "army_speed" && goal != "treasury" {
		return errors.New("invalid_upgrade_type")
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO realm_goals(player_id,upgrade_type,viewed_at) VALUES($1,$2,$3) ON CONFLICT(player_id) DO UPDATE SET upgrade_type=$2,viewed_at=$3`, user, goal, s.nowFn().UnixMilli())
	return err
}

// Career values change, player primary keys do not. NO KEY UPDATE serializes
// economic writes while allowing a reciprocal attack to reference the defender.
func realmCareerForUpdate(ctx context.Context, tx *sql.Tx, user string) (PlayerCareer, error) {
	var id string
	if err := tx.QueryRowContext(ctx, `SELECT id FROM players WHERE id=$1 FOR NO KEY UPDATE`, user).Scan(&id); err != nil {
		return PlayerCareer{}, err
	}
	return getCareer(ctx, tx, user)
}
