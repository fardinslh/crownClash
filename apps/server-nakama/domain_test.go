package main

import (
	"reflect"
	"testing"
)

func TestSettleMatchMatchesExpectedEconomyRules(t *testing.T) {
	career := CreateDefaultCareer("browser:test")
	settlement := SettleMatch(career, "victory", MatchStats{
		MatchDurationSeconds:        35,
		TerritoriesCapturedByPlayer: 6,
	}, "match_1", 1000)

	if settlement.Breakdown.TotalCoins != 70 {
		t.Fatalf("expected 70 coins, got %d", settlement.Breakdown.TotalCoins)
	}
	if settlement.NewCareer.Coins != 170 || settlement.NewCareer.Trophies != 30 {
		t.Fatalf("unexpected career: %+v", settlement.NewCareer)
	}
	if len(settlement.LedgerEntries) != 2 {
		t.Fatalf("expected two ledger entries, got %d", len(settlement.LedgerEntries))
	}
}

func TestPurchaseUpgradeUsesSameCostsAndModifiers(t *testing.T) {
	career := CreateDefaultCareer("browser:test")
	result := PurchaseUpgrade(career, UpgradeStartingGarrison, "purchase_1", 1000)
	if !result.Success || result.Cost == nil || *result.Cost != 50 {
		t.Fatalf("unexpected purchase result: %+v", result)
	}
	if result.NewCareer.StartingGarrisonLevel != 1 || result.NewCareer.Coins != 50 {
		t.Fatalf("unexpected upgraded career: %+v", result.NewCareer)
	}
	modifiers := UpgradeModifiers(result.NewCareer)
	if modifiers.StartingUnits != 23 {
		t.Fatalf("expected 23 starting units, got %d", modifiers.StartingUnits)
	}
}

func TestUpgradeBalanceParityAndTreasuryRewards(t *testing.T) {
	cases := []struct {
		level                       int
		cost                        int
		startingUnits               int
		production, speed, treasury float64
		tier                        int
	}{
		{0, 50, 20, 1, 1, 0, 0},
		{5, 500, 35, 1.4, 1.3, 0.25, 1},
		{6, 625, 36, 1.42, 1.315, 0.27, 1},
		{10, 1375, 40, 1.5, 1.375, 0.35, 2},
		{15, 2875, 45, 1.6, 1.45, 0.45, 3},
		{19, 4600, 49, 1.68, 1.51, 0.53, 3},
		{20, 0, 50, 1.7, 1.525, 0.55, 4},
	}
	for _, test := range cases {
		career := CreateDefaultCareer("balance")
		career.Coins = 100000
		career.StartingGarrisonLevel = test.level
		career.ProductionLevel = test.level
		career.ArmySpeedLevel = test.level
		career.TreasuryLevel = test.level
		if test.level < 20 && upgradeCosts[test.level] != test.cost {
			t.Fatalf("level %d: expected cost %d, got %d", test.level, test.cost, upgradeCosts[test.level])
		}
		modifiers := UpgradeModifiers(career)
		if modifiers.StartingUnits != test.startingUnits ||
			modifiers.ProductionRateMultiplier != test.production ||
			modifiers.ArmySpeedMultiplier != test.speed ||
			TreasuryCoinBonusRate(test.level) != test.treasury ||
			UpgradeMilestoneTier(test.level) != test.tier {
			t.Fatalf("level %d: unexpected upgrade balance: %+v", test.level, modifiers)
		}
	}
	expectedCosts := []int{
		50, 100, 175, 275, 400, 500, 625, 775, 950, 1150,
		1375, 1625, 1900, 2200, 2525, 2875, 3250, 3650, 4100, 4600,
	}
	if !reflect.DeepEqual(upgradeCosts, expectedCosts) {
		t.Fatalf("upgrade costs drifted: got %v", upgradeCosts)
	}

	career := CreateDefaultCareer("treasury")
	career.TreasuryLevel = 20
	reward := CalculateMatchRewards("victory", MatchStats{
		MatchDurationSeconds: 35, TerritoriesCapturedByPlayer: 5,
	}, 0, career.TreasuryLevel)
	if reward.TreasuryBonus != 38 || reward.TotalCoins != 108 || reward.TrophyDelta != 30 {
		t.Fatalf("unexpected Treasury settlement: %+v", reward)
	}

	purchase := PurchaseUpgrade(career, UpgradeTreasury, "treasury_purchase", 1000)
	if purchase.Success || purchase.Reason != "max_level" {
		t.Fatalf("expected max-level Treasury rejection, got %+v", purchase)
	}
}

