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
	{
		name: "005_add_treasury_upgrade",
		sql: `
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS treasury_level INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'players_upgrade_levels_valid'
  ) THEN
    ALTER TABLE players ADD CONSTRAINT players_upgrade_levels_valid CHECK (
      starting_garrison_level BETWEEN 0 AND 20 AND
      production_level BETWEEN 0 AND 20 AND
      army_speed_level BETWEEN 0 AND 20 AND
      treasury_level BETWEEN 0 AND 20
    );
  END IF;
END $$;
`,
	},
	{
		name: "006_daily_missions",
		sql: `
CREATE TABLE IF NOT EXISTS player_daily_progress (
  player_id TEXT NOT NULL REFERENCES players(id),
  day_key DATE NOT NULL,
  matches_played INTEGER NOT NULL DEFAULT 0 CHECK (matches_played BETWEEN 0 AND 2),
  matches_won INTEGER NOT NULL DEFAULT 0 CHECK (matches_won BETWEEN 0 AND 1),
  territories_captured INTEGER NOT NULL DEFAULT 0 CHECK (territories_captured BETWEEN 0 AND 10),
  play_matches_claimed BOOLEAN NOT NULL DEFAULT false,
  win_match_claimed BOOLEAN NOT NULL DEFAULT false,
  capture_territories_claimed BOOLEAN NOT NULL DEFAULT false,
  crown_chest_claimed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, day_key)
);
CREATE INDEX IF NOT EXISTS idx_player_daily_progress_day ON player_daily_progress (day_key);

CREATE TABLE IF NOT EXISTS daily_reward_claims (
  claim_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  day_key DATE NOT NULL,
  reward_type TEXT NOT NULL CHECK (reward_type IN ('play_matches', 'win_match', 'capture_territories', 'crown_chest')),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_id, day_key, reward_type)
);
CREATE INDEX IF NOT EXISTS idx_daily_reward_claims_player ON daily_reward_claims (player_id, day_key DESC);
`,
	},
	{
		name: "007_league_rewards",
		sql: `
CREATE TABLE IF NOT EXISTS league_reward_claims (
  claim_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  rank_id TEXT NOT NULL CHECK (rank_id IN ('soldier', 'knight', 'commander', 'warlord', 'crown_lord')),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_id, rank_id)
);
CREATE INDEX IF NOT EXISTS idx_league_reward_claims_player
  ON league_reward_claims (player_id, created_at DESC);
`,
	},
	{
		name: "008_legacy_players_compat",
		sql: `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'players'
      AND column_name = 'platform'
  ) THEN
    ALTER TABLE players ALTER COLUMN platform SET DEFAULT 'nakama';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS player_names (
  player_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`,
	},
	{
		name: "009_commanders",
		sql: `
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS selected_commander TEXT NOT NULL DEFAULT 'crown_guard';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'players_selected_commander_valid'
  ) THEN
    ALTER TABLE players ADD CONSTRAINT players_selected_commander_valid
      CHECK (selected_commander IN ('crown_guard', 'quartermaster', 'vanguard'));
  END IF;
END $$;
`,
	},
	{
		name: "010_battlefields",
		sql: `
CREATE TABLE IF NOT EXISTS bot_matches (
  match_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  battlefield_id TEXT NOT NULL CHECK (battlefield_id IN ('crown_cross', 'twin_passes', 'royal_ring')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bot_matches_player_created
  ON bot_matches (player_id, created_at DESC);
`,
	},
	{
		name: "011_multi_settlements_and_replays",
		sql: `
CREATE TABLE IF NOT EXISTS match_settlements_multi (
  match_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES players(id),
  slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 3),
  team_id TEXT NOT NULL CHECK (team_id IN ('a', 'b')),
  status TEXT NOT NULL CHECK (status IN ('victory', 'defeat', 'draw')),
  settlement JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_match_settlements_multi_user
  ON match_settlements_multi (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS match_replays (
  match_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('1v1', '2v2')),
  battlefield_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL
);
`,
	},
	{
		name: "012_tutorial_completion",
		sql: `
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS tutorial_completed BOOLEAN NOT NULL DEFAULT FALSE;
`,
	},
	{
		name: "013_capture_recovery_rules",
		sql: `
ALTER TABLE bot_matches
  ADD COLUMN IF NOT EXISTS gameplay_rules_version INTEGER NOT NULL DEFAULT 1
    CHECK (gameplay_rules_version IN (1, 2));
`,
	},
}

