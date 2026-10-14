package main

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

func TestBotDifficultyCadenceAndHistoricalDefault(t *testing.T) {
	for _, version := range []int{1, 2, 3} {
		old, oldSummary, err := simulateBattleWithRules(nil, DefaultModifiers(), DefaultModifiers(), "crown_cross", version)
		if err != nil {
			t.Fatal(err)
		}
		actual, summary, err := simulateBotBattleWithDifficulty(nil, DefaultModifiers(), DefaultModifiers(), "crown_cross", version, "normal")
		if err != nil || !reflect.DeepEqual(old, actual) || !reflect.DeepEqual(oldSummary, summary) {
			t.Fatal("normal changed historical replay", err)
		}
	}
	if botAITickSeconds("easy") != 3.6 || botAITickSeconds("normal") != 1.8 || botAITickSeconds("hard") != .9 {
		t.Fatal("wrong difficulty cadence")
	}
	if _, _, err := simulateBotBattleWithDifficulty(nil, DefaultModifiers(), DefaultModifiers(), "crown_cross", 3, "fake"); err == nil || err.Error() != "invalid_bot_difficulty" {
		t.Fatal("invalid difficulty accepted", err)
	}
	easy, _, _ := simulateBotBattleWithDifficulty(nil, DefaultModifiers(), DefaultModifiers(), "crown_cross", 3, "easy")
	hard, _, _ := simulateBotBattleWithDifficulty(nil, DefaultModifiers(), DefaultModifiers(), "crown_cross", 3, "hard")
	if reflect.DeepEqual(easy, hard) {
		t.Fatal("difficulty did not affect replay")
	}
}

