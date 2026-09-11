package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math/rand"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

const (
	liveOpCodeDispatch        = 1
	liveOpCodeMatchStarted    = 2
	liveOpCodeState           = 3
	liveOpCodeCommandAccepted = 5
	liveOpCodeCommandRejected = 6
	liveOpCodeMatchResult     = 7
	liveOpCodeError           = 8

	liveTickRate     = 20 // MatchLoop ticks per second.
	liveMaxPlayers   = 2
	liveJoinCodeLen  = 8
	liveMaxMatchTime = PvpTimeLimitSeconds + 15
)

// liveClientMessage is the client -> server payload schema.
type liveClientMessage struct {
	Type     string `json:"type"`
	Sequence int    `json:"sequence"`
	SourceID string `json:"sourceId"`
	TargetID string `json:"targetId"`
}

type livePlayerState struct {
	presence    runtime.Presence
	userID      string
	displayName string
	career      PlayerCareer
	role        Team
	nextSeq     int
}

type liveMatchState struct {
	store         *Store
	players       [liveMaxPlayers]*livePlayerState
	presenceByID  map[string]int
	state         GameState
	accumulators  map[string]float64
	startedAt     int64
	started       bool
	finished      bool
	allowedUsers  []string // ranked matches: only matched user IDs may join
	inviteCode    string   // invite matches: joiner must supply this code
	battlefieldID string
}

// liveMatch implements runtime.Match for "live_match" module matches.
type liveMatch struct {
	store *Store
}

// newLiveMatchHandler is registered as the "live_match" module match.
func newLiveMatchHandler(store *Store) func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule) (runtime.Match, error) {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule) (runtime.Match, error) {
		return &liveMatch{store: store}, nil
	}
}

func (m *liveMatch) MatchInit(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, params map[string]interface{}) (interface{}, int, string) {
	label := "open"
	var inviteCode string
	if invite, ok := params["invite"].(bool); ok && invite {
		if code, ok := params["invite_code"].(string); ok && len(code) == liveJoinCodeLen {
			inviteCode = code
		} else {
			inviteCode = newLiveJoinCode()
		}
		label = "invite:" + inviteCode
	}
	var allowedUsers []string
	if users, ok := params["allowed_users"].([]interface{}); ok {
		for _, u := range users {
			if s, ok := u.(string); ok && s != "" {
				allowedUsers = append(allowedUsers, s)
			}
		}
	}
	state := &liveMatchState{
		store:         m.store,
		presenceByID:  make(map[string]int),
		accumulators:  make(map[string]float64),
		allowedUsers:  allowedUsers,
		inviteCode:    inviteCode,
		battlefieldID: battlefieldIDs[rand.Intn(len(battlefieldIDs))],
	}
	return state, liveTickRate, label
}

func (m *liveMatch) MatchJoinAttempt(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presence runtime.Presence, metadata map[string]string) (interface{}, bool, string) {
	s, ok := state.(*liveMatchState)
	if !ok {
		return state, false, "invalid_state"
	}
	if _, joined := s.presenceByID[presence.GetUserId()]; joined {
		return state, true, ""
	}
	if s.players[0] != nil && s.players[1] != nil {
		return state, false, "live_match_full"
	}
	if s.finished {
		return state, false, "live_match_finished"
	}
	// Ranked matches restrict participation to the matched user pair.
	if len(s.allowedUsers) > 0 {
		allowed := false
		for _, uid := range s.allowedUsers {
			if uid == presence.GetUserId() {
				allowed = true
				break
			}
		}
		if !allowed {
			return state, false, "live_match_not_authorized"
		}
	}
	// Invite matches require the correct join code in metadata.
	if s.inviteCode != "" {
		code, ok := metadata["code"]
		if !ok || code != s.inviteCode {
			return state, false, "live_match_invalid_code"
		}
	}
	return state, true, ""
}

func (m *liveMatch) MatchJoin(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	s, ok := state.(*liveMatchState)
	if !ok {
		return state
	}
	for _, presence := range presences {
		if _, joined := s.presenceByID[presence.GetUserId()]; joined {
			continue
		}
		role := TeamPlayer
		slot := 0
		if s.players[0] != nil {
			role = TeamEnemy
			slot = 1
		}
		career, err := s.store.GetOrCreateCareer(ctx, presence.GetUserId())
		if err != nil {
			logger.WithField("error", err).Error("live join career fetch failed")
			continue
		}
		displayName, err := s.store.GetPlayerDisplayName(ctx, presence.GetUserId())
		if err != nil {
			displayName = presence.GetUsername()
		}
		s.players[slot] = &livePlayerState{
			presence:    presence,
			userID:      presence.GetUserId(),
			displayName: displayName,
			career:      career,
			role:        role,
		}
		s.presenceByID[presence.GetUserId()] = slot
	}

	if s.players[0] != nil && s.players[1] != nil && !s.started {
		s.state = CreateInitialGameStateForBattlefield(
			UpgradeModifiers(s.players[0].career),
			UpgradeModifiers(s.players[1].career),
			s.battlefieldID,
		)
		s.startedAt = time.Now().UnixMilli()
		s.started = true
		if err := dispatcher.MatchLabelUpdate("in_progress"); err != nil {
			logger.WithField("error", err).Warn("label update failed")
		}
		s.broadcastMatchStarted(logger, dispatcher)
	}
	return state
}

