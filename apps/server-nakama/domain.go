package main

import (
	"errors"
	"math"
	"strconv"
)

const (
	PvpTimeLimitSeconds = 90.0
	PvpAITickSeconds    = 1.8
	MaxPvpActions       = 120
	baseArmyTravelSpeed = 140.0
)

var territoryOrder = []string{
	"p_base", "e_base", "n_bot_left", "n_bot_right", "n_center",
	"n_mid_left", "n_mid_right", "n_top_left", "n_top_right",
}

var ErrPvpTooManyActions = errors.New("too_many_actions")
var ErrPvpInvalidSequence = errors.New("invalid_sequence")
var ErrPvpInvalidTimestamp = errors.New("invalid_timestamp")
var ErrPvpActionAfterBattleEnd = errors.New("action_after_battle_end")
var ErrPvpInvalidSource = errors.New("invalid_source")
var ErrPvpInvalidTarget = errors.New("invalid_target")
var ErrPvpInvalidDispatch = errors.New("invalid_dispatch")

func CreateDefaultCareer(playerID string) PlayerCareer {
	return PlayerCareer{PlayerID: playerID, Coins: 100, Gems: 10}
}

var rankTiers = []RankTierInfo{
	{ID: "recruit", Name: "Recruit", Badge: "🛡️", MinTrophies: 0, MaxTrophies: 99, Color: 0x94a3b8},
	{ID: "soldier", Name: "Soldier", Badge: "⚔️", MinTrophies: 100, MaxTrophies: 249, Color: 0x38bdf8},
	{ID: "knight", Name: "Knight", Badge: "🎖️", MinTrophies: 250, MaxTrophies: 499, Color: 0x818cf8},
	{ID: "commander", Name: "Commander", Badge: "👑", MinTrophies: 500, MaxTrophies: 899, Color: 0xf59e0b},
	{ID: "warlord", Name: "Warlord", Badge: "🔱", MinTrophies: 900, MaxTrophies: 1399, Color: 0xec4899},
	{ID: "crown_lord", Name: "Crown Lord", Badge: "💎", MinTrophies: 1400, MaxTrophies: 99999, Color: 0xa855f7},
}

func GetRankTier(trophies int) RankTierInfo {
	if trophies < 0 {
		trophies = 0
	}
	for i := len(rankTiers) - 1; i >= 0; i-- {
		if trophies >= rankTiers[i].MinTrophies {
			return rankTiers[i]
		}
	}
	return rankTiers[0]
}

func CalculateMatchRewards(status string, stats MatchStats, currentStreak int) MatchRewardBreakdown {
	switch status {
	case "victory":
		speedBonus := 0
		if stats.MatchDurationSeconds > 0 && stats.MatchDurationSeconds <= 40 {
			speedBonus = 15
		} else if stats.MatchDurationSeconds <= 60 {
			speedBonus = 10
		}
		dominationBonus := 0
		if stats.TerritoriesCapturedByPlayer >= 5 {
			dominationBonus = 15
		}
		streakBonus := minInt(25, maxInt(0, (currentStreak+1-1)*5))
		return MatchRewardBreakdown{
			BaseCoins: 40, SpeedBonus: speedBonus, DominationBonus: dominationBonus,
			StreakBonus: streakBonus, TotalCoins: 40 + speedBonus + dominationBonus + streakBonus,
			TrophyDelta: 30,
		}
	case "defeat":
		return MatchRewardBreakdown{BaseCoins: 10, TotalCoins: 10, TrophyDelta: -12}
	default:
		return MatchRewardBreakdown{BaseCoins: 20, TotalCoins: 20, TrophyDelta: 5}
	}
}

