package main

import (
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"testing"
)

func TestLaneLevelDefsMatchClientShape(t *testing.T) {
	if len(laneLevelDefs) != 9 {
		t.Fatalf("lane levels = %d, want 9", len(laneLevelDefs))
	}
	maps := map[string]map[string]bool{"easy": {}, "normal": {}, "hard": {}}
	for index, def := range laneLevelDefs {
		if def.ID != index+1 {
			t.Errorf("lane level %d has id %d", index+1, def.ID)
		}
		maps[def.Difficulty][def.Battlefield] = true
		if def.Enemy != laneEnemyModifiers[def.Difficulty] {
			t.Errorf("lane level %d enemy modifiers differ from its difficulty's", def.ID)
		}
	}
	for difficulty, seen := range maps {
		if len(seen) != 3 {
			t.Errorf("%s visits %d maps, want 3", difficulty, len(seen))
		}
	}
	if !(laneBotTickSeconds["easy"] > laneBotTickSeconds["normal"] && laneBotTickSeconds["normal"] > laneBotTickSeconds["hard"]) {
		t.Error("the lane bot must react faster on harder difficulties")
	}
}

func TestLaneOpenCutAndTierCap(t *testing.T) {
	def := laneLevelDefs[0]
	state := CreateInitialGameStateForBattlefield(levelPlayerModifiers, def.Enemy, def.Battlefield)
	state.GameplayRulesVersion = laneRulesVersion
	applyTacticalOpening(&state, levelPlayerModifiers, def.Enemy)
	engine := newLaneEngine("easy")
	if !engine.open(state, "p_base", "n_bot_left") {
		t.Fatal("a legal lane must open")
	}
	if engine.open(state, "p_base", "p_base") || engine.open(state, "e_base", "n_center") {
		t.Fatal("a lane to itself or from a tower the player does not hold must be refused")
	}
	tower := state.Territories["p_base"]
	tower.Tier = 1
	state.Territories["p_base"] = tower
	for _, id := range []string{"n_bot_right", "n_center"} {
		n := state.Territories[id]
		n.Owner = TeamNeutral
		state.Territories[id] = n
	}
	if engine.open(state, "p_base", "n_bot_right") {
		t.Fatal("a tier-1 tower with a lane running has no free path")
	}
	if !engine.cut("p_base", "n_bot_left") || engine.cut("p_base", "n_bot_left") {
		t.Fatal("cut must remove the lane once")
	}
	if !engine.open(state, "p_base", "n_bot_right") {
		t.Fatal("a cut frees the path")
	}
}

func TestLaneReplayRejectsMalformedActions(t *testing.T) {
	def := laneLevelDefs[0]
	act := func(seq int, at float64, kind, s, g string) LaneAction {
		return LaneAction{Sequence: seq, AtSeconds: at, Kind: kind, SourceID: s, TargetID: g}
	}
	tooMany := make([]LaneAction, MaxPvpActions+1)
	for i := range tooMany {
		tooMany[i] = act(i, 0, "lane", "p_base", "n_bot_left")
	}
	cases := []struct {
		name    string
		actions []LaneAction
		want    error
	}{
		{"too many", tooMany, ErrLaneTooManyActions},
		{"sequence", []LaneAction{act(1, 0, "lane", "p_base", "n_bot_left")}, ErrLaneInvalidSeq},
		{"kind", []LaneAction{act(0, 0, "ability", "p_base", "n_bot_left")}, ErrLaneInvalidKind},
		{"negative time", []LaneAction{act(0, -1, "lane", "p_base", "n_bot_left")}, ErrLaneInvalidTime},
		{"time goes back", []LaneAction{act(0, 2, "lane", "p_base", "n_bot_left"), act(1, 1, "lane", "p_base", "n_bot_left")}, ErrLaneInvalidTime},
		{"after the limit", []LaneAction{act(0, 91, "lane", "p_base", "n_bot_left")}, ErrLaneInvalidTime},
		{"unknown tower", []LaneAction{act(0, 0, "lane", "nope", "n_bot_left")}, ErrLaneInvalidTower},
	}
	for _, c := range cases {
		if _, _, err := ReplayLaneBattle(def, c.actions); !errors.Is(err, c.want) {
			t.Errorf("%s: err = %v, want %v", c.name, err, c.want)
		}
	}
}

func TestLaneReplayIgnoresIllegalOrdersAndPassivePlayerDoesNotWin(t *testing.T) {
	def := laneLevelDefs[0]
	_, summary, err := ReplayLaneBattle(def, nil)
	if err != nil || summary.Status == "victory" || summary.ActionsProcessed != 0 {
		t.Fatalf("a passive replay must not win: %+v, %v", summary, err)
	}
	_, summary, err = ReplayLaneBattle(def, []LaneAction{
		{Sequence: 0, AtSeconds: 0, Kind: "lane", SourceID: "p_base", TargetID: "n_bot_left"},
		{Sequence: 1, AtSeconds: 0.5, Kind: "lane", SourceID: "p_base", TargetID: "p_base"},
		{Sequence: 2, AtSeconds: 1, Kind: "lane", SourceID: "e_base", TargetID: "n_center"},
		{Sequence: 3, AtSeconds: 2, Kind: "cut", SourceID: "p_base", TargetID: "n_top_right"},
	})
	if err != nil || summary.ActionsProcessed != 1 {
		t.Fatalf("only the legal order counts: %+v, %v", summary, err)
	}
}

// testdata/lane_wins.json is recorded from the TS lane engine by scripts/lanes-record-wins.mjs: the
// player's orders and the final state the TS replay reaches. The Go replay must reach the same
// status, duration and tower owners and garrisons on every lane level.
func TestRecordedLaneWinsReplayToRecordedState(t *testing.T) {
	raw, err := os.ReadFile("testdata/lane_wins.json")
	if err != nil {
		t.Fatal(err)
	}
	var wins map[string]struct {
		Actions  []LaneAction `json:"actions"`
		Expected struct {
			Status          string                        `json:"status"`
			DurationSeconds int                           `json:"durationSeconds"`
			Towers          map[string][2]json.RawMessage `json:"towers"`
		} `json:"expected"`
	}
	if err := json.Unmarshal(raw, &wins); err != nil {
		t.Fatal(err)
	}
	for _, def := range laneLevelDefs {
		win, ok := wins[strconv.Itoa(def.ID)]
		if !ok {
			t.Errorf("lane level %d has no recorded win", def.ID)
			continue
		}
		state, summary, err := ReplayLaneBattle(def, win.Actions)
		if err != nil {
			t.Errorf("lane level %d: %v", def.ID, err)
			continue
		}
		if summary.Status != win.Expected.Status || summary.DurationSeconds != win.Expected.DurationSeconds {
			t.Errorf("lane level %d: Go reached %s in %ds, TS recorded %s in %ds (simulator drift)",
				def.ID, summary.Status, summary.DurationSeconds, win.Expected.Status, win.Expected.DurationSeconds)
		}
		for id, want := range win.Expected.Towers {
			var owner string
			var units int
			_ = json.Unmarshal(want[0], &owner)
			_ = json.Unmarshal(want[1], &units)
			got := state.Territories[id]
			if string(got.Owner) != owner || got.Units != units {
				t.Errorf("lane level %d tower %s: Go has %s/%d, TS recorded %s/%d", def.ID, id, got.Owner, got.Units, owner, units)
			}
		}
	}
}
