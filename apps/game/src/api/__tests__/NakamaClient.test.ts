import { describe, expect, it, vi } from 'vitest';
import { NakamaClient, isNakamaTransportError, normalizeNakamaError } from '../NakamaClient.js';
import { StaleSocketError } from '../GameApiClient.js';
import { featureFlags } from '../../config/featureFlags.js';

describe('NakamaClient settle transport payload', () => {
  it('sends the selected bot level and consumes the authoritative ticket', async () => {
    for (const botDifficulty of ['easy', 'normal', 'hard'] as const) {
      const client = new NakamaClient('127.0.0.1', '7350', false, 'defaultkey');
      const ticket = { matchId: 'issued-ticket', battlefieldId: 'crown_cross', botDifficulty, gameplayRulesVersion: 3 };
      const rpc = vi.fn().mockResolvedValue({ payload: JSON.stringify({ ticket }) });
      (client as unknown as { socket: unknown }).socket = { rpc };
      await expect(client.startBotMatch(botDifficulty)).resolves.toEqual(ticket);
      expect(rpc).toHaveBeenCalledExactlyOnceWith('match/start', JSON.stringify({ botDifficulty, supportedGameplayRulesVersions: [1, 2, 3] }));
    }
  });
  function clientWithRecordedRpc() {
    const client = new NakamaClient('127.0.0.1', '7350', false, 'defaultkey');
    const rpcCalls: Array<{ id: string; payload: string }> = [];
    // Inject a fake socket below the private rpc() helper to capture the
    // exact wire format of the match/settle RPC.
    (client as unknown as { socket: unknown }).socket = {
      rpc: async (id: string, payload: string) => {
        rpcCalls.push({ id, payload });
        return { payload: JSON.stringify({ settlement: { matchId: 'bot_1' } }) };
      },
    };
    return { client, rpcCalls };
  }

  it('includes clientObservedStatus in the settle RPC payload when supplied', async () => {
    const { client, rpcCalls } = clientWithRecordedRpc();

    await client.settleMatch('bot_1', [], 'victory');

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].id).toBe('match/settle');
    const sent = JSON.parse(rpcCalls[0].payload) as Record<string, unknown>;
    expect(sent.matchId).toBe('bot_1');
    expect(sent.clientObservedStatus).toBe('victory');
  });

  it('omits the clientObservedStatus property entirely when undefined', async () => {
    const { client, rpcCalls } = clientWithRecordedRpc();

    await client.settleMatch('bot_1', []);

    expect(rpcCalls).toHaveLength(1);
    const sent = JSON.parse(rpcCalls[0].payload) as Record<string, unknown>;
    expect('clientObservedStatus' in sent).toBe(false);
  });
});

describe('NakamaClient feature config', () => {
  it('passes the authenticated remote rollout decision into live matching', async () => {
    const client = new NakamaClient('127.0.0.1', '7350', false, 'defaultkey');
    const socket = {
      connect: async () => undefined,
      disconnect: () => undefined,
      rpc: async (id: string) => {
        if (id === 'config/features') {
          return { payload: JSON.stringify({ flags: { enable2v2: true, rolloutPercent: 5, platform: 'bale' } }) };
        }
        if (id === 'career/get') {
          return { payload: JSON.stringify({ career: { playerId: 'p1' } }) };
        }
        throw new Error(`unexpected rpc ${id}`);
      },
    };
    (client as any).client.authenticateCustom = async () => ({ token: 'token' });
    (client as any).client.createSocket = () => socket;
    const platform = {
      platform: 'bale',
      getUser: () => ({ id: '7', firstName: 'P' }),
      getInitDataRaw: () => 'signed',
    };
    await client.login(platform as any);
    expect(featureFlags.enable2v2).toBe(true);
    expect((client.openLiveMatch() as any).flags.enable2v2).toBe(true);
  });

  it('fails closed when remote config is unavailable', async () => {
    const client = new NakamaClient('127.0.0.1', '7350', false, 'defaultkey');
    const socket = {
      connect: async () => undefined,
      disconnect: () => undefined,
      rpc: async (id: string) => {
        if (id === 'config/features') throw new Error('offline');
        return { payload: JSON.stringify({ career: { playerId: 'p2' } }) };
      },
    };
    (client as any).client.authenticateCustom = async () => ({ token: 'token' });
    (client as any).client.createSocket = () => socket;
    await client.login({ platform: 'browser', getUser: () => ({ id: '8' }), getInitDataRaw: () => 'signed' } as any);
    expect(featureFlags.enable2v2).toBe(false);
  });
});