func SettleMatch(career PlayerCareer, status string, stats MatchStats, matchID string, timestamp int64) MatchSettlement {
	previous := career
	previousRank := GetRankTier(previous.Trophies)
	breakdown := CalculateMatchRewards(status, stats, previous.CurrentStreak)
	isWin := status == "victory"
	currentStreak := 0
	if isWin {
		currentStreak = previous.CurrentStreak + 1
	}
	newTrophies := maxInt(0, previous.Trophies+breakdown.TrophyDelta)
	actualTrophyDelta := newTrophies - previous.Trophies
	newCareer := previous
	newCareer.Coins += breakdown.TotalCoins
	newCareer.Trophies = newTrophies
	newCareer.MatchesPlayed++
	if isWin {
		newCareer.MatchesWon++
	}
	newCareer.CurrentStreak = currentStreak
	newCareer.BestStreak = maxInt(previous.BestStreak, currentStreak)
	newCareer.LastMatchTimestamp = timestamp
	newRank := GetRankTier(newCareer.Trophies)
	reason := "match_consolation"
	if isWin {
		reason = "match_victory"
	} else if status == "draw" {
		reason = "match_draw"
	}
	entries := []EconomyLedgerEntry{{
		ID: matchID + "_coins_" + itoa(timestamp), Player: career.PlayerID, Currency: "coins",
		Amount: breakdown.TotalCoins, Reason: reason, Source: "battle_settlement",
		PreviousBalance: previous.Coins, ResultingBalance: newCareer.Coins, Timestamp: timestamp,
	}}
	if actualTrophyDelta != 0 {
		trophyReason := "rank_defeat"
		if isWin {
			trophyReason = "rank_victory"
		} else if status == "draw" {
			trophyReason = "rank_draw"
		}
		entries = append(entries, EconomyLedgerEntry{
			ID: matchID + "_trophies_" + itoa(timestamp), Player: career.PlayerID, Currency: "trophies",
			Amount: actualTrophyDelta, Reason: trophyReason, Source: "battle_settlement",
			PreviousBalance: previous.Trophies, ResultingBalance: newCareer.Trophies, Timestamp: timestamp,
		})
	}
	return MatchSettlement{
		MatchID: matchID, Status: status, Breakdown: breakdown, Stats: stats,
		PreviousCareer: previous, NewCareer: newCareer,
		PreviousRank: previousRank, NewRank: newRank,
		RankPromoted:  newRank.MinTrophies > previousRank.MinTrophies,
		LedgerEntries: entries,
	}
}

var upgradeCosts = []int{50, 100, 175, 275, 400}

func UpgradeLevel(career PlayerCareer, upgrade UpgradeType) int {
	level := 0
	switch upgrade {
	case UpgradeStartingGarrison:
		level = career.StartingGarrisonLevel
	case UpgradeProduction:
		level = career.ProductionLevel
	case UpgradeArmySpeed:
		level = career.ArmySpeedLevel
	}
	return minInt(5, maxInt(0, level))
}

func UpgradeModifiers(career PlayerCareer) PlayerUpgradeModifiers {
	return PlayerUpgradeModifiers{
		StartingUnits:            20 + UpgradeLevel(career, UpgradeStartingGarrison)*3,
		ProductionRateMultiplier: 1 + float64(UpgradeLevel(career, UpgradeProduction))*0.08,
		ArmySpeedMultiplier:      1 + float64(UpgradeLevel(career, UpgradeArmySpeed))*0.06,
	}
}

func PurchaseUpgrade(career PlayerCareer, upgrade UpgradeType, purchaseID string, timestamp int64) UpgradePurchaseResult {
	previous := career
	level := UpgradeLevel(previous, upgrade)
	if level >= len(upgradeCosts) {
		return UpgradePurchaseResult{Success: false, Reason: "max_level", Cost: nil, PreviousCareer: previous, NewCareer: previous}
	}
	cost := upgradeCosts[level]
	if previous.Coins < cost {
		return UpgradePurchaseResult{Success: false, Reason: "insufficient_coins", Cost: &cost, PreviousCareer: previous, NewCareer: previous}
	}
	newCareer := previous
	newCareer.Coins -= cost
	switch upgrade {
	case UpgradeStartingGarrison:
		newCareer.StartingGarrisonLevel = level + 1
	case UpgradeProduction:
		newCareer.ProductionLevel = level + 1
	case UpgradeArmySpeed:
		newCareer.ArmySpeedLevel = level + 1
	}
	entry := EconomyLedgerEntry{
		ID: purchaseID, Player: previous.PlayerID, Currency: "coins", Amount: -cost,
		Reason: "upgrade_" + string(upgrade), Source: "upgrade_purchase",
		PreviousBalance: previous.Coins, ResultingBalance: newCareer.Coins, Timestamp: timestamp,
	}
	return UpgradePurchaseResult{Success: true, Cost: &cost, PreviousCareer: previous, NewCareer: newCareer, LedgerEntry: &entry}
}

