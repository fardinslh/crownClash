package main

// Deterministic 2v2 simulation unit tests (Phase 2 of docs/2v2-architecture.md).
//
// These run in every normal `go test ./...` and pin the fail-closed error
// codes, slot ownership mapping, per-slot modifiers, canonical ordering, and
// run-to-run determinism of the Go 2v2 mirror. Cross-engine agreement itself
// is proven by TestParity2v2ReplayDump + test/scripts/bot_parity_2v2_crosscheck.mjs.

import (
	"math"
	"sort"
	"testing"
)

// The parity fixture is an INJECTABLE 2v2 territory set (not a production
// battlefield). The existing authoritative stepSimulation/tickGeneration
// iterate territoryOrderForBattlefield(state.BattlefieldID), which falls back
// to the crown_cross order for unknown ids; that fallback contains none of
// the fixture ids and would make the win check see zero territories. So the
// test binary registers the fixture's deterministic (sorted) order under a
// dedicated test-only battlefield id. Production builds never link test
// files, and the id can never collide with a production battlefield.
const twoVTwoFixtureBattlefieldID = "2v2_parity_fixture"

func init() {
	fixture := twoVTwoFixtureTerritories()
	ids := make([]string, 0, len(fixture))
	for id := range fixture {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	authoritativeBattlefieldOrders[twoVTwoFixtureBattlefieldID] = ids
}

func twoVTwoFixtureTerritories() map[string]Territory {
	// Keys built in sorted order so both engines iterate identical orders.
	territories := map[string]Territory{}
	// a_east, a_west, b_east, b_west, center — sorted insertion.
	ordered := []struct {
		id    string
		x     float64
		y     float64
		owner Team
	}{
		{"a_east", 340, 600, TeamPlayer},
		{"a_west", 60, 600, TeamPlayer},
		{"b_east", 340, 120, TeamEnemy},
		{"b_west", 60, 120, TeamEnemy},
		{"center", 200, 360, TeamNeutral},
	}
	for _, tc := range ordered {
		territories[tc.id] = Territory{
			ID: tc.id, Name: tc.id, X: tc.x, Y: tc.y, Radius: 25,
			Owner: tc.owner, Units: 10, MaxUnits: 100,
			ProductionRate: 1, Tier: 1, Type: TerritoryBarracks,
		}
	}
	return territories
}

func twoVTwoTestSpawns() []TwoVTwoSpawnAssignment {
	return []TwoVTwoSpawnAssignment{
		{Slot: 0, TerritoryID: "a_west"},
		{Slot: 1, TerritoryID: "a_east"},
		{Slot: 2, TerritoryID: "b_west"},
		{Slot: 3, TerritoryID: "b_east"},
	}
}

func twoVTwoTestModifiers() map[int]PlayerUpgradeModifiers {
	return map[int]PlayerUpgradeModifiers{
		0: {StartingUnits: 20, ProductionRateMultiplier: 1, ArmySpeedMultiplier: 1},
		1: {StartingUnits: 24, ProductionRateMultiplier: 1.1, ArmySpeedMultiplier: 1.2},
		2: {StartingUnits: 28, ProductionRateMultiplier: 1.2, ArmySpeedMultiplier: 1.4},
		3: {StartingUnits: 32, ProductionRateMultiplier: 1.3, ArmySpeedMultiplier: 1.6},
	}
}

func twoVTwoAction(schemaVersion, tick, serverSeq, slot, clientSeq int, sourceID, targetID string) CanonicalTwoVTwoAction {
	return CanonicalTwoVTwoAction{
		SchemaVersion: schemaVersion, Tick: tick, ServerSeq: serverSeq,
		Slot: slot, ClientSeq: clientSeq, SourceID: sourceID, TargetID: targetID,
	}
}

func twoVTwoTestOptions(actions []CanonicalTwoVTwoAction, timeLimitSeconds float64) TwoVTwoSimulationOptions {
	return TwoVTwoSimulationOptions{
		Territories:      twoVTwoFixtureTerritories(),
		SpawnAssignments: twoVTwoTestSpawns(),
		ModifiersBySlot:  twoVTwoTestModifiers(),
		TimeLimitSeconds: timeLimitSeconds,
		BattlefieldID:    twoVTwoFixtureBattlefieldID,
		Actions:          actions,
	}
}

func TestTwoVTwoSlotOwnershipMapping(t *testing.T) {
	for slot := 0; slot < 4; slot++ {
		wantTeam := TeamIDA
		wantOwner := TeamPlayer
		if slot >= 2 {
			wantTeam = TeamIDB
			wantOwner = TeamEnemy
		}
		if got := TeamIDForSlot(slot); got != wantTeam {
			t.Fatalf("TeamIDForSlot(%d) = %s, want %s", slot, got, wantTeam)
		}
		if got := SimulationOwnerForSlot(slot); got != wantOwner {
			t.Fatalf("SimulationOwnerForSlot(%d) = %s, want %s", slot, got, wantOwner)
		}
	}
}

func TestTwoVTwoInitialModifiersOnlyTouchAssignedSpawns(t *testing.T) {
	state, err := CreateInitial2v2GameState(
		twoVTwoFixtureTerritories(), twoVTwoTestSpawns(), twoVTwoTestModifiers(), 0.02, "")
	if err != nil {
		t.Fatalf("initialization failed: %v", err)
	}
	expectedUnits := map[string]int{"a_west": 20, "a_east": 24, "b_west": 28, "b_east": 32, "center": 10}
	expectedProduction := map[string]float64{"a_west": 1, "a_east": 1.1, "b_west": 1.2, "b_east": 1.3, "center": 1}
	for id, units := range expectedUnits {
		if state.Territories[id].Units != units {
			t.Fatalf("territory %s units = %d, want %d", id, state.Territories[id].Units, units)
		}
		if state.Territories[id].ProductionRate != expectedProduction[id] {
			t.Fatalf("territory %s productionRate = %v, want %v", id, state.Territories[id].ProductionRate, expectedProduction[id])
		}
	}
}

func TestTwoVTwoSharedDispatchBothTeammates(t *testing.T) {
	result, err := Simulate2v2Battle(twoVTwoTestOptions([]CanonicalTwoVTwoAction{
		twoVTwoAction(2, 0, 0, 0, 0, "a_west", "center"),
		twoVTwoAction(2, 0, 1, 1, 0, "a_west", "center"),
	}, 0.02))
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}
	if result.ActionsProcessed != 2 {
		t.Fatalf("actionsProcessed = %d, want 2", result.ActionsProcessed)
	}
	if result.FinalState.Stats.PlayerUnitsDispatched != 15 {
		t.Fatalf("playerUnitsDispatched = %v, want 15 (10 + 5 from the shared source)", result.FinalState.Stats.PlayerUnitsDispatched)
	}
	for _, army := range result.FinalState.Armies {
		if army.Owner != TeamPlayer {
			t.Fatalf("teammate dispatch produced army owner %s", army.Owner)
		}
	}
}

