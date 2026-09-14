import { describe, expect, it } from 'vitest';
import { CareerManager } from '../CareerManager.js';
import { createDefaultCareer, type MatchSettlement } from '@crown-clash/game-core';
import type { PlatformAdapter } from '@crown-clash/platform';
import { StaleSocketError, type CareerApi, type ClientObservedStatus } from '../../api/GameApiClient.js';

/**
 * Focused diagnostics tests: the client-observed bot match status is
 * forwarded to the settlement API as diagnostic-only, untrusted evidence.
 * It must never change how CareerManager applies the authoritative result.
 */

const storage = new Map<string, string>();
const localStorageMock: Storage = {
  get length() {
    return storage.size;
  },
  clear: () => storage.clear(),
  getItem: (key) => storage.get(key) ?? null,
  key: (index) => Array.from(storage.keys())[index] ?? null,
  removeItem: (key) => storage.delete(key),
  setItem: (key, value) => storage.set(key, value),
};

Object.defineProperty(globalThis, 'window', {
  value: { localStorage: localStorageMock },
  configurable: true,
});

function authoritativeDefeatSettlement(matchId: string): MatchSettlement {
  const career = createDefaultCareer('diag_player');
  return {
    matchId,
    status: 'defeat',
    breakdown: {
      baseCoins: 0,
      speedBonus: 0,
      dominationBonus: 0,
      streakBonus: 0,
      treasuryBonus: 0,
      totalCoins: 0,
      trophyDelta: -15,
    },
    stats: {
      matchDurationSeconds: 90,
      playerUnitsDispatched: 2,
      enemyUnitsDispatched: 55,
      territoriesCapturedByPlayer: 0,
      territoriesCapturedByEnemy: 6,
    },
    previousCareer: career,
    newCareer: { ...career, trophies: 0, matchesPlayed: 1 },
    previousRank: {
      id: 'recruit',
      name: 'Recruit',
      badge: 'x',
      minTrophies: 0,
      maxTrophies: 99,
      color: 0x94a3b8,
    },
    newRank: {
      id: 'recruit',
      name: 'Recruit',
      badge: 'x',
      minTrophies: 0,
      maxTrophies: 99,
      color: 0x94a3b8,
    },
    rankPromoted: false,
    ledgerEntries: [],
  };
}

function fakeApiWithRecordedSettle(settlement: MatchSettlement) {
  const settleCalls: Array<{
    matchId: string;
    actions: readonly unknown[];
    clientObservedStatus: ClientObservedStatus | undefined;
  }> = [];
  const api: CareerApi = {
    login: async () => settlement.previousCareer,
    getCareer: async () => settlement.previousCareer,
    getLedger: async () => [],
    startBotMatch: async () => ({ matchId: 'bot_diag', battlefieldId: 'crown_cross' }),
    settleMatch: async (matchId, actions, clientObservedStatus) => {
      settleCalls.push({ matchId, actions, clientObservedStatus });
      return settlement;
    },
    purchaseUpgrade: async () => {
      throw new Error('not_used_in_test');
    },
    selectCommander: async () => {
      throw new Error('not_used_in_test');
    },
    getDailyState: async () => {
      throw new Error('not_used_in_test');
    },
    claimDailyReward: async () => {
      throw new Error('not_used_in_test');
    },
    getLeagueState: async () => {
      throw new Error('not_used_in_test');
    },
    claimLeagueReward: async () => {
      throw new Error('not_used_in_test');
    },
    trackEvents: async () => undefined,
    openLiveMatch: () => {
      throw new Error('not_used_in_test');
    },
    isAuthenticated: () => true,
  };
  return { api, settleCalls };
}

const adapter = {
  platform: 'browser',
  getInitDataRaw: () => 'user=diag_player',
} as PlatformAdapter;

describe('bot settlement status diagnostics', () => {
  it('forwards the client-observed status to the settlement API', async () => {
    const playerId = 'diag_forward_player';
    const settlement = authoritativeDefeatSettlement('bot_diag_forward');
    const { api, settleCalls } = fakeApiWithRecordedSettle(settlement);
    const manager = CareerManager.getInstance(playerId);
    await manager.connect(adapter, api);

    await manager.recordMatchResultRemote([], 'bot_diag_forward', adapter, 'victory');

    expect(settleCalls).toHaveLength(1);
    expect(settleCalls[0].matchId).toBe('bot_diag_forward');
    expect(settleCalls[0].clientObservedStatus).toBe('victory');
  });

  it('omits the client-observed status when the caller does not provide one', async () => {
    const playerId = 'diag_omit_player';
    const settlement = authoritativeDefeatSettlement('bot_diag_omit');
    const { api, settleCalls } = fakeApiWithRecordedSettle(settlement);
    const manager = CareerManager.getInstance(playerId);
    await manager.connect(adapter, api);

    await manager.recordMatchResultRemote([], 'bot_diag_omit');

    expect(settleCalls).toHaveLength(1);
    expect(settleCalls[0].clientObservedStatus).toBeUndefined();
  });

  it('applies the authoritative settlement regardless of the client-observed status', async () => {
    const playerId = 'diag_apply_player';
    const settlement = authoritativeDefeatSettlement('bot_diag_apply');
    const { api, settleCalls } = fakeApiWithRecordedSettle(settlement);
    const manager = CareerManager.getInstance(playerId);
    await manager.connect(adapter, api);

    const applied = await manager.recordMatchResultRemote([], 'bot_diag_apply', adapter, 'victory');

    expect(settleCalls[0].clientObservedStatus).toBe('victory');
    expect(applied.status).toBe('defeat');
    expect(manager.getCareer().matchesWon).toBe(0);
    expect(manager.getCareer().coins).toBe(settlement.newCareer.coins);
  });

  it('forwards the client-observed status on the stale-socket retry', async () => {
    const playerId = 'diag_retry_player';
    const settlement = authoritativeDefeatSettlement('bot_diag_retry');
    const { api, settleCalls } = fakeApiWithRecordedSettle(settlement);
    let settles = 0;
    const flakyApi: CareerApi = {
      ...api,
      settleMatch: async (matchId, actions, clientObservedStatus) => {
        settles++;
        if (settles === 1) throw new StaleSocketError('socket_closed');
        return api.settleMatch(matchId, actions, clientObservedStatus);
      },
    };
    const manager = CareerManager.getInstance(playerId);
    await manager.connect(adapter, flakyApi);

    await manager.recordMatchResultRemote([], 'bot_diag_retry', adapter, 'defeat');

    expect(settles).toBe(2);
    // The failed first attempt never reached the API contract; the retried
    // settlement carries the same diagnostic status.
    expect(settleCalls).toHaveLength(1);
    expect(settleCalls[0].clientObservedStatus).toBe('defeat');
  });
});
