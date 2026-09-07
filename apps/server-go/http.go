package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type contextKey string

const (
	playerIDContextKey contextKey = "player_id"
	platformContextKey contextKey = "platform"
)

type Server struct {
	config Config
	repo   *PlayerRepository
	live   *LiveMatchManager
}

func NewServer(config Config, repo *PlayerRepository) *Server {
	return &Server{config: config, repo: repo, live: NewLiveMatchManager(repo)}
}

func (s *Server) Handler() http.Handler {
	public := http.NewServeMux()
	public.HandleFunc("GET /health", s.health)
	public.HandleFunc("POST /auth/login", s.login)

	private := http.NewServeMux()
	private.HandleFunc("GET /career", s.getCareer)
	private.HandleFunc("GET /ledger", s.getLedger)
	private.HandleFunc("POST /matches/settle", s.settleMatch)
	private.HandleFunc("POST /upgrades/purchase", s.purchaseUpgrade)
	private.HandleFunc("POST /pvp/defense/publish", s.publishDefense)
	private.HandleFunc("GET /pvp/opponents", s.getOpponents)
	private.HandleFunc("POST /pvp/attacks", s.submitAttack)
	private.HandleFunc("GET /pvp/history", s.getHistory)

	root := http.NewServeMux()
	root.Handle("/", s.withAuth(private))
	root.Handle("/health", public)
	root.Handle("/auth/login", public)
	root.HandleFunc("GET /pvp/live", s.liveWebSocket)
	return s.withCORS(root)
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Platform string `json:"platform"`
		InitData string `json:"initData"`
	}
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	if request.Platform != "telegram" && request.Platform != "bale" &&
		request.Platform != "eitaa" && request.Platform != "browser" && request.Platform != "mock" {
		writeError(w, http.StatusBadRequest, "unsupported_platform")
		return
	}
	if request.InitData == "" {
		writeError(w, http.StatusBadRequest, "missing_init_data")
		return
	}

	var externalID, username string
	switch request.Platform {
	case "telegram", "bale":
		botToken := s.config.TelegramBotToken
		if request.Platform == "bale" {
			botToken = s.config.BaleBotToken
		}
		if botToken == "" {
			writeError(w, http.StatusServiceUnavailable, "platform_not_configured")
			return
		}
		verified, err := VerifyTelegramStyleInitData(request.InitData, botToken, s.config.InitDataMaxAgeSeconds)
		if err != nil {
			writeError(w, http.StatusUnauthorized, initDataErrorCode(err))
			return
		}
		externalID, username = verified.UserID, verified.Username
	case "eitaa":
		var ok bool
		externalID, username, ok = ExtractUnverifiedUser(request.InitData)
		if !ok {
			writeError(w, http.StatusBadRequest, "missing_user")
			return
		}
	default:
		if !s.config.AllowGuestAuth {
			writeError(w, http.StatusForbidden, "guest_auth_disabled")
			return
		}
		var ok bool
		externalID, username, ok = ExtractUnverifiedUser(request.InitData)
		if !ok {
			writeError(w, http.StatusBadRequest, "missing_user")
			return
		}
	}
	playerID := request.Platform + ":" + externalID
	var usernamePtr *string
	if username != "" {
		usernamePtr = &username
	}
	career, err := s.repo.GetOrCreateCareer(r.Context(), playerID, request.Platform, usernamePtr)
	if err != nil {
		log.Printf("[auth/login] failed: %v", err)
		writeError(w, http.StatusInternalServerError, "internal_error")
		return
	}
	if _, err := s.repo.PublishDefense(r.Context(), playerID, username, career, nowMillis()); err != nil {
		log.Printf("[auth/login] defense publish failed: %v", err)
		writeError(w, http.StatusInternalServerError, "internal_error")
		return
	}
	token, err := SignSessionToken(playerID, request.Platform, s.config.JWTSecret)
	if err != nil {
		log.Printf("[auth/login] token failed: %v", err)
		writeError(w, http.StatusInternalServerError, "internal_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token": token, "career": career, "rank": GetRankTier(career.Trophies),
	})
}

func (s *Server) getCareer(w http.ResponseWriter, r *http.Request) {
	playerID, platform := authValues(r)
	career, err := s.repo.GetOrCreateCareer(r.Context(), playerID, platform, nil)
	if err != nil {
		writeRepoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"career": career, "rank": GetRankTier(career.Trophies)})
}

