import { dispatchArmy } from './dispatch.js';
import {
  createInitial2v2GameState,
  simulationOwnerForSlot,
  TWO_V_TWO_SLOTS,
  teamIdForSlot,
  type CreateTwoVTwoInitialStateOptions,
} from './init2v2.js';
import { MAX_PVP_ACTIONS, PVP_SIMULATION_TICK_SECONDS } from './pvp.js';
import { stepSimulation } from './simulation.js';
import {
  MATCH_SCHEMA_VERSION_2,
  type GameState,
  type MatchStats,
  type Slot,
  type TeamId,
} from './types.js';
import type { MatchSettlement } from './progression.js';

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

// ───────────────────────────────────────────────────────────────────────────
// Version-2 wire protocol (docs/2v2-architecture.md §3.3, Phase 4).
//
// Envelope-layer types shared by the client networking code. The simulation's
// two-sided team model is intentionally untouched: slots and teams live only
// here. Every inbound payload must pass the validators below before a client
// mutates match state (fail closed).
// ───────────────────────────────────────────────────────────────────────────

export const TWO_V_TWO_MATCH_MODE = '2v2' as const;

export interface TwoVTwoRosterEntry {
  readonly slot: Slot;
  readonly teamId: TeamId;
  readonly userId: string;
  readonly displayName: string;
}

/** Opcode 2 — authoritative match start and reconnect resync snapshot. */
export interface TwoVTwoMatchStartedPayload {
  readonly matchId: string;
  readonly mode: typeof TWO_V_TWO_MATCH_MODE;
  readonly slot: Slot;
  readonly teamId: TeamId;
  readonly nextSequence: number;
  readonly players: readonly TwoVTwoRosterEntry[];
  readonly state: GameState;
}

/** Opcode 3 — per-tick authoritative state (per-perspective projection). */
export interface TwoVTwoStatePayload {
  readonly tick: number;
  readonly state: GameState;
}

/** Opcode 5 — the slot's command was accepted into the canonical log. */
export interface TwoVTwoCommandAcceptedPayload {
  readonly sequence: number;
  readonly slot: Slot;
}

/** Opcode 6 — the slot's command was rejected without side effects. */
export interface TwoVTwoCommandRejectedPayload {
  readonly sequence: number;
  readonly code: string;
}

export type TwoVTwoParticipantStatus = 'victory' | 'defeat' | 'draw';

export interface TwoVTwoParticipantResult {
  readonly slot: Slot;
  readonly teamId: TeamId;
  readonly userId: string;
  readonly status: TwoVTwoParticipantStatus;
  readonly stats?: MatchStats;
  readonly abandoned?: boolean;
  readonly settlement?: MatchSettlement;
}

/** Opcode 7 — atomic per-participant result, or a cancelled match. */
export interface TwoVTwoMatchResultPayload {
  readonly matchId: string;
  readonly mode: typeof TWO_V_TWO_MATCH_MODE;
  readonly winnerTeamId?: TeamId;
  readonly outcome?: 'cancelled';
  readonly participants?: readonly TwoVTwoParticipantResult[];
}

/** Opcode 2 — all four voted rematch; the id joins the fresh match. */
export interface TwoVTwoRematchStartedPayload {
  readonly matchId: string;
}

/** Opcode 8 — terminal server error (e.g. settlement_failed). */
export interface TwoVTwoErrorPayload {
  readonly code: string;
}

export type TwoVTwoServerMessage =
  | { readonly kind: 'match_started'; readonly payload: TwoVTwoMatchStartedPayload }
  | { readonly kind: 'state'; readonly payload: TwoVTwoStatePayload }
  | { readonly kind: 'command_accepted'; readonly payload: TwoVTwoCommandAcceptedPayload }
  | { readonly kind: 'command_rejected'; readonly payload: TwoVTwoCommandRejectedPayload }
  | { readonly kind: 'match_result'; readonly payload: TwoVTwoMatchResultPayload }
  | { readonly kind: 'rematch_started'; readonly payload: TwoVTwoRematchStartedPayload }
  | { readonly kind: 'error'; readonly payload: TwoVTwoErrorPayload };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isGameState = (value: unknown): value is GameState =>
  isPlainObject(value) &&
  typeof value.status === 'string' &&
  isPlainObject(value.territories) &&
  Array.isArray(value.armies);

const isFiniteInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const parseMatchStats = (value: unknown): MatchStats | undefined =>
  isPlainObject(value) && typeof value.matchDurationSeconds === 'number'
    ? (value as unknown as MatchStats)
    : undefined;

const parseSettlement = (value: unknown): MatchSettlement | undefined =>
  isPlainObject(value) && typeof value.matchId === 'string'
    ? (value as unknown as MatchSettlement)
    : undefined;

const parseSlot = (value: unknown): Slot | null =>
  isFiniteInt(value) && TWO_V_TWO_SLOTS.includes(value as Slot) ? (value as Slot) : null;

const parseRoster = (value: unknown): readonly TwoVTwoRosterEntry[] | null => {
  if (!Array.isArray(value) || value.length !== TWO_V_TWO_SLOTS.length) return null;
  const seen = new Set<number>();
  const roster: TwoVTwoRosterEntry[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) return null;
    const slot = parseSlot(entry.slot);
    if (slot === null || seen.has(slot)) return null;
    seen.add(slot);
    const userId = entry.userId;
    if (typeof userId !== 'string' || !userId) return null;
    const displayName = entry.displayName;
    if (typeof displayName !== 'string') return null;
    if (entry.teamId !== teamIdForSlot(slot)) return null;
    roster.push({ slot, teamId: teamIdForSlot(slot), userId, displayName });
  }
  return roster;
};

