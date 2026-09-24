package main

// Secure matchmaker ticket pinning (docs/2v2-architecture.md §3.2.2, Phase 3).
//
// The single RegisterBeforeRt("MatchmakerAdd", ...) hook intercepts every
// client matchmaker ticket before the server processes it and rewrites it
// with authoritative values:
//
//   - the query, mode, schema, and rating properties are NEVER trusted from
//     the client — everything is overwritten server-side;
//   - the rating numeric property is read from the player's authoritative
//     career row, not from client-supplied properties;
//   - 1v1 tickets (the existing `addMatchmaker('', 2, 2)` clients) are pinned
//     to `+properties.mode:1v1` with mode/schema properties, so they can
//     never consume 2v2 tickets;
//   - 2v2 tickets are pinned to `+properties.mode:2v2 +properties.schema:2`
//     with exactly four players, so cross-mode matching is impossible in
//     either direction;
//   - 2v2 tickets are rejected outright unless ENABLE_2V2 is enabled.
//
// Rejection logs carry only server-derived shape data (reason, counts,
// presence flags) — never user IDs, query text, or property values.

import (
	"context"
	"database/sql"
	"errors"

	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
)

const (
	matchmaker1v1Query  = "+properties.mode:1v1"
	matchmaker2v2Query  = "+properties.mode:2v2 +properties.schema:2"
	matchmakerRatingKey = "rating"
	matchmakerModeKey   = "mode"
	matchmakerSchemaKey = "schema"
	matchmaker1v1Schema = "1"
	matchmaker2v2Schema = "2"
	matchmaker1v1Count  = 2
	matchmaker2v2Count  = 4
)

// classifyMatchmakerTicket determines the intended mode from the ticket's
// client-declared shape. The classification decides which SERVER shape the
// ticket is rewritten into; the client never gets to choose the final query,
// properties, or counts.
func classifyMatchmakerTicket(add *rtapi.MatchmakerAdd) (MatchMode, error) {
	declaredMode, hasDeclaredMode := add.GetStringProperties()[matchmakerModeKey]
	minCount := int(add.GetMinCount())
	maxCount := int(add.GetMaxCount())

	unknownOrContradictory := (hasDeclaredMode &&
		declaredMode != string(MatchMode1v1) && declaredMode != string(MatchMode2v2)) ||
		(hasDeclaredMode && declaredMode == string(MatchMode1v1) && (minCount > matchmaker1v1Count || maxCount > matchmaker1v1Count))
	if unknownOrContradictory {
		return "", errors.New("matchmaker_ticket_invalid_shape")
	}

	wantsFourPlayers := minCount > matchmaker1v1Count || maxCount > matchmaker1v1Count
	if declaredMode == string(MatchMode2v2) || wantsFourPlayers {
		return MatchMode2v2, nil
	}
	return MatchMode1v1, nil
}

// beforeMatchmakerAdd is the one and only MatchmakerAdd before-hook.
func beforeMatchmakerAdd(store *Store) func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *rtapi.Envelope) (*rtapi.Envelope, error) {
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *rtapi.Envelope) (*rtapi.Envelope, error) {
		add := in.GetMatchmakerAdd()
		if add == nil {
			return in, nil
		}

		userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
		if !ok || userID == "" {
			rejectMatchmakerTicket(logger, add, "unauthenticated")
			return nil, errors.New("matchmaker_ticket_unauthenticated")
		}

		mode, err := classifyMatchmakerTicket(add)
		if err != nil {
			rejectMatchmakerTicket(logger, add, "invalid_ticket_shape")
			return nil, err
		}
		if mode == MatchMode2v2 && !serverConfig.Enable2v2 {
			rejectMatchmakerTicket(logger, add, "mode_disabled")
			return nil, errors.New("matchmaker_mode_disabled")
		}
		if mode == MatchMode2v2 {
			decision := twoVTwoRolloutDecision(userID, rolloutPlatformFromContext(ctx))
			if !decision.Enable2v2 {
				rejectMatchmakerTicket(logger, add, "rollout_ineligible")
				return nil, errors.New("matchmaker_mode_disabled")
			}
		}

		// The rating property is read from authoritative server state only.
		// A career read failure fails closed: the ticket never enters the
		// pool with a client-supplied rating.
		career, err := store.GetOrCreateCareer(ctx, userID)
		if err != nil {
			rejectMatchmakerTicket(logger, add, "career_unavailable")
			return nil, errors.New("matchmaker_ticket_unavailable")
		}

		switch mode {
		case MatchMode2v2:
			add.MinCount = matchmaker2v2Count
			add.MaxCount = matchmaker2v2Count
			add.Query = matchmaker2v2Query
			add.StringProperties = map[string]string{
				matchmakerModeKey:   string(MatchMode2v2),
				matchmakerSchemaKey: matchmaker2v2Schema,
			}
		default:
			add.MinCount = matchmaker1v1Count
			add.MaxCount = matchmaker1v1Count
			add.Query = matchmaker1v1Query
			add.StringProperties = map[string]string{
				matchmakerModeKey:   string(MatchMode1v1),
				matchmakerSchemaKey: matchmaker1v1Schema,
			}
		}
		add.NumericProperties = map[string]float64{
			matchmakerRatingKey: float64(career.Trophies),
		}
		add.CountMultiple = nil
		return in, nil
	}
}

// rejectMatchmakerTicket logs structured rejection information. The log must
// never contain user IDs or property VALUES: only the server-derived ticket
// shape (counts) and boolean presence flags.
func rejectMatchmakerTicket(logger runtime.Logger, add *rtapi.MatchmakerAdd, reason string) {
	declaredMode, hasDeclaredMode := add.GetStringProperties()[matchmakerModeKey]
	logger.WithFields(map[string]interface{}{
		"reason":              reason,
		"minCount":            add.GetMinCount(),
		"maxCount":            add.GetMaxCount(),
		"declaredModePresent": hasDeclaredMode,
		"declaredModeKnown":   hasDeclaredMode && (declaredMode == string(MatchMode1v1) || declaredMode == string(MatchMode2v2)),
		"hasQuery":            add.GetQuery() != "",
	}).Warn("matchmaker_ticket_rejected")
}
