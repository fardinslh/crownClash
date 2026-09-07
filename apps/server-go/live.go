package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	liveRoomModeQueue  = "queue"
	liveRoomModeCreate = "create"
	liveRoomModeJoin   = "join"

	liveTickInterval     = 50 * time.Millisecond
	liveSnapshotInterval = 50 * time.Millisecond
	liveWriteGrace       = 250 * time.Millisecond
)

type liveClientMessage struct {
	Type     string `json:"type"`
	Token    string `json:"token,omitempty"`
	Mode     string `json:"mode,omitempty"`
	RoomCode string `json:"roomCode,omitempty"`
	Sequence int    `json:"sequence,omitempty"`
	SourceID string `json:"sourceId,omitempty"`
	TargetID string `json:"targetId,omitempty"`
}

type liveServerMessage struct {
	Type         string           `json:"type"`
	Code         string           `json:"code,omitempty"`
	RoomCode     string           `json:"roomCode,omitempty"`
	MatchID      string           `json:"matchId,omitempty"`
	Role         Team             `json:"role,omitempty"`
	PlayerName   string           `json:"playerName,omitempty"`
	OpponentName string           `json:"opponentName,omitempty"`
	State        *GameState       `json:"state,omitempty"`
	Sequence     int              `json:"sequence,omitempty"`
	Result       *liveMatchResult `json:"result,omitempty"`
}

type liveMatchResult struct {
	MatchID    string          `json:"matchId"`
	Status     string          `json:"status"`
	Stats      MatchStats      `json:"stats"`
	Settlement MatchSettlement `json:"settlement"`
}

type liveSettlementStore interface {
	SettleMatch(ctx context.Context, playerID, status string, stats MatchStats, matchID string) (MatchSettlement, error)
}

type liveConnection struct {
	socket *websocket.Conn
	send   chan liveServerMessage
	done   chan struct{}
	once   sync.Once
}

func newLiveConnection(socket *websocket.Conn) *liveConnection {
	connection := &liveConnection{
		socket: socket,
		send:   make(chan liveServerMessage, 32),
		done:   make(chan struct{}),
	}
	go connection.writeLoop()
	return connection
}

func (c *liveConnection) writeLoop() {
	for {
		select {
		case message := <-c.send:
			if err := c.socket.WriteJSON(message); err != nil {
				c.close()
				return
			}
		case <-c.done:
			return
		}
	}
}

func (c *liveConnection) enqueue(message liveServerMessage) {
	select {
	case c.send <- message:
	case <-c.done:
	}
}

func (c *liveConnection) closeSoon() {
	time.AfterFunc(liveWriteGrace, c.close)
}

func (c *liveConnection) close() {
	c.once.Do(func() {
		close(c.done)
		if c.socket != nil {
			_ = c.socket.Close()
		}
	})
}

type livePlayer struct {
	connection  *liveConnection
	playerID    string
	displayName string
	career      PlayerCareer
	role        Team
	nextSeq     int
}

type liveCommand struct {
	player   *livePlayer
	sequence int
	sourceID string
	targetID string
}

type liveRoom struct {
	manager      *LiveMatchManager
	id           string
	code         string
	players      [2]*livePlayer
	state        GameState
	accumulators map[string]float64
	commands     chan liveCommand
	disconnects  chan *livePlayer
	lastTick     time.Time
	lastSnapshot time.Time
	finishOnce   sync.Once
}

type LiveMatchManager struct {
	repo        *PlayerRepository
	settler     liveSettlementStore
	mu          sync.Mutex
	waiting     *livePlayer
	rooms       map[string]*liveRoom
	playerRooms map[*livePlayer]*liveRoom
}

func NewLiveMatchManager(repo *PlayerRepository) *LiveMatchManager {
	return &LiveMatchManager{
		repo:        repo,
		settler:     repo,
		rooms:       make(map[string]*liveRoom),
		playerRooms: make(map[*livePlayer]*liveRoom),
	}
}