func TestBotDifficultyPostgresTicketsAndSettlement(t *testing.T) {
	s, _ := realmTestStore(t)
	ctx := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "a")
	oldPilot, oldRules := pilotRuntime, asyncGameplayRulesVersion
	t.Cleanup(func() { pilotRuntime, asyncGameplayRulesVersion = oldPilot, oldRules })
	pilotRuntime.Enabled = false
	asyncGameplayRulesVersion = 3
	ledgerTotal := 0
	for _, difficulty := range []string{"easy", "normal", "hard"} {
		raw, err := rpcStartBotMatch(s)(ctx, &stubLogger{}, s.db, nil, `{"botDifficulty":"`+difficulty+`","supportedGameplayRulesVersions":[1,2,3]}`)
		if err != nil {
			t.Fatal(err)
		}
		var response struct {
			Ticket BotMatchTicket `json:"ticket"`
		}
		if err = json.Unmarshal([]byte(raw), &response); err != nil {
			t.Fatal(err)
		}
		ticket := response.Ticket
		if ticket.BotDifficulty != difficulty || ticket.GameplayRulesVersion != 3 {
			t.Fatal("wrong ticket", ticket)
		}
		var stored string
		if err = s.db.QueryRow(`SELECT bot_difficulty FROM bot_matches WHERE match_id=$1 AND player_id='a'`, ticket.MatchID).Scan(&stored); err != nil || stored != difficulty {
			t.Fatal("difficulty not pinned", stored, err)
		}
		first, _, err := s.SettleMatchVerified(ctx, "a", ticket.MatchID, nil)
		if err != nil || first.Status != "defeat" {
			t.Fatal("authoritative result", first, err)
		}
		_, expected, err := simulateBotBattleWithDifficulty(nil, UpgradeModifiers(first.PreviousCareer), DefaultModifiers(), ticket.BattlefieldID, ticket.GameplayRulesVersion, difficulty)
		if err != nil || !reflect.DeepEqual(first.Stats, expected.Stats) {
			t.Fatal("settlement ignored pinned difficulty", first.Stats, expected.Stats, err)
		}
		if len(first.LedgerEntries) == 0 {
			t.Fatal("settlement produced no ledger entries")
		}
		ledgerTotal += len(first.LedgerEntries)
		again, _, err := s.SettleMatchVerified(ctx, "a", ticket.MatchID, []PvpAction{{Sequence: 0, SourceID: "p_base", TargetID: "n_center"}})
		if err != nil || !reflect.DeepEqual(first, again) {
			t.Fatal("duplicate settlement", err)
		}
		var count int
		if err = s.db.QueryRow(`SELECT COUNT(*) FROM economy_ledger WHERE player_id='a'`).Scan(&count); err != nil || count != ledgerTotal {
			t.Fatal("duplicate ledger", count, err)
		}
		event := AnalyticsEventRecord{EventID: "difficulty_" + difficulty, Name: "match_start", SessionID: "test", OccurredAt: s.nowFn().UnixMilli(), SchemaVersion: 1, Props: map[string]any{"matchId": ticket.MatchID, "mode": "bot", "source": "menu", "gameplayRulesVersion": 2, "botDifficulty": "normal"}}
		if _, err = s.InsertAnalyticsEvents(ctx, "a", []AnalyticsEventRecord{event}); err != nil {
			t.Fatal(err)
		}
		if err = s.db.QueryRow(`SELECT props->>'botDifficulty' FROM analytics_events WHERE event_id=$1`, event.EventID).Scan(&stored); err != nil || stored != difficulty {
			t.Fatal("forged analytics difficulty was trusted", stored, err)
		}
	}
	if _, err := rpcStartBotMatch(s)(ctx, &stubLogger{}, s.db, nil, `{"botDifficulty":"cheat"}`); err == nil || err.Error() != "invalid_bot_difficulty" {
		t.Fatal("fabricated level accepted", err)
	}
	legacy, err := s.CreateBotMatch(ctx, "b")
	if err != nil || legacy.BotDifficulty != "normal" || legacy.GameplayRulesVersion != 2 {
		t.Fatal("old client default", legacy, err)
	}
	if _, err = s.db.Exec(`INSERT INTO bot_matches(match_id,player_id,battlefield_id) VALUES('legacy_row','c','crown_cross')`); err != nil {
		t.Fatal(err)
	}
	var difficulty string
	if err = s.db.QueryRow(`SELECT bot_difficulty FROM bot_matches WHERE match_id='legacy_row'`).Scan(&difficulty); err != nil || difficulty != "normal" {
		t.Fatal("legacy row default", difficulty, err)
	}
}

func TestBotDifficultyPostgresPracticeResume(t *testing.T) {
	s, now := realmTestStore(t)
	ctx := context.Background()
	ticket, err := s.CreatePilotPracticeWithDifficulty(ctx, "a", "hard", 1, 2, 3)
	if err != nil {
		t.Fatal(err)
	}
	resumed, err := s.CreatePilotPracticeWithDifficulty(ctx, "a", "easy", 1, 2, 3)
	if err != nil || !reflect.DeepEqual(ticket, resumed) {
		t.Fatal("active difficulty changed", resumed, err)
	}
	_, err = s.CreatePilotPractice(ctx, "a", 1, 2, 3)
	requireRealmError(t, err, "client_update_required")
	*now = now.Add(100 * time.Second)
	first, _, err := s.SettlePilotPractice(ctx, "a", ticket.MatchID, []PvpAction{{Sequence: 0, SourceID: "p_base", TargetID: "n_bot_right"}})
	if err != nil {
		t.Fatal(err)
	}
	again, _, err := s.SettlePilotPractice(ctx, "a", ticket.MatchID, nil)
	if err != nil || !reflect.DeepEqual(first, again) {
		t.Fatal("practice duplicate", err)
	}
	next, err := s.CreatePilotPracticeWithDifficulty(ctx, "a", "easy", 1, 2, 3)
	if err != nil || next.MatchID == ticket.MatchID || next.BotDifficulty != "easy" {
		t.Fatal("new level did not apply", next, err)
	}
}
