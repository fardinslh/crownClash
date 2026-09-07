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
}
