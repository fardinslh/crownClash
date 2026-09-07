import { dispatchArmy } from './dispatch.js';
import { evaluateAiMove } from './ai.js';
import { createInitialGameState, stepSimulation } from './simulation.js';
import type { PlayerUpgradeModifiers } from './upgrades.js';
import type { GameState, MatchStats } from './types.js';

export const PVP_TIME_LIMIT_SECONDS = 90;
export const PVP_AI_TICK_SECONDS = 1.8;
export const MAX_PVP_ACTIONS = 120;

export interface PvpAction {
  sequence: number;
  atSeconds: number;
  sourceId: string;
  targetId: string;
}

export interface PvpDefenseSnapshot {
  playerId: string;
  displayName: string;
  trophies: number;
  matchesWon: number;
  modifiers: PlayerUpgradeModifiers;
  publishedAt: number;
}

export interface PvpOpponent {
  playerId: string;
  displayName: string;
  trophies: number;
  matchesWon: number;
  rankId: string;
  defensePublishedAt: number;
  isRevenge: boolean;
}

export interface PvpAttackHistoryEntry {
  attackId: string;
  attackerId: string;
  defenderId: string;
  status: 'victory' | 'defeat' | 'draw';
  isRevenge: boolean;
  durationSeconds: number;
  createdAt: number;
}

export interface PvpBattleSummary {
  status: 'victory' | 'defeat' | 'draw';
  stats: MatchStats;
  durationSeconds: number;
  actionsProcessed: number;
}

export interface PvpAttackResult {
  attackId: string;
  attackerId: string;
  defenderId: string;
  isRevenge: boolean;
  summary: PvpBattleSummary;
  settlement: import('./progression.js').MatchSettlement;
}

export type PvpSimulationErrorCode =
  | 'too_many_actions'
  | 'invalid_sequence'
  | 'invalid_timestamp'
  | 'action_after_battle_end'
  | 'invalid_source'
  | 'invalid_target'
  | 'invalid_dispatch';

export class PvpSimulationError extends Error {
  constructor(public readonly code: PvpSimulationErrorCode) {
    super(`pvp_simulation_invalid:${code}`);
  }
}

export interface PvpSimulationOptions {
  playerModifiers?: PlayerUpgradeModifiers;
  enemyModifiers?: PlayerUpgradeModifiers;
  actions: readonly PvpAction[];
}

export interface PvpSimulationResult {
  finalState: GameState;
  summary: PvpBattleSummary;
}

function dispatchFromState(
  state: GameState,
  sourceId: string,
  targetId: string,
  owner: 'player' | 'enemy',
  travelSpeedMultiplier: number,
  armyId: string
): GameState {
  const source = state.territories[sourceId];
  const target = state.territories[targetId];
  if (!source) throw new PvpSimulationError('invalid_source');
  if (!target) throw new PvpSimulationError('invalid_target');

  const result = dispatchArmy(
    source,
    target,
    owner,
    0.5,
    () => armyId,
    travelSpeedMultiplier
  );
  if (!result.success || !result.army || !result.sourceTerritory) {
    throw new PvpSimulationError('invalid_dispatch');
  }

  return {
    ...state,
    territories: {
      ...state.territories,
      [sourceId]: result.sourceTerritory,
    },
    armies: [...state.armies, result.army],
    stats: {
      ...state.stats,
      playerUnitsDispatched:
        owner === 'player'
          ? state.stats.playerUnitsDispatched + result.army.units
          : state.stats.playerUnitsDispatched,
      enemyUnitsDispatched:
        owner === 'enemy'
          ? state.stats.enemyUnitsDispatched + result.army.units
          : state.stats.enemyUnitsDispatched,
    },
  };
}

function validateActions(actions: readonly PvpAction[]): void {
  if (actions.length > MAX_PVP_ACTIONS) {
    throw new PvpSimulationError('too_many_actions');
  }

  let previousTime = 0;
  for (let index = 0; index < actions.length; index++) {
    const action = actions[index];
    if (action.sequence !== index) {
      throw new PvpSimulationError('invalid_sequence');
    }
    if (
      !Number.isFinite(action.atSeconds) ||
      action.atSeconds < 0 ||
      action.atSeconds > PVP_TIME_LIMIT_SECONDS ||
      action.atSeconds < previousTime
    ) {
      throw new PvpSimulationError('invalid_timestamp');
    }
    previousTime = action.atSeconds;
  }
}

/**
 * Replays an attack against a deterministic AI-controlled defensive snapshot.
 * The client supplies only timestamped dispatch intents; the server derives
 * movement, combat, captures, status, and stats from the shared simulation.
 */
export function simulatePvpBattle(options: PvpSimulationOptions): PvpSimulationResult {
  validateActions(options.actions);

  let state = createInitialGameState({
    timeLimit: PVP_TIME_LIMIT_SECONDS,
    playerModifiers: options.playerModifiers,
    enemyModifiers: options.enemyModifiers,
  });
  let accumulators: Record<string, number> = {};
  let currentTime = 0;
  let nextAiTick = PVP_AI_TICK_SECONDS;
  let aiActionIndex = 0;
  let actionIndex = 0;

  const stepTo = (timestamp: number): void => {
    const delta = timestamp - currentTime;
    if (delta <= 0) return;
    const step = requirePlayingState(state, delta, accumulators);
    state = step.state;
    accumulators = step.accumulators;
    currentTime = timestamp;
  };

  const executeAiAction = (): void => {
    if (state.status !== 'playing') return;
    const move = evaluateAiMove(state.territories, 'enemy', 8);
    if (!move) return;
    state = dispatchFromState(
      state,
      move.fromId,
      move.toId,
      'enemy',
      options.enemyModifiers?.armySpeedMultiplier ?? 1,
      `pvp_ai_${aiActionIndex++}`
    );
  };

  for (const action of options.actions) {
    while (state.status === 'playing' && nextAiTick <= action.atSeconds) {
      stepTo(nextAiTick);
      executeAiAction();
      nextAiTick += PVP_AI_TICK_SECONDS;
    }

    if (state.status !== 'playing') {
      throw new PvpSimulationError('action_after_battle_end');
    }

    stepTo(action.atSeconds);
    if (state.status !== 'playing') {
      throw new PvpSimulationError('action_after_battle_end');
    }

    state = dispatchFromState(
      state,
      action.sourceId,
      action.targetId,
      'player',
      options.playerModifiers?.armySpeedMultiplier ?? 1,
      `pvp_player_${action.sequence}`
    );
    actionIndex++;
  }

  while (state.status === 'playing' && nextAiTick <= PVP_TIME_LIMIT_SECONDS) {
    stepTo(nextAiTick);
    executeAiAction();
    nextAiTick += PVP_AI_TICK_SECONDS;
  }

  if (state.status === 'playing') {
    stepTo(PVP_TIME_LIMIT_SECONDS);
    if (state.status === 'playing') {
      const finalStep = requirePlayingState(state, 0, accumulators);
      state = finalStep.state;
    }
  }

  return {
    finalState: state,
    summary: {
      status: state.status === 'playing' ? 'draw' : state.status,
      stats: state.stats,
      durationSeconds: Math.floor(state.elapsedTimeSeconds),
      actionsProcessed: actionIndex,
    },
  };
}

function requirePlayingState(
  state: GameState,
  deltaSeconds: number,
  accumulators: Record<string, number>
) {
  return stepSimulation(state, accumulators, deltaSeconds);
}
