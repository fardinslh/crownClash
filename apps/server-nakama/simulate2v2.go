package main

// Deterministic 2v2 simulation mirror (Phase 2 of docs/2v2-architecture.md).
//
// This file mirrors the inert TypeScript 2v2 simulator in
// packages/game-core/src/pvp2v2.ts and init2v2.ts step-for-step, reusing the
// EXISTING authoritative Go primitives (dispatchArmy, stepSimulation,
// tickGeneration, resolveArrival) without forking them. It exists only so the
// cross-engine parity harness can prove TS/Go agreement for four-player
// fixtures; it is not wired into matchmaking or any live match handler.
//
// Canonical action ordering is (tick, serverSeq, slot, clientSeq) per
// architecture §6.2; serverSeq is globally unique and already fully orders
// actions inside a tick, so slot/clientSeq are audit fields. Every
// validation failure fails closed with the same error code string the
// TypeScript TwoVTwoSimulationError carries.

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
)

// CanonicalTwoVTwoAction mirrors CanonicalTwoVTwoAction (pvp2v2.ts).
type CanonicalTwoVTwoAction struct {
	SchemaVersion int    `json:"schemaVersion"`
	Tick          int    `json:"tick"`
	ServerSeq     int    `json:"serverSeq"`
	Slot          int    `json:"slot"`
	ClientSeq     int    `json:"clientSeq"`
	SourceID      string `json:"sourceId"`
	TargetID      string `json:"targetId"`
}

// TwoVTwoSpawnAssignment mirrors TwoVTwoSpawnAssignment (init2v2.ts).
type TwoVTwoSpawnAssignment struct {
	Slot        int    `json:"slot"`
	TerritoryID string `json:"territoryId"`
}

// 2v2 simulation error codes — MUST match TwoVTwoSimulationErrorCode (pvp2v2.ts).
const (
	twoVTwoErrTooManyActions       = "too_many_actions"
	twoVTwoErrInvalidSchemaVersion = "invalid_schema_version"
	twoVTwoErrInvalidTick          = "invalid_tick"
	twoVTwoErrInvalidServerSeq     = "invalid_server_sequence"
	twoVTwoErrInvalidClientSeq     = "invalid_client_sequence"
	twoVTwoErrInvalidSlot          = "invalid_slot"
	twoVTwoErrInvalidSource        = "invalid_source"
	twoVTwoErrInvalidTarget        = "invalid_target"
	twoVTwoErrSlotNotPermitted     = "slot_not_permitted"
	twoVTwoErrInvalidDispatch      = "invalid_dispatch"
	twoVTwoErrActionAfterBattleEnd = "action_after_battle_end"
)

type twoVTwoError struct{ code string }

func (e *twoVTwoError) Error() string { return "2v2_simulation_invalid:" + e.code }

func twoVTwoErrorCode(err error) string {
	if err == nil {
		return ""
	}
	if te, ok := err.(*twoVTwoError); ok {
		return te.code
	}
	// JSON/type-level failures (fractional or out-of-range numbers rejected
	// at unmarshal time) are fail-closed equivalents of the TypeScript
	// Number.isSafeInteger guards.
	return twoVTwoErrInvalidTick
}

func newTwoVTwoError(code string) error { return &twoVTwoError{code: code} }

// TeamIDForSlot mirrors teamIdForSlot (init2v2.ts).
func TeamIDForSlot(slot int) TeamID {
	if slot < 2 {
		return TeamIDA
	}
	return TeamIDB
}

// SimulationOwnerForSlot mirrors simulationOwnerForSlot (init2v2.ts).
func SimulationOwnerForSlot(slot int) Team {
	if TeamIDForSlot(slot) == TeamIDA {
		return TeamPlayer
	}
	return TeamEnemy
}

const (
	twoVTwoSlotCount         = 4
	twoVTwoDefaultMaxActions = 4 * 120 // MAX_PVP_ACTIONS * 4 (pvp2v2.ts DEFAULT_MAX_ACTIONS)
)

// TwoVTwoSimulationOptions mirrors TwoVTwoSimulationOptions (pvp2v2.ts).
type TwoVTwoSimulationOptions struct {
	Territories      map[string]Territory           `json:"territories"`
	SpawnAssignments []TwoVTwoSpawnAssignment       `json:"spawnAssignments"`
	ModifiersBySlot  map[int]PlayerUpgradeModifiers `json:"modifiersBySlot"`
	TimeLimitSeconds float64                        `json:"timeLimitSeconds"`
	BattlefieldID    string                         `json:"battlefieldId"`
	Actions          []CanonicalTwoVTwoAction       `json:"actions"`
	MaxActions       int                            `json:"maxActions,omitempty"`
}

