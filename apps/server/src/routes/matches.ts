import { Router } from 'express';
import type { AuthenticatedRequest } from '../auth/middleware.js';
import { PlayerNotFoundError, type PlayerRepository } from '../repository/playerRepository.js';
import { ValidationError, parseIdempotencyKey, parseMatchStats, parseMatchStatus } from '../validation.js';

export function createMatchesRouter(repo: PlayerRepository): Router {
  const router = Router();

  router.post('/matches/settle', async (req: AuthenticatedRequest, res) => {
    const playerId = req.playerId as string;

    try {
      const matchId = parseIdempotencyKey(req.body?.matchId, 'matchId');
      const status = parseMatchStatus(req.body?.status);
      const stats = parseMatchStats(req.body?.stats);

      const settlement = await repo.settleMatch(playerId, status, stats, matchId);
      res.json({ settlement });
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof PlayerNotFoundError) {
        res.status(404).json({ error: 'player_not_found' });
        return;
      }
      console.error('[matches/settle] failed', err);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}