func (m *liveMatch) MatchLeave(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	s, ok := state.(*liveMatchState)
	if !ok || s.finished {
		return state
	}
	for _, presence := range presences {
		slot, known := s.presenceByID[presence.GetUserId()]
		if !known {
			continue
		}
		player := s.players[slot]
		delete(s.presenceByID, presence.GetUserId())
		s.players[slot] = nil

		if player != nil && s.started {
			// Disconnect mid-match = forfeit for the leaver; settle on the
			// server for both players.
			s.finished = true
			if player.role == TeamPlayer {
				s.state.Status = "victory"
			} else {
				s.state.Status = "defeat"
			}
			s.finishSettlements(ctx, logger, dispatcher)
			return state
		}
	}
	if s.players[0] == nil && s.players[1] == nil {
		s.finished = true
	}
	return state
}

func (m *liveMatch) MatchLoop(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, messages []runtime.MatchData) interface{} {
	s, ok := state.(*liveMatchState)
	if !ok || s.finished {
		return state
	}

	if !s.started {
		// Waiting for the second player; nothing to simulate yet.
		for _, message := range messages {
			s.rejectCommand(dispatcher, message, "live_match_not_started")
		}
		return state
	}

	for _, message := range messages {
		var payload liveClientMessage
		if err := json.Unmarshal(message.GetData(), &payload); err != nil {
			s.rejectCommand(dispatcher, message, "invalid_payload")
			continue
		}
		if payload.Type != "dispatch" {
			s.rejectCommand(dispatcher, message, "unknown_message")
			continue
		}
		slot, known := s.presenceByID[message.GetUserId()]
		if !known || s.players[slot] == nil {
			s.rejectCommand(dispatcher, message, "live_match_not_started")
			continue
		}
		player := s.players[slot]
		if player.nextSeq != payload.Sequence {
			s.rejectCommand(dispatcher, message, "invalid_sequence")
			continue
		}
		err := dispatchArmy(
			&s.state,
			payload.SourceID,
			payload.TargetID,
			player.role,
			UpgradeModifiers(player.career).ArmySpeedMultiplier,
			liveArmyID(s.startedAt, player.role, payload.Sequence),
		)
		if err != nil {
			s.rejectCommand(dispatcher, message, "invalid_dispatch")
			continue
		}
		player.nextSeq++
		accepted, _ := json.Marshal(map[string]any{"type": "command_accepted", "sequence": payload.Sequence})
		if err := dispatcher.BroadcastMessageDeferred(liveOpCodeCommandAccepted, accepted, []runtime.Presence{message}, nil, true); err != nil {
			logger.WithField("error", err).Warn("broadcast accepted failed")
		}
	}

	delta := float64(1) / float64(liveTickRate)
	if s.state.Status == "playing" {
		s.state, s.accumulators = stepSimulation(s.state, s.accumulators, delta)
	}

	s.broadcastStates(dispatcher)

	if s.state.Status != "playing" {
		s.finished = true
		s.finishSettlements(ctx, logger, dispatcher)
		return state
	}

	// Safety net: never let a match run beyond the time limit + grace.
	if float64(time.Now().UnixMilli()-s.startedAt)/1000.0 > liveMaxMatchTime {
		s.finished = true
		s.state.Status = "draw"
		s.finishSettlements(ctx, logger, dispatcher)
	}
	return state
}

func (m *liveMatch) MatchTerminate(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, graceSeconds int) interface{} {
	return state
}

func (m *liveMatch) MatchSignal(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, data string) (interface{}, string) {
	return state, ""
}

func (s *liveMatchState) opponentOf(player *livePlayerState) *livePlayerState {
	for _, candidate := range s.players {
		if candidate != nil && candidate.userID != player.userID {
			return candidate
		}
	}
	return nil
}

func (s *liveMatchState) broadcastMatchStarted(logger runtime.Logger, dispatcher runtime.MatchDispatcher) {
	for _, player := range s.players {
		if player == nil {
			continue
		}
		payload, _ := json.Marshal(s.matchStartedPayload(player))
		if err := dispatcher.BroadcastMessageDeferred(liveOpCodeMatchStarted, payload, []runtime.Presence{player.presence}, nil, true); err != nil {
			logger.WithField("error", err).Warn("broadcast match_started failed")
		}
	}
}

