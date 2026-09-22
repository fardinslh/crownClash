import { describe, expect, it } from 'vitest';
import {
  MATCH_SCHEMA_VERSION_2,
  canonicalizeTwoVTwoActions,
  createInitial2v2GameState,
  simulate2v2Battle,
  simulationOwnerForSlot,
  teamIdForSlot,
  type CanonicalTwoVTwoAction,
  type PlayerUpgradeModifiers,
  type Slot,
  type Territory,
} from '../index.js';

const modifiersBySlot: Record<Slot, PlayerUpgradeModifiers> = {
  0: { startingUnits: 20, productionRateMultiplier: 1, armySpeedMultiplier: 1 },
  1: { startingUnits: 24, productionRateMultiplier: 1.1, armySpeedMultiplier: 1.2 },
  2: { startingUnits: 28, productionRateMultiplier: 1.2, armySpeedMultiplier: 1.4 },
  3: { startingUnits: 32, productionRateMultiplier: 1.3, armySpeedMultiplier: 1.6 },
};

const territories: Record<string, Territory> = {
  a_west: territory('a_west', 60, 600, 'player'),
  a_east: territory('a_east', 340, 600, 'player'),
  center: territory('center', 200, 360, 'neutral', 8),
  b_west: territory('b_west', 60, 120, 'enemy'),
  b_east: territory('b_east', 340, 120, 'enemy'),
};

const spawnAssignments = [
  { slot: 0, territoryId: 'a_west' },
  { slot: 1, territoryId: 'a_east' },
  { slot: 2, territoryId: 'b_west' },
  { slot: 3, territoryId: 'b_east' },
] as const;

function territory(
  id: string,
  x: number,
  y: number,
  owner: Territory['owner'],
  units = 10
): Territory {
  return {
    id,
    name: id,
    x,
    y,
    radius: 25,
    owner,
    units,
    maxUnits: 100,
    productionRate: 1,
    tier: 1,
    type: 'barracks',
  };
}

function action(
  serverSeq: number,
  slot: Slot,
  sourceId: string,
  targetId = 'center',
  tick = 0,
  clientSeq = 0
): CanonicalTwoVTwoAction {
  return {
    schemaVersion: MATCH_SCHEMA_VERSION_2,
    tick,
    serverSeq,
    slot,
    clientSeq,
    sourceId,
    targetId,
  };
}

function options(actions: readonly CanonicalTwoVTwoAction[], timeLimitSeconds = 0.02) {
  return { territories, spawnAssignments, modifiersBySlot, actions, timeLimitSeconds };
}