func CreateDefaultTerritories(player, enemy PlayerUpgradeModifiers) map[string]Territory {
	return map[string]Territory{
		"p_base":      {ID: "p_base", Name: "Player Fortress", X: 200, Y: 610, Radius: 36, Owner: TeamPlayer, Units: player.StartingUnits, MaxUnits: 65, ProductionRate: 1.2 * player.ProductionRateMultiplier, Tier: 3},
		"e_base":      {ID: "e_base", Name: "Enemy Citadel", X: 200, Y: 110, Radius: 36, Owner: TeamEnemy, Units: enemy.StartingUnits, MaxUnits: 65, ProductionRate: 1.2 * enemy.ProductionRateMultiplier, Tier: 3},
		"n_bot_left":  {ID: "n_bot_left", Name: "Southwest Outpost", X: 85, Y: 485, Radius: 27, Owner: TeamNeutral, Units: 8, MaxUnits: 40, ProductionRate: 0.9, Tier: 1},
		"n_bot_right": {ID: "n_bot_right", Name: "Southeast Outpost", X: 315, Y: 485, Radius: 27, Owner: TeamNeutral, Units: 8, MaxUnits: 40, ProductionRate: 0.9, Tier: 1},
		"n_center":    {ID: "n_center", Name: "Crown Keep", X: 200, Y: 360, Radius: 32, Owner: TeamNeutral, Units: 14, MaxUnits: 55, ProductionRate: 1.1, Tier: 2},
		"n_mid_left":  {ID: "n_mid_left", Name: "West Watchtower", X: 75, Y: 360, Radius: 26, Owner: TeamNeutral, Units: 10, MaxUnits: 40, ProductionRate: 0.85, Tier: 1},
		"n_mid_right": {ID: "n_mid_right", Name: "East Watchtower", X: 325, Y: 360, Radius: 26, Owner: TeamNeutral, Units: 10, MaxUnits: 40, ProductionRate: 0.85, Tier: 1},
		"n_top_left":  {ID: "n_top_left", Name: "Northwest Outpost", X: 85, Y: 235, Radius: 27, Owner: TeamNeutral, Units: 8, MaxUnits: 40, ProductionRate: 0.9, Tier: 1},
		"n_top_right": {ID: "n_top_right", Name: "Northeast Outpost", X: 315, Y: 235, Radius: 27, Owner: TeamNeutral, Units: 8, MaxUnits: 40, ProductionRate: 0.9, Tier: 1},
	}
}

func DefaultModifiers() PlayerUpgradeModifiers {
	return PlayerUpgradeModifiers{StartingUnits: 20, ProductionRateMultiplier: 1, ArmySpeedMultiplier: 1}
}

func CreateInitialGameState(player, enemy PlayerUpgradeModifiers) GameState {
	return GameState{
		Territories: CreateDefaultTerritories(player, enemy), Armies: []MarchingArmy{},
		Status: "playing", TimeLimitSeconds: PvpTimeLimitSeconds,
		Stats: MatchStats{},
	}
}

func calculateDispatchUnits(units int) int {
	if units <= 1 {
		return 0
	}
	return maxInt(1, int(math.Floor(float64(units)*0.5)))
}

type combatResult struct {
	newOwner  Team
	remaining int
	captured  bool
}

func resolveArrival(target Territory, incoming int, attacker Team) combatResult {
	if incoming <= 0 {
		return combatResult{newOwner: target.Owner, remaining: target.Units}
	}
	if attacker == target.Owner {
		return combatResult{newOwner: target.Owner, remaining: target.Units + incoming}
	}
	if incoming > target.Units {
		return combatResult{newOwner: attacker, remaining: incoming - target.Units, captured: true}
	}
	return combatResult{newOwner: target.Owner, remaining: target.Units - incoming}
}

func dispatchArmy(state *GameState, sourceID, targetID string, owner Team, multiplier float64, id string) error {
	source, ok := state.Territories[sourceID]
	if !ok {
		return ErrPvpInvalidSource
	}
	target, ok := state.Territories[targetID]
	if !ok {
		return ErrPvpInvalidTarget
	}
	if sourceID == targetID || source.Owner != owner {
		return ErrPvpInvalidDispatch
	}
	units := calculateDispatchUnits(source.Units)
	if units <= 0 {
		return ErrPvpInvalidDispatch
	}
	if !isFinitePositive(multiplier) {
		multiplier = 1
	}
	distance := math.Hypot(target.X-source.X, target.Y-source.Y)
	duration := math.Max(1, distance/(baseArmyTravelSpeed*multiplier))
	source.Units -= units
	state.Territories[sourceID] = source
	state.Armies = append(state.Armies, MarchingArmy{
		ID: id, SourceID: sourceID, TargetID: targetID, Owner: owner, Units: units,
		StartX: source.X, StartY: source.Y, TargetX: target.X, TargetY: target.Y,
		Speed: 1 / duration, Distance: distance,
	})
	if owner == TeamPlayer {
		state.Stats.PlayerUnitsDispatched += float64(units)
	} else {
		state.Stats.EnemyUnitsDispatched += float64(units)
	}
	return nil
}

