import { describe, expect, it } from 'vitest';
import { NakamaClient, isNakamaTransportError, normalizeNakamaError } from '../NakamaClient.js';
import { StaleSocketError } from '../GameApiClient.js';

describe('NakamaClient settle transport payload', () => {
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
