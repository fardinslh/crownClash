import { calculateDispatchUnits } from './dispatch.js';
import { Territory } from './types.js';
import { getTerritoryDefenseStrength } from './territory-types.js';

export interface AiMove {
  fromId: string;
  toId: string;
}

/**
 * Minimum score for the AI to act. Scores within this epsilon of zero are
 * treated as "no move" so client and server decide identically: the Go
 * runtime may fuse `a - b*c` into one FMA instruction (single rounding)
 * while JavaScript rounds each operation, so a borderline score such as
 * `25 - units - distance*0.06` can evaluate to exactly 0 in TypeScript but
 * ±1e-16 in Go. Without the epsilon that ghost sign flip made the enemy AI
 * pick different targets on the server replay, diverging bot-match
 * settlement from the client prediction.
 */
const AI_SCORE_EPSILON = 1e-9;

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
        const defenseStrength = getTerritoryDefenseStrength(target);
        const canCapture = dispatchAmount > defenseStrength;
        const unitAdvantage = dispatchAmount - defenseStrength;
        const typeValue = target.type === 'barracks' ? 18 : target.type === 'stable' ? 14 : 10;

        if (target.owner === 'player') {
          // Priority on capturing player holdings or contesting them
          if (canCapture) {
            score = 110 + typeValue + unitAdvantage * 3 - distancePenalty;
          } else {
            score = 25 - target.units - distancePenalty;
          }
        } else {
          // Neutral territory
          if (canCapture) {
            score = 65 + typeValue + (12 - defenseStrength) * 2 - distancePenalty;
            // High strategic value for the Crown Keep (center) or high-tier fortress
            if (target.id === 'n_center' || (target.tier >= 2 && target.type === 'fortress')) {
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

  return bestScore > AI_SCORE_EPSILON ? bestMove : null;
}
