package main

import (
	"math"
	"sort"
	"strings"
)

const TacticalRulesVersion = 3

// TacticalV4RulesVersion adds commander abilities and fog of war to v3
// tactics. It is async/bot only; live matches stay on v2.
const TacticalV4RulesVersion = 4

var asyncGameplayRulesVersion = TacticalV4RulesVersion

func hasCaptureRecovery(version int) bool     { return version >= 2 && version <= 4 }
func supportedGameplayRules(version int) bool { return version == 1 || hasCaptureRecovery(version) }

// usesTacticalRules: road-routed supply, one-road attacks and the tactical
// opening (v3 and later).
func usesTacticalRules(version int) bool     { return version == 3 || version == 4 }
func hasCommanderAbilities(version int) bool { return version == 4 }

// negotiatedAsyncRules picks the highest tactical version that both the
// server configuration and the client support, falling back to v2.
func negotiatedAsyncRules(supported []int) int {
	return negotiatedAsyncRulesUpTo(supported, asyncGameplayRulesVersion)
}

// parseAsyncGameplayRulesVersion reads ASYNC_GAMEPLAY_RULES_VERSION: unset
// means v4, "3" pins new tickets to v3, any other value rolls back to v2.
func parseAsyncGameplayRulesVersion(value string) int {
	switch value {
	case "", "4":
		return TacticalV4RulesVersion
	case "3":
		return TacticalRulesVersion
	default:
		return 2
	}
}

func negotiatedAsyncRulesUpTo(supported []int, ceiling int) int {
	for version := ceiling; version >= 3; version-- {
		for _, v := range supported {
			if v == version {
				return version
			}
		}
	}
	return 2
}

func applyTacticalOpening(state *GameState, player, enemy PlayerUpgradeModifiers) {
	supports := map[string][2]string{"crown_cross": {"n_bot_left", "n_top_right"}, "twin_passes": {"n_west_gate_s", "n_east_gate_n"}, "royal_ring": {"n_ring_sw", "n_ring_ne"}}
	for _, id := range []string{"p_base", "e_base"} {
		t := state.Territories[id]
		t.Units += 8
		state.Territories[id] = t
	}
	for i, id := range supports[state.BattlefieldID] {
		t := state.Territories[id]
		t.Units = 14
		if i == 0 {
			t.Owner = TeamPlayer
			t.ProductionRate *= player.ProductionRateMultiplier
		} else {
			t.Owner = TeamEnemy
			t.ProductionRate *= enemy.ProductionRateMultiplier
		}
		state.Territories[id] = t
	}
}

func tacticalNeighbors(state GameState, id string) []string {
	result := []string{}
	for _, r := range battlefieldRoads[state.BattlefieldID] {
		if r[0] == id {
			result = append(result, r[1])
		} else if r[1] == id {
			result = append(result, r[0])
		}
	}
	sort.Strings(result)
	return result
}

func findDispatchRoute(state GameState, sourceID, targetID string, owner Team) []string {
	source, a := state.Territories[sourceID]
	target, b := state.Territories[targetID]
	if !a || !b || sourceID == targetID || source.Owner != owner {
		return nil
	}
	if !usesTacticalRules(state.GameplayRulesVersion) {
		return []string{sourceID, targetID}
	}
	if target.Owner != owner {
		for _, id := range tacticalNeighbors(state, sourceID) {
			if id == targetID {
				return []string{sourceID, targetID}
			}
		}
		return nil
	}
	type entry struct {
		id   string
		cost int64
		path []string
	}
	queue := []entry{{sourceID, 0, []string{sourceID}}}
	visited := map[string]bool{}
	for len(queue) > 0 {
		sort.Slice(queue, func(i, j int) bool {
			if queue[i].cost != queue[j].cost {
				return queue[i].cost < queue[j].cost
			}
			return strings.Join(queue[i].path, "|") < strings.Join(queue[j].path, "|")
		})
		next := queue[0]
		queue = queue[1:]
		if visited[next.id] {
			continue
		}
		if next.id == targetID {
			return next.path
		}
		visited[next.id] = true
		for _, id := range tacticalNeighbors(state, next.id) {
			t, ok := state.Territories[id]
			if !ok || t.Owner != owner || visited[id] {
				continue
			}
			from := state.Territories[next.id]
			p := append(append([]string{}, next.path...), id)
			queue = append(queue, entry{id, next.cost + int64(math.Round(math.Hypot(t.X-from.X, t.Y-from.Y)*1000)), p})
		}
	}
	return nil
}

