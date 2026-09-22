package main

// Unit tests for the secure ticket-pinning hook and the single matched
// router (docs/2v2-architecture.md §3.2.2, §3.2.3).

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
)

// fakePresence implements runtime.Presence.
type fakePresence struct {
	userID    string
	sessionID string
}

func (p fakePresence) GetUserId() string             { return p.userID }
func (p fakePresence) GetSessionId() string          { return p.sessionID }
func (p fakePresence) GetNodeId() string             { return "" }
func (p fakePresence) GetHidden() bool               { return false }
func (p fakePresence) GetPersistence() bool          { return false }
func (p fakePresence) GetUsername() string           { return "" }
func (p fakePresence) GetStatus() string             { return "" }
func (p fakePresence) GetReason() runtime.PresenceReason { return 0 }

// fakeMatchmakerEntry implements runtime.MatchmakerEntry.
type fakeMatchmakerEntry struct {
	presence   runtime.Presence
	properties map[string]interface{}
}

func (e fakeMatchmakerEntry) GetPresence() runtime.Presence     { return e.presence }
func (e fakeMatchmakerEntry) GetTicket() string                 { return "" }
func (e fakeMatchmakerEntry) GetProperties() map[string]interface{} { return e.properties }
func (e fakeMatchmakerEntry) GetPartyId() string                { return "" }
func (e fakeMatchmakerEntry) GetCreateTime() int64              { return 0 }

func testEnvelopeWithTicket(add *rtapi.MatchmakerAdd) *rtapi.Envelope {
	return &rtapi.Envelope{Message: &rtapi.Envelope_MatchmakerAdd{MatchmakerAdd: add}}
}

func careerQueryMocks(mock sqlmock.Sqlmock, userID string, trophies int) {
	mock.ExpectExec("INSERT INTO players").
		WithArgs(userID, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	rows := sqlmock.NewRows([]string{
		"id", "coins", "gems", "trophies",
		"starting_garrison_level", "production_level", "army_speed_level", "treasury_level", "selected_commander",
		"matches_played", "matches_won", "current_streak", "best_streak", "last_match_timestamp",
	}).AddRow(userID, 100, 10, trophies, 0, 0, 0, 0, "crown_guard", 0, 0, 0, 0, 0)
	mock.ExpectQuery("SELECT id, coins, gems, trophies").
		WithArgs(userID).
		WillReturnRows(rows)
}

func TestBeforeMatchmakerAddRewrites1v1TicketWithAuthoritativeProperties(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db)
	careerQueryMocks(mock, "user_1", 275)

	add := &rtapi.MatchmakerAdd{
		MinCount: 2,
		MaxCount: 2,
		// A lying/malicious client-supplied query and rating must be discarded.
		// The legacy 1v1 client declares no mode at all.
		Query:             "+properties.mode:2v2 +properties.schema:2",
		NumericProperties: map[string]float64{"rating": 99999},
	}
	ctx := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "user_1")
	logger := &stubLogger{}

	envelope, err := beforeMatchmakerAdd(store)(ctx, logger, db, nil, testEnvelopeWithTicket(add))
	if err != nil {
		t.Fatalf("1v1 ticket rewrite failed: %v", err)
	}
	pinned := envelope.GetMatchmakerAdd()
	if pinned == nil {
		t.Fatal("envelope lost its MatchmakerAdd message")
	}
	if pinned.GetMinCount() != 2 || pinned.GetMaxCount() != 2 {
		t.Fatalf("1v1 ticket counts = %d/%d, want 2/2", pinned.GetMinCount(), pinned.GetMaxCount())
	}
	if pinned.GetQuery() != matchmaker1v1Query {
		t.Fatalf("1v1 ticket query = %q, want %q", pinned.GetQuery(), matchmaker1v1Query)
	}
	if pinned.GetStringProperties()["mode"] != "1v1" || pinned.GetStringProperties()["schema"] != "1" {
		t.Fatalf("1v1 ticket properties = %v, want mode=1v1 schema=1", pinned.GetStringProperties())
	}
	if pinned.GetNumericProperties()["rating"] != 275 {
		t.Fatalf("1v1 ticket rating = %v, want server-read 275", pinned.GetNumericProperties()["rating"])
	}
	if pinned.GetCountMultiple() != nil {
		t.Fatal("count multiple must be cleared")
	}
}

