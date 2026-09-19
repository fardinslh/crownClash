package main

// Cross-implementation bot-parity replay dump.
//
// Guarded by the PARITY_SCENARIOS environment variable: without it the test
// skips so normal `go test ./...` runs are unaffected. With it set, the test
// loads the scenario JSON (produced by test/scripts/bot_parity_crosscheck.mjs),
// replays every scenario through the real authoritative simulateBattle engine,
// and writes status/stats plus fine-grained state checkpoints to
// PARITY_OUTPUT. The orchestrator diffs these checkpoints against the
// TypeScript replay mirror to localize the FIRST diverging simulation state.
//
// The checkpointed loop mirrors simulateBattle exactly (same stepTo/AI
// scheduling); it is validated per scenario by asserting its final summary
// equals the real simulateBattle result. Any disagreement fails the test.

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

type parityTerritoryState struct {
	Owner         Team    `json:"owner"`
	Units         int     `json:"units"`
	ProductionRate float64 `json:"productionRate"`
}

type parityArmyState struct {
	ID       string  `json:"id"`
	Owner    Team    `json:"owner"`
	Units    int     `json:"units"`
	SourceID string  `json:"sourceId"`
	TargetID string  `json:"targetId"`
	Progress float64 `json:"progress"`
	Speed    float64 `json:"speed"`
}

type parityCheckpoint struct {
	Kind         string                          `json:"kind"`
	At           float64                         `json:"at"`
	Status       string                          `json:"status"`
	Elapsed      float64                         `json:"elapsed"`
	Territories  map[string]parityTerritoryState `json:"territories"`
	Armies       []parityArmyState               `json:"armies"`
	Accumulators map[string]float64              `json:"accumulators"`
}

type parityScenario struct {
	ID              string                  `json:"id"`
	BattlefieldID   string                  `json:"battlefieldId"`
	PlayerModifiers PlayerUpgradeModifiers  `json:"playerModifiers"`
	EnemyModifiers  *PlayerUpgradeModifiers `json:"enemyModifiers"`
	Actions         []PvpAction             `json:"actions"`
}

type parityScenarioResult struct {
	ID               string             `json:"id"`
	Status           string             `json:"status"`
	Stats            MatchStats         `json:"stats"`
	DurationSeconds  int                `json:"durationSeconds"`
	ActionsProcessed int                `json:"actionsProcessed"`
	Checkpoints      []parityCheckpoint `json:"checkpoints"`
}

func captureParityCheckpoint(checkpoints *[]parityCheckpoint, kind string, at float64, state GameState, accumulators map[string]float64) {
	territories := make(map[string]parityTerritoryState, len(state.Territories))
	for id, t := range state.Territories {
		territories[id] = parityTerritoryState{Owner: t.Owner, Units: t.Units, ProductionRate: t.ProductionRate}
	}
	armies := make([]parityArmyState, 0, len(state.Armies))
	for _, a := range state.Armies {
		armies = append(armies, parityArmyState{
			ID: a.ID, Owner: a.Owner, Units: a.Units,
			SourceID: a.SourceID, TargetID: a.TargetID,
			Progress: a.Progress, Speed: a.Speed,
		})
	}
	accumulatorsCopy := make(map[string]float64, len(accumulators))
	for key, value := range accumulators {
		accumulatorsCopy[key] = value
	}
	*checkpoints = append(*checkpoints, parityCheckpoint{
		Kind: kind, At: at, Status: state.Status, Elapsed: state.ElapsedTimeSeconds,
		Territories: territories, Armies: armies, Accumulators: accumulatorsCopy,
	})
}

