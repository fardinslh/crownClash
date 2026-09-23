package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestBattlefieldLayoutsStaySymmetricAndDistinct(t *testing.T) {
	expectedCounts := map[string]int{
		"crown_cross": 9,
		"twin_passes": 8,
		"royal_ring":  10,
		"quad_citadel": 13,
	}

	ownedBaseIDs := map[string][]string{
		"crown_cross":  {"p_base", "e_base"},
		"twin_passes":  {"p_base", "e_base"},
		"royal_ring":   {"p_base", "e_base"},
		"quad_citadel": {"a_base_w", "a_base_e", "b_base_w", "b_base_e"},
	}

	for id, expectedCount := range expectedCounts {
		territories := CreateTerritoriesForBattlefield(DefaultModifiers(), DefaultModifiers(), id)
		if len(territories) != expectedCount {
			t.Fatalf("%s: expected %d territories, got %d", id, expectedCount, len(territories))
		}

		for _, baseID := range ownedBaseIDs[id] {
			if _, exists := territories[baseID]; !exists {
				t.Fatalf("%s: missing owned starting territory %q", id, baseID)
			}
		}

		if id == "quad_citadel" {
			aBaseW, aBaseE := territories["a_base_w"], territories["a_base_e"]
			bBaseW, bBaseE := territories["b_base_w"], territories["b_base_e"]
			if aBaseW.X+bBaseE.X != 400 || aBaseW.Y+bBaseE.Y != 720 || aBaseE.X+bBaseW.X != 400 || aBaseE.Y+bBaseW.Y != 720 {
				t.Fatalf("%s: spawn pairs are not symmetric: aBaseW=%+v aBaseE=%+v bBaseW=%+v bBaseE=%+v", id, aBaseW, aBaseE, bBaseW, bBaseE)
			}
			for _, base := range []Territory{aBaseW, aBaseE, bBaseW, bBaseE} {
				if base.Owner == TeamNeutral || base.Tier != 3 || base.Type != TerritoryFortress {
					t.Fatalf("%s: spawn %q must be an owned tier-3 fortress, got owner=%v tier=%d type=%v", id, base.ID, base.Owner, base.Tier, base.Type)
				}
			}
		} else {
			pBase := territories["p_base"]
			eBase := territories["e_base"]
			if pBase.X != 200 || eBase.X != 200 || pBase.Y+eBase.Y != 720 {
				t.Fatalf("%s: bases are not symmetric: pBase=%+v, eBase=%+v", id, pBase, eBase)
			}
		}

		// 180-degree rotational symmetry
		for tID, terr := range territories {
			rotX := 400 - terr.X
			rotY := 720 - terr.Y
			found := false
			for _, other := range territories {
				if math.Abs(other.X-rotX) < 1e-4 && math.Abs(other.Y-rotY) < 1e-4 {
					found = true
					if terr.Owner == TeamPlayer && other.Owner != TeamEnemy {
						t.Fatalf("%s: territory %s owner mismatch with counterpart %s", id, tID, other.ID)
					}
					if terr.Owner == TeamNeutral && other.Owner != TeamNeutral {
						t.Fatalf("%s: neutral territory %s counterpart is not neutral", id, tID)
					}
					if terr.Tier != other.Tier || terr.Type != other.Type || terr.Units != other.Units || terr.MaxUnits != other.MaxUnits ||
						terr.ProductionRate != other.ProductionRate || terr.Radius != other.Radius {
						t.Fatalf("%s: territory %s attributes mismatch with counterpart %s", id, tID, other.ID)
					}
					break
				}
			}
			if !found {
				t.Fatalf("%s: territory %s at (%f, %f) has no symmetric counterpart at (%f, %f)", id, tID, terr.X, terr.Y, rotX, rotY)
			}
		}

		// Roads validation
		roads, ok := battlefieldRoads[id]
		if !ok || len(roads) == 0 {
			t.Fatalf("%s: missing road definitions", id)
		}
		seenRoads := make(map[string]bool)
		for _, road := range roads {
			a, b := road[0], road[1]
			if _, exists := territories[a]; !exists {
				t.Fatalf("%s: road endpoint %s not in territories", id, a)
			}
			if _, exists := territories[b]; !exists {
				t.Fatalf("%s: road endpoint %s not in territories", id, b)
			}
			if a == b {
				t.Fatalf("%s: self-road [%s, %s]", id, a, b)
			}
			key := a + "<->" + b
			if a > b {
				key = b + "<->" + a
			}
			if seenRoads[key] {
				t.Fatalf("%s: duplicate road %s", id, key)
			}
			seenRoads[key] = true
		}
	}
}

