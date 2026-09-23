package main

// Authoritative four-player 2v2 match handler (docs/2v2-architecture.md §3,
// §5, §6; Phase 3).
//
// The handler owns the full match envelope for four player slots mapped onto
// the unchanged two-sided simulation: slots 0/1 are team A (sim side
// 'player'), slots 2/3 are team B (sim side 'enemy'). Territory ownership is
// team-shared; per-slot identity, sequences, modifiers, and stats live only
// in this envelope layer. The entire module is unreachable unless
// ENABLE_2V2=true: the matchmaker hook rejects 2v2 tickets, the matched
// router refuses to create 2v2 groups, and MatchInit fails the match shut.

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

const (
	live2v2MaxPlayers             = 4
	live2v2TickRate               = 20
	live2v2CountdownSeconds       = 10
	live2v2ReconnectGraceSeconds  = 30
	live2v2RematchWindowSeconds   = 10
	live2v2SettlementRetrySeconds = 1
	live2v2MaxMatchTime           = PvpTimeLimitSeconds + 30
	live2v2WaitingTimeoutSeconds  = 30
	live2v2MaxPayloadBytes        = 4096
	live2v2MaxActionsPerMatch     = twoVTwoDefaultMaxActions
	live2v2BattlefieldID          = "quad_citadel"
)

// The quad_citadel battlefield (docs/2v2-architecture.md §7.3) is registered
// from the authoritative apps/server-nakama/battlefields.json in domain.go's
// init (Phase 6): same frozen topology and territory order as the interim
// programmatic registration this JSON entry replaces, so replays stay
// deterministic. The symmetry proof in tools/verify_battlefield_symmetry.py
// reads the shipped JSON and fails closed on any drift.

// live2v2SpawnAssignments pins one distinct starting base per slot
// (docs/2v2-architecture.md §2.3, §7.3): slot 0 -> A west, slot 1 -> A east,
// slot 2 -> B east (B1), slot 3 -> B west (B2).
var live2v2SpawnAssignments = []TwoVTwoSpawnAssignment{
	{Slot: 0, TerritoryID: "a_base_w"},
	{Slot: 1, TerritoryID: "a_base_e"},
	{Slot: 2, TerritoryID: "b_base_e"},
	{Slot: 3, TerritoryID: "b_base_w"},
}

const (
	live2v2PhaseWaiting   = "waiting"
	live2v2PhaseCountdown = "countdown"
	live2v2PhasePlaying   = "playing"
	live2v2PhaseFinished  = "finished"
	live2v2PhaseCancelled = "cancelled"
)

// live2v2SlotState is the per-slot envelope state. Slots are stable for the
// whole match and preserved across disconnects.
type live2v2SlotState struct {
	presence       runtime.Presence // newest authenticated session wins; nil while disconnected
	userID         string
	displayName    string
	career         PlayerCareer
	teamID         TeamID
	startBase      string
	nextSeq        int
	connected      bool
	disconnectedAt time.Time // zero while connected
	abandoned      bool
	surrendered    bool
	ready          bool
}

type live2v2MatchState struct {
	store             *Store
	settle2v2         func(ctx context.Context, request Settle2v2Request) ([]MatchSettlement, error)
	matchCreate       func(ctx context.Context, moduleName string, params map[string]interface{}) (string, error)
	slots             [live2v2MaxPlayers]*live2v2SlotState
	presenceByUser    map[string]int
	state             GameState
	accumulators      map[string]float64
	actionLog         []CanonicalTwoVTwoAction
	serverSeq         int
	tick              int64
	startedAt         int64
	matchID           string
	battlefieldID     string
	allowedUsers      []string
	phase             string
	countdownEnds     int64 // tick
	waitingEnds       int64 // tick
	deadlineAt        time.Time
	stats             MatchStats2v2
	prevState         *GameState
	rematchVotes      [live2v2MaxPlayers]bool
	rematchEnds       int64 // tick
	rematchMade       bool
	settled           bool
	settlementRetryAt int64 // tick; retries transient atomic-settlement failures
}

// MatchStats2v2 is the envelope-level per-slot attribution
// (docs/2v2-architecture.md §2.6, §3.3). It never enters simulation state.
type MatchStats2v2 struct {
	UnitsDispatchedBySlot     [live2v2MaxPlayers]int64 `json:"unitsDispatchedBySlot"`
	TerritoriesCapturedBySlot [live2v2MaxPlayers]int64 `json:"territoriesCapturedBySlot"`
	TeamUnitsDispatched       [2]int64                 `json:"teamUnitsDispatched"`
	TeamTerritoriesCaptured   [2]int64                 `json:"teamTerritoriesCaptured"`
}

type live2v2Match struct {
	store *Store
}

// newLive2v2MatchHandler is registered as the "live_match_2v2" module match.
func newLive2v2MatchHandler(store *Store) func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule) (runtime.Match, error) {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule) (runtime.Match, error) {
		return &live2v2Match{store: store}, nil
	}
}