describe('2v2 deterministic simulation foundations', () => {
  it('maps four slots onto the two unchanged simulation owners', () => {
    expect([0, 1, 2, 3].map((slot) => teamIdForSlot(slot as Slot))).toEqual(['a', 'a', 'b', 'b']);
    expect([0, 1, 2, 3].map((slot) => simulationOwnerForSlot(slot as Slot))).toEqual([
      'player', 'player', 'enemy', 'enemy',
    ]);
  });

  it('applies each slot modifiers only to its assigned spawn', () => {
    const state = createInitial2v2GameState(options([]));
    expect(state.territories.a_west).toMatchObject({ units: 20, productionRate: 1 });
    expect(state.territories.a_east).toMatchObject({ units: 24, productionRate: 1.1 });
    expect(state.territories.b_west).toMatchObject({ units: 28, productionRate: 1.2 });
    expect(state.territories.b_east).toMatchObject({ units: 32, productionRate: 1.3 });
    expect(state.territories.center).toMatchObject({ units: 8, productionRate: 1 });
    expect(territories.a_east).toMatchObject({ units: 10, productionRate: 1 });
  });

  it('allows both teammates to dispatch from any shared team territory', () => {
    const result = simulate2v2Battle(options([
      action(0, 0, 'a_west'),
      action(1, 1, 'a_west'),
    ]));
    expect(result.actionsProcessed).toBe(2);
    expect(result.finalState.stats.playerUnitsDispatched).toBe(15);
    expect(result.finalState.armies.map((army) => army.owner)).toEqual(['player', 'player']);
  });

  it('rejects an opposing-team dispatch from a territory it does not own', () => {
    expect(() => simulate2v2Battle(options([action(0, 2, 'a_west')]))).toThrowError(
      expect.objectContaining({ code: 'slot_not_permitted' })
    );
  });

  it('uses the acting slot speed modifier', () => {
    const slow = simulate2v2Battle(options([action(0, 0, 'a_west')]));
    const fast = simulate2v2Battle(options([action(0, 1, 'a_west')]));
    expect(fast.finalState.armies[0].speed).toBeCloseTo(slow.finalState.armies[0].speed * 1.2, 12);
  });

  it('canonicalizes input order and resolves same-tick actions by server sequence', () => {
    const later = action(1, 1, 'a_west');
    const earlier = action(0, 0, 'a_west');
    const shuffled = simulate2v2Battle(options([later, earlier]));
    const ordered = simulate2v2Battle(options([earlier, later]));
    expect(shuffled.canonicalActions).toEqual([earlier, later]);
    expect(shuffled).toEqual(ordered);
    expect(shuffled.finalState.armies.map((army) => army.units)).toEqual([10, 5]);
  });

  it('replays an identical canonical log to an identical golden state hash', () => {
    const actions = [
      action(0, 0, 'a_west', 'center', 0),
      action(1, 2, 'b_west', 'center', 1),
      action(2, 1, 'a_east', 'center', 2),
      action(3, 3, 'b_east', 'center', 3),
    ];
    const first = simulate2v2Battle(options(actions, 1));
    const second = simulate2v2Battle(options(actions, 1));
    expect(second).toEqual(first);
    expect(first.stateHash).toBe('eb165a7a');
  });

  it('fails closed for malformed canonical actions and sources', () => {
    expect(() => canonicalizeTwoVTwoActions([
      action(0, 0, 'a_west'),
      action(0, 1, 'a_east'),
    ])).toThrowError(expect.objectContaining({ code: 'invalid_server_sequence' }));

    expect(() => canonicalizeTwoVTwoActions([action(0, 0, 'a_west', 'center', 0, 1)]))
      .toThrowError(expect.objectContaining({ code: 'invalid_client_sequence' }));

    const invalidSlot = { ...action(0, 0, 'a_west'), slot: 4 as Slot };
    expect(() => canonicalizeTwoVTwoActions([invalidSlot]))
      .toThrowError(expect.objectContaining({ code: 'invalid_slot' }));

    const invalidTick = { ...action(0, 0, 'a_west'), tick: 0.5 };
    expect(() => canonicalizeTwoVTwoActions([invalidTick]))
      .toThrowError(expect.objectContaining({ code: 'invalid_tick' }));

    const invalidSchema = { ...action(0, 0, 'a_west'), schemaVersion: 1 } as unknown as CanonicalTwoVTwoAction;
    expect(() => canonicalizeTwoVTwoActions([invalidSchema]))
      .toThrowError(expect.objectContaining({ code: 'invalid_schema_version' }));

    expect(() => simulate2v2Battle(options([action(0, 0, 'missing')])))
      .toThrowError(expect.objectContaining({ code: 'invalid_source' }));
  });

  it('rejects incomplete, duplicate, or cross-team spawn assignments', () => {
    expect(() => createInitial2v2GameState({
      ...options([]),
      spawnAssignments: spawnAssignments.slice(0, 3),
    })).toThrow(/spawn_assignments/);

    expect(() => createInitial2v2GameState({
      ...options([]),
      spawnAssignments: [
        spawnAssignments[0],
        { slot: 1, territoryId: 'a_west' },
        spawnAssignments[2],
        spawnAssignments[3],
      ],
    })).toThrow(/spawn_assignments/);

    expect(() => createInitial2v2GameState({
      ...options([]),
      spawnAssignments: [
        { slot: 0, territoryId: 'b_west' },
        spawnAssignments[1],
        spawnAssignments[2],
        spawnAssignments[3],
      ],
    })).toThrow(/spawn_owner/);
  });
});
