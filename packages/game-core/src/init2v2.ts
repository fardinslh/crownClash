import type { PlayerUpgradeModifiers } from './upgrades.js';
import { getBattlefield, type BattlefieldId } from './battlefields.js';
import type { GameState, Slot, Team, TeamId, Territory } from './types.js';

export const TWO_V_TWO_SLOTS = [0, 1, 2, 3] as const satisfies readonly Slot[];

export type SlotModifiers = Readonly<Record<Slot, PlayerUpgradeModifiers>>;

/**
 * Clones the authoritative battlefield templates verbatim, in deterministic
 * definition order (docs/2v2-architecture.md §6.3, Phase 6): the resulting
 * object's insertion order — which the simulation iterates — is exactly the
 * shipped battlefields.json order, matching the Go engine's
 * territoryOrderForBattlefield for the same id. Per-slot modifiers are NOT
 * applied here; createInitial2v2GameState applies them to the spawn
 * assignments.
 */
export function createInitial2v2Territories(battlefieldId: BattlefieldId): Record<string, Territory> {
  const battlefield = getBattlefield(battlefieldId);
  if (battlefield.mode !== '2v2') {
    throw new Error('2v2_initialization_invalid:battlefield_mode');
  }
  const territories: Record<string, Territory> = {};
  for (const template of battlefield.territories) {
    territories[template.id] = {
      id: template.id,
      name: template.name,
      x: template.x,
      y: template.y,
      radius: template.radius,
      owner: template.owner,
      units: template.units,
      maxUnits: template.maxUnits,
      productionRate: template.productionRate,
      tier: template.tier,
      type: template.type,
    };
  }
  return territories;
}

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