func (s *liveMatchState) matchStartedPayload(player *livePlayerState) map[string]any {
	opponent := s.opponentOf(player)
	opponentName := "Opponent"
	if opponent != nil {
		opponentName = opponent.displayName
	}
	return map[string]any{
		"type":         "match_started",
		"matchId":      livePlayerMatchID(s.startedAt, player.userID),
		"role":         player.role,
		"playerName":   player.displayName,
		"opponentName": opponentName,
		"state":        stateForRole(s.state, player.role),
	}
}

func (s *liveMatchState) broadcastStates(dispatcher runtime.MatchDispatcher) {
	for _, player := range s.players {
		if player == nil {
			continue
		}
		payload, _ := json.Marshal(map[string]any{
			"type":  "state",
			"state": stateForRole(s.state, player.role),
		})
		if err := dispatcher.BroadcastMessageDeferred(liveOpCodeState, payload, []runtime.Presence{player.presence}, nil, false); err != nil {
			continue
		}
	}
}

func (s *liveMatchState) rejectCommand(dispatcher runtime.MatchDispatcher, message runtime.Presence, code string) {
	var sequence int
	if data, ok := message.(interface{ GetData() []byte }); ok {
		var payload liveClientMessage
		if json.Unmarshal(data.GetData(), &payload) == nil {
			sequence = payload.Sequence
		}
	}
	rejected, _ := json.Marshal(map[string]any{"type": "command_rejected", "code": code, "sequence": sequence})
	_ = dispatcher.BroadcastMessageDeferred(liveOpCodeCommandRejected, rejected, []runtime.Presence{message}, nil, true)
}

func (s *liveMatchState) finishSettlements(ctx context.Context, logger runtime.Logger, dispatcher runtime.MatchDispatcher) {
	canonical := s.state.Status
	for _, player := range s.players {
		if player == nil {
			continue
		}
		status := statusForRole(canonical, player.role)
		stats := statsForRole(s.state.Stats, player.role)
		matchID := livePlayerMatchID(s.startedAt, player.userID)
		settlement, err := s.store.SettleMatch(ctx, player.userID, status, stats, matchID)
		if err != nil {
			logger.WithField("error", err).Error("live settlement failed")
			errPayload, _ := json.Marshal(map[string]any{"type": "error", "code": "settlement_failed"})
			_ = dispatcher.BroadcastMessageDeferred(liveOpCodeError, errPayload, []runtime.Presence{player.presence}, nil, true)
			continue
		}
		payload, _ := json.Marshal(map[string]any{
			"type": "match_result",
			"result": map[string]any{
				"matchId":    matchID,
				"status":     status,
				"stats":      stats,
				"settlement": settlement,
			},
		})
		_ = dispatcher.BroadcastMessageDeferred(liveOpCodeMatchResult, payload, []runtime.Presence{player.presence}, nil, true)
	}
}

func livePlayerMatchID(startedAt int64, userID string) string {
	return fmt.Sprintf("live_%d_%s", startedAt, userID)
}

func stateForRole(state GameState, role Team) GameState {
	projected := state
	projected.Territories = make(map[string]Territory, len(state.Territories))
	for id, territory := range state.Territories {
		territory.Owner = mapTeamForRole(territory.Owner, role)
		projected.Territories[id] = territory
	}
	projected.Armies = make([]MarchingArmy, len(state.Armies))
	for index, army := range state.Armies {
		army.Owner = mapTeamForRole(army.Owner, role)
		projected.Armies[index] = army
	}
	projected.Status = statusForRole(state.Status, role)
	projected.Stats = statsForRole(state.Stats, role)
	return projected
}

func mapTeamForRole(team, role Team) Team {
	if role == TeamPlayer {
		return team
	}
	switch team {
	case TeamPlayer:
		return TeamEnemy
	case TeamEnemy:
		return TeamPlayer
	default:
		return team
	}
}

func statusForRole(status string, role Team) string {
	if role == TeamPlayer || status == "playing" || status == "draw" {
		return status
	}
	switch status {
	case "victory":
		return "defeat"
	case "defeat":
		return "victory"
	default:
		return status
	}
}

func statsForRole(stats MatchStats, role Team) MatchStats {
	if role == TeamPlayer {
		return stats
	}
	return MatchStats{
		MatchDurationSeconds:        stats.MatchDurationSeconds,
		PlayerUnitsDispatched:       stats.EnemyUnitsDispatched,
		EnemyUnitsDispatched:        stats.PlayerUnitsDispatched,
		TerritoriesCapturedByPlayer: stats.TerritoriesCapturedByEnemy,
		TerritoriesCapturedByEnemy:  stats.TerritoriesCapturedByPlayer,
	}
}

func liveArmyID(startedAt int64, role Team, sequence int) string {
	return fmt.Sprintf("live_%d_%s_%d", startedAt, role, sequence)
}

func newLiveJoinCode() string {
	const hexDigits = "0123456789ABCDEF"
	code := make([]byte, liveJoinCodeLen)
	for index := range code {
		code[index] = hexDigits[rand.Intn(len(hexDigits))]
	}
	return string(code)
}
