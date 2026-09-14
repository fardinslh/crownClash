package main

// Focused diagnostics tests for the bot result status mismatch warning.
// clientObservedStatus is untrusted diagnostic-only data: these tests pin
// that it can never influence the authoritative settlement, and that a
// mismatch produces exactly one structured warning with the evidence
// needed to diagnose real client/server divergences.

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
)

type loggerSink struct {
	messages []string
	warnings []map[string]interface{}
}

type recordingLogger struct {
	fields map[string]interface{}
	sink   *loggerSink
}

func newRecordingLogger() *recordingLogger {
	return &recordingLogger{fields: map[string]interface{}{}, sink: &loggerSink{}}
}

func (l *recordingLogger) child() *recordingLogger {
	next := &recordingLogger{fields: map[string]interface{}{}, sink: l.sink}
	for key, value := range l.fields {
		next.fields[key] = value
	}
	return next
}

func (l *recordingLogger) Debug(format string, v ...interface{}) {}
func (l *recordingLogger) Info(format string, v ...interface{})  {}
func (l *recordingLogger) Error(format string, v ...interface{}) {}
func (l *recordingLogger) Warn(format string, v ...interface{}) {
	l.sink.messages = append(l.sink.messages, fmt.Sprintf(format, v...))
	fields := map[string]interface{}{}
	for key, value := range l.fields {
		fields[key] = value
	}
	l.sink.warnings = append(l.sink.warnings, fields)
}
func (l *recordingLogger) WithField(key string, v interface{}) runtime.Logger {
	next := l.child()
	next.fields[key] = v
	return next
}
func (l *recordingLogger) WithFields(fields map[string]interface{}) runtime.Logger {
	next := l.child()
	for key, value := range fields {
		next.fields[key] = value
	}
	return next
}
func (l *recordingLogger) Fields() map[string]interface{} { return l.fields }

type fakeNakama struct {
	runtime.NakamaModule
	trophySubmissions []int64
}

func (n *fakeNakama) LeaderboardRecordWrite(ctx context.Context, id, ownerID, username string, score, subscore int64, metadata map[string]interface{}, config *int) (*api.LeaderboardRecord, error) {
	n.trophySubmissions = append(n.trophySubmissions, score)
	return nil, nil
}

func authedContext(userID string) context.Context {
	return context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, userID)
}

const diagMatchID = "bot_diag_match_1"

func newDiagStore(t *testing.T) (*Store, sqlmock.Sqlmock, *fakeNakama, *recordingLogger) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewStore(db), mock, &fakeNakama{}, newRecordingLogger()
}

// expectFreshSettlement wires sqlmock for one full fresh bot settlement of
// diagMatchID on crown_cross with the given career row values.
func expectFreshSettlement(t *testing.T, mock sqlmock.Sqlmock, userID string, careerRow *sqlmock.Rows) {
	t.Helper()
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT settlement FROM match_settlements WHERE match_id = $1")).
		WithArgs(diagMatchID).
		WillReturnRows(sqlmock.NewRows([]string{"settlement"}))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT player_id, battlefield_id")).
		WithArgs(diagMatchID).
		WillReturnRows(sqlmock.NewRows([]string{"player_id", "battlefield_id"}).AddRow(userID, "crown_cross"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM players WHERE id = $1 FOR UPDATE")).
		WithArgs(userID).
		WillReturnRows(careerRow)
	// A concurrent-settlement re-check runs after the career row lock.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT settlement FROM match_settlements WHERE match_id = $1")).
		WithArgs(diagMatchID).
		WillReturnRows(sqlmock.NewRows([]string{"settlement"}))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE players SET")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO economy_ledger")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO match_settlements")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO player_daily_progress")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE bot_matches SET settled_at = now()")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
}

func defaultCareerRow(userID string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "coins", "gems", "trophies", "starting_garrison_level", "production_level",
		"army_speed_level", "treasury_level", "selected_commander", "matches_played",
		"matches_won", "current_streak", "best_streak", "last_match_timestamp",
	}).AddRow(userID, 100, 10, 0, 0, 0, 0, 0, "crown_guard", 0, 0, 0, 0, 0)
}

// leveledCareerRow carries non-default upgrade levels so the logged modifier
// snapshot cannot pass by hardcoding the default 20/1.0/1.0 values.
// UpgradeModifiers for these levels: 20+3*3=29 units, 1+2*0.08=1.16 prod,
// 1+1*0.06=1.06 speed.
func leveledCareerRow(userID string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "coins", "gems", "trophies", "starting_garrison_level", "production_level",
		"army_speed_level", "treasury_level", "selected_commander", "matches_played",
		"matches_won", "current_streak", "best_streak", "last_match_timestamp",
	}).AddRow(userID, 100, 10, 0, 3, 2, 1, 0, "crown_guard", 0, 0, 0, 0, 0)
}

