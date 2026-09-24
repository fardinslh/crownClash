package main

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/heroiclabs/nakama-common/runtime"
)

func withRolloutConfig(t *testing.T, enabled bool, values map[string]int) {
	t.Helper()
	previousEnabled := serverConfig.Enable2v2
	previous := serverConfig.TwoVTwoRollout
	serverConfig.Enable2v2 = enabled
	serverConfig.TwoVTwoRollout = values
	t.Cleanup(func() {
		serverConfig.Enable2v2 = previousEnabled
		serverConfig.TwoVTwoRollout = previous
	})
}

func TestTwoVTwoRolloutIsDeterministicAndFailClosed(t *testing.T) {
	withRolloutConfig(t, true, map[string]int{"bale": 5, "browser": 100})
	first := twoVTwoRolloutDecision("player-42", "bale")
	second := twoVTwoRolloutDecision("player-42", "bale")
	if first != second {
		t.Fatalf("rollout assignment changed: %+v vs %+v", first, second)
	}
	if !twoVTwoRolloutDecision("player-42", "browser").Enable2v2 {
		t.Fatal("100 percent rollout did not enable eligible browser user")
	}
	for _, test := range []featureFlagResponse{
		twoVTwoRolloutDecision("", "browser"),
		twoVTwoRolloutDecision("player-42", "unknown"),
	} {
		if test.Enable2v2 {
			t.Fatalf("invalid rollout input enabled 2v2: %+v", test)
		}
	}
	serverConfig.Enable2v2 = false
	if twoVTwoRolloutDecision("player-42", "browser").Enable2v2 {
		t.Fatal("global kill switch did not override 100 percent rollout")
	}
}

func TestFeatureFlagsRPCUsesAuthenticatedContext(t *testing.T) {
	withRolloutConfig(t, true, map[string]int{"bale": 100})
	ctx := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "player-7")
	ctx = context.WithValue(ctx, runtime.RUNTIME_CTX_VARS, map[string]string{"platform": "bale"})
	payload, err := rpcFeatureFlags(ctx, &stubLogger{}, nil, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Flags featureFlagResponse `json:"flags"`
	}
	if err := json.Unmarshal([]byte(payload), &decoded); err != nil {
		t.Fatal(err)
	}
	if !decoded.Flags.Enable2v2 || decoded.Flags.Platform != "bale" || decoded.Flags.RolloutPercent != 100 {
		t.Fatalf("unexpected feature response: %+v", decoded.Flags)
	}
	if _, err := rpcFeatureFlags(context.Background(), &stubLogger{}, nil, nil, ""); err == nil {
		t.Fatal("unauthenticated feature config request was accepted")
	}
}