func init() {
	migrations = append(migrations, migration{name: "014_realm_commercial_pilot", sql: `
CREATE TABLE realm_defenses (
 player_id TEXT PRIMARY KEY REFERENCES players(id), document JSONB NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE realm_challenges (
 token TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), expires_at BIGINT NOT NULL
);
CREATE INDEX realm_challenges_owner ON realm_challenges(player_id, expires_at);
CREATE TABLE realm_tickets (
 id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), defender_id TEXT NOT NULL REFERENCES players(id),
 source TEXT NOT NULL CHECK(source IN ('ranked','friend','revenge')), origin_id TEXT,
 document JSONB NOT NULL, state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','settled','abandoned')),
 rewarded BOOLEAN NOT NULL DEFAULT false, result JSONB, actions JSONB,
 created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, settled_at BIGINT
);
CREATE UNIQUE INDEX realm_one_active ON realm_tickets(player_id) WHERE state='active';
CREATE UNIQUE INDEX realm_one_revenge ON realm_tickets(player_id,origin_id) WHERE origin_id IS NOT NULL;
CREATE INDEX realm_history_incoming ON realm_tickets(defender_id,created_at DESC);
CREATE INDEX realm_history_outgoing ON realm_tickets(player_id,created_at DESC);
CREATE TABLE realm_goals (
 player_id TEXT PRIMARY KEY REFERENCES players(id), upgrade_type TEXT NOT NULL
 CHECK(upgrade_type IN ('starting_garrison','production','army_speed','treasury')),
 viewed_at BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE coin_orders (
 id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), external_id TEXT NOT NULL,
 product_id TEXT NOT NULL CHECK(product_id IN ('starter','refill')), coins INTEGER NOT NULL CHECK(coins>0),
 amount_rials INTEGER NOT NULL CHECK(amount_rials>0), state TEXT NOT NULL DEFAULT 'created'
 CHECK(state IN ('created','pending','fulfilled','refunded')), invoice TEXT NOT NULL DEFAULT '',
 transaction_id TEXT UNIQUE, created_at BIGINT NOT NULL, fulfilled_at BIGINT,
 refunded_at BIGINT, refund_reference TEXT UNIQUE, refund_note TEXT
);
CREATE UNIQUE INDEX coin_starter_once ON coin_orders(player_id) WHERE product_id='starter';
CREATE INDEX coin_orders_player ON coin_orders(player_id,created_at DESC);
CREATE TABLE pilot_visits (
 id TEXT PRIMARY KEY, player_id TEXT, campaign TEXT NOT NULL DEFAULT 'direct', challenge_token TEXT,
 experiment_version INTEGER NOT NULL DEFAULT 1, received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pilot_visits_cohort ON pilot_visits(campaign,received_at);
CREATE TABLE pilot_observations (
 id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), name TEXT NOT NULL,
 reference TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
 received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pilot_observations_player ON pilot_observations(player_id,received_at);
`})
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

func init() {
	migrations = append(migrations, migration{name: "015_pilot_payment_recovery", sql: `
ALTER TABLE coin_orders ADD COLUMN test_mode BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bot_matches ADD COLUMN pilot_document JSONB;
CREATE UNIQUE INDEX bot_pilot_active ON bot_matches(player_id) WHERE pilot_document IS NOT NULL AND settled_at IS NULL;
`})
}

func init() {
	migrations = append(migrations, migration{name: "016_pilot_live_loadouts", sql: `
CREATE TABLE realm_live_loadouts(player_id TEXT PRIMARY KEY REFERENCES players(id),commander_id TEXT NOT NULL CHECK(commander_id IN ('crown_guard','quartermaster','vanguard')));
`})
}

func init() {
	migrations = append(migrations, migration{name: "017_social_defense_loadout", sql: `ALTER TABLE realm_challenges ADD COLUMN commander_id TEXT CHECK(commander_id IN ('crown_guard','quartermaster','vanguard'));`})
}

func init() {
	migrations = append(migrations, migration{name: "018_tactical_rules", sql: `
ALTER TABLE bot_matches DROP CONSTRAINT bot_matches_gameplay_rules_version_check;
ALTER TABLE bot_matches ADD CONSTRAINT bot_matches_gameplay_rules_version_check CHECK (gameplay_rules_version IN (1,2,3));
`})
	migrations = append(migrations, migration{name: "019_analytics_schema_constraint", sql: `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='analytics_events_player_event_id_key'
    AND conrelid='analytics_events'::regclass) THEN
    ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_player_event_id_key UNIQUE(player_id,event_id);
  END IF;
END $$;
`})
	migrations = append(migrations, migration{name: "020_bot_difficulty", sql: `
ALTER TABLE bot_matches ADD COLUMN bot_difficulty TEXT NOT NULL DEFAULT 'normal'
 CHECK (bot_difficulty IN ('easy','normal','hard'));
`})
	// Rules v4 (commander abilities + fog of war). commander_id is the
	// player's commander captured at ticket issue; settlement replays the
	// ability with this value, never a client-sent one. NULL for older rows.
	migrations = append(migrations, migration{name: "021_rules_v4_commander", sql: `
ALTER TABLE bot_matches DROP CONSTRAINT bot_matches_gameplay_rules_version_check;
ALTER TABLE bot_matches ADD CONSTRAINT bot_matches_gameplay_rules_version_check CHECK (gameplay_rules_version IN (1,2,3,4));
ALTER TABLE bot_matches ADD COLUMN commander_id TEXT CHECK (commander_id IN ('crown_guard','quartermaster','vanguard'));
`})
	// Seed opponents (see seed_bots.go). Real players default to FALSE.
	migrations = append(migrations, migration{name: "022_player_is_bot", sql: `
ALTER TABLE players ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;
`})
	// Single-player campaign progress: how many levels in a row the player has
	// completed (see levels.go). No economy value is attached to it.
	migrations = append(migrations, migration{name: "023_levels_completed", sql: `
ALTER TABLE players ADD COLUMN IF NOT EXISTS levels_completed INTEGER NOT NULL DEFAULT 0
 CHECK (levels_completed >= 0 AND levels_completed <= 10);
`})
	// First-clear coin reward per campaign level (see levels.go). The unique
	// (player_id, level_id) key is the permanent "paid once" guard; claim_id is
	// the client-generated idempotency key for retries.
	migrations = append(migrations, migration{name: "024_level_reward_claims", sql: `
CREATE TABLE IF NOT EXISTS level_reward_claims (
  claim_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  level_id INTEGER NOT NULL CHECK (level_id >= 1 AND level_id <= 10),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_id, level_id)
);
`})
}
