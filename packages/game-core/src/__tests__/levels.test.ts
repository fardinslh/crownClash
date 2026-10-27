import { describe, expect, it } from 'vitest';
import {
  BOT_DIFFICULTIES,
  LEVELS,
  LEVEL_COUNT,
  LEVEL_PLAYER_MODIFIERS,
  LEVEL_RULES_VERSION,
  createInitialGameState,
  getBattlefield,
  getLevel,
  isLevelUnlocked,
  levelsCompletedAfter,
} from '../index.js';

describe('campaign levels', () => {
  it('are numbered 1..N in order', () => {
    expect(LEVELS.map((level) => level.id)).toEqual(Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1));
  });

  it('use 1v1 battlefields, known bot difficulties and a gentler-or-equal enemy', () => {
    for (const level of LEVELS) {
      expect(getBattlefield(level.battlefieldId).mode).toBe('1v1');
      expect(BOT_DIFFICULTIES).toContain(level.botDifficulty);
      expect(level.enemy.startingUnits).toBeLessThanOrEqual(LEVEL_PLAYER_MODIFIERS.startingUnits);
      expect(level.enemy.startingUnits).toBeGreaterThan(0);
      expect(level.enemy.productionRateMultiplier).toBeGreaterThan(0);
      expect(level.enemy.productionRateMultiplier).toBeLessThanOrEqual(1.3);
    }
  });

  it('start a valid match with the enemy garrison from the level', () => {
    for (const level of LEVELS) {
      const state = createInitialGameState({
        gameplayRulesVersion: LEVEL_RULES_VERSION,
        battlefieldId: level.battlefieldId,
        playerModifiers: LEVEL_PLAYER_MODIFIERS,
        enemyModifiers: level.enemy,
      });
      expect(state.status).toBe('playing');
      expect(state.territories.p_base.owner).toBe('player');
      expect(state.territories.e_base.owner).toBe('enemy');
      expect(state.territories.e_base.units).toBeLessThan(state.territories.p_base.units);
    }
  });

  it('ramps the bot from easy through normal to hard', () => {
    const order = LEVELS.map((level) => BOT_DIFFICULTIES.indexOf(level.botDifficulty));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('looks levels up by id', () => {
    expect(getLevel(1)?.id).toBe(1);
    expect(getLevel(0)).toBeUndefined();
    expect(getLevel(LEVEL_COUNT + 1)).toBeUndefined();
  });
});

describe('level progression', () => {
  it('unlocks one level at a time', () => {
    expect(isLevelUnlocked(0, 1)).toBe(true);
    expect(isLevelUnlocked(0, 2)).toBe(false);
    expect(isLevelUnlocked(3, 4)).toBe(true);
    expect(isLevelUnlocked(3, 5)).toBe(false);
    expect(isLevelUnlocked(LEVEL_COUNT, LEVEL_COUNT)).toBe(true);
  });

  it('rejects invalid ids', () => {
    for (const id of [0, -1, 1.5, Number.NaN, LEVEL_COUNT + 1]) expect(isLevelUnlocked(LEVEL_COUNT, id)).toBe(false);
  });

  it('records the next level, ignores replays and skipped-ahead claims', () => {
    expect(levelsCompletedAfter(0, 1)).toBe(1);
    expect(levelsCompletedAfter(1, 2)).toBe(2);
    expect(levelsCompletedAfter(5, 2)).toBe(5);
    expect(levelsCompletedAfter(5, 5)).toBe(5);
    expect(levelsCompletedAfter(1, 4)).toBe(1);
    expect(levelsCompletedAfter(LEVEL_COUNT, LEVEL_COUNT)).toBe(LEVEL_COUNT);
  });

  it('is idempotent', () => {
    const once = levelsCompletedAfter(2, 3);
    expect(levelsCompletedAfter(once, 3)).toBe(once);
  });
});
