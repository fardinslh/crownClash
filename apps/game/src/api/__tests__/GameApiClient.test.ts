import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCareer } from '@crown-clash/game-core';
import type { PlatformAdapter } from '@crown-clash/platform';
import { GameApiClient } from '../GameApiClient.js';

const platform = {
  platform: 'browser',
  getInitDataRaw: () => 'user=%7B%22id%22%3A%22client_test%22%7D',
} as PlatformAdapter;

describe('GameApiClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs in with platform init data and uses the session token', async () => {
    const career = createDefaultCareer('browser:client_test');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(
          JSON.stringify({ platform: 'browser', initData: platform.getInitDataRaw() })
        );
        return new Response(JSON.stringify({ token: 'session-token', career }), { status: 200 });
      }

      expect(url).toContain('/career');
      expect(init?.headers).toMatchObject({ authorization: 'Bearer session-token' });
      return new Response(JSON.stringify({ career }), { status: 200 });
    });

    const client = new GameApiClient('http://api.test');
    await expect(client.login(platform)).resolves.toEqual(career);
    await expect(client.getCareer()).resolves.toEqual(career);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns server errors as typed API errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'insufficient_coins' }), { status: 400 })
    );

    const client = new GameApiClient('http://api.test');
    await expect(client.login(platform)).rejects.toMatchObject({
      message: 'insufficient_coins',
      status: 400,
    });
  });
});