func settlePayloadWithActions(clientStatus string, actions []PvpAction) string {
	payload, err := json.Marshal(map[string]interface{}{
		"matchId":              diagMatchID,
		"actions":              actions,
		"clientObservedStatus": clientStatus,
	})
	if err != nil {
		panic(err)
	}
	return string(payload)
}

func settlePayload(clientStatus string) string {
	return settlePayloadWithActions(clientStatus, []PvpAction{})
}

// mismatchProbeAction is structurally valid (sequence 0, finite timestamp
// inside the match window) but replay-invalid: the source territory does not
// exist, so the authoritative engine skips it without processing it.
var mismatchProbeAction = PvpAction{
	Sequence:  0,
	AtSeconds: 2,
	SourceID:  "no_such_territory",
	TargetID:  "n_center",
}

func TestSettleMatchLogsOneStructuredWarningOnStatusMismatch(t *testing.T) {
	store, mock, nk, logger := newDiagStore(t)
	expectFreshSettlement(t, mock, "diag_player", leveledCareerRow("diag_player"))

	handler := rpcSettleMatch(store, nk)
	response, err := handler(
		authedContext("diag_player"), logger, nil, nk,
		settlePayloadWithActions("victory", []PvpAction{mismatchProbeAction}),
	)
	if err != nil {
		t.Fatalf("settle failed: %v", err)
	}

	var envelope struct {
		Settlement MatchSettlement `json:"settlement"`
	}
	if err := json.Unmarshal([]byte(response), &envelope); err != nil {
		t.Fatalf("invalid response: %v", err)
	}

	if len(logger.sink.warnings) != 1 {
		t.Fatalf("status=%q warnings=%d: expected exactly one warning", envelope.Settlement.Status, len(logger.sink.warnings))
	}
	if logger.sink.messages[0] != "bot_result_status_mismatch" {
		t.Fatalf("unexpected warning message: %q", logger.sink.messages[0])
	}
	fields := logger.sink.warnings[0]
	if envelope.Settlement.Status != "defeat" {
		t.Fatalf("authoritative status must stay defeat, got %q", envelope.Settlement.Status)
	}

	// The client submitted one structurally valid but replay-invalid action
	// (nonexistent source): the authoritative engine must have skipped it.
	if envelope.Settlement.Status != fields["authoritativeStatus"] {
		t.Fatalf("logged authoritativeStatus does not match settlement")
	}
	if fields["matchId"] != diagMatchID {
		t.Fatalf("missing matchId: %+v", fields)
	}
	if fields["battlefieldId"] != "crown_cross" {
		t.Fatalf("missing battlefieldId: %+v", fields)
	}
	if fields["clientObservedStatus"] != "victory" {
		t.Fatalf("missing clientObservedStatus: %+v", fields)
	}
	if fields["submittedActionCount"] != 1 {
		t.Fatalf("unexpected submittedActionCount: %+v", fields)
	}
	if fields["processedActionCount"] != 0 {
		t.Fatalf("unexpected processedActionCount: %+v", fields)
	}
	if fields["skippedActionCount"] != 1 {
		t.Fatalf("unexpected skippedActionCount: %+v", fields)
	}
	modifiers, ok := fields["authoritativePlayerModifiers"].(map[string]interface{})
	if !ok {
		t.Fatalf("missing authoritativePlayerModifiers: %+v", fields)
	}
	// Non-default career (garrison 3, production 2, speed 1) must be logged
	// exactly, proving the snapshot reflects the settling career rather than
	// hardcoded defaults.
	if modifiers["startingUnits"] != 29 ||
		modifiers["productionRateMultiplier"] != 1.16 ||
		modifiers["armySpeedMultiplier"] != 1.06 {
		t.Fatalf("modifier snapshot mismatch: %+v", modifiers)
	}

	// Security: settlement and rewards are defeat-derived. A victory would
	// have incremented matches_won and paid victory coins.
	if envelope.Settlement.NewCareer.MatchesWon != 0 {
		t.Fatalf("client status leaked into settlement: %+v", envelope.Settlement.NewCareer)
	}
	if len(nk.trophySubmissions) != 1 || nk.trophySubmissions[0] != int64(envelope.Settlement.NewCareer.Trophies) {
		t.Fatalf("trophy submission mismatch: %+v", nk.trophySubmissions)
	}
}