func TestTwoVTwoFailClosedCodes(t *testing.T) {
	cases := []struct {
		name     string
		actions  []CanonicalTwoVTwoAction
		timeLim  float64
		wantCode string
	}{
		{
			"duplicate_server_sequence",
			[]CanonicalTwoVTwoAction{twoVTwoAction(2, 0, 0, 0, 0, "a_west", "center"), twoVTwoAction(2, 0, 0, 1, 0, "a_east", "center")},
			0.02, twoVTwoErrInvalidServerSeq,
		},
		{
			"non_contiguous_client_sequence",
			[]CanonicalTwoVTwoAction{twoVTwoAction(2, 0, 0, 0, 1, "a_west", "center")},
			0.02, twoVTwoErrInvalidClientSeq,
		},
		{
			"invalid_slot",
			[]CanonicalTwoVTwoAction{twoVTwoAction(2, 0, 0, 4, 0, "a_west", "center")},
			0.02, twoVTwoErrInvalidSlot,
		},
		{
			"unsupported_schema_version",
			[]CanonicalTwoVTwoAction{twoVTwoAction(1, 0, 0, 0, 0, "a_west", "center")},
			0.02, twoVTwoErrInvalidSchemaVersion,
		},
		{
			"negative_tick",
			[]CanonicalTwoVTwoAction{twoVTwoAction(2, -1, 0, 0, 0, "a_west", "center")},
			0.02, twoVTwoErrInvalidTick,
		},
		{
			"tick_beyond_time_limit",
			[]CanonicalTwoVTwoAction{twoVTwoAction(2, 9999, 0, 0, 0, "a_west", "center")},
			0.02, twoVTwoErrInvalidTick,
		},
		{
			"missing_source",
			[]CanonicalTwoVTwoAction{twoVTwoAction(2, 0, 0, 0, 0, "missing", "center")},
			0.02, twoVTwoErrInvalidSource,
		},
		{
			"missing_target",
			[]CanonicalTwoVTwoAction{twoVTwoAction(2, 0, 0, 0, 0, "a_west", "missing")},
			0.02, twoVTwoErrInvalidTarget,
		},
		{
			"cross_team_source",
			[]CanonicalTwoVTwoAction{twoVTwoAction(2, 0, 0, 2, 0, "a_west", "center")},
			0.02, twoVTwoErrSlotNotPermitted,
		},
		{
			"self_target",
			[]CanonicalTwoVTwoAction{twoVTwoAction(2, 0, 0, 0, 0, "a_west", "a_west")},
			0.02, twoVTwoErrInvalidDispatch,
		},
	}
	for _, testCase := range cases {
		_, err := Simulate2v2Battle(twoVTwoTestOptions(testCase.actions, testCase.timeLim))
		if err == nil {
			t.Fatalf("%s: expected error %s, got none", testCase.name, testCase.wantCode)
		}
		if got := twoVTwoErrorCode(err); got != testCase.wantCode {
			t.Fatalf("%s: error code = %s, want %s", testCase.name, got, testCase.wantCode)
		}
	}
}

