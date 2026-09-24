package main

// Real-PostgreSQL settlement proofs that go-sqlmock cannot express
// (docs/2v2-architecture.md §9.3, §11 store-test row): row-lock
// serialization, commit-vs-rollback behavior, and stored-settlement
// visibility under CONCURRENT transactions. Skipped unless
// TEST_POSTGRES_DSN is set, e.g.:
//
//	TEST_POSTGRES_DSN='postgres://crownclash:crownclash@127.0.0.1:5432/crownclash?sslmode=disable' \
//	  go test -run TestStoreSettleMatch2v2RealPostgres -v .
//
// The test creates uniquely-named players and match ids and removes every
// row it created, so it never touches production-shaped data.

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	_ "github.com/lib/pq"
)

const pg2v2TestPrefix = "pg2v2test_"

// testPostgresDSN is read once at init so the skip logic stays simple.
var testPostgresDSN = os.Getenv("TEST_POSTGRES_DSN")

func requireTestPostgres(t *testing.T) (*sql.DB, string) {
	t.Helper()
	dsn := testPostgresDSN
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN not set: real-PostgreSQL settlement proofs need a live database")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	db.SetMaxOpenConns(8)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		t.Fatalf("ping postgres: %v", err)
	}
	return db, dsn
}

func pg2v2Request(matchID string, userIDs [live2v2MaxPlayers]string, statuses [live2v2MaxPlayers]string) Settle2v2Request {
	request := Settle2v2Request{
		MatchID:       matchID,
		BattlefieldID: live2v2BattlefieldID,
		ReplayPayload: json.RawMessage(`{"schemaVersion":2,"mode":"2v2","actions":[]}`),
	}
	for slot := range request.Participants {
		request.Participants[slot] = TwoVTwoParticipantOutcome{
			Slot: slot, UserID: userIDs[slot], TeamID: TeamIDForSlot(slot),
			Status: statuses[slot], Stats: MatchStats{MatchDurationSeconds: 42},
		}
	}
	return request
}

func create2v2TestPlayers(ctx context.Context, db *sql.DB, userIDs [live2v2MaxPlayers]string) error {
	for _, userID := range userIDs {
		if _, err := db.ExecContext(ctx, `
			INSERT INTO players (id) VALUES ($1)
			ON CONFLICT (id) DO NOTHING
		`, userID); err != nil {
			return err
		}
	}
	return nil
}

func cleanup2v2TestPlayers(ctx context.Context, db *sql.DB, matchIDs []string, userIDs [live2v2MaxPlayers]string) {
	for _, matchID := range matchIDs {
		_, _ = db.ExecContext(ctx, `DELETE FROM match_replays WHERE match_id = $1`, matchID)
		_, _ = db.ExecContext(ctx, `DELETE FROM match_settlements_multi WHERE match_id = $1`, matchID)
	}
	for _, userID := range userIDs {
		_, _ = db.ExecContext(ctx, `DELETE FROM economy_ledger WHERE player_id = $1 AND id LIKE $2`, userID, pg2v2TestPrefix+"%")
		_, _ = db.ExecContext(ctx, `DELETE FROM player_daily_progress WHERE player_id = $1`, userID)
		_, _ = db.ExecContext(ctx, `DELETE FROM match_settlements_multi WHERE user_id = $1`, userID)
		_, _ = db.ExecContext(ctx, `DELETE FROM players WHERE id = $1`, userID)
	}
}

func count2v2Rows(ctx context.Context, db *sql.DB, query string, args ...interface{}) int {
	var count int
	if err := db.QueryRowContext(ctx, query, args...).Scan(&count); err != nil {
		return -1
	}
	return count
}

