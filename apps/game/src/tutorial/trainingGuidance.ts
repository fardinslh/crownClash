/**
 * Crown Clash — Live guidance and sandbox tuning for the guided training
 * battle (framework-free, unit-testable).
 *
 * Clash Royale-style tutorial rules implemented here:
 *
 *   1. The player is OVERPOWERED. `applyTrainingSandbox` boosts the player
 *      base and guts the enemy base so every guided action succeeds and
 *      the scripted finale (capturing the enemy base) is a guaranteed
 *      first-try win. The training match is client-local only (never
 *      settled, never rewarded), so this touches no economy.
 *   2. Guidance is ADAPTIVE. Each step spotlights the strongest owned
 *      tower and the nearest capturable target derived from the LIVE
 *      battle state, so a resumed or reordered tutorial never points at
 *      an already-owned tower.
 */

import type { Territory } from '@crown-clash/game-core';
import type { TutorialStepId } from './TutorialController.js';
import { TUTORIAL_ENEMY_BASE_ID } from './TutorialController.js';

/** Territory IDs the fixed training battlefield always provides. */
const PLAYER_BASE_ID = 'p_base';

/**
 * Sandbox tuning for the training battle:
 *   - boosted player base → first dispatch (~20 units) always beats the
 *     weak neutral towers it is guided to (8 units);
 *   - gutted enemy base    → the scripted finale stays a guaranteed win
 *                           even if the player dawdles through the steps
 *                           (the enemy never acts; see GameScene AI gate).
 */
export const TRAINING_PLAYER_BASE_UNITS = 40;
export const TRAINING_ENEMY_BASE_UNITS = 10;
export const TRAINING_ENEMY_BASE_PRODUCTION = 0.2;

/**
 * Generous training time limit: no timer pressure while the player reads
 * instructions (the ordinary 90s bot-match limit stays unchanged).
 */
export const TRAINING_TIME_LIMIT_SECONDS = 300;

export interface TrainingGuidance {
  /** Territory IDs to spotlight (dim the rest of the board). */
  readonly spotlightIds: readonly string[];
  /** Territory IDs in gesture order for the animated hand hint. */
  readonly hintPath: readonly string[];
}

/**
 * Applies the overpowered sandbox to a fresh crown_cross training state.
 * Mutates only the two HQ territories; neutral towers keep their real
 * values so the taught mechanics match the real game.
 */
export function applyTrainingSandbox(territories: Record<string, Territory>): void {
  const playerBase = territories[PLAYER_BASE_ID];
  if (playerBase) {
    playerBase.units = Math.min(
      Math.max(playerBase.units, TRAINING_PLAYER_BASE_UNITS),
      playerBase.maxUnits
    );
  }
  const enemyBase = territories[TUTORIAL_ENEMY_BASE_ID];
  if (enemyBase) {
    enemyBase.units = Math.min(TRAINING_ENEMY_BASE_UNITS, enemyBase.maxUnits);
    enemyBase.productionRate = TRAINING_ENEMY_BASE_PRODUCTION;
  }
}

function distance(a: Territory, b: Territory): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Player-owned towers that can actually dispatch (more than 1 unit). */
function dispatchablePlayerTowers(territories: Record<string, Territory>): Territory[] {
  return Object.values(territories).filter(
    (t) => t.owner === 'player' && t.units > 1
  );
}

/**
 * Strongest dispatchable player tower (tie-break: the player base, then
 * leftmost). Falls back to the (possibly depleted) player base so the hint
 * never disappears mid-tutorial.
 */
function strongestPlayerTower(territories: Record<string, Territory>): Territory | null {
  const towers = dispatchablePlayerTowers(territories);
  if (towers.length > 0) {
    return [...towers].sort(
      (a, b) =>
        (b.id === PLAYER_BASE_ID ? 1 : 0) - (a.id === PLAYER_BASE_ID ? 1 : 0) ||
        b.units - a.units ||
        a.x - b.x
    )[0];
  }
  return territories[PLAYER_BASE_ID] ?? null;
}

/**
 * Nearest non-player tower to the given source (tie-break: leftmost).
 * The enemy HQ is only a valid guided target in the final step — earlier
 * steps must not invite skipping the remaining lessons.
 */
function nearestCapturableTarget(
  territories: Record<string, Territory>,
  source: Territory,
  includeEnemyBase: boolean
): Territory | null {
  const candidates = Object.values(territories).filter(
    (t) =>
      t.id !== source.id &&
      t.owner !== 'player' &&
      (includeEnemyBase || t.id !== TUTORIAL_ENEMY_BASE_ID)
  );
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) => distance(source, a) - distance(source, b) || a.x - b.x
  )[0];
}

/**
 * Resolves the Clash Royale-style spotlight + hand-hint guidance for the
 * current step from the LIVE territory state (adaptive, so resumed or
 * reordered tutorials never highlight an already-owned tower).
 */
export function resolveTrainingGuidance(
  territories: Record<string, Territory>,
  stepId: TutorialStepId
): TrainingGuidance {
  const playerBase = territories[PLAYER_BASE_ID];
  if (!playerBase) {
    return { spotlightIds: [], hintPath: [] };
  }

  if (stepId === 'destroy_base') {
    // Finale: sweep every owned tower, then release on the enemy base.
    const towers = dispatchablePlayerTowers(territories);
    const sources = towers.length > 0 ? towers : [playerBase];
    const ordered = [...sources].sort((a, b) => b.units - a.units || a.x - b.x);
    return {
      spotlightIds: [...ordered.map((t) => t.id), TUTORIAL_ENEMY_BASE_ID],
      hintPath: [...ordered.map((t) => t.id), TUTORIAL_ENEMY_BASE_ID],
    };
  }

  const source = strongestPlayerTower(territories);
  if (!source) {
    return { spotlightIds: [PLAYER_BASE_ID], hintPath: [] };
  }

  if (stepId === 'multi_dispatch') {
    // Chain the two strongest owned towers into one combo drag. A resumed
    // tutorial may temporarily own a single tower: the hint then starts
    // from it without duplicating the source.
    const towers = dispatchablePlayerTowers(territories).sort(
      (a, b) => b.units - a.units || a.x - b.x
    );
    const chained =
      towers.length >= 2
        ? [towers[0], towers[1]]
        : towers.length === 1
          ? [towers[0]]
          : [source];
    const target = nearestCapturableTarget(territories, chained[0], false);
    if (!target) {
      return { spotlightIds: chained.map((t) => t.id), hintPath: [] };
    }
    return {
      spotlightIds: [...chained.map((t) => t.id), target.id],
      hintPath: [...chained.map((t) => t.id), target.id],
    };
  }

  // drag_to_attack / preview_result / tower_roles: one guided drag from
  // the strongest tower to the nearest capturable target.
  const target = nearestCapturableTarget(territories, source, false);
  if (!target) {
    return { spotlightIds: [source.id], hintPath: [] };
  }
  return {
    spotlightIds: [source.id, target.id],
    hintPath: [source.id, target.id],
  };
}
