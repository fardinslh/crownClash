import { describe, expect, it } from 'vitest';
import {
  ValidationError,
  parseIdempotencyKey,
  parseMatchStats,
  parseMatchStatus,
  parseUpgradeType,
} from '../validation.js';

describe('parseMatchStats', () => {
  const valid = {
    matchDurationSeconds: 42,
    playerUnitsDispatched: 10,
    enemyUnitsDispatched: 8,
    territoriesCapturedByPlayer: 5,
    territoriesCapturedByEnemy: 2,
  };

  it('accepts a well-formed stats object', () => {
    expect(parseMatchStats(valid)).toEqual(valid);
  });

  it('rejects negative numbers', () => {
    expect(() => parseMatchStats({ ...valid, matchDurationSeconds: -1 })).toThrow(ValidationError);
  });

  it('rejects missing fields', () => {
    const { matchDurationSeconds, ...rest } = valid;
    expect(() => parseMatchStats(rest)).toThrow(ValidationError);
  });

  it('rejects non-object input', () => {
    expect(() => parseMatchStats('not-an-object')).toThrow(ValidationError);
  });
});

describe('parseMatchStatus', () => {
  it('accepts known statuses', () => {
    expect(parseMatchStatus('victory')).toBe('victory');
    expect(parseMatchStatus('defeat')).toBe('defeat');
    expect(parseMatchStatus('draw')).toBe('draw');
  });

  it('rejects unknown statuses', () => {
    expect(() => parseMatchStatus('playing')).toThrow(ValidationError);
    expect(() => parseMatchStatus(123)).toThrow(ValidationError);
  });
});

describe('parseUpgradeType', () => {
  it('accepts known upgrade types', () => {
    expect(parseUpgradeType('starting_garrison')).toBe('starting_garrison');
  });

  it('rejects unknown upgrade types', () => {
    expect(() => parseUpgradeType('super_upgrade')).toThrow(ValidationError);
  });
});

describe('parseIdempotencyKey', () => {
  it('accepts a reasonable string key', () => {
    expect(parseIdempotencyKey('match-123', 'matchId')).toBe('match-123');
  });

  it('rejects empty or oversized keys', () => {
    expect(() => parseIdempotencyKey('', 'matchId')).toThrow(ValidationError);
    expect(() => parseIdempotencyKey('x'.repeat(200), 'matchId')).toThrow(ValidationError);
    expect(() => parseIdempotencyKey(42, 'matchId')).toThrow(ValidationError);
  });
});