// TwoVTwoSimulationResult mirrors TwoVTwoSimulationResult (pvp2v2.ts), plus
// parity checkpoints for the cross-engine harness.
type TwoVTwoSimulationResult struct {
	CanonicalActions []CanonicalTwoVTwoAction `json:"canonicalActions"`
	FinalState       GameState                `json:"finalState"`
	StateHash        string                   `json:"stateHash"`
	ActionsProcessed int                      `json:"actionsProcessed"`
	Checkpoints      []twoVTwoCheckpoint      `json:"checkpoints"`
}

type twoVTwoCheckpointTerritory struct {
	Owner          Team    `json:"owner"`
	Units          int     `json:"units"`
	ProductionRate float64 `json:"productionRate"`
}

type twoVTwoCheckpointArmy struct {
	ID       string  `json:"id"`
	Owner    Team    `json:"owner"`
	Units    int     `json:"units"`
	SourceID string  `json:"sourceId"`
	TargetID string  `json:"targetId"`
	Progress float64 `json:"progress"`
	Speed    float64 `json:"speed"`
}

type twoVTwoCheckpoint struct {
	Kind         string                                `json:"kind"`
	At           float64                               `json:"at"`
	Status       string                                `json:"status"`
	Elapsed      float64                               `json:"elapsed"`
	Territories  map[string]twoVTwoCheckpointTerritory `json:"territories"`
	Armies       []twoVTwoCheckpointArmy               `json:"armies"`
	Accumulators map[string]float64                    `json:"accumulators"`
}

// CreateInitial2v2GameState mirrors createInitial2v2GameState (init2v2.ts):
// per-slot modifiers apply ONLY to that slot's assigned spawn; all other
// territories pass through unchanged.
func CreateInitial2v2GameState(territories map[string]Territory, spawnAssignments []TwoVTwoSpawnAssignment, modifiersBySlot map[int]PlayerUpgradeModifiers, timeLimitSeconds float64, battlefieldID string) (GameState, error) {
	if len(spawnAssignments) != twoVTwoSlotCount {
		return GameState{}, fmt.Errorf("2v2_initialization_invalid:spawn_assignments")
	}
	seenSlots := map[int]bool{}
	seenTerritories := map[string]bool{}
	for _, assignment := range spawnAssignments {
		if assignment.Slot < 0 || assignment.Slot >= twoVTwoSlotCount {
			return GameState{}, fmt.Errorf("2v2_initialization_invalid:slot")
		}
		if seenSlots[assignment.Slot] || seenTerritories[assignment.TerritoryID] {
			return GameState{}, fmt.Errorf("2v2_initialization_invalid:spawn_assignments")
		}
		territory, ok := territories[assignment.TerritoryID]
		if !ok {
			return GameState{}, fmt.Errorf("2v2_initialization_invalid:spawn_not_found")
		}
		if territory.Owner != SimulationOwnerForSlot(assignment.Slot) {
			return GameState{}, fmt.Errorf("2v2_initialization_invalid:spawn_owner")
		}
		seenSlots[assignment.Slot] = true
		seenTerritories[assignment.TerritoryID] = true
	}

	cloned := make(map[string]Territory, len(territories))
	for id, territory := range territories {
		cloned[id] = territory
	}
	for _, assignment := range spawnAssignments {
		spawn := cloned[assignment.TerritoryID]
		modifiers := modifiersBySlot[assignment.Slot]
		spawn.Units = modifiers.StartingUnits
		spawn.ProductionRate = spawn.ProductionRate * modifiers.ProductionRateMultiplier
		cloned[assignment.TerritoryID] = spawn
	}

	if timeLimitSeconds <= 0 {
		timeLimitSeconds = PvpTimeLimitSeconds
	}
	return GameState{
		BattlefieldID:      battlefieldID,
		Territories:        cloned,
		Armies:             []MarchingArmy{},
		Status:             "playing",
		ElapsedTimeSeconds: 0,
		TimeLimitSeconds:   timeLimitSeconds,
		Stats:              MatchStats{},
	}, nil
}

