package main

import (
	"errors"
	"math"
	"sort"
)

// Lane battles (candidate rules v5): a Go port of packages/game-core lanes.ts, lane-ai.ts,
// lane-engine.ts and lane-replay.ts. A drag opens a lane that streams single soldiers from a
// tower until it is cut. TestRecordedLaneWinsReplayToRecordedState replays TS-recorded winning
// runs and compares the final state, so any drift from the TS rules fails a test. Keep the
// operation order identical to the TS code: float results must match.

const (
	laneEmitSeconds   = 0.2
	laneSoldierSpeed  = 140.0
	laneEpsilon       = 1e-9
	laneKindOpen      = "lane"
	laneKindCut       = "cut"
	laneRulesVersion  = levelRulesVersion
	laneRescueMaxHold = 8
)

var laneBotTickSeconds = map[string]float64{"easy": 8, "normal": 6, "hard": 4.5}

// laneBotStartSeconds: seconds before the bot plans its first lanes (mirrors LANE_BOT_START_SECONDS).
var laneBotStartSeconds = map[string]float64{"easy": 10, "normal": 8, "hard": 2}

// laneLevelDef mirrors one LANE_LEVELS row in packages/game-core/src/lane-levels.ts.
type laneLevelDef struct {
	ID          int
	Battlefield string
	Difficulty  string
	Enemy       PlayerUpgradeModifiers
}

var laneEnemyModifiers = map[string]PlayerUpgradeModifiers{
	"easy":   {StartingUnits: 14, ProductionRateMultiplier: 0.6, ArmySpeedMultiplier: 1},
	"normal": {StartingUnits: 18, ProductionRateMultiplier: 0.8, ArmySpeedMultiplier: 1},
	"hard":   {StartingUnits: 20, ProductionRateMultiplier: 0.85, ArmySpeedMultiplier: 1},
}

var laneLevelDefs = buildLaneLevelDefs()

func buildLaneLevelDefs() []laneLevelDef {
	maps := []string{"crown_cross", "twin_passes", "royal_ring"}
	defs := make([]laneLevelDef, 0, 9)
	for d, difficulty := range []string{"easy", "normal", "hard"} {
		for m, battlefield := range maps {
			defs = append(defs, laneLevelDef{ID: d*len(maps) + m + 1, Battlefield: battlefield, Difficulty: difficulty, Enemy: laneEnemyModifiers[difficulty]})
		}
	}
	return defs
}

func laneLevelDefByID(id int) (laneLevelDef, bool) {
	for _, def := range laneLevelDefs {
		if def.ID == id {
			return def, true
		}
	}
	return laneLevelDef{}, false
}

type Lane struct {
	ID         string
	Owner      Team
	SourceID   string
	TargetID   string
	RouteIDs   []string
	NextEmitIn float64
}

type Soldier struct {
	Owner     Team
	TargetID  string
	RouteIDs  []string
	Total     float64
	Remaining float64
}

type LaneState struct {
	Lanes      []Lane
	Soldiers   []Soldier
	NextLaneID int
}

// LaneAction is one recorded player order: open a lane or cut one.
type LaneAction struct {
	Sequence  int     `json:"sequence"`
	AtSeconds float64 `json:"atSeconds"`
	Kind      string  `json:"kind"`
	SourceID  string  `json:"sourceId"`
	TargetID  string  `json:"targetId"`
}

var (
	ErrLaneTooManyActions = errors.New("lane_replay_invalid:too_many_actions")
	ErrLaneInvalidSeq     = errors.New("lane_replay_invalid:invalid_sequence")
	ErrLaneInvalidKind    = errors.New("lane_replay_invalid:invalid_action_kind")
	ErrLaneInvalidTime    = errors.New("lane_replay_invalid:invalid_timestamp")
	ErrLaneInvalidTower   = errors.New("lane_replay_invalid:invalid_territory")
)

func maxLanes(state GameState, towerID string) int {
	if t, ok := state.Territories[towerID]; ok && t.Tier > 0 {
		return t.Tier
	}
	return 1
}

func laneRouteSeconds(state GameState, route []string) float64 {
	length := 0.0
	for i := 0; i < len(route)-1; i++ {
		a, b := state.Territories[route[i]], state.Territories[route[i+1]]
		length += math.Hypot(b.X-a.X, b.Y-a.Y)
	}
	return length / laneSoldierSpeed
}