// assign2v2SlotsBySnakeDraft is the pure team-assignment function
// (docs/2v2-architecture.md §3.2.4): entries are sorted by authoritative
// server-read trophies (descending) with user-ID ascending as the tiebreak,
// then drafted in snake order 0->A(slot0), 1->B(slot2), 2->B(slot3), 3->A(slot1).
// The result is stable regardless of the callback entry order.
func assign2v2SlotsBySnakeDraft(entries []twoVTwoDraftEntry) ([live2v2MaxPlayers]string, error) {
	if len(entries) != live2v2MaxPlayers {
		return [live2v2MaxPlayers]string{}, errors.New("draft_requires_four_players")
	}
	seen := make(map[string]bool, len(entries))
	for _, entry := range entries {
		if entry.UserID == "" || seen[entry.UserID] {
			return [live2v2MaxPlayers]string{}, errors.New("draft_invalid_participants")
		}
		seen[entry.UserID] = true
	}
	sorted := make([]twoVTwoDraftEntry, len(entries))
	copy(sorted, entries)
	for i := 1; i < len(sorted); i++ {
		for j := i; j > 0; j-- {
			if sorted[j-1].Trophies > sorted[j].Trophies ||
				(sorted[j-1].Trophies == sorted[j].Trophies && sorted[j-1].UserID < sorted[j].UserID) {
				continue
			}
			sorted[j-1], sorted[j] = sorted[j], sorted[j-1]
		}
	}
	var slots [live2v2MaxPlayers]string
	slots[0] = sorted[0].UserID // team A, top seed
	slots[1] = sorted[3].UserID // team A, bottom seed
	slots[2] = sorted[1].UserID // team B, second seed
	slots[3] = sorted[2].UserID // team B, third seed
	return slots, nil
}

type twoVTwoDraftEntry struct {
	UserID   string
	Trophies int
}

func newLive2v2MatchID(startedAt int64) string {
	randomBytes := make([]byte, 4)
	if _, err := rand.Read(randomBytes); err != nil {
		return fmt.Sprintf("live2v2_%d", startedAt)
	}
	return fmt.Sprintf("live2v2_%s_%d", hex.EncodeToString(randomBytes), startedAt)
}

func (m *live2v2Match) MatchInit(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, params map[string]interface{}) (interface{}, int, string) {
	state := &live2v2MatchState{
		store:          m.store,
		presenceByUser: make(map[string]int, live2v2MaxPlayers),
		accumulators:   make(map[string]float64),
		battlefieldID:  live2v2BattlefieldID,
		phase:          live2v2PhaseWaiting,
		startedAt:      time.Now().UnixMilli(),
		matchID:        newLive2v2MatchID(time.Now().UnixMilli()),
		settle2v2:      m.store.SettleMatch2v2,
		waitingEnds:    live2v2WaitingTimeoutSeconds * live2v2TickRate,
	}
	if nk != nil {
		state.matchCreate = nk.MatchCreate
	}
	if users, ok := params["allowed_users"].([]interface{}); ok {
		for _, user := range users {
			if id, ok := user.(string); ok && id != "" {
				state.allowedUsers = append(state.allowedUsers, id)
			}
		}
	}

	// The entire handler is unavailable unless ENABLE_2V2 is enabled. The
	// ticket hook and matched router already gate creation; this is the
	// in-handler safety net.
	if !serverConfig.Enable2v2 {
		state.phase = live2v2PhaseCancelled
		logger.Warn("2v2 match created with feature flag disabled; match cancelled")
		return state, live2v2TickRate, "mode:2v2;phase:cancelled;v:2"
	}

	if err := state.assignSlotsByDraft(ctx); err != nil {
		state.phase = live2v2PhaseCancelled
		logger.WithField("error", err).Error("2v2 team assignment failed; match cancelled")
		return state, live2v2TickRate, "mode:2v2;phase:cancelled;v:2"
	}
	// Rematch matches preserve the exact previous slot order.
	if slotUsers, ok := params["slot_users"].([]interface{}); ok && len(slotUsers) == live2v2MaxPlayers {
		userIDs := make([]string, 0, live2v2MaxPlayers)
		for _, slotUser := range slotUsers {
			id, ok := slotUser.(string)
			if !ok || id == "" {
				userIDs = nil
				break
			}
			userIDs = append(userIDs, id)
		}
		if userIDs != nil && state.slotsMatchAllowedUsers(userIDs) {
			if err := state.reorderSlotsByUserIDs(userIDs); err != nil {
				state.phase = live2v2PhaseCancelled
				return state, live2v2TickRate, "mode:2v2;phase:cancelled;v:2"
			}
		}
	}
	return state, live2v2TickRate, "mode:2v2;phase:open;v:2"
}

// reorderSlotsByUserIDs re-assigns the already-drafted slot states to a
// given slot order (rematch matches keep identical teams and slots).
func (s *live2v2MatchState) reorderSlotsByUserIDs(userIDs []string) error {
	byUser := make(map[string]*live2v2SlotState, live2v2MaxPlayers)
	for _, slotState := range s.slots {
		if slotState != nil {
			byUser[slotState.userID] = slotState
		}
	}
	seen := make(map[string]bool, live2v2MaxPlayers)
	for slot, userID := range userIDs {
		slotState, exists := byUser[userID]
		if !exists || seen[userID] {
			return errors.New("draft_invalid_participants")
		}
		seen[userID] = true
		slotState.teamID = TeamIDForSlot(slot)
		slotState.startBase = live2v2SpawnAssignments[slot].TerritoryID
		s.slots[slot] = slotState
	}
	return nil
}

// assignSlotsByDraft loads authoritative careers for the allowlisted users
// and drafts the four slots by snake order.
func (s *live2v2MatchState) assignSlotsByDraft(ctx context.Context) error {
	if len(s.allowedUsers) != live2v2MaxPlayers {
		return errors.New("draft_requires_four_players")
	}
	entries := make([]twoVTwoDraftEntry, 0, live2v2MaxPlayers)
	careers := make(map[string]PlayerCareer, live2v2MaxPlayers)
	for _, userID := range s.allowedUsers {
		career, err := s.store.GetOrCreateCareer(ctx, userID)
		if err != nil {
			return err
		}
		entries = append(entries, twoVTwoDraftEntry{UserID: userID, Trophies: career.Trophies})
		careers[userID] = career
	}
	slotUsers, err := assign2v2SlotsBySnakeDraft(entries)
	if err != nil {
		return err
	}
	return s.applySlotOrder(slotUsers[:], careers)
}

