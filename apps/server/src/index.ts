import { loadConfig } from './env.js';
import { createPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { createApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  const applied = await runMigrations(pool);
  if (applied.length > 0) {
    console.log(`[db] applied migrations: ${applied.join(', ')}`);
  }

  const app = createApp(pool, config);
  app.listen(config.port, () => {
    console.log(`[server] listening on port ${config.port} (${config.nodeEnv})`);
  });
}

main().catch((err) => {
  console.error('[server] failed to start', err);
  process.exitCode = 1;
});
