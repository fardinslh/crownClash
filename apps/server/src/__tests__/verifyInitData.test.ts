import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InitDataVerificationFailure, verifyTelegramStyleInitData } from '../auth/verifyInitData.js';

const BOT_TOKEN = 'test-bot-token-123456';

function signInitData(fields: Record<string, string>, botToken = BOT_TOKEN): string {
  const entries = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([key, value]) => `${key}=${value}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

function buildFields(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 12345, username: 'commander', first_name: 'Test' }),
    ...overrides,
  };
}

describe('verifyTelegramStyleInitData', () => {
  it('accepts a correctly signed payload', () => {
    const initData = signInitData(buildFields());
    const result = verifyTelegramStyleInitData(initData, BOT_TOKEN, 86400);

    expect(result.userId).toBe('12345');
    expect(result.username).toBe('commander');
  });

  it('rejects a payload signed with the wrong bot token', () => {
    const initData = signInitData(buildFields(), 'a-different-bot-token');

    expect(() => verifyTelegramStyleInitData(initData, BOT_TOKEN, 86400)).toThrow(InitDataVerificationFailure);
  });

  it('rejects a tampered field even if the hash format is valid', () => {
    const initData = signInitData(buildFields());
    const tampered = initData.replace('commander', 'attacker');

    expect(() => verifyTelegramStyleInitData(tampered, BOT_TOKEN, 86400)).toThrow(InitDataVerificationFailure);
  });

  it('rejects expired auth_date', () => {
    const staleAuthDate = String(Math.floor(Date.now() / 1000) - 100000);
    const initData = signInitData(buildFields({ auth_date: staleAuthDate }));

    expect(() => verifyTelegramStyleInitData(initData, BOT_TOKEN, 86400)).toThrow(InitDataVerificationFailure);
  });

  it('rejects a payload with no hash', () => {
    const params = new URLSearchParams(buildFields());
    expect(() => verifyTelegramStyleInitData(params.toString(), BOT_TOKEN, 86400)).toThrow(
      InitDataVerificationFailure
    );
  });

  it('rejects a payload missing the user field', () => {
    const fields = buildFields();
    delete fields.user;
    const initData = signInitData(fields);

    expect(() => verifyTelegramStyleInitData(initData, BOT_TOKEN, 86400)).toThrow(InitDataVerificationFailure);
  });
});