func (s *live2v2MatchState) slotsMatchAllowedUsers(userIDs []string) bool {
	if len(userIDs) != live2v2MaxPlayers || len(s.allowedUsers) != live2v2MaxPlayers {
		return false
	}
	allowed := make(map[string]bool, len(s.allowedUsers))
	for _, id := range s.allowedUsers {
		allowed[id] = true
	}
	for _, id := range userIDs {
		if !allowed[id] {
			return false
		}
	}
	return true
}

func (s *live2v2MatchState) applySlotOrder(userIDs []string, careers map[string]PlayerCareer) error {
	if len(userIDs) != live2v2MaxPlayers || len(careers) != live2v2MaxPlayers {
		return errors.New("draft_requires_four_players")
	}
	seen := make(map[string]bool, live2v2MaxPlayers)
	for slot, userID := range userIDs {
		if userID == "" || seen[userID] {
			return errors.New("draft_invalid_participants")
		}
		seen[userID] = true
		s.slots[slot] = &live2v2SlotState{
			userID:    userID,
			career:    careers[userID],
			teamID:    TeamIDForSlot(slot),
			startBase: live2v2SpawnAssignments[slot].TerritoryID,
		}
	}
	return nil
}

func (m *live2v2Match) MatchJoinAttempt(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presence runtime.Presence, metadata map[string]string) (interface{}, bool, string) {
	s, ok := state.(*live2v2MatchState)
	if !ok {
		return state, false, "invalid_state"
	}
	if s.phase == live2v2PhaseFinished || s.phase == live2v2PhaseCancelled {
		return state, false, "live_match_finished"
	}
	// A user id known to the match is a slot-preserving rejoin (including a
	// duplicate second session, which evicts the older presence).
	if _, joined := s.presenceByUser[presence.GetUserId()]; joined {
		return state, true, ""
	}
	// Ranked matches restrict participation to the matched four.
	if len(s.allowedUsers) > 0 {
		allowed := false
		for _, userID := range s.allowedUsers {
			if userID == presence.GetUserId() {
				allowed = true
				break
			}
		}
		if !allowed {
			return state, false, "live_match_not_authorized"
		}
	}
	assigned := s.emptySlotForUser(presence.GetUserId())
	if assigned < 0 {
		// Full match, no pre-assigned slot: no backfill is performed (§13).
		return state, false, "live_match_full"
	}
	return state, true, ""
}

func (s *live2v2MatchState) emptySlotForUser(userID string) int {
	for slot, slotState := range s.slots {
		if slotState != nil && slotState.userID == userID && slotState.presence == nil {
			return slot
		}
	}
	return -1
}

func (m *live2v2Match) MatchJoin(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	s, ok := state.(*live2v2MatchState)
	if !ok {
		return state
	}
	for _, presence := range presences {
		slot, known := s.presenceByUser[presence.GetUserId()]
		if known {
			s.adoptPresence(s.slots[slot], presence, logger, dispatcher)
			if s.phase == live2v2PhasePlaying {
				// Slot-preserving rejoin resync (§5.1): full state + next
				// expected sequence before any further state ticks.
				s.resyncRejoinedSlot(logger, dispatcher, slot)
			}
			continue
		}
		assigned := s.emptySlotForUser(presence.GetUserId())
		if assigned < 0 {
			continue
		}
		slotState := s.slots[assigned]
		displayName, err := s.store.GetPlayerDisplayName(ctx, presence.GetUserId())
		if err != nil {
			displayName = presence.GetUsername()
		}
		slotState.displayName = displayName
		s.adoptPresence(slotState, presence, logger, dispatcher)
		s.presenceByUser[presence.GetUserId()] = assigned
	}

	if s.phase == live2v2PhaseWaiting && s.allSlotsJoined() {
		s.phase = live2v2PhaseCountdown
		s.countdownEnds = tick + live2v2CountdownSeconds*live2v2TickRate
	}
	return state
}

// adoptPresence binds the newest authenticated session to the slot and, when
// a different session already held the slot, evicts it (duplicate-session
// eviction: the newest presence owns the slot).
func (s *live2v2MatchState) adoptPresence(slotState *live2v2SlotState, presence runtime.Presence, logger runtime.Logger, dispatcher runtime.MatchDispatcher) {
	if slotState.presence != nil && slotState.presence.GetSessionId() != presence.GetSessionId() {
		if err := dispatcher.MatchKick([]runtime.Presence{slotState.presence}); err != nil {
			logger.WithField("error", err).Warn("2v2 duplicate-session kick failed")
		}
	}
	slotState.presence = presence
	slotState.connected = true
	slotState.disconnectedAt = time.Time{}
}

func (s *live2v2MatchState) allSlotsJoined() bool {
	for _, slotState := range s.slots {
		if slotState == nil || slotState.presence == nil {
			return false
		}
	}
	return true
}

func (m *live2v2Match) MatchLeave(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	s, ok := state.(*live2v2MatchState)
	if !ok {
		return state
	}
	if s.phase == live2v2PhaseFinished || s.phase == live2v2PhaseCancelled {
		return state
	}
	for _, presence := range presences {
		slot, known := s.presenceByUser[presence.GetUserId()]
		if !known {
			continue
		}
		slotState := s.slots[slot]
		if slotState.presence == nil || slotState.presence.GetSessionId() != presence.GetSessionId() {
			// Leave event of an already-evicted session: ignore.
			continue
		}
		slotState.presence = nil
		slotState.connected = false
		slotState.disconnectedAt = time.Now()
	}
	return state
}

// live2v2ClientMessage is the version-2 client -> server payload schema
// (docs/2v2-architecture.md §3.3).
type live2v2ClientMessage struct {
	SchemaVersion int    `json:"schemaVersion"`
	Type          string `json:"type"`
	Sequence      int    `json:"sequence"`
	SourceID      string `json:"sourceId"`
	TargetID      string `json:"targetId"`
}