func tickGeneration(state *GameState, accumulators map[string]float64, delta float64) map[string]float64 {
	next := make(map[string]float64, len(accumulators))
	for _, id := range territoryOrder {
		territory := state.Territories[id]
		if territory.Owner == TeamNeutral || territory.ProductionRate <= 0 || territory.Units >= territory.MaxUnits {
			next[id] = 0
			continue
		}
		current := accumulators[id] + territory.ProductionRate*delta
		whole := int(math.Floor(current))
		if whole > 0 {
			allowed := maxInt(0, territory.MaxUnits-territory.Units)
			territory.Units += minInt(whole, allowed)
			state.Territories[id] = territory
			next[id] = current - float64(whole)
		} else {
			next[id] = current
		}
	}
	return next
}

func stepSimulation(state GameState, accumulators map[string]float64, delta float64) (GameState, map[string]float64) {
	if state.Status != "playing" {
		return state, accumulators
	}
	state.ElapsedTimeSeconds += delta
	state.Stats.MatchDurationSeconds = state.ElapsedTimeSeconds
	remaining := make([]MarchingArmy, 0, len(state.Armies))
	for _, army := range state.Armies {
		nextProgress := army.Progress + army.Speed*delta
		if nextProgress >= 1 {
			target, exists := state.Territories[army.TargetID]
			if exists {
				combat := resolveArrival(target, army.Units, army.Owner)
				target.Owner = combat.newOwner
				target.Units = combat.remaining
				state.Territories[army.TargetID] = target
				if combat.captured {
					if combat.newOwner == TeamPlayer {
						state.Stats.TerritoriesCapturedByPlayer++
					} else if combat.newOwner == TeamEnemy {
						state.Stats.TerritoriesCapturedByEnemy++
					}
				}
			}
		} else {
			army.Progress = nextProgress
			remaining = append(remaining, army)
		}
	}
	state.Armies = remaining
	accumulators = tickGeneration(&state, accumulators, delta)
	playerTerritories, enemyTerritories := 0, 0
	playerUnits, enemyUnits := 0, 0
	for _, id := range territoryOrder {
		territory := state.Territories[id]
		if territory.Owner == TeamPlayer {
			playerTerritories++
			playerUnits += territory.Units
		} else if territory.Owner == TeamEnemy {
			enemyTerritories++
			enemyUnits += territory.Units
		}
	}
	playerArmy, enemyArmy := false, false
	for _, army := range state.Armies {
		playerArmy = playerArmy || army.Owner == TeamPlayer
		enemyArmy = enemyArmy || army.Owner == TeamEnemy
	}
	if enemyTerritories == 0 && !enemyArmy {
		state.Status = "victory"
	} else if playerTerritories == 0 && !playerArmy {
		state.Status = "defeat"
	} else if state.ElapsedTimeSeconds >= state.TimeLimitSeconds {
		switch {
		case playerTerritories > enemyTerritories || (playerTerritories == enemyTerritories && playerUnits > enemyUnits):
			state.Status = "victory"
		case enemyTerritories > playerTerritories || (playerTerritories == enemyTerritories && enemyUnits > playerUnits):
			state.Status = "defeat"
		default:
			state.Status = "draw"
		}
	}
	return state, accumulators
}

func evaluateAIMove(state GameState) (string, string, bool) {
	bestScore := math.Inf(-1)
	fromID, toID := "", ""
	for _, sourceID := range territoryOrder {
		source := state.Territories[sourceID]
		if source.Owner != TeamEnemy || source.Units < 8 {
			continue
		}
		dispatchAmount := calculateDispatchUnits(source.Units)
		if dispatchAmount <= 0 {
			continue
		}
		for _, targetID := range territoryOrder {
			target := state.Territories[targetID]
			if target.ID == source.ID {
				continue
			}
			distancePenalty := math.Hypot(target.X-source.X, target.Y-source.Y) * 0.06
			score := 0.0
			if target.Owner != TeamEnemy {
				canCapture := dispatchAmount > target.Units
				advantage := dispatchAmount - target.Units
				if target.Owner == TeamPlayer {
					if canCapture {
						score = 110 + float64(advantage)*3 - distancePenalty
					} else {
						score = 25 - float64(target.Units) - distancePenalty
					}
				} else if canCapture {
					score = 65 + float64(12-target.Units)*2 - distancePenalty
					if target.ID == "n_center" {
						score += 35
					}
				} else {
					score = -50
				}
			} else if target.Units < 8 && source.Units >= 16 {
				score = 35 + float64(15-target.Units)*1.5 - distancePenalty
			} else {
				score = -20
			}
			if score > bestScore {
				bestScore = score
				fromID, toID = source.ID, target.ID
			}
		}
	}
	return fromID, toID, bestScore > 0
}