func TestSettleMatchLogsNothingWhenStatusesMatch(t *testing.T) {
	store, mock, nk, logger := newDiagStore(t)
	expectFreshSettlement(t, mock, "diag_player", defaultCareerRow("diag_player"))

	handler := rpcSettleMatch(store, nk)
	if _, err := handler(
		authedContext("diag_player"), logger, nil, nk, settlePayload("defeat"),
	); err != nil {
		t.Fatalf("settle failed: %v", err)
	}
	if len(logger.sink.warnings) != 0 {
		t.Fatalf("matching statuses must not warn, got %v", logger.sink.warnings)
	}
}

func TestSettleMatchReplayNeverLogsMismatch(t *testing.T) {
	store, mock, _, _ := newDiagStore(t)
	stored, err := json.Marshal(MatchSettlement{
		MatchID:   diagMatchID,
		Status:    "defeat",
		NewCareer: PlayerCareer{PlayerID: "diag_player", Coins: 100},
	})
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT settlement FROM match_settlements WHERE match_id = $1")).
		WithArgs(diagMatchID).
		WillReturnRows(sqlmock.NewRows([]string{"settlement"}).AddRow(stored))
	mock.ExpectRollback()

	logger := newRecordingLogger()
	handler := rpcSettleMatch(store, &fakeNakama{})
	response, err := handler(
		authedContext("diag_player"), logger, nil, &fakeNakama{}, settlePayload("victory"),
	)
	if err != nil {
		t.Fatalf("replay failed: %v", err)
	}
	if len(logger.sink.warnings) != 0 {
		t.Fatalf("stored replay must not log a mismatch warning, got %v", logger.sink.warnings)
	}
	var envelope struct {
		Settlement MatchSettlement `json:"settlement"`
	}
	if err := json.Unmarshal([]byte(response), &envelope); err != nil {
		t.Fatalf("invalid response: %v", err)
	}
	if envelope.Settlement.Status != "defeat" || !strings.HasPrefix(envelope.Settlement.MatchID, "bot_diag") {
		t.Fatalf("unexpected replayed settlement: %+v", envelope.Settlement)
	}
}

func TestParseActionPayloadRejectsMalformedClientStatus(t *testing.T) {
	for _, bad := range []string{"win", "lose", "VICTORY", "victory ", "null", "2"} {
		if _, _, _, err := parseActionPayload(settlePayload(bad)); err == nil || err.Error() != "invalid_client_status" {
			t.Fatalf("status %q: expected invalid_client_status, got %v", bad, err)
		}
	}
	// Absent and empty statuses are accepted.
	payload, err := json.Marshal(map[string]interface{}{"matchId": diagMatchID, "actions": []PvpAction{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, status, err := parseActionPayload(string(payload)); err != nil || status != "" {
		t.Fatalf("absent client status must be accepted, got %q, %v", status, err)
	}
	matchID, _, status, err := parseActionPayload(settlePayload("draw"))
	if err != nil || matchID != diagMatchID || status != "draw" {
		t.Fatalf("valid client status must pass through: %q, %v", status, err)
	}
}

func TestSettleMatchVerifiedReplayReturnsNoDiagnostics(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	stored, err := json.Marshal(MatchSettlement{
		MatchID:   diagMatchID,
		Status:    "defeat",
		NewCareer: PlayerCareer{PlayerID: "diag_player"},
	})
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT settlement FROM match_settlements WHERE match_id = $1")).
		WithArgs(diagMatchID).
		WillReturnRows(sqlmock.NewRows([]string{"settlement"}).AddRow(stored))
	mock.ExpectRollback()

	settlement, diagnostics, err := NewStore(db).SettleMatchVerified(
		context.Background(), "diag_player", diagMatchID, nil,
	)
	if err != nil {
		t.Fatalf("unexpected replay error: %v", err)
	}
	if diagnostics != nil {
		t.Fatalf("replay must not carry mismatch diagnostics: %+v", diagnostics)
	}
	if settlement.Status != "defeat" {
		t.Fatalf("unexpected replayed settlement: %+v", settlement)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("replay touched simulation state: %v", err)
	}
}

func TestClientStatusCannotInfluenceSettlementDirectly(t *testing.T) {
	// The store API does not accept a client status at all: compile-time
	// separation. Defended here by checking the mismatch helper never sees a
	// non-diagnostic caller: a matching-status call must be a no-op, and a
	// nil-diagnostics call (replay/error paths) must be a no-op too.
	logger := newRecordingLogger()
	logBotStatusMismatch(logger, diagMatchID, "victory", "victory", 3, &BotSettlementDiagnostics{
		BattlefieldID: "crown_cross", ActionsProcessed: 3,
	})
	logBotStatusMismatch(logger, diagMatchID, "victory", "defeat", 3, nil)
	if len(logger.sink.warnings) != 0 {
		t.Fatalf("diagnostic helper must stay silent: %v", logger.sink.warnings)
	}
}
