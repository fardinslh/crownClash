import jwt from 'jsonwebtoken';

export interface SessionTokenPayload {
  sub: string;
  platform: string;
}

const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

export function signSessionToken(
  payload: SessionTokenPayload,
  secret: string,
  expiresInSeconds: number = SEVEN_DAYS_SECONDS
): string {
  return jwt.sign(payload, secret, { expiresIn: expiresInSeconds });
}

export function verifySessionToken(token: string, secret: string): SessionTokenPayload {
  const decoded = jwt.verify(token, secret);
  if (typeof decoded === 'string' || !decoded.sub || !decoded.platform) {
    throw new Error('invalid_token_payload');
  }
  return { sub: String(decoded.sub), platform: String(decoded.platform) };
}