func setArmyLeg(army MarchingArmy, from, to Territory, leg int) MarchingArmy {
	army.RouteLeg = leg
	army.TargetID = to.ID
	army.StartX = from.X
	army.StartY = from.Y
	army.TargetX = to.X
	army.TargetY = to.Y
	army.Distance = math.Hypot(to.X-from.X, to.Y-from.Y)
	army.Progress = 0
	army.Speed = 1 / math.Max(2, army.Distance/(baseArmyTravelSpeed*army.RouteSpeedMultiplier))
	return army
}

func advanceRoutedArmy(army MarchingArmy, territories map[string]Territory, delta float64) (MarchingArmy, bool) {
	for {
		progress := army.Progress + army.Speed*delta
		if progress < 1 {
			army.Progress = progress
			return army, false
		}
		waypoint, ok := territories[army.TargetID]
		nextLeg := army.RouteLeg + 1
		if !ok || waypoint.Owner != army.Owner || nextLeg >= len(army.RouteIDs)-1 {
			army.Progress = 1
			return army, true
		}
		delta = (progress - 1) / army.Speed
		army = setArmyLeg(army, waypoint, territories[army.RouteIDs[nextLeg+1]], nextLeg)
	}
}

func armyDestination(a MarchingArmy, state GameState) string {
	for i := a.RouteLeg + 1; i < len(a.RouteIDs); i++ {
		id := a.RouteIDs[i]
		if state.Territories[id].Owner != a.Owner {
			return id
		}
	}
	if len(a.RouteIDs) > 0 {
		return a.RouteIDs[len(a.RouteIDs)-1]
	}
	return a.TargetID
}
func armyArrivalSeconds(a MarchingArmy, state GameState) float64 {
	seconds := (1 - a.Progress) / a.Speed
	destination := armyDestination(a, state)
	for i := a.RouteLeg + 1; i < len(a.RouteIDs)-1; i++ {
		if a.RouteIDs[i] == destination {
			break
		}
		leg := setArmyLeg(a, state.Territories[a.RouteIDs[i]], state.Territories[a.RouteIDs[i+1]], i)
		seconds += 1 / leg.Speed
	}
	return seconds
}

type tacticalMove struct{ FromID, ToID string }
type tacticalIncoming struct {
	army  MarchingArmy
	index int
	eta   float64
}
type tacticalCandidate struct {
	source Territory
	army   MarchingArmy
	eta    float64
}

