package main

// Unit tests for the authoritative 2v2 match handler state machine
// (docs/2v2-architecture.md §3, §5, §6, §11).

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/heroiclabs/nakama-common/runtime"
)

// fakeDispatcher captures broadcasts and kicks without a Nakama runtime.
type fakeDispatcher struct {
	broadcasts []fakeBroadcast
	kicked     []runtime.Presence
	labels     []string
}

type fakeBroadcast struct {
	opCode    int64
	data      []byte
	presences []runtime.Presence
}

func (d *fakeDispatcher) BroadcastMessage(opCode int64, data []byte, presences []runtime.Presence, sender runtime.Presence, reliable bool) error {
	d.broadcasts = append(d.broadcasts, fakeBroadcast{opCode: opCode, data: data, presences: presences})
	return nil
}

func (d *fakeDispatcher) BroadcastMessageDeferred(opCode int64, data []byte, presences []runtime.Presence, sender runtime.Presence, reliable bool) error {
	return d.BroadcastMessage(opCode, data, presences, sender, reliable)
}

func (d *fakeDispatcher) MatchKick(presences []runtime.Presence) error {
	d.kicked = append(d.kicked, presences...)
	return nil
}

func (d *fakeDispatcher) MatchLabelUpdate(label string) error {
	d.labels = append(d.labels, label)
	return nil
}

// fakeMatchData implements runtime.MatchData for drained match messages.
type fakeMatchData struct {
	fakePresence
	opCode int64
	data   []byte
}

func (m fakeMatchData) GetOpCode() int64      { return m.opCode }
func (m fakeMatchData) GetData() []byte       { return m.data }
func (m fakeMatchData) GetReceiveTime() int64 { return 0 }
func (m fakeMatchData) GetReliable() bool     { return false }

func dispatchPayload(schemaVersion int, sequence int, sourceID, targetID string) []byte {
	payload, _ := json.Marshal(map[string]any{
		"schemaVersion": schemaVersion,
		"type":          "dispatch",
		"sequence":      sequence,
		"sourceId":      sourceID,
		"targetId":      targetID,
	})
	return payload
}

func controlPayload(schemaVersion int, messageType string) []byte {
	payload, _ := json.Marshal(map[string]any{"schemaVersion": schemaVersion, "type": messageType})
	return payload
}

var test2v2UserIDs = [live2v2MaxPlayers]string{"smoke_u0", "smoke_u1", "smoke_u2", "smoke_u3"}

// newTest2v2State builds a playing-phase match state with four connected
// slots on the registered quad_citadel battlefield, bypassing the store.
func newTest2v2State(t *testing.T) (*live2v2MatchState, *fakeDispatcher, *[]Settle2v2Request) {
	t.Helper()
	settlementRequests := &[]Settle2v2Request{}
	state := &live2v2MatchState{
		presenceByUser: make(map[string]int, live2v2MaxPlayers),
		accumulators:   make(map[string]float64),
		battlefieldID:  live2v2BattlefieldID,
		phase:          live2v2PhasePlaying,
		startedAt:      1_725_000_000_000,
		matchID:        "live2v2_deadbeef_1725000000000",
		waitingEnds:    600,
		// Matches the startMatch deadline budget; a zero value would trigger
		// the deadline safety net on the first loop tick.
		deadlineAt: time.Now().Add(live2v2MaxMatchTime * time.Second),
		settle2v2: func(ctx context.Context, request Settle2v2Request) ([]MatchSettlement, error) {
			*settlementRequests = append(*settlementRequests, request)
			settlements := make([]MatchSettlement, 0, live2v2MaxPlayers)
			for _, participant := range request.Participants {
				settlements = append(settlements, SettleMatchWithPolicy(CreateDefaultCareer(participant.UserID), participant.Status, participant.Stats, request.MatchID, 1725000100000, CasualPolicy))
			}
			return settlements, nil
		},
		matchCreate: func(ctx context.Context, moduleName string, params map[string]interface{}) (string, error) {
			return "live2v2_rematch", nil
		},
	}
	for slot, userID := range test2v2UserIDs {
		state.slots[slot] = &live2v2SlotState{
			userID:    userID,
			career:    CreateDefaultCareer(userID),
			teamID:    TeamIDForSlot(slot),
			startBase: live2v2SpawnAssignments[slot].TerritoryID,
			presence:  fakePresence{userID: userID, sessionID: fmt.Sprintf("session_%d", slot)},
			connected: true,
		}
		state.presenceByUser[userID] = slot
	}
	initialState, err := state.createInitial2v2State()
	if err != nil {
		t.Fatalf("initial 2v2 state creation failed: %v", err)
	}
	state.state = initialState
	dispatcher := &fakeDispatcher{}
	return state, dispatcher, settlementRequests
}

func broadcastPayloads(dispatcher *fakeDispatcher, opCode int64) [][]byte {
	payloads := make([][]byte, 0, len(dispatcher.broadcasts))
	for _, broadcast := range dispatcher.broadcasts {
		if broadcast.opCode == opCode {
			payloads = append(payloads, broadcast.data)
		}
	}
	return payloads
}

func accepted2v2Sequences(dispatcher *fakeDispatcher) []int {
	sequences := make([]int, 0, len(dispatcher.broadcasts))
	for _, broadcast := range broadcastPayloads(dispatcher, liveOpCodeCommandAccepted) {
		var payload struct {
			Sequence int `json:"sequence"`
		}
		if json.Unmarshal(broadcast, &payload) == nil {
			sequences = append(sequences, payload.Sequence)
		}
	}
	return sequences
}