func TestBattlefieldModes(t *testing.T) {
	expectedModes := map[string]MatchMode{
		"crown_cross":  MatchMode1v1,
		"twin_passes":  MatchMode1v1,
		"royal_ring":   MatchMode1v1,
		"quad_citadel": MatchMode2v2,
	}
	if len(expectedModes) != len(authoritativeBattlefields) {
		t.Fatalf("expected %d battlefields, embedded registry has %d", len(expectedModes), len(authoritativeBattlefields))
	}
	for id, want := range expectedModes {
		definition, ok := authoritativeBattlefields[id]
		if !ok {
			t.Fatalf("battlefield %q missing from the embedded registry", id)
		}
		if definition.Mode != want {
			t.Fatalf("%s: expected mode %q, got %q", id, want, definition.Mode)
		}
	}

	mode, err := normalizeBattlefieldMode("")
	if err != nil || mode != MatchMode1v1 {
		t.Fatalf("legacy mode should default to %q: mode=%q err=%v", MatchMode1v1, mode, err)
	}
	if _, err := normalizeBattlefieldMode("3v3"); err == nil {
		t.Fatal("unknown battlefield mode should be rejected")
	}
}

// TestQuadCitadelAuthoritativeSpec pins the exact approved §7.3 specification:
// counts, frozen deterministic territory order, spawn pairs, attributes, and
// the mirror-closed 20-edge road set.
func TestQuadCitadelAuthoritativeSpec(t *testing.T) {
	definition, ok := authoritativeBattlefields["quad_citadel"]
	if !ok {
		t.Fatal("quad_citadel missing from the embedded battlefields")
	}
	if definition.Mode != MatchMode2v2 {
		t.Fatalf("quad_citadel mode: got %q", definition.Mode)
	}
	if definition.Name != "Quad Citadel" || definition.Subtitle != "Four commanders, two banners" {
		t.Fatalf("unexpected naming: %q / %q", definition.Name, definition.Subtitle)
	}
	if definition.Accent != 0x818cf8 {
		t.Fatalf("quad_citadel accent: got %#x", definition.Accent)
	}

	expectedOrder := []string{
		"a_base_w", "a_base_e", "b_base_w", "b_base_e",
		"a_gate_w", "a_gate_e", "b_gate_w", "b_gate_e",
		"n_corner_sw", "n_corner_se", "n_corner_nw", "n_corner_ne",
		"n_center",
	}
	if len(definition.Territories) != len(expectedOrder) {
		t.Fatalf("expected %d territories, got %d", len(expectedOrder), len(definition.Territories))
	}
	seen := make(map[string]bool, len(expectedOrder))
	for i, template := range definition.Territories {
		if template.ID != expectedOrder[i] {
			t.Fatalf("territory order deviates at index %d: got %q, expected %q", i, template.ID, expectedOrder[i])
		}
		if seen[template.ID] {
			t.Fatalf("duplicate territory id %q in the deterministic order", template.ID)
		}
		seen[template.ID] = true
	}
	if order := territoryOrderForBattlefield("quad_citadel"); len(order) != len(expectedOrder) || order[0] != "a_base_w" || order[len(order)-1] != "n_center" {
		t.Fatalf("territoryOrderForBattlefield must return the frozen JSON order, got %v", order)
	}

	if len(definition.Roads) != 20 {
		t.Fatalf("expected 20 roads, got %d", len(definition.Roads))
	}

	expectedSpawns := map[string]struct {
		owner Team
		x, y  float64
	}{
		"a_base_w": {TeamPlayer, 90, 590},
		"a_base_e": {TeamPlayer, 310, 590},
		"b_base_w": {TeamEnemy, 90, 130},
		"b_base_e": {TeamEnemy, 310, 130},
	}
	templates := make(map[string]battlefieldTerritoryJSON, len(definition.Territories))
	for _, template := range definition.Territories {
		templates[template.ID] = template
	}
	for spawnID, want := range expectedSpawns {
		template, ok := templates[spawnID]
		if !ok {
			t.Fatalf("spawn %q missing", spawnID)
		}
		if template.Owner != want.owner || template.X != want.x || template.Y != want.y ||
			template.Tier != 3 || template.Type != TerritoryFortress ||
			template.Units != 20 || template.MaxUnits != 65 || template.ProductionRate != 1.2 || template.Radius != 36 {
			t.Fatalf("spawn %q deviates from §7.3: %+v", spawnID, template)
		}
	}
	center := templates["n_center"]
	if center.Owner != TeamNeutral || center.X != 200 || center.Y != 360 || center.Radius != 34 ||
		center.Tier != 2 || center.Type != TerritoryFortress || center.Units != 16 || center.MaxUnits != 55 || center.ProductionRate != 1.15 {
		t.Fatalf("n_center deviates from §7.3: %+v", center)
	}

	// Degrees: n_center 4, every other territory 3.
	degree := make(map[string]int, len(templates))
	for _, road := range definition.Roads {
		degree[road[0]]++
		degree[road[1]]++
	}
	for id, count := range degree {
		expected := 3
		if id == "n_center" {
			expected = 4
		}
		if count != expected {
			t.Fatalf("territory %q has degree %d, expected %d", id, count, expected)
		}
	}
}

