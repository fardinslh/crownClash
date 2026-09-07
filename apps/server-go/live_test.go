package main

import (
	"context"
	"testing"
)

type liveSettlementCall struct {
	playerID string
	status   string
	matchID  string
}

type fakeLiveSettler struct {
	calls []liveSettlementCall
}

func (s *fakeLiveSettler) SettleMatch(
	_ context.Context,
	playerID, status string,
	_ MatchStats,
	matchID string,
) (MatchSettlement, error) {
	s.calls = append(s.calls, liveSettlementCall{
		playerID: playerID,
		status:   status,
		matchID:  matchID,
	})
	return MatchSettlement{
		MatchID:   matchID,
		Status:    status,
		NewCareer: CreateDefaultCareer(playerID),
	}, nil
}

func testLiveConnection() *liveConnection {
	return &liveConnection{
		send: make(chan liveServerMessage, 8),
		done: make(chan struct{}),
	}
}

func TestLiveRoomMirrorsEnemyPerspective(t *testing.T) {
	room := &liveRoom{
		state: CreateInitialGameState(DefaultModifiers(), DefaultModifiers()),
	}

	enemyView := room.stateFor(TeamEnemy)
	if enemyView.Territories["p_base"].Owner != TeamEnemy {
		t.Fatal("expected first player's base to be enemy in the second player's view")
	}
	if enemyView.Territories["e_base"].Owner != TeamPlayer {
		t.Fatal("expected second player's base to be player in their own view")
	}
}

func TestLiveRoomAssignsOpposingRoles(t *testing.T) {
	manager := &LiveMatchManager{
		rooms:       make(map[string]*liveRoom),
		playerRooms: make(map[*livePlayer]*liveRoom),
	}
	first := &livePlayer{playerID: "first", connection: testLiveConnection()}
	second := &livePlayer{playerID: "second", connection: testLiveConnection()}

	manager.newRoomLocked(first, second, "")
	if first.role != TeamPlayer || second.role != TeamEnemy {
		t.Fatalf("expected player/enemy roles, got %q/%q", first.role, second.role)
	}
}

func TestLiveRoomAcceptsOrderedDispatchOnly(t *testing.T) {
	player := &livePlayer{
		connection: testLiveConnection(),
		career:     CreateDefaultCareer("player"),
		role:       TeamPlayer,
	}
	room := &liveRoom{
		id:    "test",
		state: CreateInitialGameState(DefaultModifiers(), DefaultModifiers()),
	}

	room.handleCommand(liveCommand{
		player: player, sequence: 0, sourceID: "p_base", targetID: "n_center",
	})
	if player.nextSeq != 1 {
		t.Fatalf("expected next sequence 1, got %d", player.nextSeq)
	}
	if room.state.Territories["p_base"].Units >= 20 {
		t.Fatal("expected authoritative dispatch to reduce source units")
	}
	if message := <-player.connection.send; message.Type != "command_accepted" {
		t.Fatalf("expected accepted command, got %q", message.Type)
	}

	room.handleCommand(liveCommand{
		player: player, sequence: 3, sourceID: "p_base", targetID: "n_center",
	})
	if player.nextSeq != 1 {
		t.Fatal("invalid sequence must not advance command order")
	}
	if message := <-player.connection.send; message.Code != "invalid_sequence" {
		t.Fatalf("expected sequence rejection, got %q", message.Code)
	}
}

func TestLiveDisconnectSettlesImmediateSurrender(t *testing.T) {
	settler := &fakeLiveSettler{}
	manager := &LiveMatchManager{
		settler:     settler,
		rooms:       make(map[string]*liveRoom),
		playerRooms: make(map[*livePlayer]*liveRoom),
	}
	first := &livePlayer{
		connection: testLiveConnection(),
		playerID:   "first",
		career:     CreateDefaultCareer("first"),
		role:       TeamPlayer,
	}
	second := &livePlayer{
		connection: testLiveConnection(),
		playerID:   "second",
		career:     CreateDefaultCareer("second"),
		role:       TeamEnemy,
	}
	room := &liveRoom{
		manager: manager,
		id:      "live_test",
		players: [2]*livePlayer{first, second},
		state:   CreateInitialGameState(DefaultModifiers(), DefaultModifiers()),
	}
	manager.playerRooms[first] = room
	manager.playerRooms[second] = room

	room.finishDisconnect(first)
	if len(settler.calls) != 2 {
		t.Fatalf("expected two settlements, got %d", len(settler.calls))
	}
	if settler.calls[0].status != "defeat" || settler.calls[1].status != "victory" {
		t.Fatalf("expected disconnect loss and opponent win, got %q and %q", settler.calls[0].status, settler.calls[1].status)
	}
	if result := (<-second.connection.send).Result; result == nil || result.Status != "victory" {
		t.Fatal("expected surviving player to receive victory result")
	}
}
