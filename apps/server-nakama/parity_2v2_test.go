package main

// Cross-implementation 2v2 parity replay dump (Phase 2 of
// docs/2v2-architecture.md).
//
// Guarded by the PARITY2V2_SCENARIOS environment variable: without it the
// test skips so normal `go test ./...` runs are unaffected. With it set, the
// test loads the 2v2 scenario JSON (produced by
// test/scripts/bot_parity_2v2_crosscheck.mjs), replays every scenario through
// the real authoritative Simulate2v2Battle engine, and writes the canonical
// action order plus fine-grained state checkpoints to PARITY2V2_OUTPUT. The
// orchestrator diffs these against the TypeScript 2v2 mirror to localize the
// FIRST diverging simulation state.
//
// Unlike the 1v1 harness there is no separate Go checkpoint mirror to
// validate: Simulate2v2Battle captures checkpoints inside its own simulation
// loop, so no drift between "real" and "checkpointed" engines is possible on
// the Go side. The TypeScript mirror keeps the real-vs-mirror fail-closed
// validation.

import (
	"encoding/json"
	"os"
	"testing"
)

type twoVTwoParityScenario struct {
	ID                string                         `json:"id"`
	Territories       map[string]Territory           `json:"territories"`
	SpawnAssignments  []TwoVTwoSpawnAssignment       `json:"spawnAssignments"`
	ModifiersBySlot   map[int]PlayerUpgradeModifiers `json:"modifiersBySlot"`
	TimeLimitSeconds  float64                        `json:"timeLimitSeconds"`
	BattlefieldID     string                         `json:"battlefieldId"`
	Actions           []CanonicalTwoVTwoAction       `json:"actions"`
	ExpectedErrorCode string                         `json:"expectedErrorCode,omitempty"`
}

type twoVTwoParityResult struct {
	ID               string                   `json:"id"`
	ErrorCode        string                   `json:"errorCode,omitempty"`
	Status           string                   `json:"status"`
	StateHash        string                   `json:"stateHash"`
	ActionsProcessed int                      `json:"actionsProcessed"`
	Stats            MatchStats               `json:"stats"`
	CanonicalActions []CanonicalTwoVTwoAction `json:"canonicalActions"`
	Checkpoints      []twoVTwoCheckpoint      `json:"checkpoints"`
}

// TestParity2v2ReplayDump replays 2v2 scenarios and dumps results when
// PARITY2V2_SCENARIOS is set; otherwise it is a no-op skip.
func TestParity2v2ReplayDump(t *testing.T) {
	scenariosPath := os.Getenv("PARITY2V2_SCENARIOS")
	if scenariosPath == "" {
		t.Skip("PARITY2V2_SCENARIOS not set; skipping 2v2 cross-implementation replay dump")
	}
	outputPath := os.Getenv("PARITY2V2_OUTPUT")
	if outputPath == "" {
		outputPath = "parity_2v2_go_results.json"
	}

	raw, err := os.ReadFile(scenariosPath)
	if err != nil {
		t.Fatalf("failed to read 2v2 scenarios: %v", err)
	}
	var scenarios []twoVTwoParityScenario
	if err := json.Unmarshal(raw, &scenarios); err != nil {
		t.Fatalf("failed to parse 2v2 scenarios: %v", err)
	}

	results := make([]twoVTwoParityResult, 0, len(scenarios))
	for _, scenario := range scenarios {
		result, err := runTwoVTwoParityScenario(scenario)
		if err != nil {
			t.Fatalf("scenario %s: %v", scenario.ID, err)
		}
		if scenario.ExpectedErrorCode != "" && result.ErrorCode != scenario.ExpectedErrorCode {
			t.Fatalf("scenario %s: error code = %q, want %q", scenario.ID, result.ErrorCode, scenario.ExpectedErrorCode)
		}
		if scenario.ExpectedErrorCode == "" && result.ErrorCode != "" {
			t.Fatalf("scenario %s: unexpected fail-closed error %q", scenario.ID, result.ErrorCode)
		}
		results = append(results, *result)
	}

	payload, err := json.MarshalIndent(results, "", " ")
	if err != nil {
		t.Fatalf("failed to marshal 2v2 results: %v", err)
	}
	if err := os.WriteFile(outputPath, payload, 0o600); err != nil {
		t.Fatalf("failed to write 2v2 results: %v", err)
	}
	t.Logf("wrote %d 2v2 parity results to %s", len(results), outputPath)
}

// runTwoVTwoParityScenario executes one scenario through the real engine.
// Malformed scenarios become error-code results (fail closed on the Go side
// too), matching the TypeScript simulation error codes.
func runTwoVTwoParityScenario(scenario twoVTwoParityScenario) (*twoVTwoParityResult, error) {
	result, simErr := Simulate2v2Battle(TwoVTwoSimulationOptions{
		Territories:      scenario.Territories,
		SpawnAssignments: scenario.SpawnAssignments,
		ModifiersBySlot:  scenario.ModifiersBySlot,
		TimeLimitSeconds: scenario.TimeLimitSeconds,
		BattlefieldID:    scenario.BattlefieldID,
		Actions:          scenario.Actions,
	})
	if simErr != nil {
		return &twoVTwoParityResult{ID: scenario.ID, ErrorCode: twoVTwoErrorCode(simErr)}, nil
	}
	status := result.FinalState.Status
	if status == "playing" {
		status = "draw"
	}
	return &twoVTwoParityResult{
		ID:               scenario.ID,
		Status:           status,
		StateHash:        result.StateHash,
		ActionsProcessed: result.ActionsProcessed,
		Stats:            result.FinalState.Stats,
		CanonicalActions: result.CanonicalActions,
		Checkpoints:      result.Checkpoints,
	}, nil
}