func (m *live2v2Match) MatchLoop(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, messages []runtime.MatchData) interface{} {
	s, ok := state.(*live2v2MatchState)
	if !ok {
		return state
	}
	s.tick = tick
	if s.phase == live2v2PhaseCancelled {
		return nil
	}
	if s.phase == live2v2PhaseFinished && !s.settled {
		if tick >= s.settlementRetryAt {
			s.finishMatch(ctx, logger, dispatcher)
		}
		return state
	}

	if s.phase == live2v2PhasePlaying {
		s.enforceReconnectGrace(ctx, logger, dispatcher)
		if s.phase != live2v2PhasePlaying {
			return state
		}
	}

	for index, message := range messages {
		serverSeq := s.serverSeq + index + 1
		s.handleMessage(ctx, logger, dispatcher, message, serverSeq)
	}
	s.serverSeq += len(messages)
	if s.phase == live2v2PhaseFinished {
		if s.settled && tick >= s.rematchEnds {
			return nil
		}
		return state
	}

	switch s.phase {
	case live2v2PhaseWaiting:
		if s.allSlotsJoined() {
			s.phase = live2v2PhaseCountdown
			s.countdownEnds = tick + live2v2CountdownSeconds*live2v2TickRate
		} else if tick >= s.waitingEnds {
			s.cancelMatch(ctx, logger, dispatcher, "waiting_timeout")
			return state
		}
	case live2v2PhaseCountdown:
		if s.allSlotsReady() {
			s.startMatch(ctx, logger, dispatcher)
		} else if tick >= s.countdownEnds {
			if s.allSlotsJoined() {
				s.startMatch(ctx, logger, dispatcher)
			} else {
				s.cancelMatch(ctx, logger, dispatcher, "not_ready_at_countdown")
				return state
			}
		}
	}

	if s.phase == live2v2PhasePlaying {
		if s.state.Status == "playing" {
			previous := s.state
			s.state, s.accumulators = stepSimulation(s.state, s.accumulators, float64(1)/float64(live2v2TickRate))
			s.trackPerSlotCaptures(&previous)
		}
		s.broadcastStates(dispatcher)

		if s.state.Status != "playing" {
			s.finishMatch(ctx, logger, dispatcher)
			return state
		}
		if time.Now().After(s.deadlineAt) {
			// Safety net: never let a match run beyond the time limit + grace.
			if s.state.Status == "playing" {
				s.state.Status = "draw"
			}
			s.finishMatch(ctx, logger, dispatcher)
			return state
		}
	}
	return state
}

func (s *live2v2MatchState) joinedSlotCount() int {
	count := 0
	for _, slotState := range s.slots {
		if slotState != nil && slotState.presence != nil {
			count++
		}
	}
	return count
}

func (s *live2v2MatchState) allSlotsReady() bool {
	for _, slotState := range s.slots {
		if slotState == nil || !slotState.ready {
			return false
		}
	}
	return true
}

// handleMessage validates one drained message against the version-2 protocol
// and fails closed on every violation (docs/2v2-architecture.md §3.6, §7).
func (s *live2v2MatchState) handleMessage(ctx context.Context, logger runtime.Logger, dispatcher runtime.MatchDispatcher, message runtime.MatchData, serverSeq int) {
	slot, known := s.presenceByUser[message.GetUserId()]
	if !known {
		s.rejectCommand(dispatcher, message, "not_in_match")
		return
	}
	// Only the newest authenticated session bound to a slot may issue
	// commands. A kicked duplicate can still have already-buffered messages
	// in the current tick; user-id lookup alone must not authorize them.
	activePresence := s.slots[slot].presence
	if activePresence == nil || activePresence.GetSessionId() != message.GetSessionId() {
		s.rejectCommand(dispatcher, message, "not_in_match")
		return
	}
	data := message.GetData()
	if len(data) > live2v2MaxPayloadBytes {
		s.rejectCommand(dispatcher, message, "invalid_payload")
		return
	}
	var payload live2v2ClientMessage
	if err := json.Unmarshal(data, &payload); err != nil {
		s.rejectCommand(dispatcher, message, "invalid_payload")
		return
	}
	// Every 2v2 payload must carry schemaVersion: 2. Wrong or missing schema
	// fails closed.
	if payload.SchemaVersion != MatchSchemaVersion2 {
		s.rejectCommand(dispatcher, message, "invalid_payload")
		return
	}
	switch payload.Type {
	case "dispatch":
		s.handleDispatch(dispatcher, message, payload, slot, int(s.tick), serverSeq)
	case "ready":
		s.handleReady(dispatcher, message, slot)
	case "surrender":
		s.handleSurrender(ctx, logger, dispatcher, message, slot)
	case "rematch_vote":
		s.handleRematchVote(ctx, logger, dispatcher, message, slot)
	default:
		s.rejectCommand(dispatcher, message, "unknown_message")
	}
}

