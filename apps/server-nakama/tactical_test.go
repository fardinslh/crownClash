package main

import (
	"context"
	"encoding/json"
	"github.com/heroiclabs/nakama-common/runtime"
	"os"
	"reflect"
	"testing"
	"time"
)

func tacticalState() GameState {
	s := CreateInitialGameState(DefaultModifiers(), DefaultModifiers())
	s.GameplayRulesVersion = 3
	applyTacticalOpening(&s, DefaultModifiers(), DefaultModifiers())
	return s
}

func TestTacticalRoutesAndInterruption(t *testing.T) {
	s := tacticalState()
	d := s.Territories["n_bot_right"]
	d.Owner = TeamPlayer
	s.Territories[d.ID] = d
	if got := findDispatchRoute(s, "n_bot_left", "n_bot_right", TeamPlayer); !reflect.DeepEqual(got, []string{"n_bot_left", "p_base", "n_bot_right"}) {
		t.Fatal(got)
	}
	before := s.Territories["p_base"].Units
	if err := dispatchArmy(&s, "p_base", "e_base", TeamPlayer, 1, "invalid"); err != ErrPvpInvalidDispatch {
		t.Fatal(err)
	}
	if s.Territories["p_base"].Units != before {
		t.Fatal("invalid command debited")
	}
	if err := dispatchArmy(&s, "n_bot_left", "n_bot_right", TeamPlayer, 1, "supply"); err != nil {
		t.Fatal(err)
	}
	if s.Territories["n_bot_left"].Units != 7 {
		t.Fatal("wrong debit")
	}
	for id, tower := range s.Territories {
		tower.ProductionRate = 0
		s.Territories[id] = tower
	}
	tower := s.Territories["p_base"]
	tower.Owner = TeamEnemy
	tower.Units = 1
	s.Territories[tower.ID] = tower
	acc := map[string]float64{}
	for i := 0; i < 110; i++ {
		s, acc = stepSimulation(s, acc, .02)
	}
	if len(s.Armies) != 0 || s.Territories["p_base"].Owner != TeamPlayer || s.Territories["n_bot_right"].Units != d.Units {
		t.Fatal("intercept did not terminate at recaptured waypoint", s)
	}
}

func TestTacticalPostgresVersionPinningAndSettlement(t *testing.T) {
	s, now := realmTestStore(t)
	ctx := context.Background()
	oldConfig := asyncGameplayRulesVersion
	t.Cleanup(func() { asyncGameplayRulesVersion = oldConfig })
	asyncGameplayRulesVersion = 3
	legacy, err := s.CreatePilotPractice(ctx, "a")
	if err != nil || legacy.GameplayRulesVersion != 2 {
		t.Fatalf("legacy %+v %v", legacy, err)
	}
	modern, err := s.CreatePilotPractice(ctx, "b", 1, 2, 3)
	if err != nil || modern.GameplayRulesVersion != 3 {
		t.Fatalf("modern %+v %v", modern, err)
	}
	asyncGameplayRulesVersion = 2
	resumed, err := s.CreatePilotPractice(ctx, "b", 1, 2, 3)
	if err != nil || resumed.MatchID != modern.MatchID || resumed.GameplayRulesVersion != 3 {
		t.Fatalf("pinning %+v %v", resumed, err)
	}
	fallback, err := s.CreatePilotPractice(ctx, "c", 1, 2, 3)
	if err != nil || fallback.GameplayRulesVersion != 2 {
		t.Fatalf("rollback %+v %v", fallback, err)
	}
	*now = now.Add(100 * time.Second)
	invalid := []PvpAction{{Sequence: 0, AtSeconds: 0, SourceID: "p_base", TargetID: "e_base"}}
	_, _, err = s.SettlePilotPractice(ctx, "b", modern.MatchID, invalid)
	requireRealmError(t, err, "realm_dispatch_required")
	actions := []PvpAction{{Sequence: 0, AtSeconds: 0, SourceID: "p_base", TargetID: "n_bot_right"}}
	first, _, err := s.SettlePilotPractice(ctx, "b", modern.MatchID, actions)
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := s.SettlePilotPractice(ctx, "b", modern.MatchID, actions)
	if err != nil || !reflect.DeepEqual(first, second) {
		t.Fatalf("duplicate settlement %v", err)
	}
	var count int
	if err = s.db.QueryRow(`SELECT COUNT(*) FROM economy_ledger WHERE player_id='b' AND source='battle_settlement'`).Scan(&count); err != nil || count != len(first.LedgerEntries) {
		t.Fatalf("ledger %d %v", count, err)
	}
	event := AnalyticsEventRecord{EventID: "tactical_verified_version", Name: "match_end", SessionID: "test", OccurredAt: now.UnixMilli(), SchemaVersion: 1, Props: map[string]any{"matchId": modern.MatchID, "mode": "bot", "result": "victory", "durationSeconds": 0, "gameplayRulesVersion": 2}}
	if _, err = s.InsertAnalyticsEvents(ctx, "b", []AnalyticsEventRecord{event}); err != nil {
		t.Fatal(err)
	}
	var version int
	if err = s.db.QueryRow(`SELECT (props->>'gameplayRulesVersion')::integer FROM analytics_events WHERE event_id=$1`, event.EventID).Scan(&version); err != nil || version != 3 {
		t.Fatalf("forged analytics version survived %d %v", version, err)
	}
}

