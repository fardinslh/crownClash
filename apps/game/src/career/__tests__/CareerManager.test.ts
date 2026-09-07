import { beforeEach, describe, expect, it } from 'vitest';
import { CareerManager } from '../CareerManager.js';
import { MatchStats } from '@crown-clash/game-core';

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
    });
  });
});