func TestTwoVTwoCanonicalOrderResolvesShuffledInput(t *testing.T) {
	ordered := []CanonicalTwoVTwoAction{
		twoVTwoAction(2, 0, 0, 0, 0, "a_west", "center"),
		twoVTwoAction(2, 0, 1, 1, 0, "a_west", "center"),
	}
	shuffled := []CanonicalTwoVTwoAction{ordered[1], ordered[0]}

	first, err := Simulate2v2Battle(twoVTwoTestOptions(shuffled, 0.02))
	if err != nil {
		t.Fatalf("shuffled simulation failed: %v", err)
	}
	second, err := Simulate2v2Battle(twoVTwoTestOptions(ordered, 0.02))
	if err != nil {
		t.Fatalf("ordered simulation failed: %v", err)
	}
	if len(first.CanonicalActions) != 2 ||
		first.CanonicalActions[0].ServerSeq != 0 || first.CanonicalActions[1].ServerSeq != 1 {
		t.Fatalf("canonical order not restored: %+v", first.CanonicalActions)
	}
	if first.StateHash != second.StateHash || first.ActionsProcessed != second.ActionsProcessed {
		t.Fatalf("shuffled vs ordered divergence: hash %s/%s actions %d/%d",
			first.StateHash, second.StateHash, first.ActionsProcessed, second.ActionsProcessed)
	}
}

func TestTwoVTwoDeterministicGoldenHash(t *testing.T) {
	actions := []CanonicalTwoVTwoAction{
		twoVTwoAction(2, 0, 0, 0, 0, "a_west", "center"),
		twoVTwoAction(2, 1, 1, 2, 0, "b_west", "center"),
		twoVTwoAction(2, 2, 2, 1, 0, "a_east", "center"),
		twoVTwoAction(2, 3, 3, 3, 0, "b_east", "center"),
	}
	first, err := Simulate2v2Battle(twoVTwoTestOptions(actions, 1))
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}
	second, err := Simulate2v2Battle(twoVTwoTestOptions(actions, 1))
	if err != nil {
		t.Fatalf("second simulation failed: %v", err)
	}
	if first.StateHash != second.StateHash {
		t.Fatalf("nondeterministic state hash: %s vs %s", first.StateHash, second.StateHash)
	}
	if len(first.Checkpoints) != len(actions)+1 {
		t.Fatalf("checkpoint count = %d, want %d (one per action + final)", len(first.Checkpoints), len(actions)+1)
	}
}