func rejected2v2Codes(dispatcher *fakeDispatcher) map[int]string {
	codes := make(map[int]string)
	for _, broadcast := range broadcastPayloads(dispatcher, liveOpCodeCommandRejected) {
		var payload struct {
			Sequence int    `json:"sequence"`
			Code     string `json:"code"`
		}
		if json.Unmarshal(broadcast, &payload) == nil {
			codes[payload.Sequence] = payload.Code
		}
	}
	return codes
}

func drain2v2Messages(state *live2v2MatchState, dispatcher *fakeDispatcher, tick int64, messages []runtime.MatchData) {
	// Most tests identify a message by user only. Model Nakama's real message
	// presence by filling the active session unless a test supplied an
	// explicit session (for example, the evicted-session regression).
	for index, message := range messages {
		fake, ok := message.(fakeMatchData)
		if !ok || fake.sessionID != "" {
			continue
		}
		if slot, exists := state.presenceByUser[fake.userID]; exists && state.slots[slot].presence != nil {
			fake.sessionID = state.slots[slot].presence.GetSessionId()
			messages[index] = fake
		}
	}
	handler := &live2v2Match{}
	handler.MatchLoop(context.Background(), &stubLogger{}, nil, nil, dispatcher, tick, state, messages)
}

func Test2v2SnakeDraftIsStableRegardlessOfEntryOrder(t *testing.T) {
	entries := []twoVTwoDraftEntry{
		{UserID: "u_highest", Trophies: 400},
		{UserID: "u_high", Trophies: 300},
		{UserID: "u_low", Trophies: 200},
		{UserID: "u_lowest", Trophies: 100},
	}
	expected := [live2v2MaxPlayers]string{"u_highest", "u_lowest", "u_high", "u_low"}
	shuffles := [][]int{
		{0, 1, 2, 3},
		{3, 2, 1, 0},
		{2, 0, 3, 1},
		{1, 3, 0, 2},
	}
	for _, order := range shuffles {
		shuffled := make([]twoVTwoDraftEntry, 0, len(entries))
		for _, index := range order {
			shuffled = append(shuffled, entries[index])
		}
		slots, err := assign2v2SlotsBySnakeDraft(shuffled)
		if err != nil {
			t.Fatalf("draft failed: %v", err)
		}
		if slots != expected {
			t.Fatalf("draft order %v produced %v, want %v", order, slots, expected)
		}
		for slot := range slots {
			if TeamIDForSlot(slot) == TeamIDA && slot >= 2 {
				t.Fatalf("slot %d mapped to team A", slot)
			}
		}
	}
}

func Test2v2SnakeDraftTiebreaksByUserIDAscending(t *testing.T) {
	slots, err := assign2v2SlotsBySnakeDraft([]twoVTwoDraftEntry{
		{UserID: "u_b", Trophies: 100},
		{UserID: "u_a", Trophies: 100},
		{UserID: "u_d", Trophies: 100},
		{UserID: "u_c", Trophies: 100},
	})
	if err != nil {
		t.Fatalf("draft failed: %v", err)
	}
	expected := [live2v2MaxPlayers]string{"u_a", "u_d", "u_b", "u_c"}
	if slots != expected {
		t.Fatalf("tiebreak draft = %v, want %v", slots, expected)
	}
}

func Test2v2FourPlayerJoinReadyStartLifecycle(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	serverConfig.Enable2v2 = true
	defer func() { serverConfig.Enable2v2 = false }()

	for _, userID := range test2v2UserIDs {
		careerQueryMocks(mock, userID, 50)
	}

	handler := &live2v2Match{store: NewStore(db)}
	initState, _, _ := handler.MatchInit(context.Background(), &stubLogger{}, db, nil, map[string]interface{}{
		"allowed_users": []interface{}{"smoke_u0", "smoke_u1", "smoke_u2", "smoke_u3"},
		"mode":          "2v2",
	})
	state := initState.(*live2v2MatchState)

	if state.phase != live2v2PhaseWaiting {
		t.Fatalf("initial phase = %q, want waiting", state.phase)
	}
	if state.slots[0].teamID != TeamIDA || state.slots[1].teamID != TeamIDA || state.slots[2].teamID != TeamIDB || state.slots[3].teamID != TeamIDB {
		t.Fatalf("draft team mapping wrong: %v", state.slots)
	}

	dispatcher := &fakeDispatcher{}
	// Join order deliberately differs from slot order.
	for _, slot := range []int{2, 0, 3, 1} {
		userID := test2v2UserIDs[slot]
		mock.ExpectQuery("SELECT display_name FROM player_names").WithArgs(userID).WillReturnError(sql.ErrNoRows)
		state = handler.MatchJoin(context.Background(), &stubLogger{}, db, nil, dispatcher, 1, state, []runtime.Presence{fakePresence{userID: userID, sessionID: fmt.Sprintf("s%d", slot)}}).(*live2v2MatchState)
	}
	if state.phase != live2v2PhaseCountdown {
		t.Fatalf("phase after four joins = %q, want countdown", state.phase)
	}

	// Ready from three slots does not start the match early...
	messages := []runtime.MatchData{
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[0], sessionID: "s0"}, data: controlPayload(2, "ready")},
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[1], sessionID: "s1"}, data: controlPayload(2, "ready")},
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[2], sessionID: "s2"}, data: controlPayload(2, "ready")},
	}
	handler.MatchLoop(context.Background(), &stubLogger{}, db, nil, dispatcher, 2, state, messages)
	if state.phase != live2v2PhaseCountdown {
		t.Fatalf("phase after three readies = %q, want countdown", state.phase)
	}

	// ...the fourth ready starts the match early.
	messages = []runtime.MatchData{
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[3], sessionID: "s3"}, data: controlPayload(2, "ready")},
	}
	handler.MatchLoop(context.Background(), &stubLogger{}, db, nil, dispatcher, 3, state, messages)
	if state.phase != live2v2PhasePlaying {
		t.Fatalf("phase after all four ready = %q, want playing", state.phase)
	}

	started := broadcastPayloads(dispatcher, liveOpCodeMatchStarted)
	if len(started) != 4 {
		t.Fatalf("expected 4 match_started broadcasts, got %d", len(started))
	}
	var startedPayload struct {
		SchemaVersion int `json:"schemaVersion"`
		Players       []struct {
			Slot   int    `json:"slot"`
			TeamID string `json:"teamId"`
		} `json:"players"`
		State struct {
			Territories map[string]struct {
				Owner string `json:"owner"`
			} `json:"territories"`
		} `json:"state"`
	}
	if err := json.Unmarshal(started[0], &startedPayload); err != nil {
		t.Fatalf("match_started payload invalid: %v", err)
	}
	if startedPayload.SchemaVersion != MatchSchemaVersion2 {
		t.Fatalf("match_started schemaVersion = %d", startedPayload.SchemaVersion)
	}
	if len(startedPayload.Players) != 4 {
		t.Fatalf("match_started players = %d, want 4", len(startedPayload.Players))
	}
	ownedBases := 0
	for _, territory := range startedPayload.State.Territories {
		if territory.Owner == "player" {
			ownedBases++
		}
	}
	if ownedBases != 2 {
		t.Fatalf("projected team-A spawn count = %d, want 2 (one per player)", ownedBases)
	}
}

