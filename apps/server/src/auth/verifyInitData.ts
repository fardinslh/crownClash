import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifiedInitData {
  userId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  authDate: number;
}

export type InitDataVerificationCode =
  | 'missing_hash'
  | 'missing_auth_date'
  | 'invalid_signature'
  | 'expired'
  | 'missing_user'
  | 'malformed';

export class InitDataVerificationFailure extends Error {
  constructor(public readonly code: InitDataVerificationCode) {
    super(`init_data_invalid:${code}`);
  }
}

/**
 * Validates raw initData produced by Telegram Mini App WebViews, and by Bale,
 * whose Mini App bridge mirrors Telegram's WebApp API (same initData shape,
 * signed with Bale's own bot token instead of Telegram's).
 *
 * Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyTelegramStyleInitData(
  rawInitData: string,
  botToken: string,
  maxAgeSeconds: number
): VerifiedInitData {
  const params = new URLSearchParams(rawInitData);

  const hash = params.get('hash');
  if (!hash) {
    throw new InitDataVerificationFailure('missing_hash');
  }

  const authDateRaw = params.get('auth_date');
  if (!authDateRaw) {
    throw new InitDataVerificationFailure('missing_auth_date');
  }
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate)) {
    throw new InitDataVerificationFailure('malformed');
  }

  if (maxAgeSeconds > 0) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (nowSeconds - authDate > maxAgeSeconds) {
      throw new InitDataVerificationFailure('expired');
    }
  }

  const dataCheckEntries: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    dataCheckEntries.push(`${key}=${value}`);
  }
  dataCheckEntries.sort();
  const dataCheckString = dataCheckEntries.join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const expected = Buffer.from(computedHash, 'utf8');
  const actual = Buffer.from(hash, 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new InitDataVerificationFailure('invalid_signature');
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new InitDataVerificationFailure('missing_user');
  }

  let parsedUser: Record<string, unknown>;
  try {
    parsedUser = JSON.parse(userRaw);
  } catch {
    throw new InitDataVerificationFailure('malformed');
  }
  if (!parsedUser || typeof parsedUser.id === 'undefined') {
    throw new InitDataVerificationFailure('missing_user');
  }

  return {
    userId: String(parsedUser.id),
    username: typeof parsedUser.username === 'string' ? parsedUser.username : undefined,
    firstName: typeof parsedUser.first_name === 'string' ? parsedUser.first_name : undefined,
    lastName: typeof parsedUser.last_name === 'string' ? parsedUser.last_name : undefined,
    languageCode: typeof parsedUser.language_code === 'string' ? parsedUser.language_code : undefined,
    authDate,
  };
}

/**
 * Extracts a user id from a query-string-shaped initData without verifying
 * any signature. Used only for trust tiers that have no known crypto scheme
 * (Eitaa) or that are inherently unauthenticated (browser/dev guest).
 */
export function extractUnverifiedUser(rawInitData: string): { id: string; username?: string } | null {
  const params = new URLSearchParams(rawInitData);

  const userRaw = params.get('user');
  if (userRaw) {
    try {
      const parsed = JSON.parse(userRaw) as Record<string, unknown>;
      if (parsed && typeof parsed.id !== 'undefined') {
        return {
          id: String(parsed.id),
          username: typeof parsed.username === 'string' ? parsed.username : undefined,
        };
      }
    } catch {
      // fall through to query-param extraction below
    }
  }

  const rawId = params.get('eitaa_id') || params.get('user_id');
  if (rawId) {
    return { id: rawId, username: params.get('username') ?? undefined };
  }

  return null;
}