// canonicalizeTwoVTwoActions mirrors canonicalizeTwoVTwoActions (pvp2v2.ts):
// stable sort by (tick, serverSeq, slot, clientSeq), then fail-closed
// validation of schema version, tick, globally unique serverSeq, slot range,
// per-slot contiguous clientSeq, and non-empty endpoint ids.
func canonicalizeTwoVTwoActions(actions []CanonicalTwoVTwoAction, maxActions int) ([]CanonicalTwoVTwoAction, error) {
	if maxActions <= 0 {
		maxActions = twoVTwoDefaultMaxActions
	}
	if len(actions) > maxActions {
		return nil, newTwoVTwoError(twoVTwoErrTooManyActions)
	}

	canonical := make([]CanonicalTwoVTwoAction, len(actions))
	copy(canonical, actions)
	sort.SliceStable(canonical, func(left, right int) bool {
		if canonical[left].Tick != canonical[right].Tick {
			return canonical[left].Tick < canonical[right].Tick
		}
		if canonical[left].ServerSeq != canonical[right].ServerSeq {
			return canonical[left].ServerSeq < canonical[right].ServerSeq
		}
		if canonical[left].Slot != canonical[right].Slot {
			return canonical[left].Slot < canonical[right].Slot
		}
		return canonical[left].ClientSeq < canonical[right].ClientSeq
	})

	seenServerSequences := map[int]bool{}
	nextClientSequence := [twoVTwoSlotCount]int{}
	for _, action := range canonical {
		if action.SchemaVersion != MatchSchemaVersion2 {
			return nil, newTwoVTwoError(twoVTwoErrInvalidSchemaVersion)
		}
		if action.Tick < 0 {
			return nil, newTwoVTwoError(twoVTwoErrInvalidTick)
		}
		if action.ServerSeq < 0 || seenServerSequences[action.ServerSeq] {
			return nil, newTwoVTwoError(twoVTwoErrInvalidServerSeq)
		}
		if action.Slot < 0 || action.Slot >= twoVTwoSlotCount {
			return nil, newTwoVTwoError(twoVTwoErrInvalidSlot)
		}
		if action.ClientSeq != nextClientSequence[action.Slot] {
			return nil, newTwoVTwoError(twoVTwoErrInvalidClientSeq)
		}
		if action.SourceID == "" {
			return nil, newTwoVTwoError(twoVTwoErrInvalidSource)
		}
		if action.TargetID == "" {
			return nil, newTwoVTwoError(twoVTwoErrInvalidTarget)
		}
		seenServerSequences[action.ServerSeq] = true
		nextClientSequence[action.Slot]++
	}
	return canonical, nil
}

