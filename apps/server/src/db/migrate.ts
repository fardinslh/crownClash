import type { Pool } from 'pg';
import { migrations } from './migrations/index.js';

/**
 * Applies pending migrations in order, each in its own transaction, and
 * records which ones ran in schema_migrations so re-running is a no-op.
 */
export async function runMigrations(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    for (const migration of migrations) {
      const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [migration.name]);
      if (existing.rows.length > 0) continue;

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
        await client.query('COMMIT');
        applied.push(migration.name);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
  }

  return applied;
}