func TestTwoVTwoTooManyActions(t *testing.T) {
	actions := make([]CanonicalTwoVTwoAction, 0, twoVTwoDefaultMaxActions+1)
	for i := 0; i <= twoVTwoDefaultMaxActions; i++ {
		slot := i % twoVTwoSlotCount
		actions = append(actions, twoVTwoAction(2, i/4, i, slot, i/4, "a_west", "center"))
	}
	if _, err := Simulate2v2Battle(twoVTwoTestOptions(actions, 1)); twoVTwoErrorCode(err) != twoVTwoErrTooManyActions {
		t.Fatalf("error = %v, want %s", err, twoVTwoErrTooManyActions)
	}
}

func TestTwoVTwoActionAfterBattleEnd(t *testing.T) {
	// One dispatch at a tick after the time limit already elapsed in tick
	// terms is rejected by the tick bound; to hit action_after_battle_end
	// the battle must END early (base captured) with a later action queued.
	conquest := []CanonicalTwoVTwoAction{
		twoVTwoAction(2, 0, 0, 0, 0, "a_west", "center"),
		twoVTwoAction(2, 0, 1, 0, 1, "a_west", "center"),
		twoVTwoAction(2, 20, 2, 0, 2, "a_west", "center"),
	}
	_, err := Simulate2v2Battle(twoVTwoTestOptions(conquest, 1))
	if err != nil && twoVTwoErrorCode(err) != twoVTwoErrActionAfterBattleEnd {
		t.Fatalf("error = %v, want %s (or nil if battle still playing)", err, twoVTwoErrActionAfterBattleEnd)
	}
}

func TestTwoVTwoStableSourceSpeedMultiplier(t *testing.T) {
	territories := twoVTwoFixtureTerritories()
	stable := territories["a_west"]
	stable.Type = TerritoryStable
	territories["a_west"] = stable
	barracks := twoVTwoFixtureTerritories()["a_west"]

	slow, err := Simulate2v2Battle(TwoVTwoSimulationOptions{
		Territories:      map[string]Territory{"a_west": barracks, "a_east": territories["a_east"], "center": territories["center"], "b_west": territories["b_west"], "b_east": territories["b_east"]},
		SpawnAssignments: twoVTwoTestSpawns(), ModifiersBySlot: twoVTwoTestModifiers(),
		TimeLimitSeconds: 0.02, BattlefieldID: twoVTwoFixtureBattlefieldID,
		Actions: []CanonicalTwoVTwoAction{twoVTwoAction(2, 0, 0, 0, 0, "a_west", "center")},
	})
	if err != nil {
		t.Fatalf("barracks simulation failed: %v", err)
	}
	fast, err := Simulate2v2Battle(TwoVTwoSimulationOptions{
		Territories:      map[string]Territory{"a_west": stable, "a_east": territories["a_east"], "center": territories["center"], "b_west": territories["b_west"], "b_east": territories["b_east"]},
		SpawnAssignments: twoVTwoTestSpawns(), ModifiersBySlot: twoVTwoTestModifiers(),
		TimeLimitSeconds: 0.02, BattlefieldID: twoVTwoFixtureBattlefieldID,
		Actions: []CanonicalTwoVTwoAction{twoVTwoAction(2, 0, 0, 0, 0, "a_west", "center")},
	})
	if err != nil {
		t.Fatalf("stable simulation failed: %v", err)
	}
	want := slow.FinalState.Armies[0].Speed * stableArmySpeedMultiplier
	got := fast.FinalState.Armies[0].Speed
	if math.Abs(got-want) > 1e-12 {
		t.Fatalf("stable speed = %v, want ~%v (barracks %v x %v)",
			got, want, slow.FinalState.Armies[0].Speed, stableArmySpeedMultiplier)
	}
}
