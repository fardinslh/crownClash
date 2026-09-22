import { dispatchArmy } from './dispatch.js';
import {
  createInitial2v2GameState,
  simulationOwnerForSlot,
  TWO_V_TWO_SLOTS,
  type CreateTwoVTwoInitialStateOptions,
} from './init2v2.js';
import { MAX_PVP_ACTIONS, PVP_SIMULATION_TICK_SECONDS } from './pvp.js';
import { stepSimulation } from './simulation.js';
import {
  MATCH_SCHEMA_VERSION_2,
  type GameState,
  type Slot,
} from './types.js';

export interface CanonicalTwoVTwoAction {
  readonly schemaVersion: typeof MATCH_SCHEMA_VERSION_2;
  readonly tick: number;
  readonly serverSeq: number;
  readonly slot: Slot;
  readonly clientSeq: number;
  readonly sourceId: string;
  readonly targetId: string;
}

export type TwoVTwoSimulationErrorCode =
  | 'too_many_actions'
  | 'invalid_schema_version'
  | 'invalid_tick'
  | 'invalid_server_sequence'
  | 'invalid_client_sequence'
  | 'invalid_slot'
  | 'invalid_source'
  | 'invalid_target'
  | 'slot_not_permitted'
  | 'invalid_dispatch'
  | 'action_after_battle_end';

export class TwoVTwoSimulationError extends Error {
  constructor(public readonly code: TwoVTwoSimulationErrorCode) {
    super(`2v2_simulation_invalid:${code}`);
  }
}

export interface TwoVTwoSimulationOptions extends CreateTwoVTwoInitialStateOptions {
  readonly actions: readonly CanonicalTwoVTwoAction[];
  readonly maxActions?: number;
}

export interface TwoVTwoSimulationResult {
  readonly canonicalActions: readonly CanonicalTwoVTwoAction[];
  readonly finalState: GameState;
  readonly stateHash: string;
  readonly actionsProcessed: number;
}

const DEFAULT_MAX_ACTIONS = MAX_PVP_ACTIONS * 4;

export function canonicalizeTwoVTwoActions(
  actions: readonly CanonicalTwoVTwoAction[],
  maxActions = DEFAULT_MAX_ACTIONS
): readonly CanonicalTwoVTwoAction[] {
  if (actions.length > maxActions) throw new TwoVTwoSimulationError('too_many_actions');

  const canonical = [...actions].sort(compareCanonicalActions);
  const seenServerSequences = new Set<number>();
  const nextClientSequence: Record<Slot, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

  for (const action of canonical) {
    if (action.schemaVersion !== MATCH_SCHEMA_VERSION_2) {
      throw new TwoVTwoSimulationError('invalid_schema_version');
    }
    if (!Number.isSafeInteger(action.tick) || action.tick < 0) {
      throw new TwoVTwoSimulationError('invalid_tick');
    }
    if (!Number.isSafeInteger(action.serverSeq) || action.serverSeq < 0) {
      throw new TwoVTwoSimulationError('invalid_server_sequence');
    }
    if (seenServerSequences.has(action.serverSeq)) {
      throw new TwoVTwoSimulationError('invalid_server_sequence');
    }
    if (!TWO_V_TWO_SLOTS.includes(action.slot)) {
      throw new TwoVTwoSimulationError('invalid_slot');
    }
    if (
      !Number.isSafeInteger(action.clientSeq) ||
      action.clientSeq !== nextClientSequence[action.slot]
    ) {
      throw new TwoVTwoSimulationError('invalid_client_sequence');
    }
    if (!action.sourceId) throw new TwoVTwoSimulationError('invalid_source');
    if (!action.targetId) throw new TwoVTwoSimulationError('invalid_target');

    seenServerSequences.add(action.serverSeq);
    nextClientSequence[action.slot]++;
  }

  return Object.freeze(canonical.map((action) => Object.freeze({ ...action })));
}

export function simulate2v2Battle(
  options: TwoVTwoSimulationOptions
): TwoVTwoSimulationResult {
  const canonicalActions = canonicalizeTwoVTwoActions(
    options.actions,
    options.maxActions
  );
  let state = createInitial2v2GameState(options);
  let accumulators: Record<string, number> = {};
  let currentTick = 0;
  let actionsProcessed = 0;
  const maximumTick = Math.floor(state.timeLimitSeconds / PVP_SIMULATION_TICK_SECONDS + 1e-9);

  const stepUntil = (targetTick: number): void => {
    while (state.status === 'playing' && currentTick < targetTick) {
      const stepped = stepSimulation(state, accumulators, PVP_SIMULATION_TICK_SECONDS);
      state = stepped.state;
      accumulators = stepped.accumulators;
      currentTick++;
    }
  };

  for (const action of canonicalActions) {
    if (action.tick > maximumTick) throw new TwoVTwoSimulationError('invalid_tick');
    stepUntil(action.tick);
    if (state.status !== 'playing') {
      throw new TwoVTwoSimulationError('action_after_battle_end');
    }

    const source = state.territories[action.sourceId];
    const target = state.territories[action.targetId];
    if (!source) throw new TwoVTwoSimulationError('invalid_source');
    if (!target) throw new TwoVTwoSimulationError('invalid_target');

    const owner = simulationOwnerForSlot(action.slot);
    if (source.owner !== owner) {
      throw new TwoVTwoSimulationError('slot_not_permitted');
    }

    const dispatched = dispatchArmy(
      source,
      target,
      owner,
      0.5,
      () => `2v2_${action.tick}_${action.serverSeq}_${action.slot}_${action.clientSeq}`,
      options.modifiersBySlot[action.slot].armySpeedMultiplier
    );
    if (!dispatched.success || !dispatched.army || !dispatched.sourceTerritory) {
      throw new TwoVTwoSimulationError('invalid_dispatch');
    }

    state = {
      ...state,
      territories: {
        ...state.territories,
        [source.id]: dispatched.sourceTerritory,
      },
      armies: [...state.armies, dispatched.army],
      stats: {
        ...state.stats,
        playerUnitsDispatched:
          owner === 'player'
            ? state.stats.playerUnitsDispatched + dispatched.army.units
            : state.stats.playerUnitsDispatched,
        enemyUnitsDispatched:
          owner === 'enemy'
            ? state.stats.enemyUnitsDispatched + dispatched.army.units
            : state.stats.enemyUnitsDispatched,
      },
    };
    actionsProcessed++;
  }

  stepUntil(maximumTick);
  if (state.status === 'playing') {
    const remainder = state.timeLimitSeconds - state.elapsedTimeSeconds;
    const stepped = stepSimulation(state, accumulators, Math.max(0, remainder));
    state = stepped.state;
  }

  return {
    canonicalActions,
    finalState: state,
    stateHash: hashTwoVTwoState(state),
    actionsProcessed,
  };
}

export function hashTwoVTwoState(state: GameState): string {
  const canonicalState = {
    ...state,
    territories: Object.fromEntries(
      Object.entries(state.territories).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0
      )
    ),
  };
  const serialized = JSON.stringify(canonicalState);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index++) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function compareCanonicalActions(
  left: CanonicalTwoVTwoAction,
  right: CanonicalTwoVTwoAction
): number {
  return (
    left.tick - right.tick ||
    left.serverSeq - right.serverSeq ||
    left.slot - right.slot ||
    left.clientSeq - right.clientSeq
  );
}
