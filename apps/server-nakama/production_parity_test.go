package main

// Regression tests for cross-engine production-accumulator parity.
//
// The numerical audit reproduced a grant-sequence divergence on the
// production razor edge `rate = 1.1 * 1.5` with the barracks multiplier
// (effective 2.0625 units/s, 0.04125 per tick): at tick 800 the accumulated
// value sits exactly on the integer boundary in real arithmetic, where the
// TypeScript client (separate rounding per operation) computes
// 1.0000000000000033 and grants a unit while the Go server (FMA fusing
// `acc + rate*delta` into one rounding) computes 0.9999999999999999 and does
// not. The shared snap epsilon makes both engines grant on the same tick:
// accumulators within 1e-9 of an integer are snapped to it identically on
// both sides.

import (
	"testing"
)

func auditProductionTerritory(rate float64) *GameState {
	state := &GameState{
		BattlefieldID: "crown_cross",
		Territories: map[string]Territory{
			"n_center": {
				ID: "n_center", Name: "Audit Keep", X: 200, Y: 360, Radius: 32,
				Owner: TeamPlayer, Units: 0, MaxUnits: 65, ProductionRate: rate, Tier: 2, Type: TerritoryBarracks,
			},
		},
		Armies:           []MarchingArmy{},
		Status:           "playing",
		TimeLimitSeconds: 1e18,
	}
	return state
}

// TestTickGenerationGrantsOnSnappedBoundary pins the snap semantics: an
// accumulator 5e-10 BELOW the unit-grant boundary is inside the shared
// epsilon and must grant on this tick. Without the snap this test fails
// (floor(0.9999999995) == 0).
func TestTickGenerationGrantsOnSnappedBoundary(t *testing.T) {
	state := auditProductionTerritory(1.65)
	// 1 - 0.04125 - 5e-10: one tick lands 5e-10 below the boundary.
	accumulators := map[string]float64{"n_center": 0.9587499995}
	tickGeneration(state, accumulators, PvpSimulationTick)
	if units := state.Territories["n_center"].Units; units != 1 {
		t.Fatalf("accumulator 5e-10 below the grant boundary must snap and grant, got %d units", units)
	}
}

// TestTickGenerationDoesNotGrantFarBelowBoundary is the sensitivity control:
// a full 1e-7 below the boundary is outside the epsilon and must not grant.
func TestTickGenerationDoesNotGrantFarBelowBoundary(t *testing.T) {
	state := auditProductionTerritory(1.65)
	accumulators := map[string]float64{"n_center": 1 - 0.04125 - 1e-7}
	tickGeneration(state, accumulators, PvpSimulationTick)
	if units := state.Territories["n_center"].Units; units != 0 {
		t.Fatalf("accumulator 1e-7 below the grant boundary must not grant, got %d units", units)
	}
}

// TestTickGenerationGrantSequenceMatchesClientOnProductionRazorEdge replays
// the audit's reproduced divergence (rate 1.1*1.5, barracks): the client
// grants its 33rd unit at tick 800 and the server must too. Without the snap
// the server has only 32 units at tick 800 (it grants at 801) and this test
// fails.
func TestTickGenerationGrantSequenceMatchesClientOnProductionRazorEdge(t *testing.T) {
	state := auditProductionTerritory(1.1 * 1.5)
	accumulators := map[string]float64{}
	for step := 1; step <= 800; step++ {
		accumulators = tickGeneration(state, accumulators, PvpSimulationTick)
	}
	if units := state.Territories["n_center"].Units; units != 33 {
		t.Fatalf("client has 33 units at tick 800, server has %d", units)
	}
}
