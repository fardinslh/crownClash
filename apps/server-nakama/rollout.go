package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"hash/fnv"
	"strings"

	"github.com/heroiclabs/nakama-common/runtime"
)

var supportedRolloutPlatforms = [...]string{"browser", "bale", "eitaa", "telegram"}

type featureFlagResponse struct {
	Enable2v2      bool   `json:"enable2v2"`
	RolloutPercent int    `json:"rolloutPercent"`
	Platform       string `json:"platform"`
}

func rolloutPlatformFromContext(ctx context.Context) string {
	vars := ctx.Value(runtime.RUNTIME_CTX_VARS)
	switch typed := vars.(type) {
	case map[string]string:
		return strings.ToLower(typed["platform"])
	case map[string]interface{}:
		platform, _ := typed["platform"].(string)
		return strings.ToLower(platform)
	default:
		return ""
	}
}

func rolloutBucket(userID string) int {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte("crown-clash:2v2:" + userID))
	return int(hash.Sum32() % 100)
}

func twoVTwoRolloutDecision(userID, platform string) featureFlagResponse {
	percent := serverConfig.TwoVTwoRollout[strings.ToLower(platform)]
	enabled := serverConfig.Enable2v2 && userID != "" && percent > 0 && rolloutBucket(userID) < percent
	return featureFlagResponse{Enable2v2: enabled, RolloutPercent: percent, Platform: strings.ToLower(platform)}
}

func rpcFeatureFlags(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, _ := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if userID == "" {
		return "", errors.New("unauthenticated")
	}
	response := struct {
		Flags featureFlagResponse `json:"flags"`
	}{Flags: twoVTwoRolloutDecision(userID, rolloutPlatformFromContext(ctx))}
	encoded, err := json.Marshal(response)
	if err != nil {
		return "", errors.New("feature_config_unavailable")
	}
	return string(encoded), nil
}
