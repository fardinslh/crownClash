import { describe, expect, it } from 'vitest';
import { isNakamaTransportError, normalizeNakamaError } from '../NakamaClient.js';
import { StaleSocketError } from '../GameApiClient.js';

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
