package main

import (
	"math"
	"reflect"
	"strings"
	"testing"
)

func captureFixture() GameState {
	state := CreateInitialGameState(DefaultModifiers(), DefaultModifiers())
	target := state.Territories["n_bot_left"]
	target.Type = TerritoryFortress
	target.ProductionRate = 50
	target.MaxUnits = 10000
	state.Territories[target.ID] = target
	return state
}
func captureArrival(state *GameState, owner Team, id string) {
	target := state.Territories[id]
	state.Armies = append(state.Armies, MarchingArmy{ID: "capture", SourceID: "p_base", TargetID: id, Owner: owner, Units: territoryDefenseStrength(target) + 100, Progress: 1, Speed: 1})
}
func TestCaptureRecoveryProductionBotAndLiveClocks(t *testing.T) {
	for _, delta := range []float64{.02, .05} {
		state := captureFixture()
		captureArrival(&state, TeamPlayer, "n_bot_left")
		state, acc := stepSimulation(state, map[string]float64{"n_bot_left": .95}, delta)
		ready := int64(math.Round(delta*1000)) + 3000
		if state.Territories["n_bot_left"].Owner != TeamPlayer || state.ProductionReadyAtMs["n_bot_left"] != ready {
			t.Fatal("capture must start a three second recovery")
		}
		if math.Abs(acc["n_bot_left"]-math.Mod(50*.5*delta, 1)) > 1e-9 {
			t.Fatal("capture must clear the old fraction and begin at 50%")
		}
		if captureProductionMultiplier(delta, ready) != .5 || captureProductionMultiplier(delta+1.5, ready) != .75 || captureProductionMultiplier(delta+3, ready) != 1 {
			t.Fatal("recovery boundary mismatch")
		}
		state, acc = stepSimulation(state, acc, .5)
		previous := state.ProductionReadyAtMs
		captureArrival(&state, TeamEnemy, "n_bot_left")
		state, acc = stepSimulation(state, map[string]float64{"n_bot_left": .95}, .02)
		if state.Territories["n_bot_left"].Owner != TeamEnemy || state.ProductionReadyAtMs["n_bot_left"] != ready {
			t.Fatal("recapture must preserve original deadline")
		}
		if math.Abs(acc["n_bot_left"]-captureProductionMultiplier(state.ElapsedTimeSeconds, ready)) > 1e-9 {
			t.Fatal("recapture fraction mismatch")
		}
		state, acc = stepSimulation(state, acc, 3)
		captureArrival(&state, TeamPlayer, "n_bot_left")
		state, _ = stepSimulation(state, acc, .02)
		if state.ProductionReadyAtMs["n_bot_left"] != int64(math.Round(state.ElapsedTimeSeconds*1000))+3000 {
			t.Fatal("a new capture after recovery must start a new deadline")
		}
		if previous["n_bot_left"] != ready {
			t.Fatal("old snapshot deadline was mutated")
		}
	}
}
func TestCaptureRecoveryLegacyReplayAndMigration(t *testing.T) {
	state := captureFixture()
	state.GameplayRulesVersion = 1
	captureArrival(&state, TeamPlayer, "n_bot_left")
	state, acc := stepSimulation(state, map[string]float64{"n_bot_left": .95}, .02)
	if len(state.ProductionReadyAtMs) != 0 || math.Abs(acc["n_bot_left"]-.95) > 1e-9 {
		t.Fatal("historical rules must keep instant production and fractions")
	}
	for _, version := range []int{1, 2} {
		first, summary, err := simulateBattleWithRules(nil, DefaultModifiers(), DefaultModifiers(), "crown_cross", version)
		if err != nil {
			t.Fatal(err)
		}
		second, other, err := simulateBattleWithRules(nil, DefaultModifiers(), DefaultModifiers(), "crown_cross", version)
		if err != nil || !reflect.DeepEqual(first, second) || !reflect.DeepEqual(summary, other) {
			t.Fatal("versioned replay must remain deterministic")
		}
	}
	if _, _, err := simulateBattleWithRules(nil, DefaultModifiers(), DefaultModifiers(), "crown_cross", 99); err == nil {
		t.Fatal("unknown rules version accepted")
	}
	found := false
	for _, item := range migrations {
		if item.name == "013_capture_recovery_rules" {
			found = true
			if !strings.Contains(item.sql, "DEFAULT 1") || !strings.Contains(item.sql, "gameplay_rules_version IN (1, 2)") {
				t.Fatal("migration must preserve old tickets and constrain rules")
			}
		}
	}
	if !found {
		t.Fatal("rules migration missing")
	}
}