// Exercise the RPC boundary as well as the store: dropping capabilities here
// previously made the browser silently receive v2 despite advertising v3.
func TestTacticalPostgresRPCAndSocialTickets(t *testing.T) {
	s, now := realmTestStore(t)
	ctx := context.Background()
	oldConfig, oldPilot := asyncGameplayRulesVersion, pilotRuntime
	t.Cleanup(func() { asyncGameplayRulesVersion = oldConfig; pilotRuntime = oldPilot })
	asyncGameplayRulesVersion = 3
	pilotRuntime.Enabled = false
	for _, c := range []struct {
		payload string
		version int
	}{{"", 2}, {`{"supportedGameplayRulesVersions":[1,2]}`, 2}, {`{"supportedGameplayRulesVersions":[1,2,3]}`, 3}} {
		raw, err := rpcStartBotMatch(s)(context.WithValue(ctx, runtime.RUNTIME_CTX_USER_ID, "a"), &stubLogger{}, s.db, nil, c.payload)
		if err != nil {
			t.Fatal(err)
		}
		var response struct {
			Ticket BotMatchTicket `json:"ticket"`
		}
		if err = json.Unmarshal([]byte(raw), &response); err != nil || response.Ticket.GameplayRulesVersion != c.version {
			t.Fatalf("RPC %s: %s %v", c.payload, raw, err)
		}
	}
	for _, payload := range []string{`{"route":["p_base","e_base"]}`, `{"supportedGameplayRulesVersions":[3]} {}`, `{"supportedGameplayRulesVersions":["3"]}`} {
		_, err := rpcStartBotMatch(s)(context.WithValue(ctx, runtime.RUNTIME_CTX_USER_ID, "a"), &stubLogger{}, s.db, nil, payload)
		requireRealmError(t, err, "invalid_payload")
	}
	token, _, err := s.CreateRealmChallenge(ctx, "b")
	if err != nil {
		t.Fatal(err)
	}
	ticket, err := s.StartRealmAttack(ctx, "a", RealmStartRequest{Source: "friend", Token: token, SupportedGameplayRulesVersions: []int{1, 2, 3}})
	if err != nil || ticket.GameplayRulesVersion != 3 || ticket.CombatPolicy != "equal" {
		t.Fatalf("friend %+v %v", ticket, err)
	}
	_, err = s.StartRealmAttack(ctx, "a", RealmStartRequest{Source: "ranked"})
	requireRealmError(t, err, "client_update_required")
	asyncGameplayRulesVersion = 2
	resumed, err := s.StartRealmAttack(ctx, "a", RealmStartRequest{Source: "ranked", SupportedGameplayRulesVersions: []int{3}})
	if err != nil || resumed.MatchID != ticket.MatchID || resumed.GameplayRulesVersion != 3 {
		t.Fatalf("resumed %+v %v", resumed, err)
	}
	*now = now.Add(100 * time.Second)
	actions := []PvpAction{{Sequence: 0, AtSeconds: 0, SourceID: "p_base", TargetID: map[string]string{"crown_cross": "n_bot_left", "twin_passes": "n_west_gate_s", "royal_ring": "n_ring_sw"}[ticket.BattlefieldID]}}
	first, err := s.SettleRealmAttack(ctx, "a", ticket.MatchID, actions)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.SettleRealmAttack(ctx, "a", ticket.MatchID, actions)
	if err != nil || !reflect.DeepEqual(first, second) {
		t.Fatalf("social duplicate %v", err)
	}
	asyncGameplayRulesVersion = 3
	revenge, err := s.StartRealmAttack(ctx, "b", RealmStartRequest{Source: "revenge", OriginID: ticket.MatchID, SupportedGameplayRulesVersions: []int{3}})
	if err != nil || revenge.GameplayRulesVersion != 3 || revenge.CombatPolicy != "equal" {
		t.Fatalf("revenge %+v %v", revenge, err)
	}
	ranked, err := s.StartRealmAttack(ctx, "c", RealmStartRequest{Source: "ranked", SupportedGameplayRulesVersions: []int{3}})
	if err != nil || ranked.GameplayRulesVersion != 3 {
		t.Fatalf("ranked %+v %v", ranked, err)
	}
}

