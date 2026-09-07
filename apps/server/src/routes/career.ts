import { Router } from 'express';
import { getRankTier } from '@crown-clash/game-core';
import type { AuthenticatedRequest } from '../auth/middleware.js';
import type { PlayerRepository } from '../repository/playerRepository.js';

export function createCareerRouter(repo: PlayerRepository): Router {
  const router = Router();

  router.get('/career', async (req: AuthenticatedRequest, res) => {
    const playerId = req.playerId as string;
    const career = await repo.getOrCreateCareer(playerId, req.platform ?? 'unknown');
    res.json({ career, rank: getRankTier(career.trophies) });
  });

  router.get('/ledger', async (req: AuthenticatedRequest, res) => {
    const playerId = req.playerId as string;
    const limitParam = Number(req.query.limit);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(200, Math.floor(limitParam)) : 50;
    const entries = await repo.getLedger(playerId, limit);
    res.json({ entries });
  });

  return router;
}
