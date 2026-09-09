package main

import (
	"context"
	"database/sql"
)

type migration struct {
	name string
	sql  string
}

var migrations = []migration{
	{
		name: "001_init",
		sql: `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  coins INTEGER NOT NULL DEFAULT 100,
  gems INTEGER NOT NULL DEFAULT 10,
  trophies INTEGER NOT NULL DEFAULT 0,
  starting_garrison_level INTEGER NOT NULL DEFAULT 0,
  production_level INTEGER NOT NULL DEFAULT 0,
  army_speed_level INTEGER NOT NULL DEFAULT 0,
  matches_played INTEGER NOT NULL DEFAULT 0,
  matches_won INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  last_match_timestamp BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS player_names (
  player_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS economy_ledger (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  previous_balance INTEGER NOT NULL,
  resulting_balance INTEGER NOT NULL,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_economy_ledger_player ON economy_ledger (player_id, timestamp DESC);
CREATE TABLE IF NOT EXISTS match_settlements (
  match_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  status TEXT NOT NULL,
  settlement JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_match_settlements_player ON match_settlements (player_id, created_at DESC);
CREATE TABLE IF NOT EXISTS upgrade_purchases (
  purchase_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  upgrade_type TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_upgrade_purchases_player ON upgrade_purchases (player_id, created_at DESC);
`,
	},
	{
		name: "002_async_pvp",
		sql: `
CREATE TABLE IF NOT EXISTS pvp_defenses (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  display_name TEXT NOT NULL,
  trophies INTEGER NOT NULL,
  matches_won INTEGER NOT NULL,
  modifiers JSONB NOT NULL,
  published_at BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pvp_defenses_trophies ON pvp_defenses (trophies);
CREATE TABLE IF NOT EXISTS pvp_attacks (
  attack_id TEXT PRIMARY KEY,
  attacker_id TEXT NOT NULL REFERENCES players(id),
  defender_id TEXT NOT NULL REFERENCES players(id),
  is_revenge BOOLEAN NOT NULL DEFAULT false,
  actions JSONB NOT NULL,
  summary JSONB NOT NULL,
  settlement JSONB NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pvp_attacks_attacker ON pvp_attacks (attacker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pvp_attacks_defender ON pvp_attacks (defender_id, created_at DESC);
`,
	},
	{
		name: "003_analytics_events",
		sql: `
CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY,
  player_id TEXT NOT NULL,
  name TEXT NOT NULL,
  props JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_player ON analytics_events (player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name ON analytics_events (name, created_at DESC);
`,
	},
	{
		name: "004_analytics_event_envelope",
		sql: `
ALTER TABLE analytics_events
  ADD COLUMN IF NOT EXISTS event_id TEXT,
  ADD COLUMN IF NOT EXISTS session_id TEXT,
  ADD COLUMN IF NOT EXISTS occurred_at BIGINT,
  ADD COLUMN IF NOT EXISTS schema_version INTEGER;

UPDATE analytics_events
SET
  event_id = CONCAT('legacy_', id),
  session_id = 'legacy',
  occurred_at = FLOOR(EXTRACT(EPOCH FROM created_at) * 1000)::BIGINT,
  schema_version = 0
WHERE event_id IS NULL OR session_id IS NULL OR occurred_at IS NULL OR schema_version IS NULL;

ALTER TABLE analytics_events
  ALTER COLUMN event_id SET NOT NULL,
  ALTER COLUMN session_id SET NOT NULL,
  ALTER COLUMN occurred_at SET NOT NULL,
  ALTER COLUMN schema_version SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'analytics_events_player_event_id_key'
  ) THEN
    ALTER TABLE analytics_events
      ADD CONSTRAINT analytics_events_player_event_id_key UNIQUE (player_id, event_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_analytics_events_player_occurred
  ON analytics_events (player_id, occurred_at DESC);
`,
	},
}

func RunMigrations(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			name TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`); err != nil {
		return err
	}
	for _, item := range migrations {
		var exists bool
		if err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1)`, item.name).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, item.sql); err == nil {
			_, err = tx.ExecContext(ctx, `INSERT INTO schema_migrations (name) VALUES ($1)`, item.name)
		}
		if err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}
