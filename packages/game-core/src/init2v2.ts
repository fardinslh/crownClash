import type { PlayerUpgradeModifiers } from './upgrades.js';
import type { GameState, Slot, Team, TeamId, Territory } from './types.js';

export const TWO_V_TWO_SLOTS = [0, 1, 2, 3] as const satisfies readonly Slot[];

export type SlotModifiers = Readonly<Record<Slot, PlayerUpgradeModifiers>>;

export interface TwoVTwoSpawnAssignment {
  readonly slot: Slot;
  readonly territoryId: string;
}

export interface CreateTwoVTwoInitialStateOptions {
  readonly territories: Readonly<Record<string, Territory>>;
  readonly spawnAssignments: readonly TwoVTwoSpawnAssignment[];
  readonly modifiersBySlot: SlotModifiers;
  readonly timeLimitSeconds?: number;
  readonly battlefieldId?: GameState['battlefieldId'];
}

export function teamIdForSlot(slot: Slot): TeamId {
  return slot < 2 ? 'a' : 'b';
}

export function simulationOwnerForSlot(slot: Slot): Extract<Team, 'player' | 'enemy'> {
  return teamIdForSlot(slot) === 'a' ? 'player' : 'enemy';
}

export function createInitial2v2GameState(
  options: CreateTwoVTwoInitialStateOptions
): GameState {
  validateSpawnAssignments(options);

  const territories: Record<string, Territory> = {};
  for (const [id, territory] of Object.entries(options.territories)) {
    territories[id] = { ...territory };
  }

  for (const assignment of options.spawnAssignments) {
    const spawn = territories[assignment.territoryId];
    const modifiers = options.modifiersBySlot[assignment.slot];
    territories[assignment.territoryId] = {
      ...spawn,
      units: modifiers.startingUnits,
      productionRate: spawn.productionRate * modifiers.productionRateMultiplier,
    };
  }

  return {
    battlefieldId: options.battlefieldId,
    territories,
    armies: [],
    status: 'playing',
    elapsedTimeSeconds: 0,
    timeLimitSeconds: options.timeLimitSeconds ?? 90,
    stats: {
      matchDurationSeconds: 0,
      playerUnitsDispatched: 0,
      enemyUnitsDispatched: 0,
      territoriesCapturedByPlayer: 0,
      territoriesCapturedByEnemy: 0,
    },
  };
}

function validateSpawnAssignments(options: CreateTwoVTwoInitialStateOptions): void {
  if (options.spawnAssignments.length !== TWO_V_TWO_SLOTS.length) {
    throw new Error('2v2_initialization_invalid:spawn_assignments');
  }

  const seenSlots = new Set<Slot>();
  const seenTerritories = new Set<string>();
  for (const assignment of options.spawnAssignments) {
    if (!TWO_V_TWO_SLOTS.includes(assignment.slot)) {
      throw new Error('2v2_initialization_invalid:slot');
    }
    if (seenSlots.has(assignment.slot) || seenTerritories.has(assignment.territoryId)) {
      throw new Error('2v2_initialization_invalid:spawn_assignments');
    }

    const territory = options.territories[assignment.territoryId];
    if (!territory) {
      throw new Error('2v2_initialization_invalid:spawn_not_found');
    }
    if (territory.owner !== simulationOwnerForSlot(assignment.slot)) {
      throw new Error('2v2_initialization_invalid:spawn_owner');
    }
    seenSlots.add(assignment.slot);
    seenTerritories.add(assignment.territoryId);
  }
}
