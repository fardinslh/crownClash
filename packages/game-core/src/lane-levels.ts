import type { BattlefieldId } from './battlefields.js';
import type { BotDifficulty } from './bot-difficulty.js';
import { LANE_ENEMY_MODIFIERS } from './lane-ai.js';
import type { PlayerUpgradeModifiers } from './upgrades.js';

/**
 * Lane battles (candidate rules v5): nine client-local bot battles, three per difficulty, on the
 * three maps. They pay nothing and are not verified by the server; see docs/tower-war-observed.md.
 */
export interface LaneLevel {
  readonly id: number;
  readonly battlefieldId: BattlefieldId;
  readonly botDifficulty: BotDifficulty;
  readonly enemy: PlayerUpgradeModifiers;
}

const MAPS: readonly BattlefieldId[] = ['crown_cross', 'twin_passes', 'royal_ring'];
const DIFFICULTIES: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

export const LANE_LEVELS: readonly LaneLevel[] = Object.freeze(
  DIFFICULTIES.flatMap((botDifficulty, d) => MAPS.map((battlefieldId, m): LaneLevel => ({
    id: d * MAPS.length + m + 1, battlefieldId, botDifficulty, enemy: LANE_ENEMY_MODIFIERS[botDifficulty],
  }))),
);

export const getLaneLevel = (id: number): LaneLevel | undefined => LANE_LEVELS.find((level) => level.id === id);