func Test2v2SharedTerritoryTeammateDispatch(t *testing.T) {
	state, dispatcher, _ := newTest2v2State(t)

	// Slot 0 dispatches from its own base; slot 1 then dispatches from the
	// SAME team-owned base (shared ownership §2.3): the second dispatch must
	// see the halved garrison.
	drain2v2Messages(state, dispatcher, 10, []runtime.MatchData{
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[0]}, data: dispatchPayload(2, 0, "a_base_w", "a_gate_w")},
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[1]}, data: dispatchPayload(2, 0, "a_base_w", "a_gate_w")},
	})

	if len(accepted2v2Sequences(dispatcher)) != 2 {
		t.Fatalf("shared-territory teammate dispatches were not all accepted: %v", rejected2v2Codes(dispatcher))
	}
	// Each dispatch sends half of the CURRENT garrison: 20 -> 10 + 5.
	if state.stats.UnitsDispatchedBySlot[0] != 10 || state.stats.UnitsDispatchedBySlot[1] != 5 {
		t.Fatalf("per-slot dispatch stats = %v, want 10 then 5 (half of remaining)", state.stats.UnitsDispatchedBySlot)
	}
	if units := state.state.Territories["a_base_w"].Units; units != 5 {
		t.Fatalf("shared base garrison = %d, want 5 after two half-dispatches from 20", units)
	}
	if len(state.state.Armies) != 2 {
		t.Fatalf("army count = %d, want 2", len(state.state.Armies))
	}
	for _, army := range state.state.Armies {
		if army.Owner != TeamPlayer {
			t.Fatalf("teammate army owner = %q, want player", army.Owner)
		}
	}
}

func Test2v2OpposingTeamDispatchRejected(t *testing.T) {
	state, dispatcher, _ := newTest2v2State(t)

	drain2v2Messages(state, dispatcher, 10, []runtime.MatchData{
		// Team-A slot dispatching from a team-B territory.
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[0]}, data: dispatchPayload(2, 0, "b_base_w", "b_gate_w")},
		// Team-B slot dispatching from a team-A territory.
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[2]}, data: dispatchPayload(2, 0, "a_base_w", "a_gate_w")},
	})

	codes := rejected2v2Codes(dispatcher)
	if codes[0] != "invalid_dispatch" {
		t.Fatalf("team-A dispatch from enemy base code = %q, want invalid_dispatch", codes[0])
	}
	if len(state.state.Armies) != 0 {
		t.Fatalf("rejected dispatch created an army")
	}
	if state.slots[0].nextSeq != 0 || state.slots[2].nextSeq != 0 {
		t.Fatalf("rejected dispatch advanced a sequence counter")
	}
}

func Test2v2PerSlotSequencing(t *testing.T) {
	state, dispatcher, _ := newTest2v2State(t)

	drain2v2Messages(state, dispatcher, 10, []runtime.MatchData{
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[0]}, data: dispatchPayload(2, 0, "a_base_w", "a_gate_w")},
		// Slot 0: duplicate and gap sequences are rejected...
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[0]}, data: dispatchPayload(2, 0, "a_base_w", "a_gate_w")},
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[0]}, data: dispatchPayload(2, 5, "a_base_w", "a_gate_w")},
		// ...while slot 1's independent stream still starts at 0.
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[1]}, data: dispatchPayload(2, 0, "a_base_e", "a_gate_e")},
	})

	accepted := accepted2v2Sequences(dispatcher)
	if len(accepted) != 2 {
		t.Fatalf("accepted sequences = %v, want two (slot 0 seq 0, slot 1 seq 0)", accepted)
	}
	codes := rejected2v2Codes(dispatcher)
	if codes[0] != "invalid_sequence" || codes[5] != "invalid_sequence" {
		t.Fatalf("stale/gap rejections = %v", codes)
	}
	if state.slots[0].nextSeq != 1 || state.slots[1].nextSeq != 1 {
		t.Fatalf("per-slot counters = %d/%d, want 1/1", state.slots[0].nextSeq, state.slots[1].nextSeq)
	}
}

