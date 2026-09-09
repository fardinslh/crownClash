package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
)

const (
	trophiesLeaderboardID = "trophies"
)

// rpcFn matches the RegisterRpc function signature in nakama-common.
type rpcFn = func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error)

var serverConfig struct {
	TelegramBotToken string
	BaleBotToken     string
	AllowGuestAuth   bool
	InitDataMaxAge   int64
}

type platformIdentity struct {
	Platform    string `json:"platform"`
	ExternalID  string `json:"external_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
}

// InitModule wires the Crown Clash runtime into Nakama.
func InitModule(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, initializer runtime.Initializer) error {
	loadServerConfig(initializer)

	if err := RunMigrations(ctx, db); err != nil {
		logger.WithField("error", err).Error("migrations failed")
		return err
	}

	if err := nk.LeaderboardCreate(ctx, trophiesLeaderboardID, true, "desc", "best", "", map[string]interface{}{}, true); err != nil {
		logger.WithField("error", err).Warn("leaderboard create failed (may already exist)")
	}

	store := NewStore(db)

	if err := initializer.RegisterBeforeAuthenticateCustom(beforeAuthenticateCustom); err != nil {
		return err
	}
	if err := initializer.RegisterAfterAuthenticateCustom(afterAuthenticateCustom(store)); err != nil {
		return err
	}
	if err := initializer.RegisterMatchmakerMatched(matchmakerMatched(nk)); err != nil {
		return err
	}
	if err := initializer.RegisterMatch("live_match", newLiveMatchHandler(store)); err != nil {
		return err
	}

	rpc := func(name string, fn rpcFn) error {
		if err := initializer.RegisterRpc(name, fn); err != nil {
			logger.WithField("rpc", name).Error("rpc registration failed")
			return err
		}
		return nil
	}

	if err := rpc("career/get", rpcGetCareer(store)); err != nil {
		return err
	}
	if err := rpc("ledger/get", rpcGetLedger(store)); err != nil {
		return err
	}
	if err := rpc("match/settle", rpcSettleMatch(store, nk)); err != nil {
		return err
	}
	if err := rpc("upgrade/purchase", rpcPurchaseUpgrade(store)); err != nil {
		return err
	}
	if err := rpc("pvp/defense/publish", rpcPublishDefense(store)); err != nil {
		return err
	}
	if err := rpc("pvp/opponents", rpcGetOpponents(store)); err != nil {
		return err
	}
	if err := rpc("pvp/attack", rpcSubmitAttack(store, nk)); err != nil {
		return err
	}
	if err := rpc("pvp/history", rpcGetHistory(store)); err != nil {
		return err
	}
	if err := rpc("pvp/create_invite", rpcCreateInvite); err != nil {
		return err
	}
	if err := rpc("pvp/join_invite", rpcJoinInvite); err != nil {
		return err
	}
	if err := rpc("analytics/events", rpcTrackEvents(store)); err != nil {
		return err
	}
	if err := rpc("player/register_name", rpcRegisterName(store)); err != nil {
		return err
	}

	logger.Info("crown clash runtime initialized")
	return nil
}

func loadServerConfig(initializer runtime.Initializer) {
	serverConfig.TelegramBotToken = ""
	serverConfig.BaleBotToken = ""
	serverConfig.AllowGuestAuth = false
	serverConfig.InitDataMaxAge = 86400

	if config, err := initializer.GetConfig(); err == nil {
		env := make(map[string]string)
		for _, entry := range config.GetRuntime().GetEnv() {
			if key, value, found := strings.Cut(entry, "="); found {
				env[key] = value
			}
		}
		serverConfig.TelegramBotToken = env["TELEGRAM_BOT_TOKEN"]
		serverConfig.BaleBotToken = env["BALE_BOT_TOKEN"]
		serverConfig.AllowGuestAuth = env["ALLOW_GUEST_AUTH"] == "true"
		if parsed, err := strconv.ParseInt(env["INIT_DATA_MAX_AGE_SECONDS"], 10, 64); err == nil && parsed > 0 {
			serverConfig.InitDataMaxAge = parsed
		}
	}
}

// identityFromUsername parses "platform:external_id" custom IDs.
func identityFromUsername(customID string) platformIdentity {
	platform, externalID, found := strings.Cut(customID, ":")
	if !found || platform == "" || externalID == "" {
		return platformIdentity{Platform: "unknown", ExternalID: customID}
	}
	return platformIdentity{Platform: platform, ExternalID: externalID}
}

func validatePlatformIdentity(customID string, vars map[string]string) (platformIdentity, error) {
	identity := identityFromUsername(customID)
	platform := vars["platform"]
	initData := vars["init_data"]
	if identity.Platform == "unknown" || platform == "" || initData == "" {
		return platformIdentity{}, errors.New("invalid_auth_payload")
	}
	if platform != identity.Platform {
		return platformIdentity{}, errors.New("identity_mismatch")
	}

	switch platform {
	case "telegram", "bale":
		botToken := serverConfig.TelegramBotToken
		if platform == "bale" {
			botToken = serverConfig.BaleBotToken
		}
		if botToken == "" {
			return platformIdentity{}, errors.New("platform_not_configured")
		}
		verified, err := VerifyTelegramStyleInitData(initData, botToken, serverConfig.InitDataMaxAge)
		if err != nil {
			return platformIdentity{}, err
		}
		if verified.UserID != identity.ExternalID {
			return platformIdentity{}, errors.New("identity_mismatch")
		}
		identity.Username = verified.Username
		identity.DisplayName = verified.FirstName
		if identity.DisplayName == "" {
			identity.DisplayName = identity.Username
		}
	case "eitaa":
		externalID, username, ok := ExtractUnverifiedUser(initData)
		if !ok {
			return platformIdentity{}, errors.New("missing_user")
		}
		if externalID != identity.ExternalID {
			return platformIdentity{}, errors.New("identity_mismatch")
		}
		identity.Username = username
		identity.DisplayName = username
	case "guest", "browser":
		if !serverConfig.AllowGuestAuth {
			return platformIdentity{}, errors.New("guest_auth_disabled")
		}
		externalID, username, ok := ExtractUnverifiedUser(initData)
		if !ok {
			return platformIdentity{}, errors.New("missing_user")
		}
		if externalID != identity.ExternalID {
			return platformIdentity{}, errors.New("identity_mismatch")
		}
		identity.Username = username
		identity.DisplayName = username
	default:
		return platformIdentity{}, errors.New("unsupported_platform")
	}

	return identity, nil
}

// beforeAuthenticateCustom verifies platform init data and binds the
// verified external user ID to the Nakama account before creation.
func beforeAuthenticateCustom(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AuthenticateCustomRequest) (*api.AuthenticateCustomRequest, error) {
	if in.Account == nil || in.Account.Id == "" {
		return nil, errors.New("missing_custom_id")
	}
	identity, err := validatePlatformIdentity(in.Account.Id, in.Account.Vars)
	if err != nil {
		return nil, err
	}

	if identity.Username != "" {
		in.Username = identity.Username
	}
	in.Account.Vars = map[string]string{
		"platform":     identity.Platform,
		"external_id":  identity.ExternalID,
		"display_name": identity.DisplayName,
	}
	return in, nil
}

// afterAuthenticateCustom ensures the player row, display name, and defense
// snapshot exist after every successful login.
func afterAuthenticateCustom(store *Store) func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Session, in *api.AuthenticateCustomRequest) error {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Session, in *api.AuthenticateCustomRequest) error {
		userID := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
		identity := identityFromUsername(in.Account.Id)
		identity.DisplayName = in.Account.Vars["display_name"]

		career, err := store.GetOrCreateCareer(ctx, userID)
		if err != nil {
			logger.WithField("error", err).Error("career create failed")
			return errors.New("career_unavailable")
		}
		if identity.DisplayName != "" {
			if err := store.SetPlayerDisplayName(ctx, userID, identity.DisplayName); err != nil {
				logger.WithField("error", err).Warn("display name persistence failed")
			}
		}
		displayName, err := store.GetPlayerDisplayName(ctx, userID)
		if err != nil {
			displayName = userID
		}
		if _, err := store.PublishDefense(ctx, userID, displayName, career, nowMillis()); err != nil {
			logger.WithField("error", err).Warn("defense publish failed")
		}
		if _, err := nk.LeaderboardRecordWrite(ctx, trophiesLeaderboardID, userID, displayName, int64(career.Trophies), 0, nil, nil); err != nil {
			logger.WithField("error", err).Warn("leaderboard write failed")
		}
		return nil
	}
}

// matchmakerMatched spins up a live match for a matched pair from the
// Nakama matchmaker queue. The matched user IDs are passed as an
// allowlist so only the two intended players can join the match.
func matchmakerMatched(nk runtime.NakamaModule) func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, entries []runtime.MatchmakerEntry) (string, error) {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, entries []runtime.MatchmakerEntry) (string, error) {
		if len(entries) != 2 {
			return "", errors.New("matchmaker_expects_two_players")
		}
		allowedUsers := make([]interface{}, 0, 2)
		for _, entry := range entries {
			allowedUsers = append(allowedUsers, entry.GetPresence().GetUserId())
		}
		matchID, err := nk.MatchCreate(ctx, "live_match", map[string]interface{}{
			"invited":       false,
			"allowed_users": allowedUsers,
		})
		if err != nil {
			logger.WithField("error", err).Error("match create failed")
			return "", err
		}
		return matchID, nil
	}
}

// rpcCreateInvite creates an invite match and returns the invite code plus
// match ID. The caller joins the match via the Nakama socket, passing the
// code as join metadata.
func rpcCreateInvite(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("unauthenticated")
	}
	inviteCode := newLiveJoinCode()
	matchID, err := nk.MatchCreate(ctx, "live_match", map[string]interface{}{
		"invite":      true,
		"invite_code": inviteCode,
	})
	if err != nil {
		return "", err
	}
	response, _ := json.Marshal(map[string]any{
		"matchId":    matchID,
		"inviteCode": inviteCode,
	})
	return string(response), nil
}

// rpcJoinInvite looks up an invite match by its code and returns the match
// ID so the client can join via socket.
func rpcJoinInvite(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("unauthenticated")
	}
	var request struct {
		InviteCode string `json:"inviteCode"`
	}
	if err := json.Unmarshal([]byte(payload), &request); err != nil || request.InviteCode == "" {
		return "", errors.New("invalid_payload")
	}
	label := "invite:" + request.InviteCode
	minSize := 0
	maxSize := liveMaxPlayers
	matches, err := nk.MatchList(ctx, 1, true, label, &minSize, &maxSize, "")
	if err != nil {
		return "", err
	}
	if len(matches) == 0 {
		return "", errors.New("invite_not_found")
	}
	response, _ := json.Marshal(map[string]any{
		"matchId":    matches[0].GetMatchId(),
		"inviteCode": request.InviteCode,
	})
	return string(response), nil
}

func rpcGetCareer(store *Store) rpcFn {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
		userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
		if !ok || userID == "" {
			return "", errors.New("unauthenticated")
		}
		career, err := store.GetOrCreateCareer(ctx, userID)
		if err != nil {
			return "", err
		}
		response, _ := json.Marshal(map[string]any{"career": career, "rank": GetRankTier(career.Trophies)})
		return string(response), nil
	}
}

func rpcGetLedger(store *Store) rpcFn {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
		userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
		if !ok || userID == "" {
			return "", errors.New("unauthenticated")
		}
		limit := 50
		if payload != "" {
			var request struct {
				Limit int `json:"limit"`
			}
			if err := json.Unmarshal([]byte(payload), &request); err == nil && request.Limit > 0 {
				limit = request.Limit
				if limit > 200 {
					limit = 200
				}
			}
		}
		entries, err := store.GetLedger(ctx, userID, limit)
		if err != nil {
			return "", err
		}
		response, _ := json.Marshal(map[string]any{"entries": entries})
		return string(response), nil
	}
}

func parseActionPayload(payload string) (string, []PvpAction, error) {
	var request struct {
		MatchID string      `json:"matchId"`
		Actions []PvpAction `json:"actions"`
	}
	if err := json.Unmarshal([]byte(payload), &request); err != nil {
		return "", nil, errors.New("invalid_payload")
	}
	if len(request.MatchID) < 1 || len(request.MatchID) > 128 {
		return "", nil, errors.New("invalid_match_id")
	}
	if len(request.Actions) > MaxPvpActions {
		return "", nil, errors.New("invalid_actions")
	}
	for index := range request.Actions {
		if request.Actions[index].Sequence != index {
			return "", nil, errors.New("invalid_action_sequence")
		}
	}
	return request.MatchID, request.Actions, nil
}

func rpcSettleMatch(store *Store, nk runtime.NakamaModule) rpcFn {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
		userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
		if !ok || userID == "" {
			return "", errors.New("unauthenticated")
		}
		matchID, actions, err := parseActionPayload(payload)
		if err != nil {
			return "", err
		}
		settlement, err := store.SettleMatchVerified(ctx, userID, matchID, actions)
		if err != nil {
			logger.WithField("error", err).Warn("settle failed")
			return "", err
		}
		submitTrophies(ctx, nk, userID, int64(settlement.NewCareer.Trophies))
		response, _ := json.Marshal(map[string]any{"settlement": settlement})
		return string(response), nil
	}
}

func rpcPurchaseUpgrade(store *Store) rpcFn {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
		userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
		if !ok || userID == "" {
			return "", errors.New("unauthenticated")
		}
		var request struct {
			Type       string `json:"type"`
			PurchaseID string `json:"purchaseId"`
		}
		if err := json.Unmarshal([]byte(payload), &request); err != nil {
			return "", errors.New("invalid_payload")
		}
		upgrade := UpgradeType(request.Type)
		if upgrade != UpgradeStartingGarrison && upgrade != UpgradeProduction && upgrade != UpgradeArmySpeed {
			return "", errors.New("invalid_upgrade_type")
		}
		if len(request.PurchaseID) < 1 || len(request.PurchaseID) > 128 {
			return "", errors.New("invalid_purchase_id")
		}
		result, err := store.PurchaseUpgrade(ctx, userID, upgrade, request.PurchaseID)
		if err != nil {
			return "", err
		}
		response, _ := json.Marshal(map[string]any{"result": result})
		return string(response), nil
	}
}

func rpcPublishDefense(store *Store) rpcFn {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
		userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
		if !ok || userID == "" {
			return "", errors.New("unauthenticated")
		}
		career, err := store.GetOrCreateCareer(ctx, userID)
		if err != nil {
			return "", err
		}
		displayName, err := store.GetPlayerDisplayName(ctx, userID)
		if err != nil {
			return "", err
		}
		defense, err := store.PublishDefense(ctx, userID, displayName, career, nowMillis())
		if err != nil {
			return "", err
		}
		response, _ := json.Marshal(map[string]any{"defense": defense})
		return string(response), nil
	}
}

func rpcGetOpponents(store *Store) rpcFn {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
		userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
		if !ok || userID == "" {
			return "", errors.New("unauthenticated")
		}
		limit := 8
		if payload != "" {
			var request struct {
				Limit int `json:"limit"`
			}
			if err := json.Unmarshal([]byte(payload), &request); err == nil && request.Limit > 0 {
				limit = request.Limit
				if limit > 20 {
					limit = 20
				}
			}
		}
		career, err := store.GetOrCreateCareer(ctx, userID)
		if err != nil {
			return "", err
		}
		opponents, err := store.GetPvpOpponents(ctx, userID, career.Trophies, limit)
		if err != nil {
			return "", err
		}
		response, _ := json.Marshal(map[string]any{"opponents": opponents})
		return string(response), nil
	}
}

func rpcSubmitAttack(store *Store, nk runtime.NakamaModule) rpcFn {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
		userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
		if !ok || userID == "" {
			return "", errors.New("unauthenticated")
		}
		var request struct {
			AttackID   string      `json:"attackId"`
			DefenderID string      `json:"defenderId"`
			Actions    []PvpAction `json:"actions"`
		}
		if err := json.Unmarshal([]byte(payload), &request); err != nil {
			return "", errors.New("invalid_payload")
		}
		if len(request.AttackID) < 1 || len(request.AttackID) > 128 {
			return "", errors.New("invalid_attack_id")
		}
		if len(request.DefenderID) < 1 || len(request.DefenderID) > 128 {
			return "", errors.New("invalid_defender_id")
		}
		if len(request.Actions) > MaxPvpActions {
			return "", errors.New("invalid_actions")
		}
		for index := range request.Actions {
			if request.Actions[index].Sequence != index {
				return "", errors.New("invalid_action_sequence")
			}
		}
		result, err := store.SettlePvpAttack(ctx, userID, request.DefenderID, request.AttackID, request.Actions)
		if err != nil {
			return "", err
		}
		submitTrophies(ctx, nk, userID, int64(result.Settlement.NewCareer.Trophies))
		response, _ := json.Marshal(map[string]any{"result": result})
		return string(response), nil
	}
}

func rpcGetHistory(store *Store) rpcFn {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
		userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
		if !ok || userID == "" {
			return "", errors.New("unauthenticated")
		}
		limit := 20
		if payload != "" {
			var request struct {
				Limit int `json:"limit"`
			}
			if err := json.Unmarshal([]byte(payload), &request); err == nil && request.Limit > 0 {
				limit = request.Limit
				if limit > 50 {
					limit = 50
				}
			}
		}
		history, err := store.GetPvpHistory(ctx, userID, limit)
		if err != nil {
			return "", err
		}
		response, _ := json.Marshal(map[string]any{"history": history})
		return string(response), nil
	}
}

func rpcTrackEvents(store *Store) rpcFn {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
		userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
		if !ok || userID == "" {
			return "", errors.New("unauthenticated")
		}
		var request struct {
			Events []AnalyticsEventRecord `json:"events"`
		}
		if err := json.Unmarshal([]byte(payload), &request); err != nil {
			return "", errors.New("invalid_payload")
		}
		if len(request.Events) == 0 || len(request.Events) > 50 {
			return "", errors.New("invalid_events")
		}
		for _, event := range request.Events {
			if len(event.Name) < 1 || len(event.Name) > 64 {
				return "", errors.New("invalid_event_name")
			}
			if len(event.Props) > 16 {
				return "", errors.New("invalid_event_props")
			}
			for key, value := range event.Props {
				if len(key) > 64 {
					return "", errors.New("invalid_event_props")
				}
				switch value.(type) {
				case string, float64, bool, nil:
				default:
					return "", errors.New("invalid_event_props")
				}
			}
		}
		if err := store.InsertAnalyticsEvents(ctx, userID, request.Events); err != nil {
			return "", err
		}
		response, _ := json.Marshal(map[string]any{"accepted": len(request.Events)})
		return string(response), nil
	}
}

func rpcRegisterName(store *Store) rpcFn {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
		userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
		if !ok || userID == "" {
			return "", errors.New("unauthenticated")
		}
		var request struct {
			DisplayName string `json:"displayName"`
		}
		if err := json.Unmarshal([]byte(payload), &request); err != nil || request.DisplayName == "" {
			return "", errors.New("invalid_payload")
		}
		if err := store.SetPlayerDisplayName(ctx, userID, request.DisplayName); err != nil {
			return "", err
		}
		career, err := store.GetOrCreateCareer(ctx, userID)
		if err != nil {
			return "", err
		}
		if _, err := store.PublishDefense(ctx, userID, request.DisplayName, career, nowMillis()); err != nil {
			return "", err
		}
		response, _ := json.Marshal(map[string]any{"displayName": request.DisplayName})
		return string(response), nil
	}
}
