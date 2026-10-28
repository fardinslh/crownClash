import type { BattlefieldId } from './battlefields.js';
import type { BotDifficulty } from './bot-difficulty.js';
import { LaneEngine } from './lane-engine.js';
import { LEVEL_PLAYER_MODIFIERS, LEVEL_RULES_VERSION } from './levels.js';
import { MAX_PVP_ACTIONS, PVP_SIMULATION_TICK_SECONDS, PVP_TIME_LIMIT_SECONDS } from './pvp.js';
import { createInitialGameState } from './simulation.js';
import type { PlayerUpgradeModifiers } from './upgrades.js';
import type { GameState } from './types.js';

/** A lane battle order: open a lane from `sourceId` to `targetId`, or cut it. */
export interface LaneAction {
  sequence: number;
  atSeconds: number;
  kind: 'lane' | 'cut';
  sourceId: string;
  targetId: string;
}

export const MAX_LANE_ACTIONS = MAX_PVP_ACTIONS;

export type LaneReplayErrorCode = 'too_many_actions' | 'invalid_sequence' | 'invalid_action_kind' | 'invalid_timestamp' | 'invalid_territory';

export class LaneReplayError extends Error {
  constructor(public readonly code: LaneReplayErrorCode) {
    super(`lane_replay_invalid:${code}`);
  }
}

export interface LaneBattleOptions {
  readonly battlefieldId: BattlefieldId;
  readonly botDifficulty: BotDifficulty;
  readonly enemy: PlayerUpgradeModifiers;
  readonly actions: readonly LaneAction[];
}

export interface LaneBattleResult {
  readonly finalState: GameState;
  readonly summary: { status: 'victory' | 'defeat' | 'draw'; durationSeconds: number; actionsProcessed: number };
}

function validate(actions: readonly LaneAction[], state: GameState): void {
  if (actions.length > MAX_LANE_ACTIONS) throw new LaneReplayError('too_many_actions');
  let previous = 0;
  actions.forEach((action, index) => {
    if (action.sequence !== index) throw new LaneReplayError('invalid_sequence');
    if (action.kind !== 'lane' && action.kind !== 'cut') throw new LaneReplayError('invalid_action_kind');
    if (!Number.isFinite(action.atSeconds) || action.atSeconds < 0 || action.atSeconds > PVP_TIME_LIMIT_SECONDS || action.atSeconds < previous) {
      throw new LaneReplayError('invalid_timestamp');
    }
    if (!state.territories[action.sourceId] || !state.territories[action.targetId]) throw new LaneReplayError('invalid_territory');
    previous = action.atSeconds;
  });
}

/**
 * Replays a lane battle from the player's recorded orders on the fixed 20 ms clock. Orders that are
 * no longer legal in the replayed state (no road, no free path, tower lost) are ignored, like the
 * live client ignores them. The server runs the same rules in Go and the two are parity-tested.
 */
export function simulateLaneBattle(options: LaneBattleOptions): LaneBattleResult {
  let state = createInitialGameState({
    gameplayRulesVersion: LEVEL_RULES_VERSION,
    battlefieldId: options.battlefieldId,
    playerModifiers: LEVEL_PLAYER_MODIFIERS,
    enemyModifiers: options.enemy,
  });
  validate(options.actions, state);
  const engine = new LaneEngine(options.botDifficulty);
  let accumulators: Record<string, number> = {};
  let tick = 0;
  let processed = 0;

  const stepToTick = (target: number): void => {
    while (state.status === 'playing' && tick < target) {
      const step = engine.step(state, accumulators, PVP_SIMULATION_TICK_SECONDS);
      state = step.state; accumulators = step.accumulators; tick++;
    }
  };

  for (const action of options.actions) {
    stepToTick(Math.floor(action.atSeconds / PVP_SIMULATION_TICK_SECONDS + 1e-9));
    if (state.status !== 'playing') break;
    const applied = action.kind === 'lane' ? engine.open(state, action.sourceId, action.targetId) : engine.cut(action.sourceId, action.targetId);
    if (applied) processed++;
  }
  stepToTick(Math.ceil(PVP_TIME_LIMIT_SECONDS / PVP_SIMULATION_TICK_SECONDS) + 5);

  return {
    finalState: state,
    summary: { status: state.status === 'playing' ? 'draw' : state.status, durationSeconds: Math.floor(state.elapsedTimeSeconds), actionsProcessed: processed },
  };
}
