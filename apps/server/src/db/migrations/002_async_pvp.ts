export const name = '002_async_pvp';

export const sql = `
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
`;