// TestQuadCitadelIsolatedFromOneVOneSelection proves the ordinary 1v1
// selection path can never pick the 2v2 battlefield.
func TestQuadCitadelIsolatedFromOneVOneSelection(t *testing.T) {
	for _, id := range battlefieldIDs {
		if id == "quad_citadel" {
			t.Fatal("1v1 selection list must not contain quad_citadel")
		}
	}
	if IsBattlefieldID("quad_citadel") {
		t.Fatal("IsBattlefieldID (1v1 registry) must reject quad_citadel")
	}
	for _, id := range battlefieldIDs {
		if !IsBattlefieldID(id) {
			t.Fatalf("1v1 selection id %q must stay valid", id)
		}
	}
}

// TestBattlefieldValidatorRejectsMalformedDefinitions proves the embedded
// fail-closed validator rejects broken mirrors, wrong spawn modes, and
// duplicates before the server would ever boot with them.
func TestBattlefieldValidatorRejectsMalformedDefinitions(t *testing.T) {
	quad := authoritativeBattlefields["quad_citadel"]

	breakMirrorCoordinate := quad
	breakMirrorCoordinate.Territories = append([]battlefieldTerritoryJSON{}, quad.Territories...)
	for i := range breakMirrorCoordinate.Territories {
		if breakMirrorCoordinate.Territories[i].ID == "n_corner_sw" {
			breakMirrorCoordinate.Territories[i].X++
		}
	}
	if err := validateBattlefieldDefinition(breakMirrorCoordinate); err == nil {
		t.Fatal("broken mirrored coordinate must be rejected")
	}

	breakMirrorRoad := quad
	breakMirrorRoad.Roads = append([][2]string{}, quad.Roads...)
	for i := range breakMirrorRoad.Roads {
		if breakMirrorRoad.Roads[i][0] == "n_corner_sw" && breakMirrorRoad.Roads[i][1] == "n_corner_se" {
			breakMirrorRoad.Roads[i] = [2]string{"n_corner_nw", "n_center"}
		}
	}
	if err := validateBattlefieldDefinition(breakMirrorRoad); err == nil {
		t.Fatal("broken mirrored road must be rejected")
	}

	wrongSpawnCount := quad
	wrongSpawnCount.Territories = append([]battlefieldTerritoryJSON{}, quad.Territories...)
	for i := range wrongSpawnCount.Territories {
		if wrongSpawnCount.Territories[i].ID == "a_base_e" {
			wrongSpawnCount.Territories[i].Owner = TeamNeutral
		}
	}
	if err := validateBattlefieldDefinition(wrongSpawnCount); err == nil {
		t.Fatal("wrong Team A spawn count must be rejected")
	}

	wrongMode := quad
	wrongMode.Mode = MatchMode1v1
	if err := validateBattlefieldDefinition(wrongMode); err == nil {
		t.Fatal("a 2v2 map validated as 1v1 must be rejected (cross-mode)")
	}

	duplicateTerritory := quad
	duplicateTerritory.Territories = append(append([]battlefieldTerritoryJSON{}, quad.Territories...), quad.Territories[0])
	if err := validateBattlefieldDefinition(duplicateTerritory); err == nil {
		t.Fatal("duplicate territory id must be rejected")
	}

	// Mirror-invariant undirected roads: replace the two team trunk roads
	// with cross-team edges whose rotated endpoint set equals their own.
	// Degree and road counts are unchanged, so the ONLY failure reason must
	// be the self-mapping edge.
	mirrorInvariantRoads := quad
	mirrorInvariantRoads.Roads = append([][2]string{}, quad.Roads...)
	replaced := 0
	for i := range mirrorInvariantRoads.Roads {
		road := mirrorInvariantRoads.Roads[i]
		if road[0] == "a_base_w" && road[1] == "a_base_e" {
			mirrorInvariantRoads.Roads[i] = [2]string{"a_base_w", "b_base_e"}
			replaced++
		} else if road[0] == "b_base_w" && road[1] == "b_base_e" {
			mirrorInvariantRoads.Roads[i] = [2]string{"a_base_e", "b_base_w"}
			replaced++
		}
	}
	if replaced != 2 || len(mirrorInvariantRoads.Roads) != 20 {
		t.Fatalf("red-control setup broken: replaced=%d roads=%d", replaced, len(mirrorInvariantRoads.Roads))
	}
	if err := validateBattlefieldDefinition(mirrorInvariantRoads); err == nil || !strings.Contains(err.Error(), "maps to itself under mirroring") {
		t.Fatalf("mirror-invariant undirected road must be rejected with a self-map error, got %v", err)
	}

	// Duplicate coordinates: a second territory on n_center's coordinate
	// leaves n_center without a UNIQUE rotational counterpart.
	duplicateCoordinates := quad
	duplicateCoordinates.Territories = append(append([]battlefieldTerritoryJSON{}, quad.Territories...),
		battlefieldTerritoryJSON{ID: "n_center_ghost", Name: "Ghost Keep", X: 200, Y: 360, Radius: 34, Owner: TeamNeutral, Units: 16, MaxUnits: 55, ProductionRate: 1.15, Tier: 2, Type: TerritoryFortress})
	if err := validateBattlefieldDefinition(duplicateCoordinates); err == nil || !strings.Contains(err.Error(), "exactly one symmetric counterpart") {
		t.Fatalf("duplicate coordinates must be rejected with a uniqueness error, got %v", err)
	}

	duplicateRoad := quad
	duplicateRoad.Roads = append(append([][2]string{}, quad.Roads...), [2]string{"a_base_w", "a_base_e"})
	if err := validateBattlefieldDefinition(duplicateRoad); err == nil {
		t.Fatal("duplicate road must be rejected")
	}

	selfRoad := quad
	selfRoad.Roads = append(append([][2]string{}, quad.Roads...), [2]string{"n_center", "n_center"})
	if err := validateBattlefieldDefinition(selfRoad); err == nil {
		t.Fatal("self-road must be rejected")
	}

	// The unmodified definition stays valid.
	if err := validateBattlefieldDefinition(quad); err != nil {
		t.Fatalf("shipped quad_citadel must stay valid: %v", err)
	}
}

