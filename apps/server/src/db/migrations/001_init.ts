export const name = '001_init';

export const sql = `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  username TEXT,
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

-- match_id is the idempotency key: a retried settlement request for the same
-- match returns the row already stored here instead of re-applying rewards.
CREATE TABLE IF NOT EXISTS match_settlements (
  match_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  status TEXT NOT NULL,
  settlement JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_match_settlements_player ON match_settlements (player_id, created_at DESC);

-- purchase_id is the idempotency key for upgrade purchases, same rationale.
CREATE TABLE IF NOT EXISTS upgrade_purchases (
  purchase_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  upgrade_type TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_upgrade_purchases_player ON upgrade_purchases (player_id, created_at DESC);
`;
