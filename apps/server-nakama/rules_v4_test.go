package main

import "testing"

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