func (s *live2v2MatchState) handleDispatch(dispatcher runtime.MatchDispatcher, message runtime.MatchData, payload live2v2ClientMessage, slot int, tick int, serverSeq int) {
	slotState := s.slots[slot]
	if s.phase != live2v2PhasePlaying {
		s.rejectCommand(dispatcher, message, "live_match_not_started")
		return
	}
	// Dispatches by abandoned or disconnected slots fail closed.
	if slotState.abandoned || slotState.surrendered || !slotState.connected {
		s.rejectCommand(dispatcher, message, "slot_disconnected")
		return
	}
	if slotState.nextSeq != payload.Sequence {
		s.rejectCommand(dispatcher, message, "invalid_sequence")
		return
	}
	if len(s.actionLog) >= live2v2MaxActionsPerMatch {
		s.rejectCommand(dispatcher, message, "too_many_actions")
		return
	}
	source, exists := s.state.Territories[payload.SourceID]
	if !exists {
		s.rejectCommand(dispatcher, message, "invalid_source")
		return
	}
	if _, exists := s.state.Territories[payload.TargetID]; !exists {
		s.rejectCommand(dispatcher, message, "invalid_target")
		return
	}
	// Team permission: either teammate may dispatch from any team-owned
	// territory (shared ownership §2.3); dispatchArmy re-validates ownership
	// against the slot's sim side.
	unitsBefore := source.Units
	armyID := fmt.Sprintf("2v2_%d_%d_%d_%d", tick, serverSeq, slot, payload.Sequence)
	if err := dispatchArmy(&s.state, payload.SourceID, payload.TargetID, SimulationOwnerForSlot(slot), UpgradeModifiers(slotState.career).ArmySpeedMultiplier, armyID); err != nil {
		switch err {
		case ErrPvpInvalidSource:
			s.rejectCommand(dispatcher, message, "invalid_source")
		case ErrPvpInvalidTarget:
			s.rejectCommand(dispatcher, message, "invalid_target")
		default:
			s.rejectCommand(dispatcher, message, "invalid_dispatch")
		}
		return
	}
	unitsAfter := s.state.Territories[payload.SourceID].Units

	slotState.nextSeq++
	s.actionLog = append(s.actionLog, CanonicalTwoVTwoAction{
		SchemaVersion: MatchSchemaVersion2,
		Tick:          tick,
		ServerSeq:     serverSeq,
		Slot:          slot,
		ClientSeq:     payload.Sequence,
		SourceID:      payload.SourceID,
		TargetID:      payload.TargetID,
	})
	s.stats.UnitsDispatchedBySlot[slot] += int64(unitsBefore - unitsAfter)
	accepted, _ := json.Marshal(map[string]any{
		"schemaVersion": MatchSchemaVersion2,
		"type":          "command_accepted",
		"sequence":      payload.Sequence,
		"slot":          slot,
	})
	if err := dispatcher.BroadcastMessageDeferred(liveOpCodeCommandAccepted, accepted, []runtime.Presence{message}, nil, true); err != nil {
		// The action is already canonical; a failed ack broadcast must not
		// reject or revert it.
		_ = err
	}
}

func (s *live2v2MatchState) handleReady(dispatcher runtime.MatchDispatcher, message runtime.MatchData, slot int) {
	if s.phase != live2v2PhaseWaiting && s.phase != live2v2PhaseCountdown {
		s.rejectCommand(dispatcher, message, "unknown_message")
		return
	}
	s.slots[slot].ready = true
}

func (s *live2v2MatchState) handleSurrender(ctx context.Context, logger runtime.Logger, dispatcher runtime.MatchDispatcher, message runtime.MatchData, slot int) {
	switch s.phase {
	case live2v2PhaseWaiting, live2v2PhaseCountdown:
		// Explicit cancellation during the lobby/countdown phase (§5.0).
		s.cancelMatch(ctx, logger, dispatcher, "surrender")
	case live2v2PhasePlaying:
		slotState := s.slots[slot]
		if !slotState.connected {
			s.rejectCommand(dispatcher, message, "slot_disconnected")
			return
		}
		slotState.surrendered = true
		slotState.connected = false
		if slotState.presence != nil {
			_ = dispatcher.MatchKick([]runtime.Presence{slotState.presence})
			slotState.presence = nil
		}
		s.checkTeamForfeit(logger, dispatcher)
	default:
		s.rejectCommand(dispatcher, message, "unknown_message")
	}
}

func (s *live2v2MatchState) handleRematchVote(ctx context.Context, logger runtime.Logger, dispatcher runtime.MatchDispatcher, message runtime.MatchData, slot int) {
	if s.phase != live2v2PhaseFinished || !s.settled || s.rematchMade {
		s.rejectCommand(dispatcher, message, "invalid_payload")
		return
	}
	if s.tick >= s.rematchEnds {
		s.rejectCommand(dispatcher, message, "invalid_payload")
		return
	}
	if !s.slots[slot].connected {
		s.rejectCommand(dispatcher, message, "slot_disconnected")
		return
	}
	if s.rematchVotes[slot] {
		s.rejectCommand(dispatcher, message, "invalid_payload")
		return
	}
	s.rematchVotes[slot] = true
	for _, vote := range s.rematchVotes {
		if !vote {
			return
		}
	}
	// All four voted yes: create the rematch with the identical slot order.
	slotUsers := make([]interface{}, 0, live2v2MaxPlayers)
	for _, slotState := range s.slots {
		slotUsers = append(slotUsers, slotState.userID)
	}
	matchID, err := s.matchCreate(ctx, "live_match_2v2", map[string]interface{}{
		"allowed_users": slotUsers,
		"slot_users":    slotUsers,
		"mode":          string(MatchMode2v2),
	})
	if err != nil {
		logger.WithField("error", err).Error("2v2 rematch create failed")
		return
	}
	s.rematchMade = true
	payload, _ := json.Marshal(map[string]any{
		"schemaVersion": MatchSchemaVersion2,
		"type":          "rematch_started",
		"matchId":       matchID,
	})
	for _, slotState := range s.slots {
		if slotState.presence == nil {
			continue
		}
		_ = dispatcher.BroadcastMessageDeferred(liveOpCodeMatchStarted, payload, []runtime.Presence{slotState.presence}, nil, true)
	}
}