func Test2v2SameTickCanonicalOrdering(t *testing.T) {
	state, dispatcher, _ := newTest2v2State(t)

	// Three dispatches drained in ONE MatchLoop call, deliberately out of
	// slot order. serverSeq is assigned at drain time and is the complete
	// canonical order (docs/2v2-architecture.md §6.2).
	drain2v2Messages(state, dispatcher, 10, []runtime.MatchData{
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[3]}, data: dispatchPayload(2, 0, "b_base_w", "b_gate_w")},
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[0]}, data: dispatchPayload(2, 0, "a_base_w", "a_gate_w")},
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[1]}, data: dispatchPayload(2, 0, "a_base_e", "a_gate_e")},
	})

	if len(state.actionLog) != 3 {
		t.Fatalf("action log length = %d, want 3", len(state.actionLog))
	}
	wantSlots := []int{3, 0, 1}
	for index, action := range state.actionLog {
		if action.ServerSeq != index+1 {
			t.Fatalf("action %d serverSeq = %d, want %d (drain order is canonical)", index, action.ServerSeq, index+1)
		}
		if action.Slot != wantSlots[index] {
			t.Fatalf("action %d slot = %d, want %d (drain order)", index, action.Slot, wantSlots[index])
		}
		if action.Tick != 10 {
			t.Fatalf("action %d tick = %d, want 10 (drain tick)", index, action.Tick)
		}
		if action.SchemaVersion != MatchSchemaVersion2 {
			t.Fatalf("action %d schemaVersion = %d", index, action.SchemaVersion)
		}
	}
}

func Test2v2DuplicateSessionEviction(t *testing.T) {
	state, dispatcher, _ := newTest2v2State(t)

	oldPresence := state.slots[0].presence
	newPresence := fakePresence{userID: test2v2UserIDs[0], sessionID: "session_newer"}
	state.adoptPresence(state.slots[0], newPresence, &stubLogger{}, dispatcher)

	if state.slots[0].presence.GetSessionId() != "session_newer" {
		t.Fatalf("newest session did not own the slot: %v", state.slots[0].presence.GetSessionId())
	}
	if len(dispatcher.kicked) != 1 || dispatcher.kicked[0].GetSessionId() != oldPresence.GetSessionId() {
		t.Fatalf("old session was not kicked: %v", dispatcher.kicked)
	}
}

func Test2v2EvictedSessionCannotIssueBufferedCommand(t *testing.T) {
	state, dispatcher, _ := newTest2v2State(t)
	oldPresence := state.slots[0].presence
	state.adoptPresence(state.slots[0], fakePresence{userID: test2v2UserIDs[0], sessionID: "session_newer"}, &stubLogger{}, dispatcher)

	drain2v2Messages(state, dispatcher, 10, []runtime.MatchData{
		fakeMatchData{fakePresence: oldPresence.(fakePresence), data: dispatchPayload(2, 0, "a_base_w", "a_gate_w")},
	})

	if len(state.state.Armies) != 0 || state.slots[0].nextSeq != 0 {
		t.Fatal("evicted session was able to mutate authoritative match state")
	}
	if rejected2v2Codes(dispatcher)[0] != "not_in_match" {
		t.Fatalf("evicted session rejection = %q, want not_in_match", rejected2v2Codes(dispatcher)[0])
	}
}

func Test2v2SettlementFailureRetriesBeforeOpeningRematchWindow(t *testing.T) {
	state, dispatcher, _ := newTest2v2State(t)
	attempts := 0
	state.settle2v2 = func(ctx context.Context, request Settle2v2Request) ([]MatchSettlement, error) {
		attempts++
		if attempts == 1 {
			return nil, errors.New("transient database failure")
		}
		settlements := make([]MatchSettlement, 0, live2v2MaxPlayers)
		for _, participant := range request.Participants {
			settlements = append(settlements, SettleMatchWithPolicy(CreateDefaultCareer(participant.UserID), participant.Status, participant.Stats, request.MatchID, 1725000100000, CasualPolicy))
		}
		return settlements, nil
	}
	state.state.Status = "victory"
	state.tick = 100
	state.finishMatch(context.Background(), &stubLogger{}, dispatcher)

	if state.settled || state.rematchEnds != 0 || attempts != 1 {
		t.Fatalf("failed settlement incorrectly finalized match: settled=%v rematchEnds=%d attempts=%d", state.settled, state.rematchEnds, attempts)
	}
	handler := &live2v2Match{}
	if got := handler.MatchLoop(context.Background(), &stubLogger{}, nil, nil, dispatcher, state.settlementRetryAt, state, nil); got == nil {
		t.Fatal("match terminated instead of retrying settlement")
	}
	if !state.settled || attempts != 2 || state.rematchEnds <= state.tick {
		t.Fatalf("settlement retry did not finalize: settled=%v attempts=%d rematchEnds=%d tick=%d", state.settled, attempts, state.rematchEnds, state.tick)
	}
}

func Test2v2FinishedAndCancelledMatchesTerminate(t *testing.T) {
	state, dispatcher, _ := newTest2v2State(t)
	handler := &live2v2Match{}
	state.phase = live2v2PhaseFinished
	state.settled = true
	state.rematchEnds = 50
	if got := handler.MatchLoop(context.Background(), &stubLogger{}, nil, nil, dispatcher, 50, state, nil); got != nil {
		t.Fatal("finished match remained resident after rematch window")
	}

	state.phase = live2v2PhaseCancelled
	if got := handler.MatchLoop(context.Background(), &stubLogger{}, nil, nil, dispatcher, 51, state, nil); got != nil {
		t.Fatal("cancelled match remained resident")
	}
}

