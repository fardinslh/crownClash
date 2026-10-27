import type { BattlefieldId } from './battlefields.js';
import type { BotDifficulty } from './bot-difficulty.js';
import type { GameplayRulesVersion } from './gameplay-rules.js';
import type { PlayerUpgradeModifiers } from './upgrades.js';

/**
 * Single-player campaign: hand-authored levels played as client-local bot
 * matches. Levels are data only; they never read career upgrades, so a level
 * plays the same for every player and `scripts/levels-balance.mjs` can
 * simulate it. Completion grants no economy value (it only unlocks the next
 * level), which is why the server records the client's claim without replay.
 */
export const LEVEL_RULES_VERSION: GameplayRulesVersion = 3;

/** Every level starts the player from the base garrison, production and speed. */
export const LEVEL_PLAYER_MODIFIERS: PlayerUpgradeModifiers = Object.freeze({
  startingUnits: 20,
  productionRateMultiplier: 1,
  armySpeedMultiplier: 1,
});

export interface LevelDefinition {
  readonly id: number;
  readonly battlefieldId: BattlefieldId;
  readonly botDifficulty: BotDifficulty;
  /** The enemy's garrison, production and speed; below 1x/20 makes a gentler opponent. */
  readonly enemy: PlayerUpgradeModifiers;
}

const enemy = (startingUnits: number, production: number, speed = 1): PlayerUpgradeModifiers =>
  Object.freeze({ startingUnits, productionRateMultiplier: production, armySpeedMultiplier: speed });

export const LEVELS: readonly LevelDefinition[] = Object.freeze([
  { id: 1, battlefieldId: 'crown_cross', botDifficulty: 'easy', enemy: enemy(8, 0.6) },
  { id: 2, battlefieldId: 'crown_cross', botDifficulty: 'easy', enemy: enemy(12, 0.8) },
  { id: 3, battlefieldId: 'twin_passes', botDifficulty: 'easy', enemy: enemy(14, 0.9) },
  { id: 4, battlefieldId: 'royal_ring', botDifficulty: 'easy', enemy: enemy(12, 0.8) },
  { id: 5, battlefieldId: 'crown_cross', botDifficulty: 'normal', enemy: enemy(10, 0.7) },
  { id: 6, battlefieldId: 'twin_passes', botDifficulty: 'normal', enemy: enemy(12, 0.8) },
  { id: 7, battlefieldId: 'royal_ring', botDifficulty: 'normal', enemy: enemy(12, 0.8) },
  { id: 8, battlefieldId: 'crown_cross', botDifficulty: 'hard', enemy: enemy(10, 0.7) },
  { id: 9, battlefieldId: 'twin_passes', botDifficulty: 'hard', enemy: enemy(12, 0.75) },
  { id: 10, battlefieldId: 'royal_ring', botDifficulty: 'hard', enemy: enemy(14, 0.8) },
] as LevelDefinition[]);

export const LEVEL_COUNT = LEVELS.length;

export function getLevel(id: number): LevelDefinition | undefined {
  return LEVELS.find((level) => level.id === id);
}

/** Levels unlock in order: level N is playable once N-1 levels are completed. */
export function isLevelUnlocked(levelsCompleted: number, id: number): boolean {
  return Number.isInteger(id) && id >= 1 && id <= LEVEL_COUNT && id <= levelsCompleted + 1;
}

/**
 * The new "levels completed" value after finishing `id`. Replays of earlier
 * levels and skipped-ahead claims leave progress unchanged, so repeating the
 * write is harmless.
 */
export function levelsCompletedAfter(levelsCompleted: number, id: number): number {
  return isLevelUnlocked(levelsCompleted, id) ? Math.max(levelsCompleted, id) : levelsCompleted;
}
