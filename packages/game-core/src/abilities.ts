import type { CommanderId } from './commanders.js';
import { ABILITY_CONFIG, hasCommanderAbilities } from './gameplay-rules.js';
import { dispatchArmy } from './dispatch.js';
import type { GameState, MarchingArmy } from './types.js';

export type AbilityId = 'royal_shield' | 'supply_drop' | 'vanguard_charge';

/** Each commander brings exactly one active ability into a v4 match. */
export const COMMANDER_ABILITY: Readonly<Record<CommanderId, AbilityId>> = Object.freeze({
  crown_guard: 'royal_shield',
  quartermaster: 'supply_drop',
  vanguard: 'vanguard_charge',
});

/** Abilities that need a second target tower (a dispatch) rather than one own tower. */
export const abilityNeedsTarget = (ability: AbilityId): boolean => ability === 'vanguard_charge';

export interface AbilityResult {
  readonly state: GameState;
  /** The all-in army sent by vanguard_charge. */
  readonly army?: MarchingArmy;
}

/**
 * Applies the player's commander ability, or returns null when it is not
 * legal in this state. Illegal uses are ignored by both engines' replays.
 * Self-targeted abilities carry `targetId === sourceId`.
 */
export function applyPlayerAbility(
  state: GameState,
  commanderId: CommanderId | undefined,
  sourceId: string,
  targetId: string,
  armySpeedMultiplier: number,
  armyId: string,
): AbilityResult | null {
  if (!commanderId || !hasCommanderAbilities(state.gameplayRulesVersion) || state.status !== 'playing') return null;
  if (state.playerAbilityUsed || state.elapsedTimeSeconds + 1e-9 < ABILITY_CONFIG.unlockSeconds) return null;
  const source = state.territories[sourceId];
  if (!source || source.owner !== 'player') return null;
  const ability = COMMANDER_ABILITY[commanderId];
  if (!ability) return null;
  const nowMs = Math.round(state.elapsedTimeSeconds * 1000);

  if (ability === 'royal_shield') {
    if (targetId !== sourceId) return null;
    return {
      state: {
        ...state,
        playerAbilityUsed: true,
        shieldedUntilMs: { ...state.shieldedUntilMs, [sourceId]: nowMs + ABILITY_CONFIG.shieldDurationMs },
      },
    };
  }
  if (ability === 'supply_drop') {
    if (targetId !== sourceId) return null;
    return {
      state: {
        ...state,
        playerAbilityUsed: true,
        territories: { ...state.territories, [sourceId]: { ...source, units: source.units + ABILITY_CONFIG.supplyUnits } },
      },
    };
  }
  const target = state.territories[targetId];
  if (!target || targetId === sourceId) return null;
  const result = dispatchArmy(source, target, 'player', ABILITY_CONFIG.chargeRatio, () => armyId, armySpeedMultiplier, state);
  if (!result.success || !result.army || !result.sourceTerritory) return null;
  return {
    army: result.army,
    state: {
      ...state,
      playerAbilityUsed: true,
      territories: { ...state.territories, [sourceId]: result.sourceTerritory },
      armies: [...state.armies, result.army],
      stats: { ...state.stats, playerUnitsDispatched: state.stats.playerUnitsDispatched + result.army.units },
    },
  };
}

export function isShielded(state: GameState, territoryId: string): boolean {
  return (state.shieldedUntilMs?.[territoryId] ?? 0) > Math.round(state.elapsedTimeSeconds * 1000);
}