func Test2v2ReconnectWithinGraceRestoresSlot(t *testing.T) {
	state, dispatcher, _ := newTest2v2State(t)

	// Slot 1 disconnects mid-match...
	handler := &live2v2Match{}
	handler.MatchLeave(context.Background(), &stubLogger{}, nil, nil, dispatcher, 20, state, []runtime.Presence{fakePresence{userID: test2v2UserIDs[1], sessionID: "session_1"}})
	if state.slots[1].connected || state.slots[1].abandoned {
		t.Fatal("disconnect must only start the grace window")
	}
	if state.phase != live2v2PhasePlaying {
		t.Fatalf("disconnect must not end the match (phase = %q)", state.phase)
	}

	// ...and rejoins within the grace window on a fresh session.
	mockDB, mock, _ := sqlmock.New()
	defer mockDB.Close()
	mock.ExpectQuery("SELECT display_name FROM player_names").WithArgs(test2v2UserIDs[1]).WillReturnError(sql.ErrNoRows)
	handler.MatchJoin(context.Background(), &stubLogger{}, mockDB, nil, dispatcher, 25, state, []runtime.Presence{fakePresence{userID: test2v2UserIDs[1], sessionID: "session_rejoin"}})

	if !state.slots[1].connected || state.slots[1].abandoned {
		t.Fatal("reconnect within grace must restore the slot")
	}
	if state.slots[1].nextSeq != 0 {
		t.Fatalf("reconnect must preserve the per-slot sequence, got %d", state.slots[1].nextSeq)
	}
	// Resync: the rejoined session receives a match_started payload with the
	// current state and next sequence.
	resyncs := broadcastPayloads(dispatcher, liveOpCodeMatchStarted)
	if len(resyncs) != 1 {
		t.Fatalf("expected 1 resync broadcast, got %d", len(resyncs))
	}
	var resyncPayload struct {
		NextSequence int `json:"nextSequence"`
		Slot         int `json:"slot"`
	}
	if err := json.Unmarshal(resyncs[0], &resyncPayload); err != nil {
		t.Fatalf("resync payload invalid: %v", err)
	}
	if resyncPayload.Slot != 1 || resyncPayload.NextSequence != 0 {
		t.Fatalf("resync payload = slot %d nextSeq %d, want slot 1 nextSeq 0", resyncPayload.Slot, resyncPayload.NextSequence)
	}
}

func Test2v2GraceExpiryAbandonsSlotWithoutForfeitingWhileTeammateActive(t *testing.T) {
	state, dispatcher, settlementRequests := newTest2v2State(t)

	handler := &live2v2Match{}
	handler.MatchLeave(context.Background(), &stubLogger{}, nil, nil, dispatcher, 20, state, []runtime.Presence{fakePresence{userID: test2v2UserIDs[0], sessionID: "session_0"}})
	state.slots[0].disconnectedAt = time.Now().Add(-31 * time.Second)

	state.enforceReconnectGrace(context.Background(), &stubLogger{}, dispatcher)

	if !state.slots[0].abandoned {
		t.Fatal("grace expiry must abandon the slot")
	}
	if state.phase != live2v2PhasePlaying || len(*settlementRequests) != 0 {
		t.Fatal("one abandoned slot must not forfeit the team while the teammate is active")
	}
	// The abandoned slot can no longer dispatch; the teammate still can.
	drain2v2Messages(state, dispatcher, 30, []runtime.MatchData{
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[0]}, data: dispatchPayload(2, 0, "a_base_w", "a_gate_w")},
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[1]}, data: dispatchPayload(2, 0, "a_base_e", "a_gate_e")},
	})
	codes := rejected2v2Codes(dispatcher)
	if codes[0] != "not_in_match" {
		t.Fatalf("abandoned-slot dispatch code = %q, want not_in_match", codes[0])
	}
	if len(accepted2v2Sequences(dispatcher)) != 1 {
		t.Fatalf("teammate dispatch after teammate abandon was not accepted")
	}
}

func Test2v2TeamForfeitOnlyWhenBothTeammatesExpired(t *testing.T) {
	state, dispatcher, settlementRequests := newTest2v2State(t)

	handler := &live2v2Match{}
	handler.MatchLeave(context.Background(), &stubLogger{}, nil, nil, dispatcher, 20, state, []runtime.Presence{fakePresence{userID: test2v2UserIDs[0], sessionID: "session_0"}})
	state.slots[0].disconnectedAt = time.Now().Add(-31 * time.Second)
	state.enforceReconnectGrace(context.Background(), &stubLogger{}, dispatcher)

	handler.MatchLeave(context.Background(), &stubLogger{}, nil, nil, dispatcher, 21, state, []runtime.Presence{fakePresence{userID: test2v2UserIDs[1], sessionID: "session_1"}})
	state.slots[1].disconnectedAt = time.Now().Add(-31 * time.Second)
	state.enforceReconnectGrace(context.Background(), &stubLogger{}, dispatcher)

	if state.phase != live2v2PhaseFinished {
		t.Fatalf("both team-A slots expired: phase = %q, want finished", state.phase)
	}
	if len(*settlementRequests) != 1 {
		t.Fatalf("expected exactly one atomic settlement, got %d", len(*settlementRequests))
	}
	request := (*settlementRequests)[0]
	if request.MatchID != state.matchID || request.BattlefieldID != live2v2BattlefieldID {
		t.Fatalf("settlement request ids wrong: %+v", request)
	}
	if len(request.ReplayPayload) == 0 {
		t.Fatal("settlement request missing the replay payload")
	}
	for slot := 0; slot <= 1; slot++ {
		if !request.Participants[slot].Abandoned {
			t.Fatalf("slot %d should be marked abandoned", slot)
		}
		if participant := request.Participants[slot]; participant.Status != "defeat" {
			t.Fatalf("slot %d status = %q, want defeat (reduced consolation)", slot, participant.Status)
		}
	}
	// Team B wins the forfeited match with normal (non-abandoned) outcomes.
	if request.Participants[2].Status != "victory" || request.Participants[3].Status != "victory" {
		t.Fatalf("team B statuses = %q/%q, want victory/victory", request.Participants[2].Status, request.Participants[3].Status)
	}
	if request.Participants[2].Abandoned || request.Participants[3].Abandoned {
		t.Fatal("connected team-B winners must not be marked abandoned")
	}
}