// TestBattlefieldTerritoryOrderIsDeterministic proves every battlefield's
// registered order is duplicate-free, complete, and stable across calls —
// the exact TS/Go hashing and replay contract (§6.3).
func TestBattlefieldTerritoryOrderIsDeterministic(t *testing.T) {
	for id := range authoritativeBattlefields {
		first := territoryOrderForBattlefield(id)
		second := territoryOrderForBattlefield(id)
		if len(first) != len(second) {
			t.Fatalf("%s: order length changed between calls", id)
		}
		seen := make(map[string]bool, len(first))
		for _, territoryID := range first {
			if seen[territoryID] {
				t.Fatalf("%s: duplicate territory %q in registered order", id, territoryID)
			}
			seen[territoryID] = true
		}
		definition := authoritativeBattlefields[id]
		if len(first) != len(definition.Territories) {
			t.Fatalf("%s: registered order is incomplete", id)
		}
		for i, territoryID := range first {
			if definition.Territories[i].ID != territoryID {
				t.Fatalf("%s: registered order deviates from JSON order at %d", id, i)
			}
		}
	}
}

func TestBattlefieldAuthoritativeFieldParity(t *testing.T) {
	for id, def := range authoritativeBattlefields {
		territories := CreateTerritoriesForBattlefield(DefaultModifiers(), DefaultModifiers(), id)
		if len(territories) != len(def.Territories) {
			t.Fatalf("%s: territory count mismatch: got %d, expected %d", id, len(territories), len(def.Territories))
		}
		for _, template := range def.Territories {
			terr, exists := territories[template.ID]
			if !exists {
				t.Fatalf("%s: missing territory ID %q", id, template.ID)
			}
			if terr.ID != template.ID {
				t.Fatalf("%s: territory ID mismatch: got %q, expected %q", id, terr.ID, template.ID)
			}
			if terr.Name != template.Name {
				t.Fatalf("%s/%s: name mismatch: got %q, expected %q", id, terr.ID, terr.Name, template.Name)
			}
			if terr.X != template.X || terr.Y != template.Y {
				t.Fatalf("%s/%s: coordinates mismatch: got (%f, %f), expected (%f, %f)", id, terr.ID, terr.X, terr.Y, template.X, template.Y)
			}
			if terr.Radius != template.Radius {
				t.Fatalf("%s/%s: radius mismatch: got %f, expected %f", id, terr.ID, terr.Radius, template.Radius)
			}
			if terr.Owner != template.Owner {
				t.Fatalf("%s/%s: ownership mismatch: got %q, expected %q", id, terr.ID, terr.Owner, template.Owner)
			}
			expectedUnits := template.Units
			if template.ID == "p_base" || template.Owner == TeamPlayer {
				expectedUnits = 20
			} else if template.ID == "e_base" || template.Owner == TeamEnemy {
				expectedUnits = 20
			}
			if terr.Units != expectedUnits {
				t.Fatalf("%s/%s: units mismatch: got %d, expected %d", id, terr.ID, terr.Units, expectedUnits)
			}
			if terr.MaxUnits != template.MaxUnits {
				t.Fatalf("%s/%s: maxUnits mismatch: got %d, expected %d", id, terr.ID, terr.MaxUnits, template.MaxUnits)
			}
			expectedProd := template.ProductionRate
			if terr.ProductionRate != expectedProd {
				t.Fatalf("%s/%s: production mismatch: got %f, expected %f", id, terr.ID, terr.ProductionRate, expectedProd)
			}
			if terr.Tier != template.Tier {
				t.Fatalf("%s/%s: tier mismatch: got %d, expected %d", id, terr.ID, terr.Tier, template.Tier)
			}
			if terr.Type != template.Type {
				t.Fatalf("%s/%s: type mismatch: got %q, expected %q", id, terr.ID, terr.Type, template.Type)
			}
		}

		roads := battlefieldRoads[id]
		if len(roads) != len(def.Roads) {
			t.Fatalf("%s: road count mismatch: got %d, expected %d", id, len(roads), len(def.Roads))
		}
		for i, r := range def.Roads {
			actual := roads[i]
			if actual[0] != r[0] || actual[1] != r[1] {
				t.Fatalf("%s: road %d mismatch: got %v, expected %v", id, i, actual, r)
			}
		}
	}
}

