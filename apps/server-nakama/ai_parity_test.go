package main

// Regression tests for cross-engine AI decision parity.
//
// The production `bot_result_status_mismatch` investigation showed the enemy
// AI deciding differently between the TypeScript client (each float operation
// rounded separately) and the Go server (which may fuse `a - b*c` into one
// FMA with a single rounding). On crown_cross, the e_base -> n_center score
// is exactly `25 - units - 250*0.06`: zero in JavaScript, +5.5e-16 in Go.
// evaluateAIMove must reject ghost-scored moves on BOTH engines; these tests
// pin that with scores on both sides of the epsilon.

import (
	"testing"
)

// razorEdgeTerritories builds the exact diverging state from the parity
// harness (s38 at the t=10.8 AI tick): the enemy citadel holds 15 units while
// the player-held Crown Keep sits exactly 250 units away, making the attack
// score exactly 25 - 10 - 250*0.06 = 0 (up to FMA rounding).
func razorEdgeTerritories() GameState {
	player := DefaultModifiers()
	enemy := DefaultModifiers()
	state := CreateInitialGameStateForBattlefield(player, enemy, "crown_cross")
	// Mirror the harness state at the divergence tick.
	state.Territories["e_base"] = Territory{
		ID: "e_base", Name: "Enemy Citadel", X: 200, Y: 110, Radius: 36,
		Owner: TeamEnemy, Units: 15, MaxUnits: 65, ProductionRate: 1.2, Tier: 3, Type: TerritoryFortress,
	}
	state.Territories["n_center"] = Territory{
		ID: "n_center", Name: "Crown Keep", X: 200, Y: 360, Radius: 32,
		Owner: TeamPlayer, Units: 10, MaxUnits: 55, ProductionRate: 1.87, Tier: 2, Type: TerritoryFortress,
	}
	return state
}

func TestEvaluateAIMoveRejectsGhostScoreOnFmaRazorEdge(t *testing.T) {
	fromID, toID, ok := evaluateAIMove(razorEdgeTerritories())
	if ok {
		t.Fatalf("AI must not act on a borderline zero score, but attacked %s -> %s", fromID, toID)
	}
}

func TestEvaluateAIMoveStillActsOnGenuineScores(t *testing.T) {
	state := razorEdgeTerritories()
	// A decisive capture opportunity: dispatch 10 from e_base beats the 8
	// defenders of the neutral northeast barracks (score far above epsilon).
	enemyBase := state.Territories["e_base"]
	enemyBase.Units = 20
	state.Territories["e_base"] = enemyBase
	state.Territories["n_top_right"] = Territory{
		ID: "n_top_right", Name: "Northeast Barracks", X: 315, Y: 235, Radius: 27,
		Owner: TeamNeutral, Units: 8, MaxUnits: 40, ProductionRate: 0.9, Tier: 1, Type: TerritoryBarracks,
	}
	fromID, toID, ok := evaluateAIMove(state)
	if !ok {
		t.Fatal("AI must still act on a decisive capture opportunity")
	}
	if fromID != "e_base" || toID != "n_top_right" {
		t.Fatalf("unexpected move %s -> %s", fromID, toID)
	}
}

// TestEvaluateAIMoveEpsilonThresholdIsExact pins the epsilon semantics: a
// score of 5e-10 is above zero but below the 1e-9 epsilon, so the AI must not
// act. This is the sensitivity control for the epsilon itself: removing the
// epsilon (score > 0) makes this test fail.
func TestEvaluateAIMoveEpsilonThresholdIsExact(t *testing.T) {
	state := razorEdgeTerritories()
	// Craft the distance so that 25 - 10 - distance*0.06 = 5e-10:
	// distance = (15 - 5e-10) / 0.06.
	targetDistance := (15.0 - 5e-10) / 0.06
	crownKeep := state.Territories["n_center"]
	crownKeep = Territory{
		ID: "n_center", Name: "Crown Keep", X: 200, Y: 110 + targetDistance, Radius: 32,
		Owner: TeamPlayer, Units: 10, MaxUnits: 55, ProductionRate: 1.87, Tier: 2, Type: TerritoryFortress,
	}
	state.Territories["n_center"] = crownKeep
	fromID, toID, ok := evaluateAIMove(state)
	if ok {
		t.Fatalf("AI must not act on a 5e-10 score, but attacked %s -> %s", fromID, toID)
	}

	// And a score above the epsilon must act: distance chosen so the score is 5e-6.
	crownKeep.Y = 110 + (15.0-5e-6)/0.06
	state.Territories["n_center"] = crownKeep
	_, _, ok = evaluateAIMove(state)
	if !ok {
		t.Fatal("AI must act on a score of 5e-6 (above the epsilon)")
	}
}
