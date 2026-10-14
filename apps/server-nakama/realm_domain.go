package main

import (
	"errors"
	"math"
)

const realmConfigVersion = 1
const realmTicketLifetimeMs int64 = 15 * 60 * 1000
const realmChallengeLifetimeMs int64 = 7 * 24 * 60 * 60 * 1000

type RealmDefense struct {
	ChallengeRewardEligible *bool  `json:"challengeRewardEligible,omitempty"`
	PlayerID                string `json:"playerId"`
	DisplayName             string `json:"displayName"`
	Version                 string `json:"version"`
	KingdomLevel            int    `json:"kingdomLevel"`
	KingdomTierID           string `json:"kingdomTierId"`
	Trophies                int    `json:"trophies"`
	CommanderID             string `json:"commanderId"`
	Levels                  [3]int `json:"levels"`
}
type RealmTicket struct {
	RewardTreasuryLevel  int                    `json:"rewardTreasuryLevel"`
	MatchID              string                 `json:"matchId"`
	Source               string                 `json:"source"`
	CombatPolicy         string                 `json:"combatPolicy"`
	BattlefieldID        string                 `json:"battlefieldId"`
	GameplayRulesVersion int                    `json:"gameplayRulesVersion"`
	ConfigVersion        int                    `json:"configVersion"`
	Defender             RealmDefense           `json:"defender"`
	PlayerModifiers      PlayerUpgradeModifiers `json:"playerModifiers"`
	EnemyModifiers       PlayerUpgradeModifiers `json:"enemyModifiers"`
	EffectiveLevels      [3]int                 `json:"effectiveLevels"`
	CreatedAt            int64                  `json:"createdAt"`
	ExpiresAt            int64                  `json:"expiresAt"`
	RewardEligible       bool                   `json:"rewardEligible"`
	OriginID             string                 `json:"originId,omitempty"`
}
type RealmResult struct {
	Ticket     RealmTicket     `json:"ticket"`
	Settlement MatchSettlement `json:"settlement"`
	Rewarded   bool            `json:"rewarded"`
}
type RealmHistory struct {
	MatchID          string `json:"matchId"`
	Incoming         bool   `json:"incoming"`
	OpponentName     string `json:"opponentName"`
	Status           string `json:"status"`
	CreatedAt        int64  `json:"createdAt"`
	RevengeAvailable bool   `json:"revengeAvailable"`
	CombatPolicy     string `json:"combatPolicy"`
}
type CoinProduct struct {
	ID          string `json:"id"`
	Coins       int    `json:"coins"`
	AmountRials int    `json:"amountRials"`
	Once        bool   `json:"once"`
}

var pilotCoinProducts = []CoinProduct{
	{ID: "starter", Coins: 750, AmountRials: 190000, Once: true},
	{ID: "refill", Coins: 1500, AmountRials: 490000},
}

type CoinOrder struct {
	ID        string      `json:"id"`
	Product   CoinProduct `json:"product"`
	State     string      `json:"state"`
	Invoice   string      `json:"invoice"`
	CreatedAt int64       `json:"createdAt"`
}

func combatLevels(c PlayerCareer) [3]int {
	return [3]int{c.StartingGarrisonLevel, c.ProductionLevel, c.ArmySpeedLevel}
}
func realmModifiers(levels, opponent [3]int, commander, policy string) ([3]int, PlayerUpgradeModifiers) {
	var effective [3]int
	if policy != "equal" {
		for i := range effective {
			effective[i] = minInt(minInt(20, maxInt(0, levels[i])), minInt(20, maxInt(0, opponent[i]))+2)
		}
	}
	m := PlayerUpgradeModifiers{StartingUnits: 20 + effective[0], ProductionRateMultiplier: 1 + float64(effective[1])*.02, ArmySpeedMultiplier: 1 + float64(effective[2])*.015}
	switch commander {
	case "quartermaster":
		m.ProductionRateMultiplier *= 1.15
		m.ArmySpeedMultiplier *= .9
	case "vanguard":
		m.StartingUnits -= 3
		m.ArmySpeedMultiplier *= 1.15
	}
	m.ProductionRateMultiplier = math.Round(m.ProductionRateMultiplier*1000) / 1000
	m.ArmySpeedMultiplier = math.Round(m.ArmySpeedMultiplier*1000) / 1000
	return effective, m
}
func realmSettlement(c PlayerCareer, status string, stats MatchStats, id string, at int64, source string, eligible bool) MatchSettlement {
	policy := CasualPolicy
	if source == "ranked" && eligible {
		policy = RankedPolicy
	}
	base := c
	if source != "ranked" {
		base.CurrentStreak = 0
	}
	s := SettleMatchWithPolicy(base, status, stats, id, at, policy)
	s.PreviousCareer = c
	if source != "ranked" {
		s.NewCareer.CurrentStreak = c.CurrentStreak
		s.NewCareer.BestStreak = c.BestStreak
	}
	coins := s.Breakdown.TotalCoins
	if source != "ranked" {
		coins = 20
		s.Breakdown = MatchRewardBreakdown{BaseCoins: 20, TotalCoins: 20}
	}
	if !eligible {
		coins = 0
		s.Breakdown = MatchRewardBreakdown{}
		s.NewCareer.Trophies = c.Trophies
		s.NewCareer.CurrentStreak = c.CurrentStreak
		s.NewCareer.BestStreak = c.BestStreak
		s.RankPromoted = false
	}
	s.NewCareer.Coins = c.Coins + coins
	entries := []EconomyLedgerEntry{}
	if coins > 0 {
		entries = append(entries, EconomyLedgerEntry{ID: id + "_coins", Player: c.PlayerID, Currency: "coins", Amount: coins, Reason: "realm_reward", Source: "battle_settlement", PreviousBalance: c.Coins, ResultingBalance: s.NewCareer.Coins, Timestamp: at})
	}
	for _, e := range s.LedgerEntries {
		if e.Currency == "trophies" && source == "ranked" && eligible {
			entries = append(entries, e)
		}
	}
	s.LedgerEntries = entries
	return s
}
func validateRealmSource(source string) error {
	if source != "ranked" && source != "friend" && source != "revenge" {
		return errors.New("invalid_realm_source")
	}
	return nil
}