func (m *LiveMatchManager) loadPlayer(
	ctx context.Context,
	connection *liveConnection,
	playerID, platform string,
) (*livePlayer, error) {
	if m.repo == nil {
		return nil, errors.New("live_repository_unavailable")
	}
	career, err := m.repo.GetOrCreateCareer(ctx, playerID, platform, nil)
	if err != nil {
		return nil, err
	}
	displayName, err := m.repo.GetPlayerDisplayName(ctx, playerID)
	if err != nil {
		return nil, err
	}
	return &livePlayer{
		connection:  connection,
		playerID:    playerID,
		displayName: displayName,
		career:      career,
	}, nil
}

func (m *LiveMatchManager) join(player *livePlayer, mode, roomCode string) error {
	switch mode {
	case liveRoomModeQueue:
		return m.joinQueue(player)
	case liveRoomModeCreate:
		return m.createInvite(player)
	case liveRoomModeJoin:
		return m.joinInvite(player, roomCode)
	default:
		return errors.New("invalid_live_mode")
	}
}

func (m *LiveMatchManager) joinQueue(player *livePlayer) error {
	m.mu.Lock()
	if m.playerAlreadyActiveLocked(player.playerID) {
		m.mu.Unlock()
		return errors.New("live_player_already_queued")
	}
	if m.waiting == nil {
		m.waiting = player
		m.mu.Unlock()
		player.connection.enqueue(liveServerMessage{Type: "queue_waiting"})
		return nil
	}
	opponent := m.waiting
	m.waiting = nil
	room := m.newRoomLocked(opponent, player, "")
	m.mu.Unlock()

	room.start()
	return nil
}

func (m *LiveMatchManager) createInvite(player *livePlayer) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.playerAlreadyActiveLocked(player.playerID) {
		return errors.New("live_player_already_queued")
	}
	code := newLiveRoomCode()
	room := m.newRoomLocked(player, nil, code)
	player.connection.enqueue(liveServerMessage{
		Type:     "invite_created",
		RoomCode: room.code,
	})
	player.connection.enqueue(liveServerMessage{
		Type: "invite_waiting",
	})
	return nil
}

func (m *LiveMatchManager) joinInvite(player *livePlayer, roomCode string) error {
	roomCode = strings.ToUpper(strings.TrimSpace(roomCode))
	m.mu.Lock()
	if m.playerAlreadyActiveLocked(player.playerID) {
		m.mu.Unlock()
		return errors.New("live_player_already_queued")
	}
	room, ok := m.rooms[roomCode]
	if !ok || room.players[1] != nil {
		m.mu.Unlock()
		return errors.New("live_room_not_found")
	}
	if room.players[0].playerID == player.playerID {
		m.mu.Unlock()
		return errors.New("live_cannot_join_own_room")
	}
	player.role = TeamEnemy
	room.players[1] = player
	m.playerRooms[player] = room
	m.mu.Unlock()

	room.start()
	return nil
}

func (m *LiveMatchManager) disconnect(player *livePlayer) {
	m.mu.Lock()
	if m.waiting == player {
		m.waiting = nil
	}
	room := m.playerRooms[player]
	delete(m.playerRooms, player)
	m.mu.Unlock()
	if room != nil {
		if room.players[1] == nil {
			m.removeRoom(room)
			return
		}
		select {
		case room.disconnects <- player:
		case <-time.After(time.Second):
		}
	}
}

func (m *LiveMatchManager) playerAlreadyActiveLocked(playerID string) bool {
	if m.waiting != nil && m.waiting.playerID == playerID {
		return true
	}
	for player := range m.playerRooms {
		if player.playerID == playerID {
			return true
		}
	}
	return false
}

func (m *LiveMatchManager) newRoomLocked(first, second *livePlayer, code string) *liveRoom {
	id := "live_" + time.Now().UTC().Format("20060102_150405.000000000")
	room := &liveRoom{
		manager:      m,
		id:           id,
		code:         code,
		players:      [2]*livePlayer{first, second},
		accumulators: map[string]float64{},
		commands:     make(chan liveCommand, 32),
		disconnects:  make(chan *livePlayer, 2),
	}
	first.role = TeamPlayer
	if second != nil {
		second.role = TeamEnemy
	}
	if room.code != "" {
		m.rooms[room.code] = room
	}
	m.playerRooms[first] = room
	if second != nil {
		m.playerRooms[second] = room
	}
	return room
}