func TestBeforeMatchmakerAddRewrites2v2TicketWithAuthoritativeProperties(t *testing.T) {
	serverConfig.Enable2v2 = true
	defer func() { serverConfig.Enable2v2 = false }()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db)
	careerQueryMocks(mock, "user_2", 42)

	add := &rtapi.MatchmakerAdd{MinCount: 4, MaxCount: 4}
	ctx := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "user_2")

	envelope, err := beforeMatchmakerAdd(store)(ctx, &stubLogger{}, db, nil, testEnvelopeWithTicket(add))
	if err != nil {
		t.Fatalf("2v2 ticket rewrite failed: %v", err)
	}
	pinned := envelope.GetMatchmakerAdd()
	if pinned.GetMinCount() != 4 || pinned.GetMaxCount() != 4 {
		t.Fatalf("2v2 ticket counts = %d/%d, want 4/4", pinned.GetMinCount(), pinned.GetMaxCount())
	}
	if pinned.GetQuery() != matchmaker2v2Query {
		t.Fatalf("2v2 ticket query = %q, want %q", pinned.GetQuery(), matchmaker2v2Query)
	}
	if pinned.GetStringProperties()["mode"] != "2v2" || pinned.GetStringProperties()["schema"] != "2" {
		t.Fatalf("2v2 ticket properties = %v", pinned.GetStringProperties())
	}
	if pinned.GetNumericProperties()["rating"] != 42 {
		t.Fatalf("2v2 ticket rating = %v, want server-read 42", pinned.GetNumericProperties()["rating"])
	}
}

func TestBeforeMatchmakerAddRejectsWhenFlagDisabledAndCrossModeImpossible(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db)
	serverConfig.Enable2v2 = false
	defer func() { serverConfig.Enable2v2 = false }()
	hook := beforeMatchmakerAdd(store)
	ctx := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "user_3")

	// 2v2 tickets are rejected outright while the flag is off; the career is
	// never even read.
	add := &rtapi.MatchmakerAdd{MinCount: 4, MaxCount: 4}
	if _, err := hook(ctx, &stubLogger{}, db, nil, testEnvelopeWithTicket(add)); err == nil {
		t.Fatal("2v2 ticket accepted while ENABLE_2V2 is disabled")
	}

	// 1v1 tickets keep flowing (pinning happens for them).
	serverConfig.Enable2v2 = false
	careerQueryMocks(mock, "user_3", 5)
	oneVone := &rtapi.MatchmakerAdd{MinCount: 2, MaxCount: 2}
	if _, err := hook(ctx, &stubLogger{}, db, nil, testEnvelopeWithTicket(oneVone)); err != nil {
		t.Fatalf("1v1 ticket rejected: %v", err)
	}
	pinned := oneVone
	if pinned.GetQuery() != matchmaker1v1Query || pinned.GetStringProperties()["mode"] != "1v1" {
		t.Fatalf("1v1 ticket not pinned for isolation: %q / %v", pinned.GetQuery(), pinned.GetStringProperties())
	}
}

func TestBeforeMatchmakerAddRejectsInvalidShapes(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db)
	hook := beforeMatchmakerAdd(store)
	ctx := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "user_4")

	for name, add := range map[string]*rtapi.MatchmakerAdd{
		"unknown declared mode": {MinCount: 4, MaxCount: 4, StringProperties: map[string]string{"mode": "3v3"}},
		"contradictory counts":  {MinCount: 4, MaxCount: 4, StringProperties: map[string]string{"mode": "1v1"}},
	} {
		serverConfig.Enable2v2 = true
		if _, err := hook(ctx, &stubLogger{}, db, nil, testEnvelopeWithTicket(add)); err == nil {
			t.Fatalf("%s: ticket unexpectedly accepted", name)
		}
	}
}

func TestRouteMatchmakerGroupRoutes1v1ToLiveMatch(t *testing.T) {
	serverConfig.Enable2v2 = false
	created := ""
	create := func(ctx context.Context, moduleName string, params map[string]interface{}) (string, error) {
		created = moduleName
		return "match-1", nil
	}
	entries := []runtime.MatchmakerEntry{
		fakeMatchmakerEntry{presence: fakePresence{userID: "a"}, properties: map[string]interface{}{"mode": "1v1", "schema": "1"}},
		fakeMatchmakerEntry{presence: fakePresence{userID: "b"}, properties: map[string]interface{}{"mode": "1v1", "schema": "1"}},
	}
	if _, err := routeMatchmakerGroup(context.Background(), &stubLogger{}, entries, create); err != nil {
		t.Fatalf("1v1 route failed: %v", err)
	}
	if created != "live_match" {
		t.Fatalf("1v1 group created %q, want live_match", created)
	}
}

