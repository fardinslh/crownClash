import { Router } from 'express';
import type {
  PvpAction,
  PvpSimulationError,
} from '@crown-clash/game-core';
import type { AuthenticatedRequest } from '../auth/middleware.js';
import {
  PlayerNotFoundError,
  PvpAttackOwnershipError,
  PvpDefenseNotFoundError,
  PvpSelfAttackError,
  type PlayerRepository,
} from '../repository/playerRepository.js';
import {
  ValidationError,
  parseIdempotencyKey,
  parsePvpActions,
  parsePvpTargetId,
} from '../validation.js';

export function createPvpRouter(repo: PlayerRepository): Router {
  const router = Router();

  router.post('/pvp/defense/publish', async (req: AuthenticatedRequest, res) => {
    const playerId = req.playerId as string;
    try {
      const career = await repo.getOrCreateCareer(playerId, req.platform ?? 'unknown');
      const displayName = await repo.getPlayerDisplayName(playerId);
      const defense = await repo.publishDefense(playerId, displayName, career);
      res.json({ defense });
    } catch (err) {
      console.error('[pvp/defense/publish] failed', err);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/pvp/opponents', async (req: AuthenticatedRequest, res) => {
    const playerId = req.playerId as string;
    try {
      const career = await repo.getOrCreateCareer(playerId, req.platform ?? 'unknown');
      const requestedLimit = Number(req.query.limit);
      const limit =
        Number.isFinite(requestedLimit) && requestedLimit > 0
          ? Math.min(20, Math.floor(requestedLimit))
          : 8;
      const opponents = await repo.getPvpOpponents(playerId, career.trophies, limit);
      res.json({ opponents });
    } catch (err) {
      console.error('[pvp/opponents] failed', err);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/pvp/history', async (req: AuthenticatedRequest, res) => {
    const playerId = req.playerId as string;
    try {
      const requestedLimit = Number(req.query.limit);
      const limit =
        Number.isFinite(requestedLimit) && requestedLimit > 0
          ? Math.min(50, Math.floor(requestedLimit))
          : 20;
      const history = await repo.getPvpHistory(playerId, limit);
      res.json({ history });
    } catch (err) {
      console.error('[pvp/history] failed', err);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.post('/pvp/attacks', async (req: AuthenticatedRequest, res) => {
    const attackerId = req.playerId as string;
    try {
      const attackId = parseIdempotencyKey(req.body?.attackId, 'attackId');
      const defenderId = parsePvpTargetId(req.body?.defenderId);
      const actions: PvpAction[] = parsePvpActions(req.body?.actions);
      const result = await repo.settlePvpAttack(attackerId, defenderId, attackId, actions);
      res.json({ result });
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof PvpDefenseNotFoundError) {
        res.status(404).json({ error: 'pvp_target_not_found' });
        return;
      }
      if (err instanceof PvpSelfAttackError) {
        res.status(400).json({ error: 'pvp_cannot_attack_self' });
        return;
      }
      if (err instanceof PvpAttackOwnershipError) {
        res.status(409).json({ error: 'pvp_attack_id_conflict' });
        return;
      }
      if (err instanceof PlayerNotFoundError) {
        res.status(404).json({ error: 'player_not_found' });
        return;
      }
      if (isPvpSimulationError(err)) {
        res.status(400).json({ error: err.code });
        return;
      }
      console.error('[pvp/attacks] failed', err);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}

function isPvpSimulationError(error: unknown): error is PvpSimulationError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    [
      'too_many_actions',
      'invalid_sequence',
      'invalid_timestamp',
      'action_after_battle_end',
      'invalid_source',
      'invalid_target',
      'invalid_dispatch',
    ].includes(error.code)
  );
}