describe('NakamaClient error normalization', () => {
  it('identifies exact Nakama SDK socket transport errors', () => {
    // Exact string rejections from @heroiclabs/nakama-js/socket.ts
    const socketNotEstablished = 'Socket connection has not been established yet.';
    const socketResponseTimeout = 'The socket timed out while waiting for a response.';
    const socketConnectTimeout = 'The socket timed out when trying to connect.';

    expect(isNakamaTransportError(socketNotEstablished)).toBe(true);
    expect(isNakamaTransportError(new Error(socketNotEstablished))).toBe(true);

    expect(isNakamaTransportError(socketResponseTimeout)).toBe(true);
    expect(isNakamaTransportError(new Error(socketResponseTimeout))).toBe(true);

    expect(isNakamaTransportError(socketConnectTimeout)).toBe(true);
    expect(isNakamaTransportError(new Error(socketConnectTimeout))).toBe(true);

    expect(isNakamaTransportError('socket_closed')).toBe(true);
    expect(isNakamaTransportError('socket_not_connected')).toBe(true);
    expect(isNakamaTransportError('live_socket_not_connected')).toBe(true);
    expect(isNakamaTransportError(new StaleSocketError())).toBe(true);
  });

  it('normalizes transport errors into StaleSocketError instances', () => {
    const rawNotEstablished = 'Socket connection has not been established yet.';
    const normalized1 = normalizeNakamaError(rawNotEstablished);
    expect(normalized1).toBeInstanceOf(StaleSocketError);
    expect(normalized1.message).toBe(rawNotEstablished);

    const rawTimeout = 'The socket timed out while waiting for a response.';
    const normalized2 = normalizeNakamaError(new Error(rawTimeout));
    expect(normalized2).toBeInstanceOf(StaleSocketError);
    expect(normalized2.message).toBe(rawTimeout);
  });

  it('preserves domain and validation errors as non-transport errors', () => {
    const domainErrors = [
      'bot_match_not_found',
      'bot_match_owned_by_another_player',
      'foreign ownership',
      'invalid_argument',
      'invalid_actions',
      'invalid_payload',
      'unauthorized',
      'unauthenticated',
      'commander_locked',
      'insufficient_coins',
    ];

    for (const code of domainErrors) {
      expect(isNakamaTransportError(code)).toBe(false);
      expect(isNakamaTransportError(new Error(code))).toBe(false);
      expect(isNakamaTransportError({ message: code })).toBe(false);

      const normalized = normalizeNakamaError(new Error(code));
      expect(normalized).not.toBeInstanceOf(StaleSocketError);
      expect(normalized.message).toBe(code);
    }
  });

  it('returns an existing StaleSocketError unchanged', () => {
    const error = new StaleSocketError('custom_stale');
    expect(normalizeNakamaError(error)).toBe(error);
  });
});


describe('analytics across scene transitions', () => {
  const event = { eventId:'event_1', sessionId:'session_1', occurredAt:Date.now(), schemaVersion:1 as const, name:'session_start' as const, props:{} };
  it('uses authenticated HTTP when the live socket has been retired and propagates failures for retry', async () => {
    const client = new NakamaClient('127.0.0.1','7350',false,'defaultkey');
    const session = { token:'test-token' };
    const socketRpc = vi.fn().mockRejectedValue(new StaleSocketError('retired'));
    const httpRpc = vi.fn().mockResolvedValue({ payload:'{}' });
    (client as any).session = session;
    (client as any).socket = { rpc:socketRpc };
    (client as any).client.rpc = httpRpc;
    await client.trackEvents([event]);
    expect(httpRpc).toHaveBeenCalledWith(session,'analytics/events',{events:[event]});
    expect(socketRpc).not.toHaveBeenCalled();
    httpRpc.mockRejectedValueOnce(new Error('offline'));
    await expect(client.trackEvents([event])).rejects.toThrow('offline');
  });
  it('requires authentication before sending an analytics batch', async () => {
    const client = new NakamaClient('127.0.0.1','7350',false,'defaultkey');
    const rpc = vi.fn();(client as any).client.rpc = rpc;
    await expect(client.trackEvents([event])).rejects.toThrow('analytics_not_authenticated');
    expect(rpc).not.toHaveBeenCalled();
  });
});
