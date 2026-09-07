import type { Pool, PoolClient } from 'pg';
import {
  createDefaultCareer,
  getPlayerUpgradeModifiers,
  getRankTier,
  purchaseUpgrade as purchaseUpgradeDomain,
  simulatePvpBattle,
  settleMatch,
  type PvpAction,
  type PvpAttackHistoryEntry,
  type PvpAttackResult,
  type PvpDefenseSnapshot,
  type PvpOpponent,
  type EconomyLedgerEntry,
  type MatchSettlement,
  type MatchStats,
  type PlayerCareer,
  type UpgradePurchaseResult,
  type UpgradeType,
} from '@crown-clash/game-core';
import type { SettlementStatus } from '../validation.js';

interface PlayerRow {
  id: string;
  platform: string;
  username: string | null;
  coins: number;
  gems: number;
  trophies: number;
  starting_garrison_level: number;
  production_level: number;
  army_speed_level: number;
  matches_played: number;
  matches_won: number;
  current_streak: number;
  best_streak: number;
  last_match_timestamp: string | number;
}

interface LedgerRow {
  id: string;
  player_id: string;
  currency: EconomyLedgerEntry['currency'];
  amount: number;
  reason: string;
  source: string;
  previous_balance: number;
  resulting_balance: number;
  timestamp: string | number;
}

interface DefenseRow {
  player_id: string;
  display_name: string;
  trophies: number;
  matches_won: number;
  modifiers: PvpDefenseSnapshot['modifiers'];
  published_at: string | number;
  is_revenge?: boolean;
}

function rowToCareer(row: PlayerRow): PlayerCareer {
  return {
    playerId: row.id,
    coins: row.coins,
    gems: row.gems,
    trophies: row.trophies,
    startingGarrisonLevel: row.starting_garrison_level,
    productionLevel: row.production_level,
    armySpeedLevel: row.army_speed_level,
    matchesPlayed: row.matches_played,
    matchesWon: row.matches_won,
    currentStreak: row.current_streak,
    bestStreak: row.best_streak,
    lastMatchTimestamp: Number(row.last_match_timestamp),
  };
}

function rowToLedgerEntry(row: LedgerRow): EconomyLedgerEntry {
  return {
    id: row.id,
    player: row.player_id,
    currency: row.currency,
    amount: row.amount,
    reason: row.reason,
    source: row.source,
    previousBalance: row.previous_balance,
    resultingBalance: row.resulting_balance,
    timestamp: Number(row.timestamp),
  };
}

export class PlayerNotFoundError extends Error {
  constructor(playerId: string) {
    super(`player_not_found:${playerId}`);
  }
}

export class PvpDefenseNotFoundError extends Error {
  constructor(playerId: string) {
    super(`pvp_defense_not_found:${playerId}`);
  }
}

export class PvpSelfAttackError extends Error {
  constructor() {
    super('pvp_cannot_attack_self');
  }
}

export class PvpAttackOwnershipError extends Error {
  constructor() {
    super('pvp_attack_id_owned_by_another_player');
  }
}

export class PlayerRepository {
  constructor(private readonly pool: Pool) {}