func openLane(state GameState, lanes LaneState, owner Team, sourceID, targetID string) LaneState {
	count := 0
	for _, l := range lanes.Lanes {
		if l.Owner == owner && l.SourceID == sourceID && l.TargetID == targetID {
			return lanes
		}
		if l.Owner == owner && l.SourceID == sourceID {
			count++
		}
	}
	if count >= maxLanes(state, sourceID) {
		return lanes
	}
	route := findDispatchRoute(state, sourceID, targetID, owner)
	if route == nil {
		return lanes
	}
	lane := Lane{ID: "lane_" + itoa(int64(lanes.NextLaneID)), Owner: owner, SourceID: sourceID, TargetID: targetID, RouteIDs: route}
	next := lanes
	next.Lanes = append(append([]Lane{}, lanes.Lanes...), lane)
	next.NextLaneID = lanes.NextLaneID + 1
	return next
}

func cutLane(lanes LaneState, owner Team, sourceID, targetID string) (LaneState, bool) {
	kept := make([]Lane, 0, len(lanes.Lanes))
	for _, l := range lanes.Lanes {
		if !(l.Owner == owner && l.SourceID == sourceID && l.TargetID == targetID) {
			kept = append(kept, l)
		}
	}
	if len(kept) == len(lanes.Lanes) {
		return lanes, false
	}
	lanes.Lanes = kept
	return lanes, true
}

func copyTerritories(in map[string]Territory) map[string]Territory {
	out := make(map[string]Territory, len(in))
	for id, t := range in {
		out[id] = t
	}
	return out
}

// stepLaneSimulation advances the base simulation, then the lanes by the same step.
func stepLaneSimulation(state GameState, accumulators map[string]float64, lanes LaneState, delta float64) (GameState, map[string]float64, LaneState) {
	next, acc := stepSimulation(state, accumulators, delta)
	if next.Status != "playing" {
		return next, acc, lanes
	}
	territories := copyTerritories(next.Territories)
	stats := next.Stats

	flying := make([]Soldier, 0, len(lanes.Soldiers))
	for _, soldier := range lanes.Soldiers {
		remaining := soldier.Remaining - delta
		if remaining > laneEpsilon {
			soldier.Remaining = remaining
			flying = append(flying, soldier)
			continue
		}
		target, ok := territories[soldier.TargetID]
		if !ok {
			continue
		}
		switch {
		case target.Owner == soldier.Owner:
			target.Units = minInt(target.MaxUnits, target.Units+1)
		case target.Units > 0:
			target.Units--
		default:
			target.Owner = soldier.Owner
			target.Units = 1
			if soldier.Owner == TeamPlayer {
				stats.TerritoriesCapturedByPlayer++
			} else {
				stats.TerritoriesCapturedByEnemy++
			}
		}
		territories[soldier.TargetID] = target
	}

	emitted := []Soldier{}
	nextLanes := make([]Lane, 0, len(lanes.Lanes))
	for _, lane := range lanes.Lanes {
		if territories[lane.SourceID].Owner != lane.Owner {
			continue // the source tower was lost
		}
		wait := lane.NextEmitIn - delta
		source := territories[lane.SourceID]
		for wait <= laneEpsilon {
			if source.Units > 1 {
				source.Units--
				total := laneRouteSeconds(next, lane.RouteIDs)
				emitted = append(emitted, Soldier{Owner: lane.Owner, TargetID: lane.TargetID, RouteIDs: lane.RouteIDs, Total: total, Remaining: total})
				if lane.Owner == TeamPlayer {
					stats.PlayerUnitsDispatched++
				} else {
					stats.EnemyUnitsDispatched++
				}
			}
			wait += laneEmitSeconds
			if source.Units <= 1 {
				wait = math.Max(wait, laneEmitSeconds)
				break
			}
		}
		territories[lane.SourceID] = source
		lane.NextEmitIn = wait
		nextLanes = append(nextLanes, lane)
	}

	towers := func(team Team) int {
		n := 0
		for _, t := range territories {
			if t.Owner == team {
				n++
			}
		}
		return n
	}
	inFlight := func(team Team) int {
		n := 0
		for _, s := range flying {
			if s.Owner == team {
				n++
			}
		}
		for _, s := range emitted {
			if s.Owner == team {
				n++
			}
		}
		return n
	}
	status := next.Status
	if towers(TeamEnemy) == 0 && inFlight(TeamEnemy) == 0 {
		status = "victory"
	} else if towers(TeamPlayer) == 0 && inFlight(TeamPlayer) == 0 {
		status = "defeat"
	}
	next.Territories = territories
	next.Stats = stats
	next.Status = status
	return next, acc, LaneState{Lanes: nextLanes, Soldiers: append(flying, emitted...), NextLaneID: lanes.NextLaneID}
}