// enforceReconnectGrace expires per-slot reconnect windows and triggers the
// team-forfeit check (docs/2v2-architecture.md §5.0).
func (s *live2v2MatchState) enforceReconnectGrace(ctx context.Context, logger runtime.Logger, dispatcher runtime.MatchDispatcher) {
	now := time.Now()
	for _, slotState := range s.slots {
		if slotState.connected || slotState.abandoned {
			continue
		}
		if slotState.surrendered {
			continue
		}
		if slotState.disconnectedAt.IsZero() {
			continue
		}
		if now.Sub(slotState.disconnectedAt) > live2v2ReconnectGraceSeconds*time.Second {
			slotState.abandoned = true
		}
	}
	s.checkTeamForfeit(logger, dispatcher)
}

// checkTeamForfeit forfeits a team only when BOTH of its slots have
// surrendered or exhausted reconnect grace. A mere simultaneous disconnect
// never forfeits while any grace is running.
func (s *live2v2MatchState) checkTeamForfeit(logger runtime.Logger, dispatcher runtime.MatchDispatcher) {
	for _, teamID := range []TeamID{TeamIDA, TeamIDB} {
		teamDead := true
		for slot, slotState := range s.slots {
			if TeamIDForSlot(slot) != teamID {
				continue
			}
			if !slotState.abandoned && !slotState.surrendered {
				teamDead = false
			}
		}
		if teamDead && s.state.Status == "playing" {
			// The opposing team wins. Canonical sim status: team A is the
			// 'player' side; team B forfeit reads as defeat from team A.
			if teamID == TeamIDA {
				s.state.Status = "defeat"
			} else {
				s.state.Status = "victory"
			}
			s.finishMatch(context.Background(), logger, dispatcher)
			return
		}
	}
}

// startMatch transitions from countdown to playing with the deterministic
// 2v2 initial state and broadcasts the version-2 match_started payload.
func (s *live2v2MatchState) startMatch(ctx context.Context, logger runtime.Logger, dispatcher runtime.MatchDispatcher) {
	initialState, err := s.createInitial2v2State()
	if err != nil {
		logger.WithField("error", err).Error("2v2 initial state creation failed")
		s.cancelMatch(ctx, logger, dispatcher, "initialization_failed")
		return
	}
	s.state = initialState
	s.phase = live2v2PhasePlaying
	s.startedAt = time.Now().UnixMilli()
	s.deadlineAt = time.Now().Add(live2v2MaxMatchTime * time.Second)
	if err := dispatcher.MatchLabelUpdate("mode:2v2;phase:in_progress;v:2"); err != nil {
		logger.WithField("error", err).Warn("label update failed")
	}
	s.broadcastMatchStarted(logger, dispatcher)
}

// createInitial2v2State builds the shared-territory initial state from the
// registered quad_citadel battlefield with per-slot modifier application
// (one owned base per player, docs/2v2-architecture.md §2.4).
func (s *live2v2MatchState) createInitial2v2State() (GameState, error) {
	definition, ok := authoritativeBattlefields[s.battlefieldID]
	if !ok {
		return GameState{}, errors.New("2v2_battlefield_missing")
	}
	territories := make(map[string]Territory, len(definition.Territories))
	for _, t := range definition.Territories {
		territories[t.ID] = Territory{
			ID: t.ID, Name: t.Name, X: t.X, Y: t.Y, Radius: t.Radius,
			Owner: t.Owner, Units: t.Units, MaxUnits: t.MaxUnits,
			ProductionRate: t.ProductionRate, Tier: t.Tier, Type: t.Type,
		}
	}
	modifiersBySlot := make(map[int]PlayerUpgradeModifiers, live2v2MaxPlayers)
	for slot, slotState := range s.slots {
		modifiersBySlot[slot] = UpgradeModifiers(slotState.career)
	}
	return CreateInitial2v2GameState(territories, live2v2SpawnAssignments, modifiersBySlot, PvpTimeLimitSeconds, s.battlefieldID)
}

// trackPerSlotCaptures attributes territory captures to the slot that owned
// the dispatching army (docs/2v2-architecture.md §2.6). Armies carry their
// slot in the id `2v2_tick_serverSeq_slot_clientSeq`; an army that left the
// in-flight list and left its target newly team-owned captured it.
func (s *live2v2MatchState) trackPerSlotCaptures(previous *GameState) {
	if previous == nil {
		return
	}
	previousOwners := make(map[string]Team, len(previous.Territories))
	for id, territory := range previous.Territories {
		previousOwners[id] = territory.Owner
	}
	// Last vanished army per target territory wins the attribution when
	// several armies arrive in the same tick.
	vanished := make(map[string]MarchingArmy, len(previous.Armies))
	for _, army := range previous.Armies {
		vanished[army.TargetID] = army
	}
	for _, army := range s.state.Armies {
		delete(vanished, army.TargetID)
	}
	for targetID, army := range vanished {
		territory, ok := s.state.Territories[targetID]
		if !ok || territory.Owner != army.Owner {
			continue
		}
		if previousOwners[targetID] == army.Owner {
			continue // reinforcement of already-owned territory
		}
		slot, err := slotFrom2v2ArmyID(army.ID)
		if err != nil {
			continue
		}
		s.stats.TerritoriesCapturedBySlot[slot]++
	}
	teamStats := s.state.Stats
	s.stats.TeamUnitsDispatched = [2]int64{int64(teamStats.PlayerUnitsDispatched), int64(teamStats.EnemyUnitsDispatched)}
	s.stats.TeamTerritoriesCaptured = [2]int64{int64(teamStats.TerritoriesCapturedByPlayer), int64(teamStats.TerritoriesCapturedByEnemy)}
}

func slotFrom2v2ArmyID(armyID string) (int, error) {
	var tick, serverSeq, slot, clientSeq int
	if _, err := fmt.Sscanf(armyID, "2v2_%d_%d_%d_%d", &tick, &serverSeq, &slot, &clientSeq); err != nil {
		return -1, err
	}
	if slot < 0 || slot >= live2v2MaxPlayers {
		return -1, errors.New("invalid_slot_in_army_id")
	}
	return slot, nil
}

