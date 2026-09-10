package main

import (
	"strings"
	"testing"
)

func TestLegacyPlayersMigrationSupportsNakamaCareerCreation(t *testing.T) {
	var legacyMigration *migration
	for index := range migrations {
		if migrations[index].name == "008_legacy_players_compat" {
			legacyMigration = &migrations[index]
			break
		}
	}
	if legacyMigration == nil {
		t.Fatal("legacy players compatibility migration missing")
	}

	for _, clause := range []string{
		"column_name = 'platform'",
		"ALTER COLUMN platform SET DEFAULT 'nakama'",
		"CREATE TABLE IF NOT EXISTS player_names",
	} {
		if !strings.Contains(legacyMigration.sql, clause) {
			t.Fatalf("legacy migration missing %q", clause)
		}
	}
}
