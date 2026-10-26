package main

import (
	"context"
	"testing"
	"unicode/utf8"
)

func TestSeedBotRosterIsWellFormed(t *testing.T) {
	ids, names := map[string]bool{}, map[string]bool{}
	previous := -1
	for index, bot := range seedBotRoster {
		if ids[bot.ID] || names[bot.Name] {
			t.Errorf("duplicate seed bot %q / %q", bot.ID, bot.Name)
		}
		ids[bot.ID], names[bot.Name] = true, true
		if n := utf8.RuneCountInString(bot.Name); n == 0 || n > 40 {
			t.Errorf("%s name length %d", bot.ID, n)
		}
		if bot.Trophies <= previous {
			t.Errorf("%s trophies %d are not increasing", bot.ID, bot.Trophies)
		}
		previous = bot.Trophies

		garrison, production, speed, treasury := seedBotLevels(index, bot.Trophies)
		for _, level := range []int{garrison, production, speed, treasury} {
			if level < 0 || level > 20 {
				t.Errorf("%s level %d out of range", bot.ID, level)
			}
		}
		commander := seedBotCommander(index, garrison+production+speed+treasury)
		unlock, ok := CommanderUnlockLevel(commander)
		if !ok || unlock > garrison+production+speed+treasury {
			t.Errorf("%s holds commander %s it could not unlock", bot.ID, commander)
		}
	}
}

func TestSeedBotsPostgres(t *testing.T) {
	s, _ := realmTestStore(t)
	ctx := context.Background()
	previous := serverConfig.SeedBots
	t.Cleanup(func() { serverConfig.SeedBots = previous })

	created, err := s.EnsureSeedBots(ctx)
	if err != nil || created != len(seedBotRoster) {
		t.Fatalf("created %d, err %v", created, err)
	}
	if again, err := s.EnsureSeedBots(ctx); err != nil || again != 0 {
		t.Fatalf("second run created %d, err %v", again, err)
	}

	var coins, gems, ledger, defenses int
	if err := s.db.QueryRow(`SELECT COALESCE(SUM(coins),0), COALESCE(SUM(gems),0) FROM players WHERE is_bot`).Scan(&coins, &gems); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM economy_ledger l JOIN players p ON p.id=l.player_id WHERE p.is_bot`).Scan(&ledger); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM realm_defenses d JOIN players p ON p.id=d.player_id WHERE p.is_bot`).Scan(&defenses); err != nil {
		t.Fatal(err)
	}
	if coins != 0 || gems != 0 || ledger != 0 || defenses != len(seedBotRoster) {
		t.Fatalf("bots must hold no currency and publish a defense each: coins=%d gems=%d ledger=%d defenses=%d", coins, gems, ledger, defenses)
	}
	var realBots int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM players WHERE is_bot AND id IN ('a','b','c','d','e','f')`).Scan(&realBots); err != nil || realBots != 0 {
		t.Fatalf("real players flagged as bots: %d %v", realBots, err)
	}

	// A lone real player (everyone else is out of range) is matched with a seed bot.
	serverConfig.SeedBots = true
	for _, id := range []string{"b", "c", "d", "e", "f"} {
		if _, err := s.db.Exec(`UPDATE players SET trophies=5000 WHERE id=$1`, id); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.db.Exec(`UPDATE players SET trophies=100 WHERE id='a'`); err != nil {
		t.Fatal(err)
	}
	ticket, err := s.StartRealmAttack(ctx, "a", RealmStartRequest{Source: "ranked"})
	if err != nil {
		t.Fatal(err)
	}
	if len(ticket.Defender.PlayerID) < 8 || ticket.Defender.PlayerID[:8] != "seedbot_" {
		t.Fatalf("expected a seed bot defender, got %q", ticket.Defender.PlayerID)
	}
	if err := s.AbandonRealmAttack(ctx, "a", ticket.MatchID); err != nil {
		t.Fatal(err)
	}

	// A real defender in range wins over a closer seed bot.
	if _, err := s.db.Exec(`UPDATE players SET trophies=300 WHERE id='b'`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.StartRealmAttack(ctx, "b", RealmStartRequest{Source: "ranked"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE realm_tickets SET state='abandoned' WHERE player_id='b'`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE players SET trophies=290 WHERE id='a'`); err != nil {
		t.Fatal(err)
	}
	realTicket, err := s.StartRealmAttack(ctx, "a", RealmStartRequest{Source: "ranked"})
	if err != nil {
		t.Fatal(err)
	}
	if realTicket.Defender.PlayerID != "b" {
		t.Fatalf("a real defender in range must beat a seed bot, got %q", realTicket.Defender.PlayerID)
	}
	if err := s.AbandonRealmAttack(ctx, "a", realTicket.MatchID); err != nil {
		t.Fatal(err)
	}

	// Disabling the feature hides every seed bot without deleting them.
	serverConfig.SeedBots = false
	if _, err := s.db.Exec(`UPDATE players SET trophies=5000 WHERE id='b'`); err != nil {
		t.Fatal(err)
	}
	_, err = s.StartRealmAttack(ctx, "a", RealmStartRequest{Source: "ranked"})
	requireRealmError(t, err, "no_realm_opponent")
}
