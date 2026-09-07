import express, { type Express } from 'express';
import type { Pool } from 'pg';
import type { AppConfig } from './env.js';
import { PlayerRepository } from './repository/playerRepository.js';
import { requireAuth } from './auth/middleware.js';
import { createAuthRouter } from './routes/auth.js';
import { createCareerRouter } from './routes/career.js';
import { createMatchesRouter } from './routes/matches.js';
import { createUpgradesRouter } from './routes/upgrades.js';

export function createApp(pool: Pool, config: AppConfig): Express {
  const app = express();
  app.use(express.json());

  const repo = new PlayerRepository(pool);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(createAuthRouter(repo, config));

  const auth = requireAuth(config.jwtSecret);
  app.use(auth, createCareerRouter(repo));
  app.use(auth, createMatchesRouter(repo));
  app.use(auth, createUpgradesRouter(repo));

  return app;
}