func (m *LiveMatchManager) removeRoom(room *liveRoom) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if room.code != "" {
		delete(m.rooms, room.code)
	}
	for _, player := range room.players {
		if player != nil {
			delete(m.playerRooms, player)
		}
	}
}

func (r *liveRoom) start() {
	if r.players[0] == nil || r.players[1] == nil {
		return
	}
	r.state = CreateInitialGameState(
		UpgradeModifiers(r.players[0].career),
		UpgradeModifiers(r.players[1].career),
	)
	r.lastTick = time.Now()
	r.lastSnapshot = r.lastTick
	for _, player := range r.players {
		if player == nil {
			continue
		}
		player.connection.enqueue(liveServerMessage{
			Type:         "match_started",
			MatchID:      r.id,
			Role:         player.role,
			PlayerName:   player.displayName,
			OpponentName: r.opponentName(player),
			State:        r.stateFor(player.role),
		})
	}
	go r.loop()
}

func (r *liveRoom) loop() {
	ticker := time.NewTicker(liveTickInterval)
	defer ticker.Stop()
	for {
		select {
		case command := <-r.commands:
			r.handleCommand(command)
		case player := <-r.disconnects:
			r.finishDisconnect(player)
			return
		case now := <-ticker.C:
			r.tick(now)
			if r.state.Status != "playing" {
				r.finish(r.state.Status)
				return
			}
		}
	}
}

func (r *liveRoom) handleCommand(command liveCommand) {
	if command.player == nil || r.state.Status != "playing" {
		return
	}
	if command.player.nextSeq != command.sequence {
		command.player.connection.enqueue(liveServerMessage{
			Type: "command_rejected", Code: "invalid_sequence", Sequence: command.sequence,
		})
		return
	}
	err := dispatchArmy(
		&r.state,
		command.sourceID,
		command.targetID,
		roleToTeam(command.player.role),
		UpgradeModifiers(command.player.career).ArmySpeedMultiplier,
		"live_"+r.id+"_"+itoa(int64(command.sequence)),
	)
	if err != nil {
		command.player.connection.enqueue(liveServerMessage{
			Type: "command_rejected", Code: err.Error(), Sequence: command.sequence,
		})
		return
	}
	command.player.nextSeq++
	command.player.connection.enqueue(liveServerMessage{
		Type: "command_accepted", Sequence: command.sequence,
	})
}

func (r *liveRoom) tick(now time.Time) {
	delta := now.Sub(r.lastTick).Seconds()
	if delta <= 0 {
		return
	}
	if delta > 0.25 {
		delta = 0.25
	}
	r.lastTick = now
	r.state, r.accumulators = stepSimulation(r.state, r.accumulators, delta)
	if now.Sub(r.lastSnapshot) < liveSnapshotInterval {
		return
	}
	r.lastSnapshot = now
	for _, player := range r.players {
		if player != nil {
			player.connection.enqueue(liveServerMessage{
				Type:  "state",
				State: r.stateFor(player.role),
			})
		}
	}
}

func (r *liveRoom) finishDisconnect(disconnected *livePlayer) {
	if disconnected == nil {
		return
	}
	if disconnected.role == TeamPlayer {
		r.finish("defeat")
	} else {
		r.finish("victory")
	}
}