// cancelMatch ends the match with zero settlements (§5.0 countdown cases).
func (s *live2v2MatchState) cancelMatch(ctx context.Context, logger runtime.Logger, dispatcher runtime.MatchDispatcher, reason string) {
	s.phase = live2v2PhaseCancelled
	logger.WithField("reason", reason).Info("2v2 match cancelled")
	payload, _ := json.Marshal(map[string]any{
		"schemaVersion": MatchSchemaVersion2,
		"type":          "match_result",
		"result": map[string]any{
			"matchId": s.matchID,
			"mode":    string(MatchMode2v2),
			"outcome": "cancelled",
		},
	})
	_ = dispatcher.BroadcastMessageDeferred(liveOpCodeMatchResult, payload, s.connectedPresences(), nil, true)
	_ = dispatcher.MatchLabelUpdate("mode:2v2;phase:cancelled;v:2")
}

// finishMatch settles all four participants atomically and broadcasts the
// per-participant match result (§3.3, §9.3).
func (s *live2v2MatchState) finishMatch(ctx context.Context, logger runtime.Logger, dispatcher runtime.MatchDispatcher) {
	if s.settled {
		return
	}
	if s.phase != live2v2PhaseFinished {
		s.phase = live2v2PhaseFinished
		_ = dispatcher.MatchLabelUpdate("mode:2v2;phase:finished;v:2")
	}

	request := Settle2v2Request{
		MatchID:       s.matchID,
		BattlefieldID: s.battlefieldID,
		ReplayPayload: s.replayPayload(),
		Participants:  s.participantOutcomes(),
	}
	settlements, err := s.settle2v2(ctx, request)
	if err != nil {
		s.settlementRetryAt = s.tick + live2v2SettlementRetrySeconds*live2v2TickRate
		logger.WithField("error", err).Error("2v2 settlement failed")
		errorPayload, _ := json.Marshal(map[string]any{"schemaVersion": MatchSchemaVersion2, "type": "error", "code": "settlement_failed"})
		_ = dispatcher.BroadcastMessageDeferred(liveOpCodeError, errorPayload, s.connectedPresences(), nil, true)
		return
	}
	s.settled = true
	s.rematchEnds = s.tick + live2v2RematchWindowSeconds*live2v2TickRate
	winnerTeamID := ""
	switch s.state.Status {
	case "victory":
		winnerTeamID = string(TeamIDA)
	case "defeat":
		winnerTeamID = string(TeamIDB)
	}
	participants := make([]map[string]any, 0, live2v2MaxPlayers)
	for slot, slotState := range s.slots {
		participants = append(participants, map[string]any{
			"slot":       slot,
			"teamId":     string(slotState.teamID),
			"userId":     slotState.userID,
			"status":     request.Participants[slot].Status,
			"stats":      request.Participants[slot].Stats,
			"abandoned":  request.Participants[slot].Abandoned,
			"settlement": settlements[slot],
		})
	}
	resultPayload, _ := json.Marshal(map[string]any{
		"schemaVersion": MatchSchemaVersion2,
		"type":          "match_result",
		"result": map[string]any{
			"matchId":      s.matchID,
			"mode":         string(MatchMode2v2),
			"winnerTeamId": winnerTeamID,
			"participants": participants,
		},
	})
	_ = dispatcher.BroadcastMessageDeferred(liveOpCodeMatchResult, resultPayload, s.connectedPresences(), nil, true)
}

// participantOutcomes derives the per-slot settlement inputs from the team
// result. Abandoned and surrendered slots receive the reduced-consolation
// outcome (§5.3): defeat status regardless of the team result; the store
// zeroes their capture stats before the policy calculation.
func (s *live2v2MatchState) participantOutcomes() [live2v2MaxPlayers]TwoVTwoParticipantOutcome {
	outcomes := [live2v2MaxPlayers]TwoVTwoParticipantOutcome{}
	for slot, slotState := range s.slots {
		status := statusForRole(s.state.Status, roleForTeamID(slotState.teamID))
		stats := statsForRole(s.state.Stats, roleForTeamID(slotState.teamID))
		abandoned := slotState.abandoned || slotState.surrendered
		if abandoned {
			status = "defeat"
		}
		outcomes[slot] = TwoVTwoParticipantOutcome{
			Slot: slot, UserID: slotState.userID, TeamID: slotState.teamID,
			Status: status, Stats: stats, Abandoned: abandoned,
		}
	}
	return outcomes
}

func roleForTeamID(teamID TeamID) Team {
	if teamID == TeamIDA {
		return TeamPlayer
	}
	return TeamEnemy
}

// replayPayload serializes the authoritative replay record (§3.4) written
// inside the settlement transaction.
func (s *live2v2MatchState) replayPayload() json.RawMessage {
	players := make([]live2v2ReplayPlayer, 0, live2v2MaxPlayers)
	for slot, slotState := range s.slots {
		players = append(players, live2v2ReplayPlayer{
			Slot: slot, TeamID: string(slotState.teamID), UserID: slotState.userID,
			Modifiers: UpgradeModifiers(slotState.career),
		})
	}
	winnerTeamID := ""
	switch s.state.Status {
	case "victory":
		winnerTeamID = string(TeamIDA)
	case "defeat":
		winnerTeamID = string(TeamIDB)
	}
	payload, _ := json.Marshal(live2v2Replay{
		SchemaVersion:    MatchSchemaVersion2,
		Mode:             string(MatchMode2v2),
		BattlefieldID:    s.battlefieldID,
		TimeLimitSeconds: s.state.TimeLimitSeconds,
		RewardPolicy:     CasualPolicy.Name,
		Players:          players,
		Actions:          s.actionLog,
		Result: live2v2ReplayResult{
			WinnerTeamID: winnerTeamID,
			PerTeam: [2]MatchStats{
				s.state.Stats,
				statsForRole(s.state.Stats, TeamEnemy),
			},
		},
	})
	return payload
}