// Simulate2v2Battle mirrors simulate2v2Battle (pvp2v2.ts) over the EXISTING
// authoritative Go primitives (dispatchArmy/stepSimulation). Diverging
// validation produces the same fail-closed error codes as TypeScript.
func Simulate2v2Battle(options TwoVTwoSimulationOptions) (TwoVTwoSimulationResult, error) {
	canonicalActions, err := canonicalizeTwoVTwoActions(options.Actions, options.MaxActions)
	if err != nil {
		return TwoVTwoSimulationResult{}, err
	}
	if len(options.ModifiersBySlot) != twoVTwoSlotCount {
		return TwoVTwoSimulationResult{}, fmt.Errorf("2v2_initialization_invalid:modifiers")
	}
	state, err := CreateInitial2v2GameState(
		options.Territories, options.SpawnAssignments, options.ModifiersBySlot,
		options.TimeLimitSeconds, options.BattlefieldID,
	)
	if err != nil {
		return TwoVTwoSimulationResult{}, err
	}
	accumulators := map[string]float64{}
	currentTick := 0
	actionsProcessed := 0
	maximumTick := int(math.Floor(state.TimeLimitSeconds/PvpSimulationTick + 1e-9))
	checkpoints := []twoVTwoCheckpoint{}

	stepUntil := func(targetTick int) {
		for state.Status == "playing" && currentTick < targetTick {
			state, accumulators = stepSimulation(state, accumulators, PvpSimulationTick)
			currentTick++
		}
	}
	capture := func(kind string) {
		captureTwoVTwoCheckpoint(&checkpoints, kind, float64(currentTick)*PvpSimulationTick, state, accumulators)
	}

	for _, action := range canonicalActions {
		if action.Tick > maximumTick {
			return TwoVTwoSimulationResult{}, newTwoVTwoError(twoVTwoErrInvalidTick)
		}
		stepUntil(action.Tick)
		if state.Status != "playing" {
			return TwoVTwoSimulationResult{}, newTwoVTwoError(twoVTwoErrActionAfterBattleEnd)
		}

		source, exists := state.Territories[action.SourceID]
		if !exists {
			return TwoVTwoSimulationResult{}, newTwoVTwoError(twoVTwoErrInvalidSource)
		}
		if _, exists := state.Territories[action.TargetID]; !exists {
			return TwoVTwoSimulationResult{}, newTwoVTwoError(twoVTwoErrInvalidTarget)
		}
		owner := SimulationOwnerForSlot(action.Slot)
		if source.Owner != owner {
			return TwoVTwoSimulationResult{}, newTwoVTwoError(twoVTwoErrSlotNotPermitted)
		}
		// Per-action acting-slot speed modifier; army id mirrors
		// `2v2_${tick}_${serverSeq}_${slot}_${clientSeq}` (pvp2v2.ts).
		armyID := fmt.Sprintf("2v2_%d_%d_%d_%d", action.Tick, action.ServerSeq, action.Slot, action.ClientSeq)
		if err := dispatchArmy(&state, action.SourceID, action.TargetID, owner, options.ModifiersBySlot[action.Slot].ArmySpeedMultiplier, armyID); err != nil {
			// dispatchArmy fails closed on self-target, empty armies, and
			// ownership drift with the same codes the TS mirror throws.
			switch err {
			case ErrPvpInvalidSource:
				return TwoVTwoSimulationResult{}, newTwoVTwoError(twoVTwoErrInvalidSource)
			case ErrPvpInvalidTarget:
				return TwoVTwoSimulationResult{}, newTwoVTwoError(twoVTwoErrInvalidTarget)
			default:
				return TwoVTwoSimulationResult{}, newTwoVTwoError(twoVTwoErrInvalidDispatch)
			}
		}
		actionsProcessed++
		capture("action")
	}

	stepUntil(maximumTick)
	if state.Status == "playing" {
		remainder := state.TimeLimitSeconds - state.ElapsedTimeSeconds
		state, accumulators = stepSimulation(state, accumulators, math.Max(0, remainder))
	}
	capture("final")

	return TwoVTwoSimulationResult{
		CanonicalActions: canonicalActions,
		FinalState:       state,
		StateHash:        HashTwoVTwoState(state),
		ActionsProcessed: actionsProcessed,
		Checkpoints:      checkpoints,
	}, nil
}

func captureTwoVTwoCheckpoint(checkpoints *[]twoVTwoCheckpoint, kind string, at float64, state GameState, accumulators map[string]float64) {
	territories := make(map[string]twoVTwoCheckpointTerritory, len(state.Territories))
	for id, territory := range state.Territories {
		territories[id] = twoVTwoCheckpointTerritory{
			Owner: territory.Owner, Units: territory.Units, ProductionRate: territory.ProductionRate,
		}
	}
	armies := make([]twoVTwoCheckpointArmy, 0, len(state.Armies))
	for _, army := range state.Armies {
		armies = append(armies, twoVTwoCheckpointArmy{
			ID: army.ID, Owner: army.Owner, Units: army.Units,
			SourceID: army.SourceID, TargetID: army.TargetID,
			Progress: army.Progress, Speed: army.Speed,
		})
	}
	accumulatorsCopy := make(map[string]float64, len(accumulators))
	for id, accumulator := range accumulators {
		accumulatorsCopy[id] = accumulator
	}
	*checkpoints = append(*checkpoints, twoVTwoCheckpoint{
		Kind: kind, At: at, Status: state.Status, Elapsed: state.ElapsedTimeSeconds,
		Territories: territories, Armies: armies, Accumulators: accumulatorsCopy,
	})
}

// HashTwoVTwoState mirrors hashTwoVTwoState (pvp2v2.ts): FNV-1a 32-bit over
// the canonical JSON serialization of the state (territory keys sorted —
// Go's encoding/json sorts map keys natively, matching the TypeScript
// Object.entries sort).
func HashTwoVTwoState(state GameState) string {
	serialized, err := json.Marshal(state)
	if err != nil {
		panic(err)
	}
	hash := uint32(0x811c9dc5)
	for _, octet := range serialized {
		hash ^= uint32(octet)
		hash *= 0x01000193
	}
	return fmt.Sprintf("%08x", hash)
}