/**
 * Validates an inbound version-2 server payload. Returns null for any
 * malformed, wrong-schema, or impossible message: callers must fail closed
 * without touching match state.
 */
export function parseTwoVTwoServerMessage(raw: unknown): TwoVTwoServerMessage | null {
  if (!isPlainObject(raw)) return null;
  if (raw.schemaVersion !== MATCH_SCHEMA_VERSION_2) return null;
  if (typeof raw.type !== 'string') return null;

  switch (raw.type) {
    case 'match_started': {
      if (typeof raw.matchId !== 'string' || !raw.matchId) return null;
      if (raw.mode !== TWO_V_TWO_MATCH_MODE) return null;
      const slot = parseSlot(raw.slot);
      if (slot === null || raw.teamId !== teamIdForSlot(slot)) return null;
      if (!isFiniteInt(raw.nextSequence)) return null;
      const players = parseRoster(raw.players);
      if (!players) return null;
      if (!isGameState(raw.state)) return null;
      return {
        kind: 'match_started',
        payload: {
          matchId: raw.matchId,
          mode: TWO_V_TWO_MATCH_MODE,
          slot,
          teamId: teamIdForSlot(slot),
          nextSequence: raw.nextSequence,
          players,
          state: raw.state,
        },
      };
    }
    case 'state': {
      if (!isFiniteInt(raw.tick)) return null;
      if (!isGameState(raw.state)) return null;
      return { kind: 'state', payload: { tick: raw.tick, state: raw.state } };
    }
    case 'command_accepted': {
      if (!isFiniteInt(raw.sequence)) return null;
      const slot = parseSlot(raw.slot);
      if (slot === null) return null;
      return { kind: 'command_accepted', payload: { sequence: raw.sequence, slot } };
    }
    case 'command_rejected': {
      if (!isFiniteInt(raw.sequence)) return null;
      if (typeof raw.code !== 'string' || !raw.code) return null;
      // The server rejects on behalf of the sender (slot is advisory and can
      // be -1); only the sequence and code are contractual.
      return { kind: 'command_rejected', payload: { sequence: raw.sequence, code: raw.code } };
    }
    case 'match_result': {
      if (!isPlainObject(raw.result)) return null;
      const result = raw.result;
      if (typeof result.matchId !== 'string' || !result.matchId) return null;
      if (result.mode !== TWO_V_TWO_MATCH_MODE) return null;
      if (result.outcome === 'cancelled') {
        return {
          kind: 'match_result',
          payload: { matchId: result.matchId, mode: TWO_V_TWO_MATCH_MODE, outcome: 'cancelled' },
        };
      }
      if (!Array.isArray(result.participants) || result.participants.length !== TWO_V_TWO_SLOTS.length) {
        return null;
      }
      const participants: TwoVTwoParticipantResult[] = [];
      const seenParticipantSlots = new Set<Slot>();
      const seenParticipantUsers = new Set<string>();
      for (const entry of result.participants) {
        if (!isPlainObject(entry)) return null;
        const slot = parseSlot(entry.slot);
        if (slot === null || entry.teamId !== teamIdForSlot(slot)) return null;
        if (typeof entry.userId !== 'string' || !entry.userId) return null;
        if (seenParticipantSlots.has(slot) || seenParticipantUsers.has(entry.userId)) return null;
        seenParticipantSlots.add(slot);
        seenParticipantUsers.add(entry.userId);
        if (
          entry.status !== 'victory' &&
          entry.status !== 'defeat' &&
          entry.status !== 'draw'
        ) {
          return null;
        }
        participants.push({
          slot,
          teamId: teamIdForSlot(slot),
          userId: entry.userId,
          status: entry.status,
          stats: parseMatchStats(entry.stats),
          abandoned: typeof entry.abandoned === 'boolean' ? entry.abandoned : undefined,
          settlement: parseSettlement(entry.settlement),
        });
      }
      let winnerTeamId: TeamId | undefined;
      if (result.winnerTeamId !== undefined) {
        if (result.winnerTeamId !== 'a' && result.winnerTeamId !== 'b') return null;
        winnerTeamId = result.winnerTeamId;
      }
      return {
        kind: 'match_result',
        payload: {
          matchId: result.matchId,
          mode: TWO_V_TWO_MATCH_MODE,
          winnerTeamId,
          participants,
        },
      };
    }
    case 'rematch_started': {
      if (typeof raw.matchId !== 'string' || !raw.matchId) return null;
      return { kind: 'rematch_started', payload: { matchId: raw.matchId } };
    }
    case 'error': {
      if (typeof raw.code !== 'string' || !raw.code) return null;
      return { kind: 'error', payload: { code: raw.code } };
    }
    default:
      return null;
  }
}

// Client → server (opcode 1). Every payload carries schemaVersion 2.

export function createTwoVTwoDispatchMessage(
  sequence: number,
  sourceId: string,
  targetId: string
): string {
  return JSON.stringify({ schemaVersion: MATCH_SCHEMA_VERSION_2, type: 'dispatch', sequence, sourceId, targetId });
}

export function createTwoVTwoReadyMessage(): string {
  return JSON.stringify({ schemaVersion: MATCH_SCHEMA_VERSION_2, type: 'ready' });
}

export function createTwoVTwoSurrenderMessage(): string {
  return JSON.stringify({ schemaVersion: MATCH_SCHEMA_VERSION_2, type: 'surrender' });
}

export function createTwoVTwoRematchVoteMessage(): string {
  return JSON.stringify({ schemaVersion: MATCH_SCHEMA_VERSION_2, type: 'rematch_vote' });
}