  async getOrCreateCareer(playerId: string, platform: string, username?: string): Promise<PlayerCareer> {
    const existing = await this.pool.query<PlayerRow>('SELECT * FROM players WHERE id = $1', [playerId]);
    if (existing.rows.length > 0) {
      return rowToCareer(existing.rows[0]);
    }

    const fresh = createDefaultCareer(playerId);
    await this.pool.query(
      `INSERT INTO players (id, platform, username, coins, gems, trophies)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [playerId, platform, username ?? null, fresh.coins, fresh.gems, fresh.trophies]
    );

    const inserted = await this.pool.query<PlayerRow>('SELECT * FROM players WHERE id = $1', [playerId]);
    return rowToCareer(inserted.rows[0]);
  }

  async getLedger(playerId: string, limit: number): Promise<EconomyLedgerEntry[]> {
    const result = await this.pool.query<LedgerRow>(
      `SELECT id, player_id, currency, amount, reason, source, previous_balance, resulting_balance, timestamp
       FROM economy_ledger WHERE player_id = $1 ORDER BY timestamp DESC LIMIT $2`,
      [playerId, limit]
    );
    return result.rows.map(rowToLedgerEntry);
  }

  async getPlayerDisplayName(playerId: string): Promise<string> {
    const result = await this.pool.query<{ username: string | null }>(
      'SELECT username FROM players WHERE id = $1',
      [playerId]
    );
    return result.rows[0]?.username || playerId;
  }

  async settleMatch(
    playerId: string,
    status: SettlementStatus,
    stats: MatchStats,
    matchId: string
  ): Promise<MatchSettlement> {
    const client = await this.pool.connect();
    try {
      const existing = await client.query<{ settlement: MatchSettlement }>(
        'SELECT settlement FROM match_settlements WHERE match_id = $1',
        [matchId]
      );
      if (existing.rows.length > 0) {
        return existing.rows[0].settlement;
      }

      await client.query('BEGIN');

      const playerRes = await client.query<PlayerRow>('SELECT * FROM players WHERE id = $1 FOR UPDATE', [playerId]);
      if (playerRes.rows.length === 0) {
        throw new PlayerNotFoundError(playerId);
      }

      const career = rowToCareer(playerRes.rows[0]);
      const settlement = settleMatch(career, status, stats, matchId, Date.now());

      await this.persistCareer(client, settlement.newCareer);
      await this.insertLedgerEntries(client, settlement.ledgerEntries);
      await client.query(
        `INSERT INTO match_settlements (match_id, player_id, status, settlement)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (match_id) DO NOTHING`,
        [matchId, playerId, status, JSON.stringify(settlement)]
      );

      await client.query('COMMIT');
      return settlement;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async purchaseUpgrade(playerId: string, type: UpgradeType, purchaseId: string): Promise<UpgradePurchaseResult> {
    const client = await this.pool.connect();
    try {
      const existing = await client.query<{ result: UpgradePurchaseResult }>(
        'SELECT result FROM upgrade_purchases WHERE purchase_id = $1',
        [purchaseId]
      );
      if (existing.rows.length > 0) {
        return existing.rows[0].result;
      }

      await client.query('BEGIN');

      const playerRes = await client.query<PlayerRow>('SELECT * FROM players WHERE id = $1 FOR UPDATE', [playerId]);
      if (playerRes.rows.length === 0) {
        throw new PlayerNotFoundError(playerId);
      }

      const career = rowToCareer(playerRes.rows[0]);
      const result = purchaseUpgradeDomain(career, type, purchaseId);

      if (!result.success) {
        // Nothing was mutated, so a failed attempt does not need an
        // idempotency record: retrying it just re-evaluates current state.
        await client.query('ROLLBACK');
        return result;
      }

      await this.persistCareer(client, result.newCareer);
      await this.insertLedgerEntries(client, [result.ledgerEntry]);
      await client.query(
        `INSERT INTO upgrade_purchases (purchase_id, player_id, upgrade_type, result)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (purchase_id) DO NOTHING`,
        [purchaseId, playerId, type, JSON.stringify(result)]
      );

      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async publishDefense(
    playerId: string,
    displayName: string,
    career: PlayerCareer,
    publishedAt = Date.now()
  ): Promise<PvpDefenseSnapshot> {
    const snapshot: PvpDefenseSnapshot = {
      playerId,
      displayName: displayName.slice(0, 40) || playerId,
      trophies: career.trophies,
      matchesWon: career.matchesWon,
      modifiers: getPlayerUpgradeModifiers(career),
      publishedAt,
    };

    await this.pool.query(
      `INSERT INTO pvp_defenses
         (player_id, display_name, trophies, matches_won, modifiers, published_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (player_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         trophies = EXCLUDED.trophies,
         matches_won = EXCLUDED.matches_won,
         modifiers = EXCLUDED.modifiers,
         published_at = EXCLUDED.published_at,
         updated_at = now()`,
      [
        snapshot.playerId,
        snapshot.displayName,
        snapshot.trophies,
        snapshot.matchesWon,
        JSON.stringify(snapshot.modifiers),
        snapshot.publishedAt,
      ]
    );

    return snapshot;
  }

  async getPvpOpponents(playerId: string, playerTrophies: number, limit: number): Promise<PvpOpponent[]> {
    const result = await this.pool.query<DefenseRow>(
      `SELECT
         d.player_id,
         d.display_name,
         d.trophies,
         d.matches_won,
         d.published_at,
         d.modifiers,
         EXISTS (
           SELECT 1
           FROM pvp_attacks revenge_check
           WHERE revenge_check.attacker_id = d.player_id
             AND revenge_check.defender_id = $1
         ) AS is_revenge
       FROM pvp_defenses d
       WHERE d.player_id <> $1
       ORDER BY ABS(d.trophies - $2), d.published_at DESC
       LIMIT $3`,
      [playerId, playerTrophies, limit]
    );

    return result.rows.map((row) => ({
      playerId: row.player_id,
      displayName: row.display_name,
      trophies: row.trophies,
      matchesWon: row.matches_won,
      rankId: getRankTier(row.trophies).id,
      defensePublishedAt: Number(row.published_at),
      isRevenge: Boolean(row.is_revenge),
    }));
  }

  async getPvpHistory(playerId: string, limit: number): Promise<PvpAttackHistoryEntry[]> {
    const result = await this.pool.query<{
      attack_id: string;
      attacker_id: string;
      defender_id: string;
      status: PvpAttackResult['summary']['status'];
      is_revenge: boolean;
      duration_seconds: number;
      created_at: string | number;
    }>(
      `SELECT
         attack_id,
         attacker_id,
         defender_id,
         summary->>'status' AS status,
         is_revenge,
         (summary->>'durationSeconds')::integer AS duration_seconds,
         created_at
       FROM pvp_attacks
       WHERE attacker_id = $1 OR defender_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [playerId, limit]
    );

    return result.rows.map((row) => ({
      attackId: row.attack_id,
      attackerId: row.attacker_id,
      defenderId: row.defender_id,
      status: row.status,
      isRevenge: row.is_revenge,
      durationSeconds: row.duration_seconds,
      createdAt: Number(row.created_at),
    }));
  }

  async settlePvpAttack(
    attackerId: string,
    defenderId: string,
    attackId: string,
    actions: readonly PvpAction[]
  ): Promise<PvpAttackResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query<{ result: PvpAttackResult }>(
        `SELECT jsonb_build_object(
           'attackId', attack_id,
           'attackerId', attacker_id,
           'defenderId', defender_id,
           'isRevenge', is_revenge,
           'summary', summary,
           'settlement', settlement
         ) AS result
         FROM pvp_attacks
         WHERE attack_id = $1`,
        [attackId]
      );
      if (existing.rows.length > 0) {
        if (existing.rows[0].result.attackerId !== attackerId) {
          throw new PvpAttackOwnershipError();
        }
        await client.query('COMMIT');
        return existing.rows[0].result;
      }

      if (attackerId === defenderId) {
        throw new PvpSelfAttackError();
      }

      const attackerRes = await client.query<PlayerRow>(
        'SELECT * FROM players WHERE id = $1 FOR UPDATE',
        [attackerId]
      );
      if (attackerRes.rows.length === 0) {
        throw new PlayerNotFoundError(attackerId);
      }

      const defenseRes = await client.query<DefenseRow>(
        'SELECT player_id, display_name, trophies, matches_won, modifiers, published_at FROM pvp_defenses WHERE player_id = $1 FOR SHARE',
        [defenderId]
      );
      if (defenseRes.rows.length === 0) {
        throw new PvpDefenseNotFoundError(defenderId);
      }

      const career = rowToCareer(attackerRes.rows[0]);
      const defense = defenseRes.rows[0];
      const isRevengeRes = await client.query<{ is_revenge: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pvp_attacks
           WHERE attacker_id = $1 AND defender_id = $2
         ) AS is_revenge`,
        [defenderId, attackerId]
      );
      const isRevenge = Boolean(isRevengeRes.rows[0].is_revenge);
      const simulation = simulatePvpBattle({
        actions,
        playerModifiers: getPlayerUpgradeModifiers(career),
        enemyModifiers: defense.modifiers,
      });
      const summary = simulation.summary;
      const settlement = settleMatch(career, summary.status, summary.stats, attackId, Date.now());
      const result: PvpAttackResult = {
        attackId,
        attackerId,
        defenderId,
        isRevenge,
        summary,
        settlement,
      };

      await this.persistCareer(client, settlement.newCareer);
      await this.insertLedgerEntries(client, settlement.ledgerEntries);
      await client.query(
        `INSERT INTO pvp_attacks
           (attack_id, attacker_id, defender_id, is_revenge, actions, summary, settlement, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          attackId,
          attackerId,
          defenderId,
          isRevenge,
          JSON.stringify(actions),
          JSON.stringify(summary),
          JSON.stringify(settlement),
          settlement.newCareer.lastMatchTimestamp,
        ]
      );

      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async persistCareer(client: PoolClient, career: PlayerCareer): Promise<void> {
    await client.query(
      `UPDATE players SET
         coins = $2, gems = $3, trophies = $4,
         starting_garrison_level = $5, production_level = $6, army_speed_level = $7,
         matches_played = $8, matches_won = $9, current_streak = $10, best_streak = $11,
         last_match_timestamp = $12, updated_at = now()
       WHERE id = $1`,
      [
        career.playerId,
        career.coins,
        career.gems,
        career.trophies,
        career.startingGarrisonLevel,
        career.productionLevel,
        career.armySpeedLevel,
        career.matchesPlayed,
        career.matchesWon,
        career.currentStreak,
        career.bestStreak,
        career.lastMatchTimestamp,
      ]
    );
  }

  private async insertLedgerEntries(client: PoolClient, entries: EconomyLedgerEntry[]): Promise<void> {
    for (const entry of entries) {
      await client.query(
        `INSERT INTO economy_ledger
           (id, player_id, currency, amount, reason, source, previous_balance, resulting_balance, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          entry.id,
          entry.player,
          entry.currency,
          entry.amount,
          entry.reason,
          entry.source,
          entry.previousBalance,
          entry.resultingBalance,
          entry.timestamp,
        ]
      );
    }
  }
}