func TestRouteMatchmakerGroupRoutes2v2ToLiveMatch2v2(t *testing.T) {
	serverConfig.Enable2v2 = true
	defer func() { serverConfig.Enable2v2 = false }()
	created := ""
	create := func(ctx context.Context, moduleName string, params map[string]interface{}) (string, error) {
		created = moduleName
		return "match-2", nil
	}
	entries := make([]runtime.MatchmakerEntry, 0, 4)
	for _, userID := range []string{"p0", "p1", "p2", "p3"} {
		entries = append(entries, fakeMatchmakerEntry{
			presence:   fakePresence{userID: userID},
			properties: map[string]interface{}{"mode": "2v2", "schema": "2"},
		})
	}
	if _, err := routeMatchmakerGroup(context.Background(), &stubLogger{}, entries, create); err != nil {
		t.Fatalf("2v2 route failed: %v", err)
	}
	if created != "live_match_2v2" {
		t.Fatalf("2v2 group created %q, want live_match_2v2", created)
	}
}

func TestRouteMatchmakerGroupRejectsCrossModeGroups(t *testing.T) {
	serverConfig.Enable2v2 = true
	defer func() { serverConfig.Enable2v2 = false }()

	twoVTwoProps := map[string]interface{}{"mode": "2v2", "schema": "2"}
	oneVOneProps := map[string]interface{}{"mode": "1v1", "schema": "1"}

	groups := map[string][]runtime.MatchmakerEntry{
		// 2v2 tickets consumed by a 1v1-sized group.
		"three 2v2 entries": {
			fakeMatchmakerEntry{properties: twoVTwoProps}, fakeMatchmakerEntry{properties: twoVTwoProps},
			fakeMatchmakerEntry{properties: twoVTwoProps},
		},
		// mixed modes
		"mixed modes": {
			fakeMatchmakerEntry{properties: twoVTwoProps}, fakeMatchmakerEntry{properties: twoVTwoProps},
			fakeMatchmakerEntry{properties: oneVOneProps}, fakeMatchmakerEntry{properties: twoVTwoProps},
		},
		// a 1v1 entry slipping into a 2v2 group with only 2 members of 2v2
		"two 2v2 entries": {fakeMatchmakerEntry{properties: twoVTwoProps}, fakeMatchmakerEntry{properties: twoVTwoProps}},
		// missing properties entirely (a raw 1v1-shaped ticket that skipped the hook)
		"missing properties": {fakeMatchmakerEntry{}, fakeMatchmakerEntry{}},
		// unknown mode
		"unknown mode": {
			fakeMatchmakerEntry{properties: map[string]interface{}{"mode": "3v3", "schema": "2"}},
			fakeMatchmakerEntry{properties: map[string]interface{}{"mode": "3v3", "schema": "2"}},
			fakeMatchmakerEntry{properties: map[string]interface{}{"mode": "3v3", "schema": "2"}},
			fakeMatchmakerEntry{properties: map[string]interface{}{"mode": "3v3", "schema": "2"}},
		},
	}

	for name, entries := range groups {
		created := false
		create := func(ctx context.Context, moduleName string, params map[string]interface{}) (string, error) {
			created = true
			return "should-not-exist", nil
		}
		if _, err := routeMatchmakerGroup(context.Background(), &stubLogger{}, entries, create); err == nil {
			t.Fatalf("%s: group unexpectedly accepted", name)
		}
		if created {
			t.Fatalf("%s: match was created on rejection", name)
		}
	}
}

// stubLogger satisfies runtime.Logger for unit tests.
type stubLogger struct{}

func (l *stubLogger) WithField(string, interface{}) runtime.Logger          { return l }
func (l *stubLogger) WithFields(map[string]interface{}) runtime.Logger      { return l }
func (l *stubLogger) Fields() map[string]interface{}                        { return nil }
func (l *stubLogger) Error(format string, v ...interface{})                 {}
func (l *stubLogger) Warn(format string, v ...interface{})                  {}
func (l *stubLogger) Info(format string, v ...interface{})                  {}
func (l *stubLogger) Debug(format string, v ...interface{})                 {}
func (l *stubLogger) Flush()                                                {}

var _ runtime.Logger = &stubLogger{}