func Test2v2SurrenderFlowAndTeamForfeit(t *testing.T) {
	state, dispatcher, settlementRequests := newTest2v2State(t)

	// First team-B teammate surrenders: the team fights on.
	drain2v2Messages(state, dispatcher, 40, []runtime.MatchData{
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[2]}, data: controlPayload(2, "surrender")},
	})
	if state.phase != live2v2PhasePlaying {
		t.Fatalf("first surrender must not forfeit (phase = %q)", state.phase)
	}
	if !state.slots[2].surrendered {
		t.Fatal("surrender flag not recorded")
	}
	// The surrendered slot cannot dispatch anymore; the surviving teammate can.
	drain2v2Messages(state, dispatcher, 41, []runtime.MatchData{
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[2]}, data: dispatchPayload(2, 0, "b_base_e", "b_gate_w")},
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[3]}, data: dispatchPayload(2, 0, "b_base_w", "b_gate_e")},
	})
	if len(accepted2v2Sequences(dispatcher)) != 1 {
		t.Fatalf("surviving teammate dispatch must be accepted")
	}

	// Second team-B surrender forfeits the team and settles all four.
	drain2v2Messages(state, dispatcher, 42, []runtime.MatchData{
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[3]}, data: controlPayload(2, "surrender")},
	})
	if state.phase != live2v2PhaseFinished || len(*settlementRequests) != 1 {
		t.Fatalf("two surrenders must forfeit the team (phase = %q, settlements = %d)", state.phase, len(*settlementRequests))
	}
	request := (*settlementRequests)[0]
	if request.Participants[0].Status != "victory" || request.Participants[1].Status != "victory" {
		t.Fatalf("team A statuses = %q/%q, want victory/victory", request.Participants[0].Status, request.Participants[1].Status)
	}
	for slot := 2; slot <= 3; slot++ {
		if !request.Participants[slot].Abandoned || request.Participants[slot].Status != "defeat" {
			t.Fatalf("surrendered slot %d = abandoned=%v status=%q, want abandoned defeat-tier", slot, request.Participants[slot].Abandoned, request.Participants[slot].Status)
		}
	}
}

func Test2v2SurrenderedAndAbandonedSlotsCannotRejoin(t *testing.T) {
	state, dispatcher, _ := newTest2v2State(t)
	handler := &live2v2Match{}

	// A surrendered slot left the match by authenticated choice (§5.3): no
	// later session of the same user may rejoin it.
	state.handleSurrender(context.Background(), &stubLogger{}, dispatcher, fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[2], sessionID: "session_2"}, data: controlPayload(2, "surrender")}, 2)
	if state.slots[2].connected || !state.slots[2].surrendered {
		t.Fatal("surrender must detach and flag the slot")
	}
	_, allowed, reason := handler.MatchJoinAttempt(context.Background(), &stubLogger{}, nil, nil, dispatcher, 45, state, fakePresence{userID: test2v2UserIDs[2], sessionID: "session_rejoin"}, nil)
	if allowed || reason != "slot_not_reconnectable" {
		t.Fatalf("surrendered slot rejoin = %v (%q), want rejection with slot_not_reconnectable", allowed, reason)
	}

	// A grace-expired (abandoned) slot is likewise closed (§5.0).
	handler.MatchLeave(context.Background(), &stubLogger{}, nil, nil, dispatcher, 50, state, []runtime.Presence{fakePresence{userID: test2v2UserIDs[0], sessionID: "session_0"}})
	state.slots[0].disconnectedAt = time.Now().Add(-31 * time.Second)
	state.enforceReconnectGrace(context.Background(), &stubLogger{}, dispatcher)
	if !state.slots[0].abandoned {
		t.Fatal("grace expiry must abandon the slot")
	}
	_, allowed, reason = handler.MatchJoinAttempt(context.Background(), &stubLogger{}, nil, nil, dispatcher, 55, state, fakePresence{userID: test2v2UserIDs[0], sessionID: "session_rejoin_abandoned"}, nil)
	if allowed || reason != "slot_not_reconnectable" {
		t.Fatalf("abandoned slot rejoin = %v (%q), want rejection with slot_not_reconnectable", allowed, reason)
	}

	// An active slot's duplicate second session must still reach the
	// eviction path: only surrendered/abandoned slots are closed.
	_, allowed, reason = handler.MatchJoinAttempt(context.Background(), &stubLogger{}, nil, nil, dispatcher, 56, state, fakePresence{userID: test2v2UserIDs[1], sessionID: "session_duplicate"}, nil)
	if !allowed {
		t.Fatalf("active duplicate session rejected (reason = %q), want allowed for eviction", reason)
	}
}

func Test2v2CountdownCancelsWhenSlotMissing(t *testing.T) {
	state, dispatcher, settlementRequests := newTest2v2State(t)
	state.phase = live2v2PhaseCountdown
	state.countdownEnds = 100

	// Slot 3 never connected; the countdown expires without all four present.
	state.slots[3].presence = nil
	state.slots[3].connected = false

	handler := &live2v2Match{}
	handler.MatchLoop(context.Background(), &stubLogger{}, nil, nil, dispatcher, 101, state, nil)

	if state.phase != live2v2PhaseCancelled {
		t.Fatalf("countdown expiry with a missing slot: phase = %q, want cancelled", state.phase)
	}
	if len(*settlementRequests) != 0 {
		t.Fatal("cancelled matches must not settle")
	}
	results := broadcastPayloads(dispatcher, liveOpCodeMatchResult)
	if len(results) != 1 {
		t.Fatalf("expected 1 match_result broadcast, got %d", len(results))
	}
	var payload struct {
		Result struct {
			Outcome string `json:"outcome"`
		} `json:"result"`
	}
	if err := json.Unmarshal(results[0], &payload); err != nil {
		t.Fatalf("cancel result payload invalid: %v", err)
	}
	if payload.Result.Outcome != "cancelled" {
		t.Fatalf("cancel outcome = %q, want cancelled", payload.Result.Outcome)
	}
}

