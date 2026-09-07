import { Router } from 'express';
import { getRankTier } from '@crown-clash/game-core';
import type { AppConfig } from '../env.js';
import { InitDataVerificationFailure, extractUnverifiedUser, verifyTelegramStyleInitData } from '../auth/verifyInitData.js';
import { signSessionToken } from '../auth/jwt.js';
import type { PlayerRepository } from '../repository/playerRepository.js';

const SUPPORTED_PLATFORMS = new Set(['telegram', 'bale', 'eitaa', 'browser', 'mock']);

export function createAuthRouter(repo: PlayerRepository, config: AppConfig): Router {
  const router = Router();

  router.post('/auth/login', async (req, res) => {
    const { platform, initData } = req.body ?? {};

    if (typeof platform !== 'string' || !SUPPORTED_PLATFORMS.has(platform)) {
      res.status(400).json({ error: 'unsupported_platform' });
      return;
    }
    if (typeof initData !== 'string') {
      res.status(400).json({ error: 'missing_init_data' });
      return;
    }

    try {
      let externalId: string;
      let username: string | undefined;

      if (platform === 'telegram' || platform === 'bale') {
        const botToken = platform === 'telegram' ? config.telegramBotToken : config.baleBotToken;
        if (!botToken) {
          res.status(503).json({ error: 'platform_not_configured' });
          return;
        }
        const verified = verifyTelegramStyleInitData(initData, botToken, config.initDataMaxAgeSeconds);
        externalId = verified.userId;
        username = verified.username;
      } else if (platform === 'eitaa') {
        // Eitaa Mini Apps have no documented initData signature yet. Accepted
        // unverified until Eitaa publishes a crypto spec; same trust tier as guest.
        const user = extractUnverifiedUser(initData);
        if (!user) {
          res.status(400).json({ error: 'missing_user' });
          return;
        }
        externalId = user.id;
        username = user.username;
      } else {
        if (!config.allowGuestAuth) {
          res.status(403).json({ error: 'guest_auth_disabled' });
          return;
        }
        const user = extractUnverifiedUser(initData);
        if (!user) {
          res.status(400).json({ error: 'missing_user' });
          return;
        }
        externalId = user.id;
        username = user.username;
      }

      const playerId = `${platform}:${externalId}`;
      const career = await repo.getOrCreateCareer(playerId, platform, username);
      const token = signSessionToken({ sub: playerId, platform }, config.jwtSecret);

      res.json({ token, career, rank: getRankTier(career.trophies) });
    } catch (err) {
      if (err instanceof InitDataVerificationFailure) {
        res.status(401).json({ error: err.code });
        return;
      }
      console.error('[auth/login] failed', err);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}