func TestBotBattlefieldReplayIsDeterministic(t *testing.T) {
	actionsByBattlefield := map[string][]PvpAction{
		"crown_cross": {
			{Sequence: 0, AtSeconds: 0, SourceID: "p_base", TargetID: "n_center"},
			{Sequence: 1, AtSeconds: 4, SourceID: "p_base", TargetID: "n_bot_left"},
		},
		"twin_passes": {
			{Sequence: 0, AtSeconds: 0, SourceID: "p_base", TargetID: "n_west_gate_s"},
			{Sequence: 1, AtSeconds: 4, SourceID: "p_base", TargetID: "n_east_gate_s"},
		},
		"royal_ring": {
			{Sequence: 0, AtSeconds: 0, SourceID: "p_base", TargetID: "n_ring_sw"},
			{Sequence: 1, AtSeconds: 4, SourceID: "p_base", TargetID: "n_ring_se"},
		},
	}

	for _, id := range []string{"crown_cross", "twin_passes", "royal_ring"} {
		actions := actionsByBattlefield[id]
		firstState, firstSummary, err := SimulateBotBattleOnBattlefield(actions, DefaultModifiers(), id)
		if err != nil {
			t.Fatal(err)
		}
		secondState, secondSummary, err := SimulateBotBattleOnBattlefield(actions, DefaultModifiers(), id)
		if err != nil {
			t.Fatal(err)
		}
		if firstState.BattlefieldID != id || !reflect.DeepEqual(firstState, secondState) || !reflect.DeepEqual(firstSummary, secondSummary) {
			t.Fatalf("%s replay diverged: %+v / %+v", id, firstSummary, secondSummary)
		}
	}
}