func Test2v2CountdownSurrenderCancelsWithoutSettlements(t *testing.T) {
	state, dispatcher, settlementRequests := newTest2v2State(t)
	state.phase = live2v2PhaseCountdown
	state.countdownEnds = 200

	// All four slots are connected (not ready); an explicit surrender while
	// the countdown is still running must cancel the match without any
	// settlement attempt (§5.0).
	drain2v2Messages(state, dispatcher, 100, []runtime.MatchData{
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[2]}, data: controlPayload(MatchSchemaVersion2, "surrender")},
	})

	if state.phase != live2v2PhaseCancelled {
		t.Fatalf("countdown surrender: phase = %q, want cancelled (rejections: %v)", state.phase, rejected2v2Codes(dispatcher))
	}
	if len(*settlementRequests) != 0 {
		t.Fatal("cancelled matches must not settle")
	}
	results := broadcastPayloads(dispatcher, liveOpCodeMatchResult)
	if len(results) != 1 {
		t.Fatalf("expected 1 match_result broadcast, got %d", len(results))
	}
	var payload struct {
		Result struct {
			MatchId      string         `json:"matchId"`
			Outcome      string         `json:"outcome"`
			Participants map[string]any `json:"participants"`
		} `json:"result"`
	}
	if err := json.Unmarshal(results[0], &payload); err != nil {
		t.Fatalf("cancel result payload invalid: %v", err)
	}
	if payload.Result.Outcome != "cancelled" {
		t.Fatalf("countdown surrender outcome = %q, want cancelled", payload.Result.Outcome)
	}
	if payload.Result.MatchId != state.matchID {
		t.Fatalf("countdown surrender matchId = %q, want %q", payload.Result.MatchId, state.matchID)
	}
	if payload.Result.Participants != nil {
		t.Fatal("cancelled results must not carry per-participant settlements")
	}
}

func Test2v2ProtocolFailClosed(t *testing.T) {
	state, dispatcher, _ := newTest2v2State(t)

	oversized := make([]byte, live2v2MaxPayloadBytes+1)
	for i := range oversized {
		oversized[i] = 'x'
	}
	messages := []runtime.MatchData{
		// wrong schema version
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[0]}, data: dispatchPayload(1, 0, "a_base_w", "a_gate_w")},
		// missing schema version
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[0]}, data: []byte(`{"type":"dispatch","sequence":0,"sourceId":"a_base_w","targetId":"a_gate_w"}`)},
		// unknown message type
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[0]}, data: controlPayload(2, "cheat")},
		// malformed ready payload
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[0]}, data: []byte(`{"schemaVersion":2,"type":"ready","sequence":"oops"}`)},
		// oversized payload
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[0]}, data: oversized},
		// unknown user
		fakeMatchData{fakePresence: fakePresence{userID: "intruder"}, data: controlPayload(2, "ready")},
	}
	drain2v2Messages(state, dispatcher, 10, messages)

	rejections := broadcastPayloads(dispatcher, liveOpCodeCommandRejected)
	if len(rejections) != len(messages) {
		t.Fatalf("expected %d rejections, got %d", len(messages), rejections)
	}
	// Every rejected message must produce a code; collect them in order.
	type rejectedCode struct {
		sequence int
		code     string
	}
	codesInOrder := make([]rejectedCode, 0, len(rejections))
	for _, broadcast := range rejections {
		var payload struct {
			Sequence int    `json:"sequence"`
			Code     string `json:"code"`
		}
		if err := json.Unmarshal(broadcast, &payload); err != nil {
			t.Fatalf("rejection payload invalid: %v", err)
		}
		codesInOrder = append(codesInOrder, rejectedCode{payload.Sequence, payload.Code})
	}
	expectCodes := []rejectedCode{
		{0, "invalid_payload"},  // wrong schema version
		{-1, "invalid_payload"}, // missing schema version (no sequence key parsed -> -1)
		{0, "unknown_message"},
		{-1, "invalid_payload"}, // malformed ready (sequence is a string -> default -1)
		{-1, "invalid_payload"}, // oversized
		{0, "not_in_match"},
	}
	for index, expected := range expectCodes {
		if codesInOrder[index].code != expected.code {
			t.Fatalf("rejection %d code = %q, want %q (all: %v)", index, codesInOrder[index].code, expected.code, codesInOrder)
		}
	}
	if len(state.actionLog) != 0 || len(state.state.Armies) != 0 {
		t.Fatal("rejected messages mutated match state")
	}
}

func Test2v2NotInMatchRejected(t *testing.T) {
	state, dispatcher, _ := newTest2v2State(t)
	drain2v2Messages(state, dispatcher, 10, []runtime.MatchData{
		fakeMatchData{fakePresence: fakePresence{userID: "stranger"}, data: dispatchPayload(2, 0, "a_base_w", "a_gate_w")},
	})
	codes := rejected2v2Codes(dispatcher)
	if codes[0] != "not_in_match" {
		t.Fatalf("stranger dispatch code = %q, want not_in_match", codes[0])
	}
}