func (r *liveRoom) finish(canonicalStatus string) {
	r.finishOnce.Do(func() {
		r.state.Status = canonicalStatus
		for _, player := range r.players {
			if player == nil {
				continue
			}
			status := statusForRole(canonicalStatus, player.role)
			stats := statsForRole(r.state.Stats, player.role)
			settlement, err := r.manager.settler.SettleMatch(
				context.Background(),
				player.playerID,
				status,
				stats,
				r.id+"_"+player.playerID,
			)
			if err != nil {
				log.Printf("[live] settlement failed for %s: %v", player.playerID, err)
				player.connection.enqueue(liveServerMessage{Type: "error", Code: "settlement_failed"})
				continue
			}
			player.connection.enqueue(liveServerMessage{
				Type:    "match_result",
				MatchID: r.id,
				Result: &liveMatchResult{
					MatchID:    settlement.MatchID,
					Status:     status,
					Stats:      stats,
					Settlement: settlement,
				},
			})
			player.connection.closeSoon()
		}
		r.manager.removeRoom(r)
	})
}

func (r *liveRoom) opponentName(player *livePlayer) string {
	for _, candidate := range r.players {
		if candidate != nil && candidate != player {
			return candidate.displayName
		}
	}
	return "Opponent"
}

func (r *liveRoom) stateFor(role Team) *GameState {
	state := r.state
	state.Territories = make(map[string]Territory, len(r.state.Territories))
	for id, territory := range r.state.Territories {
		territory.Owner = mapTeamForRole(territory.Owner, role)
		state.Territories[id] = territory
	}
	state.Armies = make([]MarchingArmy, len(r.state.Armies))
	for index, army := range r.state.Armies {
		army.Owner = mapTeamForRole(army.Owner, role)
		state.Armies[index] = army
	}
	state.Status = statusForRole(r.state.Status, role)
	state.Stats = statsForRole(r.state.Stats, role)
	return &state
}

func roleToTeam(role Team) Team {
	if role == TeamEnemy {
		return TeamEnemy
	}
	return TeamPlayer
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

func newLiveRoomCode() string {
	var bytes [4]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return strings.ToUpper(hex.EncodeToString(bytes[:]))
	}
	return strings.ToUpper(hex.EncodeToString(bytes[:]))
}

func (s *Server) liveWebSocket(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin: func(request *http.Request) bool {
			origin := request.Header.Get("Origin")
			return origin == "" || s.config.ClientOrigins[origin]
		},
	}
	socket, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	connection := newLiveConnection(socket)
	defer connection.close()
	socket.SetReadLimit(64 * 1024)
	_ = socket.SetReadDeadline(time.Now().Add(10 * time.Second))

	var auth liveClientMessage
	if err := socket.ReadJSON(&auth); err != nil || auth.Type != "auth" {
		connection.enqueue(liveServerMessage{Type: "error", Code: "authentication_required"})
		return
	}
	playerID, platform, err := VerifySessionToken(auth.Token, s.config.JWTSecret)
	if err != nil {
		connection.enqueue(liveServerMessage{Type: "error", Code: "invalid_token"})
		return
	}
	player, err := s.live.loadPlayer(r.Context(), connection, playerID, platform)
	if err != nil {
		connection.enqueue(liveServerMessage{Type: "error", Code: "player_unavailable"})
		return
	}
	connection.enqueue(liveServerMessage{Type: "ready"})
	_ = socket.SetReadDeadline(time.Time{})

	joined := false
	for {
		var message liveClientMessage
		if err := socket.ReadJSON(&message); err != nil {
			s.live.disconnect(player)
			return
		}
		switch message.Type {
		case "join":
			if joined {
				connection.enqueue(liveServerMessage{Type: "error", Code: "already_joined"})
				continue
			}
			if err := s.live.join(player, message.Mode, message.RoomCode); err != nil {
				connection.enqueue(liveServerMessage{Type: "error", Code: err.Error()})
				continue
			}
			joined = true
		case "dispatch":
			s.live.mu.Lock()
			room := s.live.playerRooms[player]
			s.live.mu.Unlock()
			if room == nil {
				connection.enqueue(liveServerMessage{Type: "error", Code: "live_match_not_started"})
				continue
			}
			room.commands <- liveCommand{
				player: player, sequence: message.Sequence,
				sourceID: message.SourceID, targetID: message.TargetID,
			}
		default:
			connection.enqueue(liveServerMessage{Type: "error", Code: "unknown_message"})
		}
	}
}
