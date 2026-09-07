import { Router } from 'express';
import type { AuthenticatedRequest } from '../auth/middleware.js';
import { PlayerNotFoundError, type PlayerRepository } from '../repository/playerRepository.js';
import { ValidationError, parseIdempotencyKey, parseUpgradeType } from '../validation.js';

export function createUpgradesRouter(repo: PlayerRepository): Router {
  const router = Router();

  router.post('/upgrades/purchase', async (req: AuthenticatedRequest, res) => {
    const playerId = req.playerId as string;

    try {
      const type = parseUpgradeType(req.body?.type);
      const purchaseId = parseIdempotencyKey(req.body?.purchaseId, 'purchaseId');

      const result = await repo.purchaseUpgrade(playerId, type, purchaseId);
      res.json({ result });
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof PlayerNotFoundError) {
        res.status(404).json({ error: 'player_not_found' });
        return;
      }
      console.error('[upgrades/purchase] failed', err);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}