// SimulatePvpBattle replays an asynchronous PvP attack against the
// defender's snapshot. Structural violations (bad sequence, timestamps,
// action count) are rejected; player actions that are invalid at replay time
// (e.g. due to minor client prediction divergence) are skipped. The outcome
// is always derived from this server-side simulation, so skipping cannot
// inflate rewards.
func SimulatePvpBattle(actions []PvpAction, player, enemy PlayerUpgradeModifiers) (GameState, PvpBattleSummary, error) {
	return simulateBattle(actions, player, enemy)
}

// SimulateBotBattle replays a single-player match against the standard AI.
func SimulateBotBattle(actions []PvpAction, player PlayerUpgradeModifiers) (GameState, PvpBattleSummary, error) {
	return simulateBattle(actions, player, DefaultModifiers())
}

func simulateBattle(actions []PvpAction, player, enemy PlayerUpgradeModifiers) (GameState, PvpBattleSummary, error) {
	if len(actions) > MaxPvpActions {
		return GameState{}, PvpBattleSummary{}, ErrPvpTooManyActions
	}
	previousTime := 0.0
	for index, action := range actions {
		if action.Sequence != index {
			return GameState{}, PvpBattleSummary{}, ErrPvpInvalidSequence
		}
		if !isFinite(action.AtSeconds) || action.AtSeconds < 0 || action.AtSeconds > PvpTimeLimitSeconds || action.AtSeconds < previousTime {
			return GameState{}, PvpBattleSummary{}, ErrPvpInvalidTimestamp
		}
		previousTime = action.AtSeconds
	}
	state := CreateInitialGameState(player, enemy)
	accumulators := map[string]float64{}
	currentTime := 0.0
	nextAITick := PvpAITickSeconds
	aiActionIndex := 0
	actionsProcessed := 0
	stepTo := func(timestamp float64) {
		delta := timestamp - currentTime
		if delta <= 0 {
			return
		}
		state, accumulators = stepSimulation(state, accumulators, delta)
		currentTime = timestamp
	}
	executeAI := func() {
		if state.Status != "playing" {
			return
		}
		fromID, toID, ok := evaluateAIMove(state)
		if ok {
			_ = dispatchArmy(&state, fromID, toID, TeamEnemy, enemy.ArmySpeedMultiplier, "pvp_ai_"+itoa(int64(aiActionIndex)))
			aiActionIndex++
		}
	}
	for _, action := range actions {
		for state.Status == "playing" && nextAITick <= action.AtSeconds {
			stepTo(nextAITick)
			executeAI()
			nextAITick += PvpAITickSeconds
		}
		if state.Status != "playing" {
			break
		}
		stepTo(action.AtSeconds)
		if state.Status != "playing" {
			break
		}
		if err := dispatchArmy(&state, action.SourceID, action.TargetID, TeamPlayer, player.ArmySpeedMultiplier, "pvp_player_"+itoa(int64(action.Sequence))); err != nil {
			continue
		}
		actionsProcessed++
	}
	for state.Status == "playing" && nextAITick <= PvpTimeLimitSeconds {
		stepTo(nextAITick)
		executeAI()
		nextAITick += PvpAITickSeconds
	}
	if state.Status == "playing" {
		stepTo(PvpTimeLimitSeconds)
	}
	status := state.Status
	if status == "playing" {
		status = "draw"
	}
	return state, PvpBattleSummary{
		Status: status, Stats: state.Stats,
		DurationSeconds:  int(math.Floor(state.ElapsedTimeSeconds)),
		ActionsProcessed: actionsProcessed,
	}, nil
}

func isFinite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func isFinitePositive(value float64) bool {
	return isFinite(value) && value > 0
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func itoa(value int64) string {
	return strconv.FormatInt(value, 10)
}
