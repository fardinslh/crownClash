import type { NextFunction, Request, Response } from 'express';
import { verifySessionToken } from './jwt.js';

export interface AuthenticatedRequest extends Request {
  playerId?: string;
  platform?: string;
}

export function requireAuth(jwtSecret: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const header = req.header('authorization') || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      res.status(401).json({ error: 'missing_authorization' });
      return;
    }

    try {
      const payload = verifySessionToken(token, jwtSecret);
      req.playerId = payload.sub;
      req.platform = payload.platform;
      next();
    } catch {
      res.status(401).json({ error: 'invalid_token' });
    }
  };
}