// simulateBattleWithCheckpoints mirrors simulateBattle step-for-step and
// records a checkpoint after every AI tick, every processed/skipped player
// action, and at the end.
func simulateBattleWithCheckpoints(actions []PvpAction, player, enemy PlayerUpgradeModifiers, battlefieldID string) (GameState, PvpBattleSummary, []parityCheckpoint, error) {
	checkpoints := []parityCheckpoint{}
	state := CreateInitialGameStateForBattlefield(player, enemy, battlefieldID)
	accumulators := map[string]float64{}
	currentTime := 0.0
	nextAITick := PvpAITickSeconds
	aiActionIndex := 0
	actionsProcessed := 0

	stepTo := func(timestamp float64) {
		for state.Status == "playing" && currentTime+PvpSimulationTick <= timestamp+1e-9 {
			state, accumulators = stepSimulation(state, accumulators, PvpSimulationTick)
			currentTime += PvpSimulationTick
		}
		remainder := timestamp - currentTime
		if state.Status == "playing" && remainder > 0 {
			state, accumulators = stepSimulation(state, accumulators, remainder)
		}
		clockCorrection := timestamp - state.ElapsedTimeSeconds
		if state.Status == "playing" && clockCorrection > 0 {
			state, accumulators = stepSimulation(state, accumulators, clockCorrection)
		}
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
			captureParityCheckpoint(&checkpoints, "ai_tick", nextAITick, state, accumulators)
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
			captureParityCheckpoint(&checkpoints, "skipped_action", action.AtSeconds, state, accumulators)
			continue
		}
		actionsProcessed++
		captureParityCheckpoint(&checkpoints, "player_action", action.AtSeconds, state, accumulators)
	}
	for state.Status == "playing" && nextAITick <= PvpTimeLimitSeconds {
		stepTo(nextAITick)
		executeAI()
		captureParityCheckpoint(&checkpoints, "ai_tick", nextAITick, state, accumulators)
		nextAITick += PvpAITickSeconds
	}
	if state.Status == "playing" {
		stepTo(PvpTimeLimitSeconds)
	}
	captureParityCheckpoint(&checkpoints, "final", currentTime, state, accumulators)

	status := state.Status
	if status == "playing" {
		status = "draw"
	}
	return state, PvpBattleSummary{
		Status: status, Stats: state.Stats,
		DurationSeconds:  int(math.Floor(state.ElapsedTimeSeconds)),
		ActionsProcessed: actionsProcessed,
	}, checkpoints, nil
}

// TestParityReplayDump replays scenarios and dumps results when
// PARITY_SCENARIOS is set; otherwise it is a no-op skip.
func TestParityReplayDump(t *testing.T) {
	scenariosPath := os.Getenv("PARITY_SCENARIOS")
	if scenariosPath == "" {
		t.Skip("PARITY_SCENARIOS not set; skipping cross-implementation replay dump")
	}
	outputPath := os.Getenv("PARITY_OUTPUT")
	if outputPath == "" {
		outputPath = "parity_go_results.json"
	}

	raw, err := os.ReadFile(scenariosPath)
	if err != nil {
		t.Fatalf("failed to read scenarios: %v", err)
	}
	var scenarios []parityScenario
	if err := json.Unmarshal(raw, &scenarios); err != nil {
		t.Fatalf("failed to parse scenarios: %v", err)
	}

	results := make([]parityScenarioResult, 0, len(scenarios))
	for _, scenario := range scenarios {
		enemy := DefaultModifiers()
		if scenario.EnemyModifiers != nil {
			enemy = *scenario.EnemyModifiers
		}

		// Authoritative result from the real production engine.
		realState, realSummary, err := simulateBattle(scenario.Actions, scenario.PlayerModifiers, enemy, scenario.BattlefieldID)
		if err != nil {
			t.Fatalf("scenario %s: real simulateBattle failed: %v", scenario.ID, err)
		}

		// Checkpointed mirror of the same replay; must agree with the real
		// engine or the dump is invalid (fail closed).
		mirrorState, mirrorSummary, checkpoints, err := simulateBattleWithCheckpoints(scenario.Actions, scenario.PlayerModifiers, enemy, scenario.BattlefieldID)
		if err != nil {
			t.Fatalf("scenario %s: checkpoint mirror failed: %v", scenario.ID, err)
		}
		if realSummary.Status != mirrorSummary.Status ||
			realSummary.ActionsProcessed != mirrorSummary.ActionsProcessed ||
			realSummary.DurationSeconds != mirrorSummary.DurationSeconds ||
			realState.Stats != mirrorState.Stats {
			t.Fatalf("scenario %s: checkpoint mirror diverged from real simulateBattle: real=%+v mirror=%+v", scenario.ID, realSummary, mirrorSummary)
		}

		results = append(results, parityScenarioResult{
			ID:               scenario.ID,
			Status:           realSummary.Status,
			Stats:            realSummary.Stats,
			DurationSeconds:  realSummary.DurationSeconds,
			ActionsProcessed: realSummary.ActionsProcessed,
			Checkpoints:      checkpoints,
		})
	}

	payload, err := json.MarshalIndent(results, "", " ")
	if err != nil {
		t.Fatalf("failed to marshal results: %v", err)
	}
	if err := os.WriteFile(outputPath, payload, 0o600); err != nil {
		t.Fatalf("failed to write results: %v", err)
	}
	t.Logf("wrote %d parity replay results to %s", len(results), outputPath)
}