func laneRegeneration(t Territory) float64 {
	if t.Owner == TeamNeutral {
		return 0
	}
	return t.ProductionRate * territoryProductionMultiplier(t.Type)
}

type laneOrder struct{ From, To string }

// planLanes mirrors lane-ai.ts planLanes at skill 0 (the bot never plays below its best).
func planLanes(state GameState, lanes LaneState, team Team) (open, cut []laneOrder) {
	rate := 1 / laneEmitSeconds
	ids := make([]string, 0, len(state.Territories))
	for id := range state.Territories {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	towers := make([]Territory, 0, len(ids))
	for _, id := range ids {
		towers = append(towers, state.Territories[id])
	}

	for _, lane := range lanes.Lanes {
		if lane.Owner != team {
			continue
		}
		target, okT := state.Territories[lane.TargetID]
		_, okS := state.Territories[lane.SourceID]
		if !okT || !okS {
			continue
		}
		finished := target.Owner == team && target.Units >= minInt(target.MaxUnits-1, 14)
		hopeless := target.Owner != team && rate <= laneRegeneration(target)+0.1
		if finished || hopeless {
			cut = append(cut, laneOrder{lane.SourceID, lane.TargetID})
		}
	}
	isCut := func(l Lane) bool {
		for _, c := range cut {
			if c.From == l.SourceID && c.To == l.TargetID {
				return true
			}
		}
		return false
	}
	active := []Lane{}
	for _, l := range lanes.Lanes {
		if l.Owner == team && !isCut(l) {
			active = append(active, l)
		}
	}
	attackedBy := func(t Territory) int {
		n := 0
		for _, l := range lanes.Lanes {
			if l.Owner != team && l.TargetID == t.ID {
				n++
			}
		}
		return n
	}
	targeted := func(t Territory) int {
		n := 0
		for _, l := range active {
			if l.TargetID == t.ID {
				n++
			}
		}
		return n
	}

	for _, source := range towers {
		if source.Owner != team || source.Units < 4 {
			continue
		}
		own := []Lane{}
		for _, l := range active {
			if l.SourceID == source.ID {
				own = append(own, l)
			}
		}
		if len(own) >= maxLanes(state, source.ID) {
			continue
		}
		hasOwnTo := func(t Territory) bool {
			for _, l := range own {
				if l.TargetID == t.ID {
					return true
				}
			}
			return false
		}

		var rescue *Territory
		for i := range towers {
			t := towers[i]
			if t.Owner != team || t.ID == source.ID || attackedBy(t) <= 0 || t.Units >= laneRescueMaxHold || source.Units < 12 || targeted(t) != 0 {
				continue
			}
			if hasOwnTo(t) || findDispatchRoute(state, source.ID, t.ID, team) == nil {
				continue
			}
			if rescue == nil || t.Units < rescue.Units || (t.Units == rescue.Units && t.ID < rescue.ID) {
				cp := t
				rescue = &cp
			}
		}
		if rescue != nil {
			open = append(open, laneOrder{source.ID, rescue.ID})
			continue
		}

		type scored struct {
			t     Territory
			score float64
		}
		options := []scored{}
		for _, t := range towers {
			if t.Owner == team || hasOwnTo(t) || targeted(t) >= 2 {
				continue
			}
			if !(rate > laneRegeneration(t)+0.2) || findDispatchRoute(state, source.ID, t.ID, team) == nil {
				continue
			}
			score := float64(t.Units)
			if t.Owner != TeamNeutral {
				score += 3
			}
			score += math.Hypot(t.X-source.X, t.Y-source.Y) / 45
			if attackedBy(t) > 0 {
				score -= 2
			}
			options = append(options, scored{t, score})
		}
		sort.SliceStable(options, func(i, j int) bool {
			if options[i].score != options[j].score {
				return options[i].score < options[j].score
			}
			return options[i].t.ID < options[j].t.ID
		})
		if len(options) > 0 {
			open = append(open, laneOrder{source.ID, options[0].t.ID})
		}
	}
	return open, cut
}

// laneEngine mirrors lane-engine.ts: the match state beside GameState.
type laneEngine struct {
	difficulty  string
	lanes       LaneState
	nextBotSecs float64
}

func newLaneEngine(difficulty string) *laneEngine {
	return &laneEngine{difficulty: difficulty, nextBotSecs: laneBotStartSeconds[difficulty]}
}

func (e *laneEngine) step(state GameState, acc map[string]float64, delta float64) (GameState, map[string]float64) {
	next, nextAcc, lanes := stepLaneSimulation(state, acc, e.lanes, delta)
	e.lanes = lanes
	if next.Status == "playing" && next.ElapsedTimeSeconds >= e.nextBotSecs-laneEpsilon {
		e.nextBotSecs += laneBotTickSeconds[e.difficulty]
		open, cut := planLanes(next, e.lanes, TeamEnemy)
		for _, o := range cut {
			e.lanes, _ = cutLane(e.lanes, TeamEnemy, o.From, o.To)
		}
		for _, o := range open {
			e.lanes = openLane(next, e.lanes, TeamEnemy, o.From, o.To)
		}
	}
	return next, nextAcc
}

func (e *laneEngine) open(state GameState, sourceID, targetID string) bool {
	source, ok := state.Territories[sourceID]
	if !ok || source.Owner != TeamPlayer || sourceID == targetID {
		return false
	}
	e.lanes = openLane(state, e.lanes, TeamPlayer, sourceID, targetID)
	for _, l := range e.lanes.Lanes {
		if l.Owner == TeamPlayer && l.SourceID == sourceID && l.TargetID == targetID {
			return true
		}
	}
	return false
}

func (e *laneEngine) cut(sourceID, targetID string) bool {
	next, removed := cutLane(e.lanes, TeamPlayer, sourceID, targetID)
	e.lanes = next
	return removed
}

// LaneBattleSummary is the outcome of a replayed lane battle.
type LaneBattleSummary struct {
	Status           string
	DurationSeconds  int
	ActionsProcessed int
}

// ReplayLaneBattle re-simulates a lane battle from the player's recorded orders on the fixed 20 ms
// clock. Orders that are not legal in the replayed state are ignored, like the live client does.
func ReplayLaneBattle(def laneLevelDef, actions []LaneAction) (GameState, LaneBattleSummary, error) {
	state := CreateInitialGameStateForBattlefield(levelPlayerModifiers, def.Enemy, def.Battlefield)
	state.GameplayRulesVersion = laneRulesVersion
	applyTacticalOpening(&state, levelPlayerModifiers, def.Enemy)

	if len(actions) > MaxPvpActions {
		return GameState{}, LaneBattleSummary{}, ErrLaneTooManyActions
	}
	previous := 0.0
	for index, a := range actions {
		if a.Sequence != index {
			return GameState{}, LaneBattleSummary{}, ErrLaneInvalidSeq
		}
		if a.Kind != laneKindOpen && a.Kind != laneKindCut {
			return GameState{}, LaneBattleSummary{}, ErrLaneInvalidKind
		}
		if !isFinite(a.AtSeconds) || a.AtSeconds < 0 || a.AtSeconds > PvpTimeLimitSeconds || a.AtSeconds < previous {
			return GameState{}, LaneBattleSummary{}, ErrLaneInvalidTime
		}
		if _, ok := state.Territories[a.SourceID]; !ok {
			return GameState{}, LaneBattleSummary{}, ErrLaneInvalidTower
		}
		if _, ok := state.Territories[a.TargetID]; !ok {
			return GameState{}, LaneBattleSummary{}, ErrLaneInvalidTower
		}
		previous = a.AtSeconds
	}

	engine := newLaneEngine(def.Difficulty)
	accumulators := map[string]float64{}
	tick := 0
	processed := 0
	stepToTick := func(target int) {
		for state.Status == "playing" && tick < target {
			state, accumulators = engine.step(state, accumulators, PvpSimulationTick)
			tick++
		}
	}
	for _, a := range actions {
		stepToTick(int(math.Floor(a.AtSeconds/PvpSimulationTick + 1e-9)))
		if state.Status != "playing" {
			break
		}
		var applied bool
		if a.Kind == laneKindOpen {
			applied = engine.open(state, a.SourceID, a.TargetID)
		} else {
			applied = engine.cut(a.SourceID, a.TargetID)
		}
		if applied {
			processed++
		}
	}
	stepToTick(int(math.Ceil(PvpTimeLimitSeconds/PvpSimulationTick)) + 5)
	status := state.Status
	if status == "playing" {
		status = "draw"
	}
	return state, LaneBattleSummary{Status: status, DurationSeconds: int(math.Floor(state.ElapsedTimeSeconds)), ActionsProcessed: processed}, nil
}
