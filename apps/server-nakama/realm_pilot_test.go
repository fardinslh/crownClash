package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestRealmCombatAndRewardPolicies(t *testing.T) {
	levels, mods := realmModifiers([3]int{20, 20, 20}, [3]int{0, 3, 8}, "vanguard", "bounded")
	if levels != [3]int{2, 5, 10} || mods.StartingUnits != 19 || mods.ArmySpeedMultiplier != 1.322 {
		t.Fatalf("bounded power: %+v %+v", levels, mods)
	}
	for _, commander := range []string{"crown_guard", "quartermaster", "vanguard"} {
		a, am := realmModifiers([3]int{20, 20, 20}, [3]int{}, commander, "equal")
		b, bm := realmModifiers([3]int{}, [3]int{20, 20, 20}, commander, "equal")
		if a != b || a != [3]int{} || am != bm {
			t.Fatalf("paid power affected friend: %s", commander)
		}
	}
	c := CreateDefaultCareer("test")
	c.Trophies = 100
	c.CurrentStreak = 7
	c.BestStreak = 9
	c.TreasuryLevel = 20
	for _, source := range []string{"friend", "revenge"} {
		r := realmSettlement(c, "victory", MatchStats{MatchDurationSeconds: 20}, "m", 1, source, true)
		if r.NewCareer.Coins != c.Coins+20 || r.NewCareer.Trophies != 100 || r.NewCareer.CurrentStreak != 7 || len(r.LedgerEntries) != 1 {
			t.Fatalf("social: %+v", r)
		}
		r = realmSettlement(c, "victory", MatchStats{}, "m", 1, source, false)
		if r.NewCareer.Coins != c.Coins || len(r.LedgerEntries) != 0 {
			t.Fatalf("repeat paid: %+v", r)
		}
	}
	r := realmSettlement(c, "victory", MatchStats{MatchDurationSeconds: 20}, "m", 1, "ranked", true)
	if r.NewCareer.Trophies <= c.Trophies || r.Breakdown.TotalCoins <= 20 {
		t.Fatal("ranked reward lost")
	}
	lo, hi := realmDay(time.Date(2026, 10, 11, 21, 0, 0, 0, time.UTC))
	if hi-lo != 86400000 || time.UnixMilli(lo).UTC().Hour() != 20 {
		t.Fatal("Tehran day incorrect")
	}
}
func TestBaleProviderContract(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		switch r.URL.Path {
		case "/botfake/createInvoiceLink":
			if body["provider_token"] != "test-wallet" || body["payload"] != "order-contract" {
				t.Error("invoice binding lost")
			}
			prices := body["prices"].([]any)
			if prices[0].(map[string]any)["amount"] != float64(190000) {
				t.Error("rial price mismatch")
			}
			fmt.Fprint(w, `{"ok":true,"result":"opaque:invoice?x=1"}`)
		case "/botfake/inquireTransaction":
			if body["transaction_id"] != "tx-contract" && body["transaction_id"] != "other" {
				t.Error("wrong inquiry")
			}
			fmt.Fprint(w, `{"ok":true,"result":{"id":"tx-contract","status":"paid","userID":123,"amount":190000}}`)
		default:
			t.Errorf("unexpected API %s", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer server.Close()
	p := &BalePaymentProvider{Token: "fake", WalletToken: "test-wallet", BaseURL: server.URL, Client: server.Client()}
	invoice, err := p.CreateInvoice(context.Background(), CoinOrder{ID: "order-contract", Product: pilotCoinProducts[0]})
	if err != nil || invoice != "opaque:invoice?x=1" {
		t.Fatalf("invoice %s %v", invoice, err)
	}
	transaction, err := p.Inquiry(context.Background(), "tx-contract")
	if err != nil || transaction.UserID.String() != "123" || transaction.Amount != 190000 || calls != 2 {
		t.Fatalf("inquiry %+v %v calls=%d", transaction, err, calls)
	}
	if _, err = p.Inquiry(context.Background(), "other"); err == nil {
		t.Fatal("mismatching transaction accepted")
	}
}
func realmTestStore(t *testing.T) (*Store, *time.Time) {
	t.Helper()
	admin, dsn := requireTestPostgres(t)
	t.Cleanup(func() { admin.Close() })
	schema, err := realmID("realm_test_")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = admin.Exec(`CREATE SCHEMA ` + schema); err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := parsed.Query()
	q.Set("search_path", schema)
	parsed.RawQuery = q.Encode()
	db, err := sql.Open("postgres", parsed.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Close()
		if _, err := admin.Exec(`DROP SCHEMA ` + schema + ` CASCADE`); err != nil {
			t.Error(err)
		}
	})
	if err = RunMigrations(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 12, 9, 0, 0, 0, time.UTC)
	s := NewStore(db)
	s.nowFn = func() time.Time { return now }
	for _, id := range []string{"a", "b", "c", "d", "e", "f"} {
		if _, err = s.GetOrCreateCareer(context.Background(), id); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(`UPDATE players SET tutorial_completed=true,matches_played=3 WHERE id=$1`, id); err != nil {
			t.Fatal(err)
		}
	}
	return s, &now
}
func requireRealmError(t *testing.T, err error, code string) {
	t.Helper()
	if err == nil || !strings.Contains(err.Error(), code) {
		t.Fatalf("expected %s got %v", code, err)
	}
}
func TestRealmPostgresBattleAndQuotas(t *testing.T) {
	s, now := realmTestStore(t)
	ctx := context.Background()
	token, _, err := s.CreateRealmChallenge(ctx, "b")
	if err != nil {
		t.Fatal(err)
	}
	preview, err := s.ResolveRealmChallenge(ctx, "a", token)
	if err != nil {
		t.Fatal(err)
	}
	ticket, err := s.StartRealmAttack(ctx, "a", RealmStartRequest{Source: "friend", Token: token, DefenseVersion: preview.Version, CommanderID: "vanguard"})
	if err != nil {
		t.Fatal(err)
	}
	if ticket.CombatPolicy != "equal" || ticket.PlayerModifiers.StartingUnits != 17 || !ticket.RewardEligible {
		t.Fatalf("ticket %+v", ticket)
	}
	same, err := s.StartRealmAttack(ctx, "a", RealmStartRequest{Source: "ranked"})
	if err != nil || same.MatchID != ticket.MatchID {
		t.Fatal("active battle duplicated")
	}
	if _, err = s.db.Exec(`UPDATE players SET starting_garrison_level=20 WHERE id='a'`); err != nil {
		t.Fatal(err)
	}
	_, err = s.SettleRealmAttack(ctx, "a", ticket.MatchID, nil)
	requireRealmError(t, err, "realm_dispatch_required")
	actions := []PvpAction{{Sequence: 0, AtSeconds: 0, SourceID: "p_base", TargetID: "n_bot_left"}}
	_, err = s.SettleRealmAttack(ctx, "a", ticket.MatchID, actions)
	requireRealmError(t, err, "realm_settlement_too_early")
	*now = now.Add(5 * time.Minute)
	var wg sync.WaitGroup
	results := make(chan RealmResult, 8)
	failures := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := s.SettleRealmAttack(ctx, "a", ticket.MatchID, actions)
			if e != nil {
				failures <- e
			} else {
				results <- r
			}
		}()
	}
	wg.Wait()
	close(results)
	close(failures)
	for e := range failures {
		t.Fatal(e)
	}
	count := 0
	for r := range results {
		count++
		if r.Settlement.NewCareer.Coins != 120 || r.Ticket.PlayerModifiers.StartingUnits != 17 {
			t.Fatalf("settled %+v", r)
		}
	}
	if count != 8 {
		t.Fatalf("only %d results", count)
	}
	var entries int
	if err = s.db.QueryRow(`SELECT COUNT(*) FROM economy_ledger WHERE player_id='a'`).Scan(&entries); err != nil || entries != 1 {
		t.Fatalf("ledger entries %d %v", entries, err)
	}
	_, err = s.SettleRealmAttack(ctx, "b", ticket.MatchID, actions)
	requireRealmError(t, err, "realm_ticket_ownership")
	home, err := s.RealmHome(ctx, "b")
	if err != nil {
		t.Fatal(err)
	}
	if len(home.History) != 1 || !home.History[0].Incoming || !home.History[0].RevengeAvailable {
		t.Fatalf("incoming %+v", home.History)
	}
	revenge, err := s.StartRealmAttack(ctx, "b", RealmStartRequest{Source: "revenge", OriginID: ticket.MatchID, CommanderID: "quartermaster"})
	if err != nil {
		t.Fatal(err)
	}
	if revenge.CombatPolicy != "equal" {
		t.Fatal("revenge changed policy")
	}
	*now = now.Add(5 * time.Minute)
	if _, err = s.SettleRealmAttack(ctx, "b", revenge.MatchID, actions); err != nil {
		t.Fatal(err)
	}
	_, err = s.StartRealmAttack(ctx, "b", RealmStartRequest{Source: "revenge", OriginID: ticket.MatchID})
	if err == nil {
		t.Fatal("second revenge accepted")
	}
	repeat, err := s.StartRealmAttack(ctx, "a", RealmStartRequest{Source: "friend", Token: token})
	if err != nil {
		t.Fatal(err)
	}
	if repeat.RewardEligible {
		t.Fatal("pair quota bypass")
	}
	if err = s.AbandonRealmAttack(ctx, "a", repeat.MatchID); err != nil {
		t.Fatal(err)
	}
	for _, defender := range []string{"c", "d", "e"} {
		token, _, err := s.CreateRealmChallenge(ctx, defender)
		if err != nil {
			t.Fatal(err)
		}
		battle, err := s.StartRealmAttack(ctx, "a", RealmStartRequest{Source: "friend", Token: token})
		if err != nil {
			t.Fatal(err)
		}
		*now = now.Add(5 * time.Minute)
		r, err := s.SettleRealmAttack(ctx, "a", battle.MatchID, actions)
		if err != nil {
			t.Fatal(err)
		}
		if r.Rewarded != (defender != "e") {
			t.Fatalf("social quota %s rewarded=%v", defender, r.Rewarded)
		}
	}
	c, err := s.GetOrCreateCareer(ctx, "a")
	if err != nil || c.Coins != 160 || c.Trophies != 0 {
		t.Fatalf("final career %+v %v", c, err)
	}
}
func TestCoinPostgresVerificationRecoveryAndRefund(t *testing.T) {
	s, _ := realmTestStore(t)
	ctx := context.Background()
	if err := s.SetRealmGoal(ctx, "a", "starting_garrison"); err != nil {
		t.Fatal(err)
	}
	order, err := s.CreateCoinOrder(ctx, "a", "123", "coin-order-0000000001", "starter")
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.CreateCoinOrder(ctx, "b", "456", order.ID, "starter")
	requireRealmError(t, err, "coin_order_ownership")
	providerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "createInvoiceLink") {
			fmt.Fprint(w, `{"ok":true,"result":"unchanged-invoice"}`)
		} else {
			fmt.Fprint(w, `{"ok":true,"result":{"id":"payment-1","status":"paid","userID":123,"amount":190000}}`)
		}
	}))
	defer providerServer.Close()
	p := &BalePaymentProvider{Token: "fake", WalletToken: "fake", BaseURL: providerServer.URL, Client: providerServer.Client()}
	order, err = s.EnsureCoinInvoice(ctx, "a", order.ID, p)
	if err != nil || order.State != "pending" {
		t.Fatalf("invoice %+v %v", order, err)
	}
	_, err = s.VerifyCoinReceipt(ctx, p, order.ID, "payment-1", "123", 190000, "IRR")
	requireRealmError(t, err, "coin_transaction_mismatch")
	if err = s.bindCoinCheckout(ctx, p, order.ID, "payment-1", "123", "IRR", 190000); err != nil {
		t.Fatal(err)
	}
	_, err = s.VerifyCoinReceipt(ctx, p, order.ID, "payment-1", "123", 1, "IRR")
	requireRealmError(t, err, "coin_payment_not_verified")
	var wg sync.WaitGroup
	failures := make(chan error, 10)
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			o, e := s.RecoverCoinOrder(ctx, "a", order.ID, p)
			if e != nil {
				failures <- e
			} else if o.State != "fulfilled" {
				failures <- fmt.Errorf("not fulfilled: %s", o.State)
			}
		}()
	}
	wg.Wait()
	close(failures)
	for e := range failures {
		t.Fatal(e)
	}
	c, err := s.GetOrCreateCareer(ctx, "a")
	if err != nil || c.Coins != 850 {
		t.Fatalf("credited %+v %v", c, err)
	}
	var count int
	if err = s.db.QueryRow(`SELECT COUNT(*) FROM economy_ledger WHERE reason='coin_purchase'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("purchase ledger %d %v", count, err)
	}
	_, err = s.CreateCoinOrder(ctx, "a", "123", "coin-order-0000000002", "starter")
	requireRealmError(t, err, "coin_starter_already_purchased")
	if err = s.RecordCoinRefund(ctx, order.ID, "receipt-refund-1", "confirmed wallet refund"); err != nil {
		t.Fatal(err)
	}
	if err = s.RecordCoinRefund(ctx, order.ID, "receipt-refund-1", "confirmed wallet refund"); err != nil {
		t.Fatal(err)
	}
	c, err = s.GetOrCreateCareer(ctx, "a")
	if err != nil || c.Coins != 100 {
		t.Fatalf("refund %+v %v", c, err)
	}
	_, err = s.VerifyCoinReceipt(ctx, p, order.ID, "payment-1", "123", 190000, "IRR")
	if err != nil {
		t.Fatal(err)
	}
	c, err = s.GetOrCreateCareer(ctx, "a")
	if err != nil || c.Coins != 100 {
		t.Fatal("refund recredited by receipt retry")
	}
}

func TestRealmPostgresConcurrencyExpiryAndPractice(t *testing.T) {
	s, now := realmTestStore(t)
	ctx := context.Background()
	for _, id := range []string{"a", "b"} {
		if _, err := s.RealmHome(ctx, id); err != nil {
			t.Fatal(err)
		}
	}
	var wg sync.WaitGroup
	failures := make(chan error, 2)
	tickets := make(chan RealmTicket, 2)
	for _, id := range []string{"a", "b"} {
		wg.Add(1)
		go func(user string) {
			defer wg.Done()
			r, e := s.StartRealmAttack(ctx, user, RealmStartRequest{Source: "ranked"})
			if e != nil {
				failures <- e
			} else {
				tickets <- r
			}
		}(id)
	}
	wg.Wait()
	close(failures)
	close(tickets)
	for e := range failures {
		t.Fatal(e)
	}
	count := 0
	for r := range tickets {
		count++
		if r.CombatPolicy != "bounded" {
			t.Fatal("ranked power")
		}
	}
	if count != 2 {
		t.Fatal("reciprocal start incomplete")
	}
	if _, err := s.db.Exec(`UPDATE players SET trophies=100 WHERE id IN ('a','b')`); err != nil {
		t.Fatal(err)
	}
	*now = now.Add(16 * time.Minute)
	for i := 0; i < 2; i++ {
		home, err := s.RealmHome(ctx, "a")
		if err != nil {
			t.Fatal(err)
		}
		if home.ActiveTicket != nil {
			t.Fatal("expired battle still active")
		}
	}
	career, err := s.GetOrCreateCareer(ctx, "a")
	if err != nil || career.Trophies != 88 || career.Coins != 100 {
		t.Fatalf("expiry %+v %v", career, err)
	}
	practice, err := s.CreatePilotPractice(ctx, "a")
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := s.CreatePilotPractice(ctx, "a")
	if err != nil || repeated.MatchID != practice.MatchID {
		t.Fatal("duplicate practice")
	}
	_, err = s.StartRealmAttack(ctx, "a", RealmStartRequest{Source: "ranked"})
	requireRealmError(t, err, "realm_practice_active")
	if _, err = s.db.Exec(`UPDATE players SET starting_garrison_level=20 WHERE id='a'`); err != nil {
		t.Fatal(err)
	}
	actions := []PvpAction{{Sequence: 0, AtSeconds: 0, SourceID: "p_base", TargetID: "n_bot_left"}}
	*now = now.Add(5 * time.Minute)
	result, diagnostics, err := s.SettlePilotPractice(ctx, "a", practice.MatchID, actions)
	if err != nil {
		t.Fatal(err)
	}
	if diagnostics == nil || diagnostics.Modifiers.StartingUnits != 20 || result.NewCareer.Trophies != 88 || result.Breakdown.TotalCoins <= 0 {
		t.Fatalf("practice %+v %+v", result, diagnostics)
	}
	retry, _, err := s.SettlePilotPractice(ctx, "a", practice.MatchID, actions)
	if err != nil || retry.NewCareer.Coins != result.NewCareer.Coins {
		t.Fatal("duplicate practice rewarded")
	}
}

func TestRealmParityFixtures(t *testing.T) {
	file := os.Getenv("REALM_PARITY_FIXTURE")
	if file == "" {
		t.Skip("run npm run build and node scripts/realm-balance.mjs; set REALM_PARITY_FIXTURE to its output")
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Battles []struct {
			Policy          string
			BattlefieldID   string `json:"battlefieldId"`
			Commander       string
			Defender        string
			Own             [3]int
			Enemy           [3]int
			PlayerModifiers PlayerUpgradeModifiers `json:"playerModifiers"`
			EnemyModifiers  PlayerUpgradeModifiers `json:"enemyModifiers"`
			Actions         []PvpAction
			Status          string
			Stats           MatchStats
		}
	}
	if err = json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	if len(fixtures.Battles) != 270 {
		t.Fatalf("expected 270 fixtures, got %d", len(fixtures.Battles))
	}
	for i, f := range fixtures.Battles {
		_, pm := realmModifiers(f.Own, f.Enemy, f.Commander, f.Policy)
		_, em := realmModifiers(f.Enemy, f.Own, f.Defender, f.Policy)
		if pm != f.PlayerModifiers || em != f.EnemyModifiers {
			t.Fatalf("modifier parity %d %+v %+v", i, pm, f.PlayerModifiers)
		}
		_, summary, err := simulateBattleWithRules(f.Actions, pm, em, f.BattlefieldID, 2)
		if err != nil {
			t.Fatalf("fixture %d %v", i, err)
		}
		if summary.ActionsProcessed != 1 {
			t.Fatalf("fixture %d opening not processed", i)
		}
		if summary.Status != f.Status || summary.Stats != f.Stats {
			t.Fatalf("combat parity %d server=%+v client=%s %+v", i, summary, f.Status, f.Stats)
		}
	}
}

func TestRealmPostgresTemporaryCommandersDoNotGrantOwnership(t *testing.T) {
	s, _ := realmTestStore(t)
	ctx := context.Background()
	token, _, err := s.CreateRealmChallengeWithCommander(ctx, "b", "vanguard")
	if err != nil {
		t.Fatal(err)
	}
	defense, err := s.ResolveRealmChallenge(ctx, "a", token)
	if err != nil || defense.CommanderID != "vanguard" {
		t.Fatalf("friend defense %+v %v", defense, err)
	}
	c, err := s.GetOrCreateCareer(ctx, "b")
	if err != nil || c.SelectedCommanderID != "crown_guard" || c.StartingGarrisonLevel != 0 {
		t.Fatal("temporary defense granted progression")
	}
	if err = s.SetPilotLiveLoadout(ctx, "b", "quartermaster"); err != nil {
		t.Fatal(err)
	}
	live, err := s.pilotLiveCareer(ctx, c)
	if err != nil || live.SelectedCommanderID != "quartermaster" || UpgradeModifiers(live).StartingUnits != 20 {
		t.Fatalf("live loadout %+v %v", live, err)
	}
	saved, err := s.GetOrCreateCareer(ctx, "b")
	if err != nil || saved.SelectedCommanderID != "crown_guard" {
		t.Fatal("temporary live commander persisted as owned")
	}
	requireRealmError(t, s.SetPilotLiveLoadout(ctx, "b", "fake"), "invalid_commander")
}

func TestRealmPostgresPinsTreasuryRewardDuringBattle(t *testing.T) {
	s, now := realmTestStore(t)
	ctx := context.Background()
	if _, err := s.RealmHome(ctx, "b"); err != nil {
		t.Fatal(err)
	}
	battle, err := s.StartRealmAttack(ctx, "a", RealmStartRequest{Source: "ranked"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`UPDATE players SET treasury_level=20 WHERE id='a'`); err != nil {
		t.Fatal(err)
	}
	*now = now.Add(5 * time.Minute)
	result, err := s.SettleRealmAttack(ctx, "a", battle.MatchID, []PvpAction{{Sequence: 0, AtSeconds: 0, SourceID: "p_base", TargetID: "n_bot_left"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Settlement.Breakdown.TreasuryBonus != 0 || result.Settlement.NewCareer.TreasuryLevel != 20 {
		t.Fatalf("reward rebalanced or purchased progression lost: %+v", result.Settlement)
	}
}

func TestRealmPostgresCohortRevenueAndReturnWindows(t *testing.T) {
	s, _ := realmTestStore(t)
	ctx := context.Background()
	if _, err := s.db.Exec(`CREATE TABLE users(id TEXT PRIMARY KEY,custom_id TEXT);INSERT INTO users VALUES('a','bale:123'),('b','browser:456');
 INSERT INTO pilot_visits(id,player_id,campaign,received_at) VALUES('cohort-a','a','ad_growth',now()-interval '40 days'),('cohort-b','b','ad_growth',now()-interval '40 days');
 INSERT INTO pilot_visits(id,player_id,campaign,received_at) SELECT 'return-d1','a','direct',received_at+interval '1 day' FROM pilot_visits WHERE id='cohort-a';
 INSERT INTO pilot_visits(id,player_id,campaign,received_at) SELECT 'return-d7','a','direct',received_at+interval '7 days' FROM pilot_visits WHERE id='cohort-a';
 INSERT INTO match_settlements(match_id,player_id,status,settlement,created_at) SELECT 'cohort-match','a','victory','{}',received_at+interval '1 hour' FROM pilot_visits WHERE id='cohort-a';
 INSERT INTO realm_tickets(id,player_id,defender_id,source,document,state,result,created_at,expires_at) VALUES('cohort-match','a','b','ranked','{}','settled','{}',0,900000);
 INSERT INTO coin_orders(id,player_id,external_id,product_id,coins,amount_rials,state,created_at,fulfilled_at,test_mode)
 SELECT 'cohort-paid','a','123','starter',750,190000,'fulfilled',0,extract(epoch FROM received_at+interval '2 days')*1000,false FROM pilot_visits WHERE id='cohort-a';
 INSERT INTO coin_orders(id,player_id,external_id,product_id,coins,amount_rials,state,created_at,fulfilled_at,test_mode)
 SELECT 'cohort-test','a','123','refill',1500,490000,'fulfilled',0,extract(epoch FROM received_at+interval '2 days')*1000,true FROM pilot_visits WHERE id='cohort-a';
 INSERT INTO coin_orders(id,player_id,external_id,product_id,coins,amount_rials,state,created_at,fulfilled_at,test_mode)
 SELECT 'cohort-refund','a','123','refill',1500,490000,'refunded',0,extract(epoch FROM received_at+interval '3 days')*1000,false FROM pilot_visits WHERE id='cohort-a';`); err != nil {
		t.Fatal(err)
	}
	query, err := os.ReadFile("../../docs/analytics/realm-cohorts.sql")
	if err != nil {
		t.Fatal(err)
	}
	var raw []byte
	if err = s.db.QueryRowContext(ctx, string(query)).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var report struct {
		Cohorts []struct {
			Authenticated int
			Activated     int
			FirstComplete int `json:"first_complete"`
			D1            int `json:"d1_returned"`
			D7            int `json:"d7_returned"`
			Payers7       int `json:"payers7"`
			Buyers30      int `json:"buyers30"`
			Repeat30      int `json:"repeat_buyers30"`
			Net           int `json:"net_revenue30_rials"`
		}
	}
	if err = json.Unmarshal(raw, &report); err != nil {
		t.Fatal(err)
	}
	if len(report.Cohorts) != 1 {
		t.Fatalf("expected one Bale cohort: %s", raw)
	}
	c := report.Cohorts[0]
	if c.Authenticated != 1 || c.Activated != 1 || c.FirstComplete != 1 || c.D1 != 1 || c.D7 != 1 || c.Payers7 != 1 || c.Buyers30 != 1 || c.Repeat30 != 1 || c.Net != 190000 {
		t.Fatalf("invalid cohort or test/refund revenue counted: %s", raw)
	}
}
