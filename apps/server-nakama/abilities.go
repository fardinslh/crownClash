package main

import "math"

// v4 commander abilities. Mirrors packages/game-core/src/abilities.ts and
// ABILITY_CONFIG in gameplay-rules.ts; change both engines together.
const (
	pvpActionKindAbility           = "ability"
	abilityUnlockSeconds           = 15.0
	abilityShieldDefenseMultiplier = 2.0
	abilityShieldDurationMs        = int64(8000)
	abilitySupplyUnits             = 5
	// Vanguard charge: an ordinary 50% send whose army arrives 2x stronger
	// and 1.5x faster; the source pays only the usual half.
	abilityChargeUnitMultiplier  = 2.0
	abilityChargeSpeedMultiplier = 1.5
)

var commanderAbility = map[string]string{
	"crown_guard":   "royal_shield",
	"quartermaster": "supply_drop",
	"vanguard":      "vanguard_charge",
}

// applyPlayerAbility applies the player's one ability and reports whether it
// was legal. An illegal use leaves the state untouched.
func applyPlayerAbility(state *GameState, commanderID, sourceID, targetID string, speedMultiplier float64, armyID string) bool {
	return applyTeamAbility(state, TeamPlayer, commanderID, sourceID, targetID, speedMultiplier, armyID)
}

func abilityUsed(state *GameState, team Team) bool {
	if team == TeamPlayer {
		return state.PlayerAbilityUsed
	}
	return state.EnemyAbilityUsed
}

// applyTeamAbility applies a team's one ability and reports whether it was
// legal. Mirrors applyTeamAbility in abilities.ts.
func applyTeamAbility(state *GameState, team Team, commanderID, sourceID, targetID string, speedMultiplier float64, armyID string) bool {
	if !hasCommanderAbilities(state.GameplayRulesVersion) || state.Status != "playing" || abilityUsed(state, team) {
		return false
	}
	if state.ElapsedTimeSeconds+1e-9 < abilityUnlockSeconds {
		return false
	}
	ability, ok := commanderAbility[commanderID]
	if !ok {
		return false
	}
	source, ok := state.Territories[sourceID]
	if !ok || source.Owner != team {
		return false
	}
	nowMs := int64(math.Round(state.ElapsedTimeSeconds * 1000))
	switch ability {
	case "royal_shield":
		if targetID != sourceID {
			return false
		}
		shields := make(map[string]int64, len(state.ShieldedUntilMs)+1)
		for id, until := range state.ShieldedUntilMs {
			shields[id] = until
		}
		shields[sourceID] = nowMs + abilityShieldDurationMs
		state.ShieldedUntilMs = shields
	case "supply_drop":
		if targetID != sourceID {
			return false
		}
		source.Units += abilitySupplyUnits
		state.Territories[sourceID] = source
	case "vanguard_charge":
		if targetID == sourceID {
			return false
		}
		if err := dispatchArmyWithRatio(state, sourceID, targetID, team, speedMultiplier*abilityChargeSpeedMultiplier, armyID, 0.5); err != nil {
			return false
		}
		last := len(state.Armies) - 1
		boosted := int(math.Floor(float64(state.Armies[last].Units) * abilityChargeUnitMultiplier))
		extra := float64(boosted - state.Armies[last].Units)
		if team == TeamPlayer {
			state.Stats.PlayerUnitsDispatched += extra
		} else {
			state.Stats.EnemyUnitsDispatched += extra
		}
		state.Armies[last].Units = boosted
	default:
		return false
	}
	if team == TeamPlayer {
		state.PlayerAbilityUsed = true
	} else {
		state.EnemyAbilityUsed = true
	}
	return true
}

// normalizeCommanderID maps an unknown or empty selection to the default
// commander so a v4 ticket always carries a valid ability owner.
func normalizeCommanderID(commanderID string) string {
	if _, ok := CommanderUnlockLevel(commanderID); ok {
		return commanderID
	}
	return "crown_guard"
}
