package main

import "sort"

// botAbilityChoice mirrors BotAbilityChoice in bot-abilities.ts.
type botAbilityChoice struct {
	sourceID string
	targetID string
	// moves are the dispatches still to send (a charge replaces the first).
	moves []tacticalMove
}

type threatenedTower struct {
	tower    Territory
	firstEta float64
	horizon  float64
}

// threatenedTowers lists own towers that the armies already marching on them
// would capture, in tower-id order.
func threatenedTowers(state GameState, team Team) []threatenedTower {
	ids := []string{}
	for id := range state.Territories {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	result := []threatenedTower{}
	for _, id := range ids {
		tower := state.Territories[id]
		if tower.Owner != team {
			continue
		}
		hostile := []tacticalIncoming{}
		for _, a := range tacticalIncomingAt(state, id) {
			if a.army.Owner != team {
				hostile = append(hostile, a)
			}
		}
		if len(hostile) == 0 {
			continue
		}
		horizon := hostile[len(hostile)-1].eta
		if tacticalForecast(state, tower, horizon, tower.Units).Owner == team {
			continue
		}
		result = append(result, threatenedTower{tower, hostile[0].eta, horizon})
	}
	return result
}

// chooseBotAbility decides whether the bot spends its one ability this tick.
// Mirrors chooseBotAbility in bot-abilities.ts; the server replays the same
// choice at settlement.
func chooseBotAbility(state GameState, team Team, commanderID string, moves []tacticalMove) (botAbilityChoice, bool) {
	none := botAbilityChoice{}
	if commanderID == "" || !hasCommanderAbilities(state.GameplayRulesVersion) || state.Status != "playing" {
		return none, false
	}
	if abilityUsed(&state, team) || state.ElapsedTimeSeconds+1e-9 < abilityUnlockSeconds {
		return none, false
	}
	ability, ok := commanderAbility[commanderID]
	if !ok {
		return none, false
	}
	if ability == "vanguard_charge" {
		if len(moves) == 0 {
			return none, false
		}
		return botAbilityChoice{moves[0].FromID, moves[0].ToID, moves[1:]}, true
	}
	threats := threatenedTowers(state, team)
	shieldSeconds := float64(abilityShieldDurationMs) / 1000
	if ability == "royal_shield" {
		saved := []threatenedTower{}
		for _, t := range threats {
			if t.firstEta > shieldSeconds-1+1e-9 {
				continue
			}
			horizon := t.horizon
			if shieldSeconds-1 < horizon {
				horizon = shieldSeconds - 1
			}
			if tacticalForecastWithDefense(state, t.tower, horizon, t.tower.Units, abilityShieldDefenseMultiplier).Owner == team {
				saved = append(saved, t)
			}
		}
		if len(saved) == 0 {
			return none, false
		}
		sort.SliceStable(saved, func(i, j int) bool {
			if saved[i].tower.Units != saved[j].tower.Units {
				return saved[i].tower.Units > saved[j].tower.Units
			}
			return saved[i].tower.ID < saved[j].tower.ID
		})
		return botAbilityChoice{saved[0].tower.ID, saved[0].tower.ID, moves}, true
	}
	// supply_drop: rescue a tower that +units would save, else feed the first attack.
	rescued := []threatenedTower{}
	for _, t := range threats {
		if tacticalForecast(state, t.tower, t.horizon, t.tower.Units+abilitySupplyUnits).Owner == team {
			rescued = append(rescued, t)
		}
	}
	if len(rescued) > 0 {
		sort.SliceStable(rescued, func(i, j int) bool {
			if rescued[i].firstEta != rescued[j].firstEta {
				return rescued[i].firstEta < rescued[j].firstEta
			}
			return rescued[i].tower.ID < rescued[j].tower.ID
		})
		return botAbilityChoice{rescued[0].tower.ID, rescued[0].tower.ID, moves}, true
	}
	if len(moves) > 0 {
		return botAbilityChoice{moves[0].FromID, moves[0].FromID, moves}, true
	}
	return none, false
}
