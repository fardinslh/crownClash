import { calculateDispatchUnits } from './dispatch.js';
import { Territory } from './types.js';

export interface AiMove {
  fromId: string;
  toId: string;
}

/**
 * Evaluates the board state and decides an action for the AI team.
 * Simple, reactive, deterministic heuristic suitable for casual prototype pacing.
 */
export function evaluateAiMove(
  territories: Record<string, Territory>,
  aiTeam: 'enemy' = 'enemy',
  minDispatchThreshold: number = 8
): AiMove | null {
  const territoryList = Object.values(territories);
  const myTerritories = territoryList.filter((t) => t.owner === aiTeam);
  if (myTerritories.length === 0) return null;

  // Filter sources with enough units to mount an expedition
  const readySources = myTerritories.filter((t) => t.units >= minDispatchThreshold);
  if (readySources.length === 0) return null;

  // Pick source with the most units
  readySources.sort((a, b) => b.units - a.units);
  const source = readySources[0];
  const dispatchAmount = calculateDispatchUnits(source.units, 0.5);
  if (dispatchAmount <= 0) return null;

  // Potential targets (not the source itself)
  const targets = territoryList.filter((t) => t.id !== source.id);
  if (targets.length === 0) return null;

  let bestTarget: Territory | null = null;
  let bestScore = -Infinity;

  for (const target of targets) {
    const dist = Math.hypot(target.x - source.x, target.y - source.y);
    const distancePenalty = dist * 0.05;

    let score = 0;

    if (target.owner !== aiTeam) {
      // Hostile territory (Neutral or Player)
      const canCapture = dispatchAmount > target.units;
      const unitAdvantage = dispatchAmount - target.units;

      if (target.owner === 'player') {
        // High reward for taking player territory
        if (canCapture) {
          score = 100 + unitAdvantage * 2 - distancePenalty;
        } else {
          // Attacking player even if not capturing right away (harassment)
          score = 20 - target.units - distancePenalty;
        }
      } else {
        // Neutral territory
        if (canCapture) {
          // Capturing neutral territory expands economy
          score = 60 + (10 - target.units) * 2 - distancePenalty;
          // Center keep bonus
          if (target.id === 'n_center') {
            score += 25;
          }
        } else {
          // Don't suicide on strong neutrals if we can't capture them
          score = -50;
        }
      }
    } else {
      // Friendly reinforcement
      if (target.units < 10 && source.units > 20) {
        score = 30 + (20 - target.units) - distancePenalty;
      } else {
        score = -20;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestTarget = target;
    }
  }

  if (bestTarget && bestScore > 0) {
    return {
      fromId: source.id,
      toId: bestTarget.id,
    };
  }

  return null;
}
