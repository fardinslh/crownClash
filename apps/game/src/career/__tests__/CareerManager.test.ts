import { beforeEach, describe, expect, it } from 'vitest';
import { CareerManager } from '../CareerManager.js';
import { MatchStats } from '@crown-clash/game-core';

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
});
