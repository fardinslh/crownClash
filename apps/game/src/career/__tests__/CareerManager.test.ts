import { beforeEach, describe, expect, it } from 'vitest';
import { CareerManager } from '../CareerManager.js';
import { MatchStats, createDefaultCareer } from '@crown-clash/game-core';
import type { PlatformAdapter } from '@crown-clash/platform';
import type { CareerApi } from '../../api/GameApiClient.js';

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

describe('CareerManager', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage?.clear();
    }
  });

  it('initializes career with default balance', () => {
    const manager = CareerManager.getInstance('test_player_1');
    const career = manager.getCareer();

    expect(career.playerId).toBe('test_player_1');
    expect(career.coins).toBe(100);
    expect(career.trophies).toBe(0);
    expect(career.matchesPlayed).toBe(0);
  });

  it('enforces commander unlocks in the dev local fallback', async () => {
    const playerId = 'commander_local_player';
    window.localStorage.setItem(
      `crown_clash_career_${playerId}`,
      JSON.stringify({ ...createDefaultCareer(playerId), startingGarrisonLevel: 10 })
    );
    const manager = CareerManager.getInstance(playerId);
    await expect(manager.selectCommander('vanguard')).resolves.toMatchObject({
      success: false,
      reason: 'commander_locked',
    });
    await expect(manager.selectCommander('quartermaster')).resolves.toMatchObject({ success: true });
    expect(manager.getCareer().selectedCommanderId).toBe('quartermaster');
  });

  it('supports permanent league claims through the dev local fallback', async () => {
    const manager = CareerManager.getInstance('league_local_player');
    const stats: MatchStats = {
      matchDurationSeconds: 45,
      playerUnitsDispatched: 10,
      enemyUnitsDispatched: 5,
      territoriesCapturedByPlayer: 4,
      territoriesCapturedByEnemy: 1,
    };
    for (let index = 0; index < 4; index++) {
      manager.recordMatchResult('victory', stats, `league_match_${index}`);
    }

    const before = await manager.getLeagueState();
    expect(before.currentRankId).toBe('soldier');
    expect(before.tiers.find((tier) => tier.rankId === 'soldier')).toMatchObject({
      unlocked: true,
      claimed: false,
    });

    const claim = await manager.claimLeagueReward('soldier');
    expect(claim).toMatchObject({ success: true, reward: 75 });
    expect(manager.getCareer().coins).toBe(claim.newCareer.coins);
    expect((await manager.getLeagueState()).tiers.find((tier) => tier.rankId === 'soldier')?.claimed).toBe(true);

    const duplicate = await manager.claimLeagueReward('soldier');
    expect(duplicate).toMatchObject({ success: false, reason: 'already_claimed' });
  });

  it('records match victory, updates balances, and appends to ledger', () => {
    const manager = CareerManager.getInstance('test_player_2');
    const stats: MatchStats = {
      matchDurationSeconds: 38,
      playerUnitsDispatched: 45,
      enemyUnitsDispatched: 20,
      territoriesCapturedByPlayer: 5,
      territoriesCapturedByEnemy: 0,
    };

    const settlement = manager.recordMatchResult('victory', stats, 'match_v1');

    expect(settlement.status).toBe('victory');
    expect(settlement.newCareer.coins).toBeGreaterThan(140);
    expect(settlement.newCareer.trophies).toBe(30);
    expect(settlement.newCareer.matchesWon).toBe(1);

    const career = manager.getCareer();
    expect(career.coins).toBe(settlement.newCareer.coins);
    expect(career.trophies).toBe(30);

    const ledger = manager.getLedger();
    expect(ledger.length).toBe(2);
    expect(ledger[0].reason).toBe('match_victory');
    expect(ledger[0].currency).toBe('coins');
    expect(ledger[1].currency).toBe('trophies');
  });

  it('supports daily progress and claims through the dev-only local fallback', async () => {
    const manager = CareerManager.getInstance('daily_local_player');
    const stats: MatchStats = {
      matchDurationSeconds: 38,
      playerUnitsDispatched: 45,
      enemyUnitsDispatched: 20,
      territoriesCapturedByPlayer: 5,
      territoriesCapturedByEnemy: 0,
    };
    manager.recordMatchResult('victory', stats, 'daily_match_1');
    manager.recordMatchResult('defeat', stats, 'daily_match_2');

    const state = await manager.getDailyState();
    expect(state.missions.map((mission) => mission.progress)).toEqual([2, 1, 10]);

    const beforeClaims = manager.getCareer().coins;
    for (const type of ['play_matches', 'win_match', 'capture_territories'] as const) {
      await expect(manager.claimDailyReward(type)).resolves.toMatchObject({ success: true });
    }
    await expect(manager.claimDailyReward('crown_chest')).resolves.toMatchObject({
      success: true,
      reward: 75,
    });
    expect(manager.getCareer().coins).toBe(beforeClaims + 195);
    expect((await manager.getDailyState()).chest.claimed).toBe(true);
  });

  it('broadcasts state changes to subscribers', () => {
    const manager = CareerManager.getInstance('test_player_3');
    let notifiedCoins = 0;

    const unsubscribe = manager.subscribe((c) => {
      notifiedCoins = c.coins;
    });

    const stats: MatchStats = {
      matchDurationSeconds: 50,
      playerUnitsDispatched: 30,
      enemyUnitsDispatched: 30,
      territoriesCapturedByPlayer: 3,
      territoriesCapturedByEnemy: 2,
    };

    manager.recordMatchResult('victory', stats, 'match_v2');
    expect(notifiedCoins).toBeGreaterThan(100);

    unsubscribe();
  });

  it('purchases and persists an upgrade with an auditable ledger entry', () => {
    const manager = CareerManager.getInstance('test_player_upgrade');
    let notifiedLevel = 0;
    manager.subscribe((career) => {
      notifiedLevel = career.productionLevel;
    });

    const purchase = manager.purchaseUpgrade('production');
    expect(purchase.success).toBe(true);
    expect(manager.getCareer().productionLevel).toBe(1);
    expect(manager.getCareer().coins).toBe(50);
    expect(notifiedLevel).toBe(1);
    expect(manager.getLedger().at(-1)).toMatchObject({
      amount: -50,
      reason: 'upgrade_production',
      source: 'upgrade_purchase',
      previousBalance: 100,
      resultingBalance: 50,
    });

    CareerManager.getInstance('another_player');
    const reloaded = CareerManager.getInstance('test_player_upgrade');
    expect(reloaded.getCareer().productionLevel).toBe(1);
    expect(reloaded.getCareer().coins).toBe(50);
  });

  it('rejects an unaffordable upgrade without mutating state or ledger', () => {
    const manager = CareerManager.getInstance('test_player_poor');
    expect(manager.purchaseUpgrade('army_speed').success).toBe(true);
    const ledgerLength = manager.getLedger().length;

    const rejected = manager.purchaseUpgrade('army_speed');
    expect(rejected.success).toBe(false);
    if (rejected.success) throw new Error('Expected upgrade purchase to fail');
    expect(rejected.reason).toBe('insufficient_coins');
    expect(manager.getCareer().armySpeedLevel).toBe(1);
    expect(manager.getLedger()).toHaveLength(ledgerLength);
  });

  it('migrates legacy saves with safe default upgrade levels', () => {
    window.localStorage.setItem(
      'crown_clash_career_legacy_player',
      JSON.stringify({
        playerId: 'legacy_player',
        coins: 200,
        gems: 10,
        trophies: 25,
        matchesPlayed: 3,
        matchesWon: 2,
      })
    );

    const manager = CareerManager.getInstance('legacy_player');
    expect(manager.getCareer()).toMatchObject({
      startingGarrisonLevel: 0,
      productionLevel: 0,
      armySpeedLevel: 0,
      treasuryLevel: 0,
    });
  });

  it('hydrates career and applies remote settlement and upgrade responses', async () => {
    const remoteCareer = createDefaultCareer('remote_player');
    const remoteStats: MatchStats = {
      matchDurationSeconds: 45,
      playerUnitsDispatched: 10,
      enemyUnitsDispatched: 10,
      territoriesCapturedByPlayer: 3,
      territoriesCapturedByEnemy: 2,
    };
    const remoteApi: CareerApi = {
      login: async () => remoteCareer,
      getCareer: async () => remoteCareer,
      getLedger: async () => [],
      settleMatch: async (matchId) => ({
        matchId,
        status: 'victory',
        breakdown: {
          baseCoins: 40,
          speedBonus: 0,
          dominationBonus: 0,
          streakBonus: 0,
          treasuryBonus: 0,
          totalCoins: 40,
          trophyDelta: 30,
        },
        stats: remoteStats,
        previousCareer: remoteCareer,
        newCareer: { ...remoteCareer, coins: 140, trophies: 30, matchesPlayed: 1, matchesWon: 1 },
        previousRank: {
          id: 'recruit',
          name: 'Recruit',
          badge: '🛡️',
          minTrophies: 0,
          maxTrophies: 99,
          color: 0x94a3b8,
        },
        newRank: {
          id: 'recruit',
          name: 'Recruit',
          badge: '🛡️',
          minTrophies: 0,
          maxTrophies: 99,
          color: 0x94a3b8,
        },
        rankPromoted: false,
        ledgerEntries: [],
      }),
      purchaseUpgrade: async (_type, purchaseId) => ({
        success: true,
        cost: 50,
        previousCareer: { ...remoteCareer, coins: 140, trophies: 30, matchesPlayed: 1, matchesWon: 1 },
        newCareer: {
          ...remoteCareer,
          coins: 90,
          trophies: 30,
          matchesPlayed: 1,
          matchesWon: 1,
          productionLevel: 1,
        },
        ledgerEntry: {
          id: purchaseId,
          player: 'remote_player',
          currency: 'coins',
          amount: -50,
          reason: 'upgrade_production',
          source: 'upgrade_purchase',
          previousBalance: 140,
          resultingBalance: 90,
          timestamp: 2,
        },
      }),
      selectCommander: async () => { throw new Error('not_used_in_test'); },
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
    const adapter = {
      platform: 'browser',
      getInitDataRaw: () => 'user=remote_player',
    } as PlatformAdapter;
    const manager = CareerManager.getInstance('remote_player');

    await expect(manager.connect(adapter, remoteApi)).resolves.toMatchObject({
      coins: 100,
      trophies: 0,
    });

    const settlement = await manager.recordMatchResultRemote([], 'remote_match_1');
    expect(settlement.newCareer.coins).toBe(140);
    expect(manager.getCareer().coins).toBe(140);

    const purchase = await manager.purchaseUpgradeRemote('production');
    expect(purchase.success).toBe(true);
    expect(manager.getCareer().productionLevel).toBe(1);
    expect(manager.getCareer().coins).toBe(90);
  });

  it('deduplicates concurrent connect calls into a single login', async () => {
    const remoteCareer = createDefaultCareer('dedup_player');
    let logins = 0;
    const remoteApi: CareerApi = {
      login: async () => {
        logins++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return remoteCareer;
      },
      getCareer: async () => remoteCareer,
      getLedger: async () => [],
      settleMatch: async () => {
        throw new Error('not_used_in_test');
      },
      purchaseUpgrade: async () => {
        throw new Error('not_used_in_test');
      },
      selectCommander: async () => { throw new Error('not_used_in_test'); },
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
    const adapter = {
      platform: 'browser',
      getInitDataRaw: () => 'user=dedup_player',
    } as PlatformAdapter;
    const manager = CareerManager.getInstance('dedup_player');

    const [first, second, third] = await Promise.all([
      manager.connect(adapter, remoteApi),
      manager.connect(adapter, remoteApi),
      manager.connect(adapter, remoteApi),
    ]);
    expect(logins).toBe(1);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
  });

  it('refreshes the remote career without local overwrite', async () => {
    const remoteCareer = createDefaultCareer('refresh_player');
    const updatedCareer = { ...remoteCareer, coins: 777, trophies: 42 };
    let careerToServe = remoteCareer;
    const remoteApi: CareerApi = {
      login: async () => remoteCareer,
      getCareer: async () => careerToServe,
      getLedger: async () => [],
      settleMatch: async () => {
        throw new Error('not_used_in_test');
      },
      purchaseUpgrade: async () => {
        throw new Error('not_used_in_test');
      },
      selectCommander: async () => { throw new Error('not_used_in_test'); },
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
    const adapter = {
      platform: 'browser',
      getInitDataRaw: () => 'user=refresh_player',
    } as PlatformAdapter;
    const manager = CareerManager.getInstance('refresh_player');

    await manager.connect(adapter, remoteApi);
    expect(manager.getCareer().coins).toBe(100);

    careerToServe = updatedCareer;
    await manager.refreshRemoteCareer();
    expect(manager.getCareer().coins).toBe(777);
    expect(manager.getCareer().trophies).toBe(42);
  });
});