func (s *Server) getLedger(w http.ResponseWriter, r *http.Request) {
	playerID, _ := authValues(r)
	limit := queryLimit(r, "limit", 50, 200)
	entries, err := s.repo.GetLedger(r.Context(), playerID, limit)
	if err != nil {
		writeRepoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

func (s *Server) settleMatch(w http.ResponseWriter, r *http.Request) {
	playerID, _ := authValues(r)
	var request struct {
		MatchID string             `json:"matchId"`
		Status  string             `json:"status"`
		Stats   *matchStatsPayload `json:"stats"`
	}
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	matchID, err := parseIdempotencyKey(request.MatchID, "matchId")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if request.Status != "victory" && request.Status != "defeat" && request.Status != "draw" {
		writeError(w, http.StatusBadRequest, "invalid_status")
		return
	}
	stats, err := parseMatchStats(request.Stats)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	settlement, err := s.repo.SettleMatch(r.Context(), playerID, request.Status, stats, matchID)
	if err != nil {
		writeRepoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settlement": settlement})
}

func (s *Server) purchaseUpgrade(w http.ResponseWriter, r *http.Request) {
	playerID, _ := authValues(r)
	var request struct {
		Type       string `json:"type"`
		PurchaseID string `json:"purchaseId"`
	}
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	upgrade := UpgradeType(request.Type)
	if upgrade != UpgradeStartingGarrison && upgrade != UpgradeProduction && upgrade != UpgradeArmySpeed {
		writeError(w, http.StatusBadRequest, "invalid_upgrade_type")
		return
	}
	purchaseID, err := parseIdempotencyKey(request.PurchaseID, "purchaseId")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.repo.PurchaseUpgrade(r.Context(), playerID, upgrade, purchaseID)
	if err != nil {
		writeRepoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}

func (s *Server) publishDefense(w http.ResponseWriter, r *http.Request) {
	playerID, platform := authValues(r)
	career, err := s.repo.GetOrCreateCareer(r.Context(), playerID, platform, nil)
	if err != nil {
		writeRepoError(w, err)
		return
	}
	displayName, err := s.repo.GetPlayerDisplayName(r.Context(), playerID)
	if err != nil {
		writeRepoError(w, err)
		return
	}
	defense, err := s.repo.PublishDefense(r.Context(), playerID, displayName, career, nowMillis())
	if err != nil {
		writeRepoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"defense": defense})
}

func (s *Server) getOpponents(w http.ResponseWriter, r *http.Request) {
	playerID, platform := authValues(r)
	career, err := s.repo.GetOrCreateCareer(r.Context(), playerID, platform, nil)
	if err != nil {
		writeRepoError(w, err)
		return
	}
	opponents, err := s.repo.GetPvpOpponents(r.Context(), playerID, career.Trophies, queryLimit(r, "limit", 8, 20))
	if err != nil {
		writeRepoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"opponents": opponents})
}

func (s *Server) getHistory(w http.ResponseWriter, r *http.Request) {
	playerID, _ := authValues(r)
	history, err := s.repo.GetPvpHistory(r.Context(), playerID, queryLimit(r, "limit", 20, 50))
	if err != nil {
		writeRepoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"history": history})
}

func (s *Server) submitAttack(w http.ResponseWriter, r *http.Request) {
	playerID, _ := authValues(r)
	var request struct {
		AttackID   string             `json:"attackId"`
		DefenderID string             `json:"defenderId"`
		Actions    *[]json.RawMessage `json:"actions"`
	}
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	attackID, err := parseIdempotencyKey(request.AttackID, "attackId")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(request.DefenderID) < 1 || len(request.DefenderID) > 128 {
		writeError(w, http.StatusBadRequest, "invalid_defender_id")
		return
	}
	if request.Actions == nil {
		writeError(w, http.StatusBadRequest, "invalid_actions")
		return
	}
	actions, err := parsePvpActions(*request.Actions)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.repo.SettlePvpAttack(r.Context(), playerID, request.DefenderID, attackID, actions)
	if err != nil {
		switch {
		case errors.Is(err, ErrPvpDefenseNotFound):
			writeError(w, http.StatusNotFound, "pvp_target_not_found")
		case errors.Is(err, ErrPvpSelfAttack):
			writeError(w, http.StatusBadRequest, "pvp_cannot_attack_self")
		case errors.Is(err, ErrPvpAttackOwnership):
			writeError(w, http.StatusConflict, "pvp_attack_id_conflict")
		case errors.Is(err, ErrPlayerNotFound):
			writeError(w, http.StatusNotFound, "player_not_found")
		case isPvpSimulationError(err):
			writeError(w, http.StatusBadRequest, err.Error())
		default:
			log.Printf("[pvp/attacks] failed: %v", err)
			writeError(w, http.StatusInternalServerError, "internal_error")
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}

type matchStatsPayload struct {
	MatchDurationSeconds        *float64 `json:"matchDurationSeconds"`
	PlayerUnitsDispatched       *float64 `json:"playerUnitsDispatched"`
	EnemyUnitsDispatched        *float64 `json:"enemyUnitsDispatched"`
	TerritoriesCapturedByPlayer *float64 `json:"territoriesCapturedByPlayer"`
	TerritoriesCapturedByEnemy  *float64 `json:"territoriesCapturedByEnemy"`
}

func parseMatchStats(value *matchStatsPayload) (MatchStats, error) {
	if value == nil {
		return MatchStats{}, errors.New("invalid_stats")
	}
	values := []*float64{
		value.MatchDurationSeconds, value.PlayerUnitsDispatched, value.EnemyUnitsDispatched,
		value.TerritoriesCapturedByPlayer, value.TerritoriesCapturedByEnemy,
	}
	names := []string{
		"matchDurationSeconds", "playerUnitsDispatched", "enemyUnitsDispatched",
		"territoriesCapturedByPlayer", "territoriesCapturedByEnemy",
	}
	for index, number := range values {
		if number == nil || !isFinite(*number) || *number < 0 {
			return MatchStats{}, errors.New("invalid_" + names[index])
		}
	}
	return MatchStats{
		MatchDurationSeconds:        *value.MatchDurationSeconds,
		PlayerUnitsDispatched:       *value.PlayerUnitsDispatched,
		EnemyUnitsDispatched:        *value.EnemyUnitsDispatched,
		TerritoriesCapturedByPlayer: *value.TerritoriesCapturedByPlayer,
		TerritoriesCapturedByEnemy:  *value.TerritoriesCapturedByEnemy,
	}, nil
}

func parsePvpActions(items []json.RawMessage) ([]PvpAction, error) {
	if len(items) > MaxPvpActions {
		return nil, errors.New("invalid_actions")
	}
	actions := make([]PvpAction, len(items))
	for index, raw := range items {
		var value map[string]json.RawMessage
		if err := json.Unmarshal(raw, &value); err != nil || value == nil {
			return nil, errors.New("invalid_action")
		}
		var sequence int
		var atSeconds float64
		var sourceID, targetID string
		if decodeField(value, "sequence", &sequence) != nil ||
			decodeField(value, "atSeconds", &atSeconds) != nil ||
			decodeField(value, "sourceId", &sourceID) != nil ||
			decodeField(value, "targetId", &targetID) != nil ||
			sequence != index || !isFinite(atSeconds) {
			return nil, errors.New("invalid_action")
		}
		actions[index] = PvpAction{Sequence: index, AtSeconds: atSeconds, SourceID: sourceID, TargetID: targetID}
	}
	return actions, nil
}

func decodeField(value map[string]json.RawMessage, key string, target any) error {
	raw, ok := value[key]
	if !ok {
		return errors.New("missing_field")
	}
	return json.Unmarshal(raw, target)
}

func parseIdempotencyKey(value, field string) (string, error) {
	if len(value) < 1 || len(value) > 128 {
		return "", errors.New("invalid_" + field)
	}
	return value, nil
}

func queryLimit(r *http.Request, key string, fallback, max int) int {
	value, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil || value <= 0 {
		return fallback
	}
	if value > max {
		return max
	}
	return value
}

func (s *Server) withAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := strings.Fields(r.Header.Get("Authorization"))
		if len(header) != 2 || header[0] != "Bearer" {
			writeError(w, http.StatusUnauthorized, "missing_authorization")
			return
		}
		playerID, platform, err := VerifySessionToken(header[1], s.config.JWTSecret)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid_token")
			return
		}
		ctx := context.WithValue(r.Context(), playerIDContextKey, playerID)
		ctx = context.WithValue(ctx, platformContextKey, platform)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && s.config.ClientOrigins[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func authValues(r *http.Request) (string, string) {
	playerID, _ := r.Context().Value(playerIDContextKey).(string)
	platform, _ := r.Context().Value(platformContextKey).(string)
	return playerID, platform
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func writeRepoError(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrPlayerNotFound) {
		writeError(w, http.StatusNotFound, "player_not_found")
		return
	}
	log.Printf("repository error: %v", err)
	writeError(w, http.StatusInternalServerError, "internal_error")
}

func initDataErrorCode(err error) string {
	switch {
	case errors.Is(err, ErrMissingHash):
		return "missing_hash"
	case errors.Is(err, ErrMissingAuthDate):
		return "missing_auth_date"
	case errors.Is(err, ErrInvalidSignature):
		return "invalid_signature"
	case errors.Is(err, ErrExpiredInitData):
		return "expired"
	case errors.Is(err, ErrMissingUser):
		return "missing_user"
	default:
		return "malformed"
	}
}

func isPvpSimulationError(err error) bool {
	return errors.Is(err, ErrPvpTooManyActions) ||
		errors.Is(err, ErrPvpInvalidSequence) ||
		errors.Is(err, ErrPvpInvalidTimestamp) ||
		errors.Is(err, ErrPvpActionAfterBattleEnd) ||
		errors.Is(err, ErrPvpInvalidSource) ||
		errors.Is(err, ErrPvpInvalidTarget) ||
		errors.Is(err, ErrPvpInvalidDispatch)
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}