func TestSettleMatchRejectsForeignBotTicketBeforeCareerMutation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT settlement FROM match_settlements WHERE match_id = $1")).
		WithArgs("bot_foreign").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT player_id, battlefield_id")).
		WithArgs("bot_foreign").
		WillReturnRows(sqlmock.NewRows([]string{"player_id", "battlefield_id"}).AddRow("player_1", "royal_ring"))
	mock.ExpectRollback()

	_, _, err = NewStore(db).SettleMatchVerified(context.Background(), "player_2", "bot_foreign", nil)
	if !errors.Is(err, ErrBotMatchOwnership) {
		t.Fatalf("expected ownership error, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("foreign ticket touched career state: %v", err)
	}
}

func TestSettleMatchRejectsMissingBotTicketBeforeCareerMutation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT settlement FROM match_settlements WHERE match_id = $1")).
		WithArgs("forged_match").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT player_id, battlefield_id")).
		WithArgs("forged_match").WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	_, _, err = NewStore(db).SettleMatchVerified(context.Background(), "player_1", "forged_match", nil)
	if !errors.Is(err, ErrBotMatchNotFound) {
		t.Fatalf("expected missing ticket error, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("missing ticket touched career state: %v", err)
	}
}

func TestSettleMatchReplayRejectsAnotherPlayersSettlement(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	stored, err := json.Marshal(MatchSettlement{
		MatchID:   "bot_settled",
		NewCareer: PlayerCareer{PlayerID: "player_1"},
	})
	if err != nil {
		t.Fatal(err)
	}

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT settlement FROM match_settlements WHERE match_id = $1")).
		WithArgs("bot_settled").
		WillReturnRows(sqlmock.NewRows([]string{"settlement"}).AddRow(stored))
	mock.ExpectRollback()

	_, _, err = NewStore(db).SettleMatchVerified(context.Background(), "player_2", "bot_settled", nil)
	if !errors.Is(err, ErrBotMatchOwnership) {
		t.Fatalf("expected ownership error, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSettleMatchReplayReturnsStoredResultWithoutCareerMutation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	stored, err := json.Marshal(MatchSettlement{
		MatchID:   "bot_settled",
		Status:    "victory",
		NewCareer: PlayerCareer{PlayerID: "player_1", Coins: 250},
	})
	if err != nil {
		t.Fatal(err)
	}

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT settlement FROM match_settlements WHERE match_id = $1")).
		WithArgs("bot_settled").
		WillReturnRows(sqlmock.NewRows([]string{"settlement"}).AddRow(stored))
	mock.ExpectRollback()

	settlement, _, err := NewStore(db).SettleMatchVerified(context.Background(), "player_1", "bot_settled", nil)
	if err != nil {
		t.Fatalf("unexpected replay error: %v", err)
	}
	if settlement.NewCareer.Coins != 250 || settlement.Status != "victory" {
		t.Fatalf("unexpected replayed settlement: %+v", settlement)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("replay touched career state: %v", err)
	}
}

func TestCreateBotMatchPersistsOpaqueServerSelectedTicket(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO players (id, coins, gems, trophies)")).
		WithArgs("player_1", 100, 10, 0).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM players WHERE id = $1")).
		WithArgs("player_1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "coins", "gems", "trophies", "starting_garrison_level", "production_level",
			"army_speed_level", "treasury_level", "selected_commander", "matches_played", "matches_won",
			"current_streak", "best_streak", "last_match_timestamp",
		}).AddRow("player_1", 100, 10, 0, 0, 0, 0, 0, "crown_guard", 0, 0, 0, 0, 0))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO bot_matches (match_id, player_id, battlefield_id)")).
		WithArgs(sqlmock.AnyArg(), "player_1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	ticket, err := NewStore(db).CreateBotMatch(context.Background(), "player_1")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(ticket.MatchID, "bot_") || len(ticket.MatchID) != len("bot_")+32 {
		t.Fatalf("match ID is not opaque: %q", ticket.MatchID)
	}
	if !IsBattlefieldID(ticket.BattlefieldID) {
		t.Fatalf("invalid selected battlefield: %q", ticket.BattlefieldID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestBattlefieldMigrationStoresServerSelection(t *testing.T) {
	for _, item := range migrations {
		if item.name != "010_battlefields" {
			continue
		}
		for _, clause := range []string{
			"CREATE TABLE IF NOT EXISTS bot_matches",
			"match_id TEXT PRIMARY KEY",
			"player_id TEXT NOT NULL REFERENCES players(id)",
			"'crown_cross', 'twin_passes', 'royal_ring'",
		} {
			if !strings.Contains(item.sql, clause) {
				t.Fatalf("battlefield migration missing %q", clause)
			}
		}
		return
	}
	t.Fatal("battlefield migration missing")
}
