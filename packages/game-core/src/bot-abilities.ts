import { ABILITY_CONFIG, hasCommanderAbilities } from './gameplay-rules.js';
import { COMMANDER_ABILITY } from './abilities.js';
import { tacticalForecast, tacticalIncoming } from './tactical-ai.js';
import type { AiMove } from './ai.js';
import type { CommanderId } from './commanders.js';
import type { GameState } from './types.js';

export interface BotAbilityChoice {
  sourceId: string;
  targetId: string;
  /** The moves the bot should still dispatch (a charge replaces the first one). */
  moves: AiMove[];
}

/** An own tower that the armies already marching on it would capture, soonest threat first. */
function threatenedTowers(state: GameState, team: 'player' | 'enemy') {
  return Object.values(state.territories)
    .filter((t) => t.owner === team)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .flatMap((tower) => {
      const hostile = tacticalIncoming(state, tower.id).filter((a) => a.army.owner !== team);
      if (!hostile.length) return [];
      const horizon = hostile[hostile.length - 1].eta;
      if (tacticalForecast(state, tower, horizon).owner === team) return [];
      return [{ tower, firstEta: hostile[0].eta, horizon }];
    });
}

/**
 * Decides whether the bot spends its one commander ability this tick.
 * Deterministic and mirrored in Go (`bot_abilities.go`): the server replays the
 * same choice at settlement. `moves` are the dispatches the tactical policy
 * already picked for this tick.
 */
export function chooseBotAbility(
  state: GameState,
  team: 'player' | 'enemy',
  commanderId: CommanderId | undefined,
  moves: AiMove[],
): BotAbilityChoice | null {
  if (!commanderId || !hasCommanderAbilities(state.gameplayRulesVersion) || state.status !== 'playing') return null;
  if ((team === 'player' ? state.playerAbilityUsed : state.enemyAbilityUsed) || state.elapsedTimeSeconds + 1e-9 < ABILITY_CONFIG.unlockSeconds) return null;
  const ability = COMMANDER_ABILITY[commanderId];
  if (!ability) return null;

  if (ability === 'vanguard_charge') {
    if (!moves.length) return null;
    return { sourceId: moves[0].fromId, targetId: moves[0].toId, moves: moves.slice(1) };
  }

  const threats = threatenedTowers(state, team);
  const shieldSeconds = ABILITY_CONFIG.shieldDurationMs / 1000;
  if (ability === 'royal_shield') {
    // Only worth it when the shield is up for the fight and actually saves the tower.
    const saved = threats
      .filter((t) => t.firstEta <= shieldSeconds - 1 + 1e-9
        && tacticalForecast(state, t.tower, Math.min(t.horizon, shieldSeconds - 1), t.tower.units, ABILITY_CONFIG.shieldDefenseMultiplier).owner === team)
      .sort((a, b) => b.tower.units - a.tower.units || (a.tower.id < b.tower.id ? -1 : 1));
    return saved.length ? { sourceId: saved[0].tower.id, targetId: saved[0].tower.id, moves } : null;
  }

  // supply_drop: rescue a tower that +units would save, else feed the first attack.
  const rescued = threats
    .filter((t) => tacticalForecast(state, t.tower, t.horizon, t.tower.units + ABILITY_CONFIG.supplyUnits).owner === team)
    .sort((a, b) => a.firstEta - b.firstEta || (a.tower.id < b.tower.id ? -1 : 1));
  if (rescued.length) return { sourceId: rescued[0].tower.id, targetId: rescued[0].tower.id, moves };
  if (moves.length) return { sourceId: moves[0].fromId, targetId: moves[0].fromId, moves };
  return null;
}
