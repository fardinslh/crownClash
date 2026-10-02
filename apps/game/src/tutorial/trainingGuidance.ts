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

import type { Team, Territory } from '@crown-clash/game-core';
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

/**
 * Alpha applied to non-guided enemy/neutral towers during training. The
 * whole field dims EXCEPT the guided towers — and, crucially, every
 * player-owned tower: capturing must feel rewarding, so the player's
 * empire always stays bright (a freshly captured tower that goes pale
 * reads as "broken", not "mine").
 */
export const TRAINING_DIM_ALPHA = 0.45;

/**
 * Clash Royale-style focus rule: a territory is bright when it is
 * spotlighted by the current step OR owned by the player; everything else
 * dims. Ownership is read from the LIVE state, never the visual snapshot
 * (an unknown/missing territory dims conservatively).
 */
export function isTrainingTerritoryBright(
  id: string,
  owner: Team | undefined,
  spotlightIds: readonly string[]
): boolean {
  return spotlightIds.includes(id) || owner === 'player';
}

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

/**
 * Orders the finale's sweep stroke as one continuous greedy
 * nearest-neighbor path that starts at the tower FARTHEST from the enemy
 * base and flows toward it, so the demonstrated gesture reads as a single
 * smooth stroke across the field instead of a strength-ordered zigzag.
 */
function sweepPath(towers: readonly Territory[], base: Territory): Territory[] {
  if (towers.length <= 1) return [...towers];
  const remaining = [...towers];
  let current = remaining.reduce((far, t) =>
    distance(t, base) > distance(far, base) ? t : far
  );
  const path: Territory[] = [current];
  remaining.splice(remaining.indexOf(current), 1);
  while (remaining.length > 0) {
    let best = 0;
    for (let index = 1; index < remaining.length; index += 1) {
      if (distance(current, remaining[index]) < distance(current, remaining[best])) {
        best = index;
      }
    }
    current = remaining[best];
    path.push(current);
    remaining.splice(best, 1);
  }
  return path;
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
    // Finale: sweep every owned tower, then release on the enemy base. The
    // sweep is a continuous nearest-neighbor stroke (see sweepPath) so the
    // demonstrated gesture reads as one smooth drag across the field.
    const towers = dispatchablePlayerTowers(territories);
    const sources = towers.length > 0 ? towers : [playerBase];
    const base = territories[TUTORIAL_ENEMY_BASE_ID];
    const ordered = base
      ? sweepPath(sources, base)
      : [...sources].sort((a, b) => b.units - a.units || a.x - b.x);
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
    // The chain starts at the tower FARTHEST from the target so the
    // demonstrated stroke flows toward the release point as one gesture.
    const ordered = [...chained].sort(
      (a, b) => distance(b, target) - distance(a, target)
    );
    return {
      spotlightIds: [...ordered.map((t) => t.id), target.id],
      hintPath: [...ordered.map((t) => t.id), target.id],
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