// TestStoreSettleMatch2v2RealPostgresSameMatchConcurrent settles ONE match
// from two goroutines at the same time. Exactly one transaction may settle;
// the other must return the stored four rows (fast path under the career
// locks). Economy and daily progress apply exactly once per participant.
func TestStoreSettleMatch2v2RealPostgresSameMatchConcurrent(t *testing.T) {
	db, _ := requireTestPostgres(t)
	defer db.Close()

	var userIDs [live2v2MaxPlayers]string
	for slot := range userIDs {
		userIDs[slot] = fmt.Sprintf("%s%s_same", pg2v2TestPrefix, test2v2UserIDs[slot])
	}
	matchID := pg2v2TestPrefix + "match_same"
	ctx := context.Background()
	if err := RunMigrations(ctx, db); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	cleanup2v2TestPlayers(ctx, db, []string{matchID}, userIDs) // pre-clean leftovers
	if err := create2v2TestPlayers(ctx, db, userIDs); err != nil {
		t.Fatalf("create players: %v", err)
	}
	defer cleanup2v2TestPlayers(ctx, db, []string{matchID}, userIDs)

	request := pg2v2Request(matchID, userIDs, [live2v2MaxPlayers]string{"victory", "victory", "defeat", "defeat"})
	store := NewStore(db)

	const concurrency = 2
	results := make([][]MatchSettlement, concurrency)
	errs := make([]error, concurrency)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for index := 0; index < concurrency; index++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			<-start
			results[index], errs[index] = store.SettleMatch2v2(ctx, request)
		}(index)
	}
	close(start)
	wg.Wait()

	for index := range errs {
		if errs[index] != nil {
			t.Fatalf("concurrent settlement %d failed: %v", index, errs[index])
		}
		if len(results[index]) != live2v2MaxPlayers {
			t.Fatalf("concurrent settlement %d returned %d settlements, want 4", index, len(results[index]))
		}
	}
	// Both callers must observe the SAME stored settlements (the loser saw
	// the committed rows, not its own parallel calculation): identical
	// player ids in identical slot order with identical resulting balances.
	for index := 0; index < live2v2MaxPlayers; index++ {
		if results[0][index].NewCareer.PlayerID != results[1][index].NewCareer.PlayerID ||
			results[0][index].NewCareer.Coins != results[1][index].NewCareer.Coins ||
			results[0][index].NewCareer.MatchesPlayed != results[1][index].NewCareer.MatchesPlayed {
			t.Fatalf("concurrent settlements diverged at slot %d: %+v vs %+v", index, results[0][index].NewCareer, results[1][index].NewCareer)
		}
	}

	// Exactly one settlement row per participant, one replay row, one coin
	// ledger entry per participant (the 1v1 id format would have collided).
	if got := count2v2Rows(ctx, db, `SELECT COUNT(*) FROM match_settlements_multi WHERE match_id = $1`, matchID); got != live2v2MaxPlayers {
		t.Fatalf("match_settlements_multi rows = %d, want 4", got)
	}
	if got := count2v2Rows(ctx, db, `SELECT COUNT(*) FROM match_replays WHERE match_id = $1`, matchID); got != 1 {
		t.Fatalf("match_replays rows = %d, want 1", got)
	}
	for _, userID := range userIDs {
		if got := count2v2Rows(ctx, db, `SELECT COUNT(*) FROM economy_ledger WHERE player_id = $1 AND currency = 'coins' AND id LIKE $2`, userID, matchID+"_%"); got != 1 {
			t.Fatalf("coin ledger rows for %s = %d, want 1", userID, got)
		}
		if got := count2v2Rows(ctx, db, `SELECT COUNT(*) FROM economy_ledger WHERE player_id = $1 AND currency = 'trophies'`, userID); got != 0 {
			t.Fatalf("trophy ledger rows for %s = %d, want 0 (casual)", userID, got)
		}
		if got := count2v2Rows(ctx, db, `SELECT matches_played FROM player_daily_progress WHERE player_id = $1`, userID); got != 1 {
			t.Fatalf("daily matches_played for %s = %d, want exactly 1", userID, got)
		}
	}
}