type live2v2ReplayPlayer struct {
	Slot      int                    `json:"slot"`
	TeamID    string                 `json:"teamId"`
	UserID    string                 `json:"userId"`
	Modifiers PlayerUpgradeModifiers `json:"modifiers"`
}

type live2v2ReplayResult struct {
	WinnerTeamID string        `json:"winnerTeamId"`
	PerTeam      [2]MatchStats `json:"perTeam"`
}

type live2v2Replay struct {
	SchemaVersion    int                      `json:"schemaVersion"`
	Mode             string                   `json:"mode"`
	BattlefieldID    string                   `json:"battlefieldId"`
	TimeLimitSeconds float64                  `json:"timeLimitSeconds"`
	RewardPolicy     string                   `json:"rewardPolicy"`
	Players          []live2v2ReplayPlayer    `json:"players"`
	Actions          []CanonicalTwoVTwoAction `json:"actions"`
	Result           live2v2ReplayResult      `json:"result"`
}

func (s *live2v2MatchState) connectedPresences() []runtime.Presence {
	presences := make([]runtime.Presence, 0, live2v2MaxPlayers)
	for _, slotState := range s.slots {
		if slotState.presence != nil {
			presences = append(presences, slotState.presence)
		}
	}
	return presences
}

func (s *live2v2MatchState) broadcastMatchStarted(logger runtime.Logger, dispatcher runtime.MatchDispatcher) {
	for slot, slotState := range s.slots {
		if slotState.presence == nil {
			continue
		}
		payload, _ := json.Marshal(s.matchStartedPayload(slot))
		if err := dispatcher.BroadcastMessageDeferred(liveOpCodeMatchStarted, payload, []runtime.Presence{slotState.presence}, nil, true); err != nil {
			logger.WithField("error", err).Warn("broadcast match_started failed")
		}
	}
}

func (s *live2v2MatchState) matchStartedPayload(slot int) map[string]any {
	slotState := s.slots[slot]
	role := roleForTeamID(slotState.teamID)
	players := make([]map[string]any, 0, live2v2MaxPlayers)
	for _, player := range s.slots {
		players = append(players, map[string]any{
			"slot":        s.slotIndex(player.userID),
			"teamId":      string(player.teamID),
			"userId":      player.userID,
			"displayName": player.displayName,
		})
	}
	return map[string]any{
		"schemaVersion": MatchSchemaVersion2,
		"type":          "match_started",
		"matchId":       s.matchID,
		"mode":          string(MatchMode2v2),
		"slot":          slot,
		"teamId":        string(slotState.teamID),
		"nextSequence":  slotState.nextSeq,
		"players":       players,
		"state":         stateForRole(s.state, role),
	}
}

func (s *live2v2MatchState) slotIndex(userID string) int {
	for slot, slotState := range s.slots {
		if slotState.userID == userID {
			return slot
		}
	}
	return -1
}

func (s *live2v2MatchState) broadcastStates(dispatcher runtime.MatchDispatcher) {
	for _, slotState := range s.slots {
		if slotState.presence == nil {
			continue
		}
		payload, _ := json.Marshal(map[string]any{
			"schemaVersion": MatchSchemaVersion2,
			"type":          "state",
			"tick":          s.tick,
			"state":         stateForRole(s.state, roleForTeamID(slotState.teamID)),
		})
		if err := dispatcher.BroadcastMessageDeferred(liveOpCodeState, payload, []runtime.Presence{slotState.presence}, nil, false); err != nil {
			continue
		}
	}
}

// Slot-preserving rejoin resync (§5.1): the rejoined session receives the
// version-2 match_started payload with the current full state and the slot's
// next expected sequence before any further state ticks.
func (s *live2v2MatchState) resyncRejoinedSlot(logger runtime.Logger, dispatcher runtime.MatchDispatcher, slot int) {
	slotState := s.slots[slot]
	if slotState.presence == nil || s.phase != live2v2PhasePlaying {
		return
	}
	payload, _ := json.Marshal(s.matchStartedPayload(slot))
	if err := dispatcher.BroadcastMessageDeferred(liveOpCodeMatchStarted, payload, []runtime.Presence{slotState.presence}, nil, true); err != nil {
		logger.WithField("error", err).Warn("broadcast rejoin resync failed")
	}
}

func (s *live2v2MatchState) rejectCommand(dispatcher runtime.MatchDispatcher, message runtime.MatchData, code string) {
	var sequence int
	if data := message.GetData(); len(data) > 0 {
		var payload live2v2ClientMessage
		if json.Unmarshal(data, &payload) == nil {
			sequence = payload.Sequence
		}
	}
	rejected, _ := json.Marshal(map[string]any{
		"schemaVersion": MatchSchemaVersion2,
		"type":          "command_rejected",
		"code":          code,
		"sequence":      sequence,
		"slot":          -1,
	})
	_ = dispatcher.BroadcastMessageDeferred(liveOpCodeCommandRejected, rejected, []runtime.Presence{message}, nil, true)
}

func (m *live2v2Match) MatchTerminate(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, graceSeconds int) interface{} {
	s, ok := state.(*live2v2MatchState)
	if !ok {
		return state
	}
	if s.phase == live2v2PhasePlaying || s.phase == live2v2PhaseCountdown || s.phase == live2v2PhaseWaiting {
		// Graceful shutdown settles as cancelled: no rewards, no ledger
		// writes (docs/2v2-architecture.md §5.2).
		s.cancelMatch(ctx, logger, dispatcher, "server_terminate")
	}
	return state
}

func (m *live2v2Match) MatchSignal(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, data string) (interface{}, string) {
	return state, ""
}