func TestPvpSimulationIsDeterministic(t *testing.T) {
	actions := []PvpAction{
		{Sequence: 0, AtSeconds: 0, SourceID: "p_base", TargetID: "n_center"},
		{Sequence: 1, AtSeconds: 3, SourceID: "p_base", TargetID: "n_bot_left"},
	}
	firstState, firstSummary, err := SimulatePvpBattle(actions, DefaultModifiers(), DefaultModifiers())
	if err != nil {
		t.Fatal(err)
	}
	secondState, secondSummary, err := SimulatePvpBattle(actions, DefaultModifiers(), DefaultModifiers())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(firstState, secondState) || !reflect.DeepEqual(firstSummary, secondSummary) {
		t.Fatal("replaying identical PvP actions produced different results")
	}
	t.Logf("PvP summary: %+v", firstSummary)
	if firstSummary.ActionsProcessed != len(actions) {
		t.Fatalf("expected %d processed actions, got %d", len(actions), firstSummary.ActionsProcessed)
	}
}

func TestPvpSimulationRejectsMalformedActions(t *testing.T) {
	_, _, err := SimulatePvpBattle([]PvpAction{
		{Sequence: 1, AtSeconds: 0, SourceID: "p_base", TargetID: "n_center"},
	}, DefaultModifiers(), DefaultModifiers())
	if err != ErrPvpInvalidSequence {
		t.Fatalf("expected invalid sequence, got %v", err)
	}

	_, _, err = SimulatePvpBattle([]PvpAction{
		{Sequence: 0, AtSeconds: 91, SourceID: "p_base", TargetID: "n_center"},
	}, DefaultModifiers(), DefaultModifiers())
	if err != ErrPvpInvalidTimestamp {
		t.Fatalf("expected invalid timestamp, got %v", err)
	}

	_, summary, err := SimulatePvpBattle([]PvpAction{
		{Sequence: 0, AtSeconds: 0, SourceID: "does_not_exist", TargetID: "n_center"},
	}, DefaultModifiers(), DefaultModifiers())
	if err != nil {
		t.Fatalf("expected invalid player action to be skipped, got %v", err)
	}
	if summary.ActionsProcessed != 0 {
		t.Fatalf("expected 0 processed actions, got %d", summary.ActionsProcessed)
	}
}

func TestBotBattleSkipsInvalidPlayerActionsInsteadOfFailing(t *testing.T) {
	actions := []PvpAction{
		{Sequence: 0, AtSeconds: 0, SourceID: "p_base", TargetID: "n_center"},
		{Sequence: 1, AtSeconds: 5, SourceID: "does_not_exist", TargetID: "n_center"},
		{Sequence: 2, AtSeconds: 8, SourceID: "p_base", TargetID: "n_bot_left"},
	}
	state, summary, err := SimulateBotBattle(actions, DefaultModifiers())
	if err != nil {
		t.Fatal(err)
	}
	if summary.ActionsProcessed != 2 {
		t.Fatalf("expected 2 processed actions, got %d", summary.ActionsProcessed)
	}
	switch summary.Status {
	case "victory", "defeat", "draw":
	default:
		t.Fatalf("unexpected status: %q", summary.Status)
	}
	if summary.Stats.MatchDurationSeconds <= 0 || state.ElapsedTimeSeconds <= 0 {
		t.Fatal("bot battle replay did not run the simulation")
	}
}

func TestBotBattleIsDeterministic(t *testing.T) {
	actions := []PvpAction{
		{Sequence: 0, AtSeconds: 0, SourceID: "p_base", TargetID: "n_center"},
		{Sequence: 1, AtSeconds: 4, SourceID: "p_base", TargetID: "n_bot_right"},
		{Sequence: 2, AtSeconds: 9, SourceID: "n_bot_right", TargetID: "n_top_right"},
	}
	firstState, firstSummary, err := SimulateBotBattle(actions, DefaultModifiers())
	if err != nil {
		t.Fatal(err)
	}
	secondState, secondSummary, err := SimulateBotBattle(actions, DefaultModifiers())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(firstState, secondState) || !reflect.DeepEqual(firstSummary, secondSummary) {
		t.Fatal("replaying identical bot actions produced different results")
	}
}
