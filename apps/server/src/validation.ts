import type { MatchStats } from '@crown-clash/game-core';

export class ValidationError extends Error {}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function parseMatchStats(body: unknown): MatchStats {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('invalid_stats');
  }
  const b = body as Record<string, unknown>;

  if (!isFiniteNonNegativeNumber(b.matchDurationSeconds)) throw new ValidationError('invalid_matchDurationSeconds');
  if (!isFiniteNonNegativeNumber(b.playerUnitsDispatched)) throw new ValidationError('invalid_playerUnitsDispatched');
  if (!isFiniteNonNegativeNumber(b.enemyUnitsDispatched)) throw new ValidationError('invalid_enemyUnitsDispatched');
  if (!isFiniteNonNegativeNumber(b.territoriesCapturedByPlayer))
    throw new ValidationError('invalid_territoriesCapturedByPlayer');
  if (!isFiniteNonNegativeNumber(b.territoriesCapturedByEnemy))
    throw new ValidationError('invalid_territoriesCapturedByEnemy');

  return {
    matchDurationSeconds: b.matchDurationSeconds as number,
    playerUnitsDispatched: b.playerUnitsDispatched as number,
    enemyUnitsDispatched: b.enemyUnitsDispatched as number,
    territoriesCapturedByPlayer: b.territoriesCapturedByPlayer as number,
    territoriesCapturedByEnemy: b.territoriesCapturedByEnemy as number,
  };
}

const MATCH_STATUSES = new Set(['victory', 'defeat', 'draw']);
export type SettlementStatus = 'victory' | 'defeat' | 'draw';

export function parseMatchStatus(value: unknown): SettlementStatus {
  if (typeof value !== 'string' || !MATCH_STATUSES.has(value)) {
    throw new ValidationError('invalid_status');
  }
  return value as SettlementStatus;
}

export function parseIdempotencyKey(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new ValidationError(`invalid_${field}`);
  }
  return value;
}

const UPGRADE_TYPES = new Set(['starting_garrison', 'production', 'army_speed']);
export type UpgradeTypeInput = 'starting_garrison' | 'production' | 'army_speed';

export function parseUpgradeType(value: unknown): UpgradeTypeInput {
  if (typeof value !== 'string' || !UPGRADE_TYPES.has(value)) {
    throw new ValidationError('invalid_upgrade_type');
  }
  return value as UpgradeTypeInput;
}