// TestStoreSettleMatch2v2RealPostgresSharedParticipantNoDeadlock settles two
// DIFFERENT matches sharing one participant concurrently. The ordered
// FOR UPDATE career locking (§9.3) must let both commit without deadlock.
func TestStoreSettleMatch2v2RealPostgresSharedParticipantNoDeadlock(t *testing.T) {
	db, _ := requireTestPostgres(t)
	defer db.Close()

	// User 0 is shared between both matches; the other three differ.
	userIDsA := [live2v2MaxPlayers]string{
		pg2v2TestPrefix + "shared_u0", pg2v2TestPrefix + "a_u1",
		pg2v2TestPrefix + "a_u2", pg2v2TestPrefix + "a_u3",
	}
	userIDsB := [live2v2MaxPlayers]string{
		pg2v2TestPrefix + "shared_u0", pg2v2TestPrefix + "b_u1",
		pg2v2TestPrefix + "b_u2", pg2v2TestPrefix + "b_u3",
	}
	matchA := pg2v2TestPrefix + "match_a"
	matchB := pg2v2TestPrefix + "match_b"
	ctx := context.Background()
	if err := RunMigrations(ctx, db); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	cleanup2v2TestPlayers(ctx, db, []string{matchA, matchB}, userIDsA) // pre-clean leftovers
	for _, userID := range userIDsB {
		if _, err := db.ExecContext(ctx, `DELETE FROM economy_ledger WHERE player_id = $1 AND id LIKE $2`, userID, pg2v2TestPrefix+"%"); err != nil {
			t.Fatalf("pre-clean B: %v", err)
		}
		_, _ = db.ExecContext(ctx, `DELETE FROM player_daily_progress WHERE player_id = $1`, userID)
		_, _ = db.ExecContext(ctx, `DELETE FROM match_settlements_multi WHERE user_id = $1`, userID)
		_, _ = db.ExecContext(ctx, `DELETE FROM players WHERE id = $1`, userID)
	}
	if err := create2v2TestPlayers(ctx, db, userIDsA); err != nil {
		t.Fatalf("create players A: %v", err)
	}
	if err := create2v2TestPlayers(ctx, db, userIDsB); err != nil {
		t.Fatalf("create players B: %v", err)
	}
	defer cleanup2v2TestPlayers(ctx, db, []string{matchA, matchB}, userIDsA)
	defer func(userIDs [live2v2MaxPlayers]string) {
		for _, userID := range userIDs {
			_, _ = db.ExecContext(ctx, `DELETE FROM economy_ledger WHERE player_id = $1 AND id LIKE $2`, userID, pg2v2TestPrefix+"%")
			_, _ = db.ExecContext(ctx, `DELETE FROM player_daily_progress WHERE player_id = $1`, userID)
			_, _ = db.ExecContext(ctx, `DELETE FROM match_settlements_multi WHERE user_id = $1`, userID)
			_, _ = db.ExecContext(ctx, `DELETE FROM players WHERE id = $1`, userID)
		}
	}(userIDsB)

	store := NewStore(db)
	requestA := pg2v2Request(matchA, userIDsA, [live2v2MaxPlayers]string{"victory", "victory", "defeat", "defeat"})
	requestB := pg2v2Request(matchB, userIDsB, [live2v2MaxPlayers]string{"draw", "draw", "draw", "draw"})

	errs := make([]error, 2)
	settlements := make([][]MatchSettlement, 2)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for index, request := range []Settle2v2Request{requestA, requestB} {
		wg.Add(1)
		go func(index int, request Settle2v2Request) {
			defer wg.Done()
			<-start
			settlements[index], errs[index] = store.SettleMatch2v2(ctx, request)
		}(index, request)
	}
	close(start)
	wg.Wait()

	for index, err := range errs {
		if err != nil {
			t.Fatalf("shared-participant settlement %d failed: %v", index, err)
		}
	}
	// Both matches settled fully and independently.
	for _, matchID := range []string{matchA, matchB} {
		if got := count2v2Rows(ctx, db, `SELECT COUNT(*) FROM match_settlements_multi WHERE match_id = $1`, matchID); got != live2v2MaxPlayers {
			t.Fatalf("match %s settlement rows = %d, want 4", matchID, got)
		}
		if got := count2v2Rows(ctx, db, `SELECT COUNT(*) FROM match_replays WHERE match_id = $1`, matchID); got != 1 {
			t.Fatalf("match %s replay rows = %d, want 1", matchID, got)
		}
	}
	// The shared participant advanced exactly once per match: two coin
	// ledger entries with distinct per-match ids, two daily match counts.
	shared := userIDsA[0]
	if got := count2v2Rows(ctx, db, `SELECT COUNT(*) FROM economy_ledger WHERE player_id = $1 AND currency = 'coins' AND id LIKE $2`, shared, pg2v2TestPrefix+"%"); got != 2 {
		t.Fatalf("shared participant coin ledger rows = %d, want 2 (one per match)", got)
	}
	if got := count2v2Rows(ctx, db, `SELECT matches_played FROM player_daily_progress WHERE player_id = $1`, shared); got != 2 {
		t.Fatalf("shared participant daily matches_played = %d, want 2", got)
	}
}
