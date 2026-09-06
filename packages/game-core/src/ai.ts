import { calculateDispatchUnits } from './dispatch.js';
import { Territory } from './types.js';

export interface AiMove {
  fromId: string;
  toId: string;
}

/**
 * Evaluates the board state and decides an action for the AI team.
 * Evaluates all ready AI territories to find the highest tactical leverage opportunity.
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

  let bestMove: AiMove | null = null;
  let bestScore = -Infinity;

  for (const source of readySources) {
    const dispatchAmount = calculateDispatchUnits(source.units, 0.5);
    if (dispatchAmount <= 0) continue;

    const targets = territoryList.filter((t) => t.id !== source.id);

    for (const target of targets) {
      const dist = Math.hypot(target.x - source.x, target.y - source.y);
      const distancePenalty = dist * 0.06;

      let score = 0;

      if (target.owner !== aiTeam) {
        // Hostile territory (Neutral or Player)
        const canCapture = dispatchAmount > target.units;
        const unitAdvantage = dispatchAmount - target.units;

        if (target.owner === 'player') {
          // Priority on capturing player holdings or contesting them
          if (canCapture) {
            score = 110 + unitAdvantage * 3 - distancePenalty;
          } else {
            score = 25 - target.units - distancePenalty;
          }
        } else {
          // Neutral territory
          if (canCapture) {
            score = 65 + (12 - target.units) * 2 - distancePenalty;
            // High strategic value for the Crown Keep (center)
            if (target.id === 'n_center') {
              score += 35;
            }
          } else {
            // Avoid suicide attacks on high-density neutral keeps
            score = -50;
          }
        }
      } else {
        // Friendly reinforcement
        if (target.units < 8 && source.units >= 16) {
          score = 35 + (15 - target.units) * 1.5 - distancePenalty;
        } else {
          score = -20;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMove = {
          fromId: source.id,
          toId: target.id,
        };
      }
    }
  }

  return bestScore > 0 ? bestMove : null;
}
