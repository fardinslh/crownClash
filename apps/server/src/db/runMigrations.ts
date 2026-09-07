import { loadConfig } from '../env.js';
import { createPool } from './pool.js';
import { runMigrations } from './migrate.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);

runMigrations(pool)
  .then((applied) => {
    console.log(applied.length > 0 ? `Applied migrations: ${applied.join(', ')}` : 'No pending migrations.');
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