func Test2v2FeatureFlagDisabledCancelsMatch(t *testing.T) {
	serverConfig.Enable2v2 = false
	defer func() { serverConfig.Enable2v2 = true }()
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	handler := &live2v2Match{store: NewStore(db)}
	initState, _, _ := handler.MatchInit(context.Background(), &stubLogger{}, db, nil, map[string]interface{}{
		"allowed_users": []interface{}{"a", "b", "c", "d"},
	})
	state := initState.(*live2v2MatchState)
	if state.phase != live2v2PhaseCancelled {
		t.Fatalf("flag-disabled match phase = %q, want cancelled", state.phase)
	}
	// No career queries were expected; any unexpected store access surfaces
	// as an error from sqlmock during MatchInit above and the cancelled phase
	// assertion below catches the safety net. The draft must never run.
	for _, slotState := range state.slots {
		if slotState != nil {
			t.Fatal("flag-disabled match must not assign slots")
		}
	}
}

func Test2v2RematchVoteRequiresAllFour(t *testing.T) {
	state, dispatcher, _ := newTest2v2State(t)
	state.phase = live2v2PhaseFinished
	state.settled = true
	state.rematchEnds = 10_000

	created := ""
	state.matchCreate = func(ctx context.Context, moduleName string, params map[string]interface{}) (string, error) {
		created = moduleName
		return "live2v2_rematch", nil
	}

	// Three votes do not trigger the rematch.
	drain2v2Messages(state, dispatcher, 100, []runtime.MatchData{
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[0]}, data: controlPayload(2, "rematch_vote")},
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[1]}, data: controlPayload(2, "rematch_vote")},
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[2]}, data: controlPayload(2, "rematch_vote")},
	})
	if created != "" {
		t.Fatal("rematch created before all four voted")
	}

	// The fourth vote triggers it with identical slot order.
	drain2v2Messages(state, dispatcher, 101, []runtime.MatchData{
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[3]}, data: controlPayload(2, "rematch_vote")},
	})
	if created != "live_match_2v2" {
		t.Fatalf("rematch create module = %q, want live_match_2v2", created)
	}

	// After the rematch, further votes fail closed.
	drain2v2Messages(state, dispatcher, 102, []runtime.MatchData{
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[0]}, data: controlPayload(2, "rematch_vote")},
	})
	if len(broadcastPayloads(dispatcher, liveOpCodeCommandRejected)) != 1 {
		t.Fatal("post-rematch vote must be rejected")
	}
}

func Test2v2RematchWindowExpiryBroadcastsMatchClosed(t *testing.T) {
	state, dispatcher, _ := newTest2v2State(t)
	state.phase = live2v2PhaseFinished
	state.settled = true
	state.rematchEnds = 1_000

	created := ""
	state.matchCreate = func(ctx context.Context, moduleName string, params map[string]interface{}) (string, error) {
		created = moduleName
		return "live2v2_rematch", nil
	}

	// Fewer than four votes: the window expires without a rematch.
	drain2v2Messages(state, dispatcher, 999, []runtime.MatchData{
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[0]}, data: controlPayload(2, "rematch_vote")},
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[1]}, data: controlPayload(2, "rematch_vote")},
		fakeMatchData{fakePresence: fakePresence{userID: test2v2UserIDs[2]}, data: controlPayload(2, "rematch_vote")},
	})
	if created != "" {
		t.Fatal("rematch created before all four voted")
	}

	// The first loop tick past the window must terminate the handler and
	// broadcast match_closed exactly once so the remaining presences can
	// drop to the menu (§2.6) instead of hanging on a dead session.
	handler := &live2v2Match{}
	if next := handler.MatchLoop(context.Background(), &stubLogger{}, nil, nil, dispatcher, 1_001, state, nil); next != nil {
		t.Fatal("expired rematch window must terminate the match handler")
	}
	if created != "" {
		t.Fatal("expiry must not create a rematch")
	}
	closed := broadcastPayloads(dispatcher, liveOpCodeMatchClosed)
	if len(closed) != 1 {
		t.Fatalf("expected exactly 1 match_closed broadcast, got %d", len(closed))
	}
	var payload struct {
		Type    string `json:"type"`
		MatchID string `json:"matchId"`
	}
	if err := json.Unmarshal(closed[0], &payload); err != nil {
		t.Fatalf("match_closed payload invalid: %v", err)
	}
	if payload.Type != "match_closed" {
		t.Fatalf("expiry payload type = %q, want match_closed", payload.Type)
	}
	if payload.MatchID != state.matchID {
		t.Fatalf("expiry matchId = %q, want %q", payload.MatchID, state.matchID)
	}
	// Expiry must never broadcast a match start (no rematch was made).
	if len(broadcastPayloads(dispatcher, liveOpCodeMatchStarted)) != 0 {
		t.Fatal("expired window must not broadcast a match start")
	}
}

func Test2v2RematchWindowExpirySilentAfterRematchMade(t *testing.T) {
	state, dispatcher, _ := newTest2v2State(t)
	state.phase = live2v2PhaseFinished
	state.settled = true
	state.rematchEnds = 1_000
	state.rematchMade = true

	// The old handler keeps looping until the window ends even after the
	// rematch was created; its expiry must stay silent — the presences
	// already moved to the fresh match and must not see a terminal close.
	handler := &live2v2Match{}
	if next := handler.MatchLoop(context.Background(), &stubLogger{}, nil, nil, dispatcher, 1_001, state, nil); next != nil {
		t.Fatal("post-rematch expiry must terminate the old handler")
	}
	if len(broadcastPayloads(dispatcher, liveOpCodeMatchClosed)) != 0 {
		t.Fatal("expiry after a rematch must not broadcast match_closed")
	}
}
