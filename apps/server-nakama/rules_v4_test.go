package main

import (
	"context"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestNegotiatedAsyncRulesPicksHighestSharedVersion(t *testing.T) {
	old := asyncGameplayRulesVersion
	t.Cleanup(func() { asyncGameplayRulesVersion = old })
	cases := []struct {
		ceiling   int
		supported []int
		want      int
	}{
		{4, []int{1, 2, 3, 4}, 4},
		{4, []int{1, 2, 3}, 3},
		{4, []int{1, 2}, 2},
		{4, nil, 2},
		{3, []int{1, 2, 3, 4}, 3},
		{2, []int{1, 2, 3, 4}, 2},
	}
	for _, c := range cases {
		asyncGameplayRulesVersion = c.ceiling
		if got := negotiatedAsyncRules(c.supported); got != c.want {
			t.Errorf("ceiling %d supported %v: got %d want %d", c.ceiling, c.supported, got, c.want)
		}
	}
}

func TestParseAsyncGameplayRulesVersion(t *testing.T) {
	for value, want := range map[string]int{"": 4, "4": 4, "3": 3, "2": 2, "banana": 2} {
		if got := parseAsyncGameplayRulesVersion(value); got != want {
			t.Errorf("%q: got %d want %d", value, got, want)
		}
	}
}

func TestRulesV4CapabilitiesKeepTacticalBehaviour(t *testing.T) {
	if !supportedGameplayRules(4) || supportedGameplayRules(5) {
		t.Fatal("v4 must be supported and v5 rejected")
	}
	if !usesTacticalRules(4) || !hasCaptureRecovery(4) || !hasCommanderAbilities(4) {
		t.Fatal("v4 builds on v3 tactics and capture recovery")
	}
	if hasCommanderAbilities(3) || usesTacticalRules(2) {
		t.Fatal("older versions must not gain v4 or tactical behaviour")
	}
}

func v4AbilityState() GameState {
	state := CreateInitialGameStateForBattlefield(DefaultModifiers(), DefaultModifiers(), "crown_cross")
	state.GameplayRulesVersion = TacticalV4RulesVersion
	applyTacticalOpening(&state, DefaultModifiers(), DefaultModifiers())
	state.ElapsedTimeSeconds = abilityUnlockSeconds
	return state
}

func TestApplyPlayerAbilityRules(t *testing.T) {
	shield := v4AbilityState()
	if !applyPlayerAbility(&shield, "crown_guard", "p_base", "p_base", 1, "a") || !shield.PlayerAbilityUsed {
		t.Fatal("royal shield should apply once")
	}
	if shield.ShieldedUntilMs["p_base"] != 15000+abilityShieldDurationMs {
		t.Fatalf("shield deadline %d", shield.ShieldedUntilMs["p_base"])
	}
	if applyPlayerAbility(&shield, "crown_guard", "p_base", "p_base", 1, "b") {
		t.Fatal("ability must be single use")
	}
	base := shield.Territories["p_base"]
	incoming := base.Units * 3 / 2
	if !resolveArrival(base, incoming, TeamEnemy).captured || resolveArrivalWithBonus(base, incoming, TeamEnemy, abilityShieldDefenseMultiplier).captured {
		t.Fatal("shield must turn a capture into a hold")
	}

	supply := v4AbilityState()
	before := supply.Territories["p_base"].Units
	if !applyPlayerAbility(&supply, "quartermaster", "p_base", "p_base", 1, "a") || supply.Territories["p_base"].Units != before+abilitySupplyUnits {
		t.Fatal("supply drop should add units")
	}

	charge := v4AbilityState()
	units := charge.Territories["p_base"].Units
	sent := units / 2
	if !applyPlayerAbility(&charge, "vanguard", "p_base", "n_bot_left", 1, "c") || charge.Territories["p_base"].Units != units-sent ||
		charge.Armies[len(charge.Armies)-1].Units != int(float64(sent)*abilityChargeUnitMultiplier) ||
		charge.Stats.PlayerUnitsDispatched != float64(charge.Armies[len(charge.Armies)-1].Units) {
		t.Fatalf("vanguard charge should pay half and send a doubled army: %+v", charge.Armies)
	}
	remote := v4AbilityState()
	if applyPlayerAbility(&remote, "vanguard", "p_base", "e_base", 1, "c") || remote.PlayerAbilityUsed {
		t.Fatal("charge must follow the one-road attack rule")
	}

	early := v4AbilityState()
	early.ElapsedTimeSeconds = abilityUnlockSeconds - 0.02
	v3 := v4AbilityState()
	v3.GameplayRulesVersion = TacticalRulesVersion
	enemyTower := v4AbilityState()
	for name, c := range map[string]struct {
		state     *GameState
		commander string
		source    string
	}{"early": {&early, "quartermaster", "p_base"}, "v3": {&v3, "quartermaster", "p_base"}, "enemy tower": {&enemyTower, "quartermaster", "e_base"}, "no commander": {&enemyTower, "", "p_base"}} {
		if applyPlayerAbility(c.state, c.commander, c.source, c.source, 1, "x") {
			t.Errorf("%s: ability must be rejected", name)
		}
	}
}

func TestReplayUsesStoredCommanderAndRejectsUnknownKinds(t *testing.T) {
	actions := []PvpAction{
		{Sequence: 0, AtSeconds: 16, SourceID: "p_base", TargetID: "p_base", Kind: pvpActionKindAbility},
		{Sequence: 1, AtSeconds: 17, SourceID: "p_base", TargetID: "p_base", Kind: pvpActionKindAbility},
	}
	_, with, err := simulateBotBattleWithCommander(actions, DefaultModifiers(), DefaultModifiers(), "crown_cross", TacticalV4RulesVersion, "normal", "quartermaster")
	if err != nil || with.ActionsProcessed != 1 {
		t.Fatalf("with commander: %+v %v", with, err)
	}
	_, without, err := simulateBotBattleWithCommander(actions, DefaultModifiers(), DefaultModifiers(), "crown_cross", TacticalV4RulesVersion, "normal", "")
	if err != nil || without.ActionsProcessed != 0 {
		t.Fatalf("without commander: %+v %v", without, err)
	}
	_, _, err = simulateBotBattleWithCommander([]PvpAction{{Sequence: 0, AtSeconds: 1, SourceID: "p_base", TargetID: "p_base", Kind: "bogus"}}, DefaultModifiers(), DefaultModifiers(), "crown_cross", TacticalV4RulesVersion, "normal", "")
	if err != ErrPvpInvalidActionKind {
		t.Fatalf("unknown kind: %v", err)
	}
}

func TestCreateBotMatchStoresCommanderOnV4Tickets(t *testing.T) {
	old := asyncGameplayRulesVersion
	t.Cleanup(func() { asyncGameplayRulesVersion = old })
	asyncGameplayRulesVersion = TacticalV4RulesVersion
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO players (id, coins, gems, trophies)")).
		WithArgs("player_1", 100, 10, 0).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM players WHERE id = $1")).
		WithArgs("player_1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "coins", "gems", "trophies", "starting_garrison_level", "production_level",
			"army_speed_level", "treasury_level", "selected_commander", "matches_played", "matches_won",
			"current_streak", "best_streak", "last_match_timestamp", "tutorial_completed",
		}).AddRow("player_1", 100, 10, 0, 0, 0, 0, 0, "quartermaster", 0, 0, 0, 0, 0, true))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO bot_matches (match_id, player_id, battlefield_id, gameplay_rules_version, bot_difficulty, commander_id)")).
		WithArgs(sqlmock.AnyArg(), "player_1", sqlmock.AnyArg(), TacticalV4RulesVersion, "normal", "quartermaster").
		WillReturnResult(sqlmock.NewResult(1, 1))
	ticket, err := NewStore(db).CreateBotMatch(context.Background(), "player_1", 1, 2, 3, 4)
	if err != nil || ticket.GameplayRulesVersion != TacticalV4RulesVersion || ticket.CommanderID != "quartermaster" {
		t.Fatalf("ticket %+v %v", ticket, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestBotSpendsItsAbilityByDifficultyOnV4Only(t *testing.T) {
	player, enemy := DefaultModifiers(), DefaultModifiers()
	run := func(rules int, difficulty string) GameState {
		state, _, err := simulateBotBattleWithDifficulty(nil, player, enemy, "crown_cross", rules, difficulty)
		if err != nil {
			t.Fatal(err)
		}
		return state
	}
	if !run(4, "hard").EnemyAbilityUsed {
		t.Error("hard v4 bot should have spent its vanguard charge")
	}
	if run(4, "easy").EnemyAbilityUsed {
		t.Error("easy bot must stay ability-free")
	}
	if run(3, "hard").EnemyAbilityUsed {
		t.Error("v3 has no abilities")
	}
	if a, b := run(4, "hard"), run(4, "hard"); a.Stats != b.Stats {
		t.Error("bot ability replay must be deterministic")
	}
}

func TestChooseBotAbilityIgnoresIllegalStates(t *testing.T) {
	state := v4AbilityState()
	moves := []tacticalMove{{"e_base", "n_bot_right"}, {"e_base", "n_center"}}
	if _, ok := chooseBotAbility(state, TeamEnemy, "", moves); ok {
		t.Error("no commander, no ability")
	}
	early := state
	early.ElapsedTimeSeconds = abilityUnlockSeconds - 0.02
	if _, ok := chooseBotAbility(early, TeamEnemy, "vanguard", moves); ok {
		t.Error("ability is locked before 15s")
	}
	used := state
	used.EnemyAbilityUsed = true
	if _, ok := chooseBotAbility(used, TeamEnemy, "vanguard", moves); ok {
		t.Error("one use per match")
	}
	choice, ok := chooseBotAbility(state, TeamEnemy, "vanguard", moves)
	if !ok || choice.sourceID != "e_base" || choice.targetID != "n_bot_right" || len(choice.moves) != 1 {
		t.Errorf("vanguard should replace the first attack, got %+v ok=%v", choice, ok)
	}
}