func tacticalIncomingAt(state GameState, id string) []tacticalIncoming {
	result := []tacticalIncoming{}
	for i, a := range state.Armies {
		if armyDestination(a, state) == id {
			result = append(result, tacticalIncoming{a, i, armyArrivalSeconds(a, state)})
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].eta != result[j].eta {
			return result[i].eta < result[j].eta
		}
		return result[i].index < result[j].index
	})
	return result
}
func tacticalForecast(state GameState, t Territory, seconds float64, units int) Territory {
	t.Units = units
	for _, a := range tacticalIncomingAt(state, t.ID) {
		if a.eta <= seconds+1e-9 {
			r := resolveArrival(t, a.army.Units, a.army.Owner)
			t.Owner = r.newOwner
			t.Units = r.remaining
		}
	}
	return t
}
func tacticalCandidates(state GameState, target Territory, team Team, multiplier float64) []tacticalCandidate {
	result := []tacticalCandidate{}
	ids := []string{}
	for id := range state.Territories {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		s := state.Territories[id]
		if s.Owner != team || s.Units < 4 || s.ID == target.ID {
			continue
		}
		route := findDispatchRoute(state, s.ID, target.ID, team)
		if route == nil {
			continue
		}
		units := calculateDispatchUnits(s.Units)
		safe := true
		hostile := []tacticalIncoming{}
		for _, a := range tacticalIncomingAt(state, s.ID) {
			if a.army.Owner != team {
				hostile = append(hostile, a)
			}
		}
		if len(hostile) > 0 {
			safe = tacticalForecast(state, s, hostile[len(hostile)-1].eta, s.Units-units).Owner == team
		}
		if !safe {
			continue
		}
		a := MarchingArmy{ID: "candidate", SourceID: s.ID, Owner: team, Units: units, RouteIDs: route, RouteSpeedMultiplier: multiplier * territoryArmySpeedMultiplier(s.Type)}
		a = setArmyLeg(a, s, state.Territories[route[1]], 0)
		result = append(result, tacticalCandidate{s, a, armyArrivalSeconds(a, state)})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].eta != result[j].eta {
			return result[i].eta < result[j].eta
		}
		return result[i].source.ID < result[j].source.ID
	})
	return result
}
func evaluateTacticalMoves(state GameState, team Team, multiplier float64) []tacticalMove {
	if state.Status != "playing" {
		return nil
	}
	ids := []string{}
	for id := range state.Territories {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		t := state.Territories[id]
		if t.Owner != team {
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
		if tacticalForecast(state, t, horizon, t.Units).Owner == team {
			continue
		}
		units := t.Units
		moves := []tacticalMove{}
		for _, c := range tacticalCandidates(state, t, team, multiplier) {
			if c.eta >= hostile[0].eta-1e-9 {
				continue
			}
			units += c.army.Units
			moves = append(moves, tacticalMove{c.source.ID, id})
			if tacticalForecast(state, t, horizon, units).Owner == team {
				return moves
			}
		}
	}
	best := []tacticalMove{}
	bestScore := math.Inf(-1)
	for _, id := range ids {
		t := state.Territories[id]
		if t.Owner == team {
			continue
		}
		options := tacticalCandidates(state, t, team, multiplier)
		if len(options) == 0 {
			continue
		}
		lastETA := options[len(options)-1].eta
		projected := tacticalForecast(state, t, lastETA, t.Units)
		if projected.Owner == team {
			continue
		}
		if t.Owner != TeamNeutral {
			projected.Units += int(math.Ceil(lastETA * t.ProductionRate * territoryProductionMultiplier(t.Type)))
		}
		moves := []tacticalMove{}
		for _, c := range options {
			r := resolveArrival(projected, c.army.Units, team)
			projected.Owner = r.newOwner
			projected.Units = r.remaining
			moves = append(moves, tacticalMove{c.source.ID, id})
			if projected.Owner == team {
				role := 10
				if t.Type == TerritoryBarracks {
					role = 18
				} else if t.Type == TerritoryStable {
					role = 14
				}
				base := 1000
				if t.Owner == TeamNeutral {
					base = 500
				}
				score := float64(base+role*10+minInt(projected.Units, 50)) - math.Round(c.eta*10)
				if score > bestScore {
					bestScore = score
					best = moves
				}
				break
			}
		}
	}
	if len(best) > 0 {
		return best
	}
	frontier := func(t Territory) bool {
		for _, id := range tacticalNeighbors(state, t.ID) {
			if state.Territories[id].Owner != team {
				return true
			}
		}
		return false
	}
	for _, id := range ids {
		t := state.Territories[id]
		if t.Owner != team || !frontier(t) {
			continue
		}
		committed := 0
		for _, a := range tacticalIncomingAt(state, id) {
			if a.army.Owner == team {
				committed += a.army.Units
			}
		}
		strongest := 0
		for _, id := range tacticalNeighbors(state, t.ID) {
			n := state.Territories[id]
			if n.Owner != team {
				strongest = maxInt(strongest, territoryDefenseStrength(n))
			}
		}
		if calculateDispatchUnits(t.Units+committed) > strongest {
			continue
		}
		for _, c := range tacticalCandidates(state, t, team, multiplier) {
			if !frontier(c.source) {
				return []tacticalMove{{c.source.ID, id}}
			}
		}
	}
	return nil
}

func clientSupportsRules(supported []int, version int) bool {
	if version < 3 {
		return true
	}
	for _, v := range supported {
		if v == version {
			return true
		}
	}
	return false
}