// Invoked by the cross-engine script. Every state includes route metadata and every army.
func TestTacticalCrossEngine(t *testing.T) {
	input := os.Getenv("TACTICAL_PARITY_INPUT")
	if input == "" {
		t.Skip("cross-engine orchestrator only")
	}
	var cases []struct {
		ID     string    `json:"id"`
		State  GameState `json:"state"`
		Ticks  int       `json:"ticks"`
		Orders []struct {
			At             int `json:"at"`
			Source, Target string
			Owner          Team
		} `json:"orders"`
		Changes []struct {
			At    int `json:"at"`
			ID    string
			Owner Team
			Units int
		} `json:"changes"`
		Replay *struct {
			BattlefieldID        string                 `json:"battlefieldId"`
			GameplayRulesVersion int                    `json:"gameplayRulesVersion"`
			PlayerModifiers      PlayerUpgradeModifiers `json:"playerModifiers"`
			EnemyModifiers       PlayerUpgradeModifiers `json:"enemyModifiers"`
			Actions              []PvpAction            `json:"actions"`
		} `json:"replay"`
	}
	raw, err := os.ReadFile(input)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	output := map[string]any{}
	for _, c := range cases {
		if c.Replay != nil {
			r := c.Replay
			state, summary, err := simulateBattleWithRules(r.Actions, r.PlayerModifiers, r.EnemyModifiers, r.BattlefieldID, r.GameplayRulesVersion)
			if err != nil {
				t.Fatal(c.ID, err)
			}
			output[c.ID] = map[string]any{"finalState": state, "summary": summary}
			continue
		}
		s := c.State
		acc := map[string]float64{}
		snapshots := []json.RawMessage{}
		for tick := 0; tick < c.Ticks; tick++ {
			for i, o := range c.Orders {
				if o.At == tick {
					err := dispatchArmy(&s, o.Source, o.Target, o.Owner, 1, "order_"+itoa(int64(i)))
					if err != nil {
						t.Fatal(c.ID, tick, err)
					}
				}
			}
			for _, change := range c.Changes {
				if change.At == tick {
					v := s.Territories[change.ID]
					v.Owner = change.Owner
					v.Units = change.Units
					s.Territories[change.ID] = v
				}
			}
			moves := evaluateTacticalMoves(s, TeamEnemy, 1)
			s, acc = stepSimulation(s, acc, .02)
			raw, err = json.Marshal(map[string]any{"state": s, "accumulators": acc, "moves": moves})
			if err != nil {
				t.Fatal(err)
			}
			snapshots = append(snapshots, raw)
		}
		output[c.ID] = snapshots
	}
	raw, err = json.Marshal(output)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(os.Getenv("TACTICAL_PARITY_OUTPUT"), raw, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestTacticalPostgresCohortReport(t *testing.T) {
	s, _ := realmTestStore(t)
	var base int64
	if err := s.db.QueryRow(`SELECT (EXTRACT(EPOCH FROM now()-interval '3 day')*1000)::bigint`).Scan(&base); err != nil {
		t.Fatal(err)
	}
	type fixture struct {
		player, session, name, match, result, source string
		version, offset, duration                    int
	}
	events := []fixture{
		{"a", "one", "match_start", "a1", "", "menu", 3, 0, 0},
		{"a", "one", "match_end", "a1", "defeat", "", 3, 1, 30},
		{"a", "one", "match_start", "a2", "", "rematch", 3, 2, 0},
		{"a", "one", "match_end", "a2", "victory", "", 3, 3, 60},
		{"a", "two", "match_start", "a3", "", "menu", 3, 86400, 0},
		{"b", "one", "match_start", "b1", "", "menu", 2, 0, 0},
		{"b", "one", "match_end", "b1", "victory", "", 2, 1, 40},
		{"b", "one", "match_start", "b2", "", "rematch", 2, 2, 0},
		{"b", "one", "match_quit", "b2", "", "", 2, 3, 10},
	}
	events = append(events, events[0], events[1], events[8])
	for i, e := range events {
		raw, _ := json.Marshal(map[string]any{"matchId": e.match, "mode": "bot", "result": e.result, "source": e.source, "gameplayRulesVersion": e.version, "durationSeconds": e.duration})
		if _, err := s.db.Exec(`INSERT INTO analytics_events(player_id,event_id,session_id,name,props,occurred_at,schema_version) VALUES($1,$2,$3,$4,$5,$6,1)`, e.player, "cohort_"+itoa(int64(i)), e.session, e.name, string(raw), base+int64(e.offset)*1000); err != nil {
			t.Fatal(err)
		}
	}
	query, err := os.ReadFile("../../docs/analytics/tactical-cohorts.sql")
	if err != nil {
		t.Fatal(err)
	}
	var raw []byte
	if err = s.db.QueryRow(string(query)).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var report struct {
		Cohorts []map[string]any `json:"cohorts"`
	}
	if err = json.Unmarshal(raw, &report); err != nil {
		t.Fatal(err)
	}
	if len(report.Cohorts) != 2 {
		t.Fatal(string(raw))
	}
	for _, m := range report.Cohorts {
		expected := map[string]float64{"sessions_started_second": 1, "d1_eligible_players": 1}
		if m["rules"] == float64(3) {
			for k, v := range map[string]float64{"matches_started": 3, "matches_completed": 2, "sessions": 2, "sessions_completed_second": 1, "rematches_after_loss": 1, "quits_before_15s": 0, "d1_returned_players": 1, "mean_duration_seconds": 45} {
				expected[k] = v
			}
		} else {
			for k, v := range map[string]float64{"matches_started": 2, "matches_completed": 1, "sessions": 1, "sessions_completed_second": 0, "rematches_after_loss": 0, "quits_before_15s": 1, "d1_returned_players": 0, "mean_duration_seconds": 40} {
				expected[k] = v
			}
		}
		for k, v := range expected {
			if m[k] != v {
				t.Fatalf("rules %v %s got %v want %v", m["rules"], k, m[k], v)
			}
		}
	}
}

func TestTacticalVersionedBotQuitPayload(t *testing.T) {
	events, err := parseAnalyticsEventsPayload(analyticsPayload([]AnalyticsEventRecord{
		analyticsTestEvent("match_quit", map[string]any{"matchId": "bot_versioned", "mode": "bot", "durationSeconds": float64(8), "gameplayRulesVersion": float64(3)}),
	}), analyticsTestNow)
	if err != nil || len(events) != 1 {
		t.Fatalf("versioned bot quit rejected: %v", err)
	}
}

func TestTacticalPostgresMenuAnalyticsBatch(t *testing.T) {
	s, _ := realmTestStore(t)
	ctx := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "a")
	oldConfig, oldPilot := asyncGameplayRulesVersion, pilotRuntime
	t.Cleanup(func() { asyncGameplayRulesVersion = oldConfig; pilotRuntime = oldPilot })
	asyncGameplayRulesVersion = 3
	pilotRuntime.Enabled = false
	ticket, err := s.CreateBotMatch(ctx, "a", 3)
	if err != nil {
		t.Fatal(err)
	}
	events := []AnalyticsEventRecord{}
	for _, name := range []string{"match_start", "match_menu_opened", "match_resumed", "match_leave_requested", "match_leave_cancelled", "match_quit_confirmed", "match_quit"} {
		props := map[string]any{"matchId": ticket.MatchID, "mode": "bot"}
		if name == "match_start" {
			props["source"] = "menu"
			props["gameplayRulesVersion"] = 2
		}
		if name == "match_quit" || name == "match_quit_confirmed" {
			props["durationSeconds"] = 8
		}
		if name == "match_quit" {
			props["gameplayRulesVersion"] = 2
		}
		events = append(events, AnalyticsEventRecord{EventID: name, Name: name, SessionID: "menu_qa", OccurredAt: nowMillis(), SchemaVersion: 1, Props: props})
	}
	payload, _ := json.Marshal(map[string]any{"events": events})
	if _, err = rpcTrackEvents(s)(ctx, &stubLogger{}, s.db, nil, string(payload)); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = s.db.QueryRow(`SELECT COUNT(*) FROM analytics_events WHERE player_id='a' AND name IN ('match_start','match_quit') AND props->>'gameplayRulesVersion'='3'`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("versioned terminal/start data lost: %d %v", count, err)
	}
}
