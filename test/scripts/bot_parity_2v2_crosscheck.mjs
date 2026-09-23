#!/usr/bin/env node
/**
 * Cross-implementation 2v2 parity crosscheck (Phase 2 of docs/2v2-architecture.md).
 *
 * For every 2v2 scenario this tool:
 *  1. replays the canonical action log through the REAL TypeScript 2v2 engine
 *     (core.simulate2v2Battle, the Phase 1 inert simulator);
 *  2. replays the same log through a checkpoint mirror of simulate2v2Battle,
 *     validated fail-closed against the real engine's summary and state hash;
 *  3. replays the identical scenario through the real Go authoritative mirror
 *     (apps/server-nakama Simulate2v2Battle) in the pinned golang container;
 *  4. compares the canonical action order, per-action state checkpoints,
 *     team-level stats, elapsed time, match status, actions processed, and
 *     the deterministic FNV-1a state hash — localizing the FIRST divergence.
 *
 * Fail-closed on both sides: malformed canonical logs must produce the SAME
 * error code on both engines; any missing result or mismatch is a hard failure.
 *
 * Usage: node test/scripts/bot_parity_2v2_crosscheck.mjs [--keep-artifacts]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as core from '../../packages/game-core/dist/packages/game-core/src/index.js';
import { snapshotState } from './bot_parity_harness.mjs';
import {
  FLOAT_TOLERANCE,
  FLOAT_ABSOLUTE_FLOOR,
  compareFloat,
  compareCheckpoint,
} from './bot_parity_crosscheck.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EPSILON = 1e-9;

// ---------------------------------------------------------------------------
// Fixtures: injectable 2v2 territory sets (NOT production battlefields).
// Territory keys are created in sorted order so both engines iterate
// identical territory orders.
// ---------------------------------------------------------------------------

function baseTerritories({ stableSpawns = false, productionRate = 1 } = {}) {
  // Sorted ids: a_east, a_west, b_east, b_west, center.
  const sourceType = stableSpawns ? 'stable' : 'barracks';
  const territories = {};
  territories.a_east = { id: 'a_east', name: 'a_east', x: 340, y: 600, radius: 25, owner: 'player', units: 10, maxUnits: 100, productionRate, tier: 1, type: 'barracks' };
  territories.a_west = { id: 'a_west', name: 'a_west', x: 60, y: 600, radius: 25, owner: 'player', units: 10, maxUnits: 100, productionRate, tier: 1, type: sourceType };
  territories.b_east = { id: 'b_east', name: 'b_east', x: 340, y: 120, radius: 25, owner: 'enemy', units: 10, maxUnits: 100, productionRate, tier: 1, type: 'barracks' };
  territories.b_west = { id: 'b_west', name: 'b_west', x: 60, y: 120, radius: 25, owner: 'enemy', units: 10, maxUnits: 100, productionRate, tier: 1, type: sourceType };
  territories.center = { id: 'center', name: 'center', x: 200, y: 360, radius: 25, owner: 'neutral', units: 8, maxUnits: 100, productionRate, tier: 2, type: 'fortress' };
  return territories;
}

const SPAWN_ASSIGNMENTS = [
  { slot: 0, territoryId: 'a_west' },
  { slot: 1, territoryId: 'a_east' },
  { slot: 2, territoryId: 'b_west' },
  { slot: 3, territoryId: 'b_east' },
];

// Per-slot modifier sets: distinct starting garrison, production, and speed
// per slot, including boundary-sensitive multipliers (1.1 * 1.5-style
// production churn and speed values near the 1.0 s march clamp).
const MODIFIER_SETS = {
  spread: {
    0: { startingUnits: 20, productionRateMultiplier: 1, armySpeedMultiplier: 1 },
    1: { startingUnits: 24, productionRateMultiplier: 1.1, armySpeedMultiplier: 1.2 },
    2: { startingUnits: 28, productionRateMultiplier: 1.2, armySpeedMultiplier: 1.4 },
    3: { startingUnits: 32, productionRateMultiplier: 1.3, armySpeedMultiplier: 1.6 },
  },
  boundary_production: {
    0: { startingUnits: 20, productionRateMultiplier: 1.65, armySpeedMultiplier: 1 },
    1: { startingUnits: 21, productionRateMultiplier: 1.1, armySpeedMultiplier: 1.06 },
    2: { startingUnits: 22, productionRateMultiplier: 1.4, armySpeedMultiplier: 1.495 },
    3: { startingUnits: 23, productionRateMultiplier: 1.7, armySpeedMultiplier: 1.525 },
  },
  mixed_teams: {
    0: { startingUnits: 50, productionRateMultiplier: 1.7, armySpeedMultiplier: 1.525 },
    1: { startingUnits: 20, productionRateMultiplier: 1, armySpeedMultiplier: 1 },
    2: { startingUnits: 50, productionRateMultiplier: 1.4, armySpeedMultiplier: 1.495 },
    3: { startingUnits: 20, productionRateMultiplier: 1.16, armySpeedMultiplier: 1.06 },
  },
};

// The fixture battlefield id is registered ONLY by the Go test binary
// (simulate2v2_test.go init) so the authoritative step loop iterates the
// fixture territory order; it is not a production battlefield.
const FIXTURE_BATTLEFIELD_ID = '2v2_parity_fixture';

// ---------------------------------------------------------------------------
// Production 2v2 battlefield scenarios (Phase 6): quad_citadel territories
// are built from the SHIPPED battlefields.json definition in its frozen
// deterministic order (core.createInitial2v2Territories), so the TypeScript
// simulation's iteration order is exactly the Go engine's
// territoryOrderForBattlefield('quad_citadel') — the JSON registration —
// with no fixture ordering involved.
// ---------------------------------------------------------------------------

const QUAD_CITADEL_ID = 'quad_citadel';

function quadCitadelTerritories() {
  return core.createInitial2v2Territories(QUAD_CITADEL_ID);
}

// The production per-slot spawn assignment (live2v2.go live2v2SpawnAssignments).
const QUAD_CITADEL_SPAWN_ASSIGNMENTS = [
  { slot: 0, territoryId: 'a_base_w' },
  { slot: 1, territoryId: 'a_base_e' },
  { slot: 2, territoryId: 'b_base_e' },
  { slot: 3, territoryId: 'b_base_w' },
];

function quadScenario({ id, modifiers = MODIFIER_SETS.spread, timeLimitSeconds, actions, expectedErrorCode }) {
  return {
    id,
    territories: quadCitadelTerritories(),
    spawnAssignments: QUAD_CITADEL_SPAWN_ASSIGNMENTS,
    modifiersBySlot: modifiers,
    timeLimitSeconds,
    battlefieldId: QUAD_CITADEL_ID,
    actions,
    ...(expectedErrorCode ? { expectedErrorCode } : {}),
  };
}

function action(schemaVersion, tick, serverSeq, slot, clientSeq, sourceId, targetId) {
  return { schemaVersion, tick, serverSeq, slot, clientSeq, sourceId, targetId };
}

function canonicalAction(tick, serverSeq, slot, clientSeq, sourceId, targetId = 'center') {
  return action(2, tick, serverSeq, slot, clientSeq, sourceId, targetId);
}

function scenario({ id, modifiers = MODIFIER_SETS.spread, territories = baseTerritories(), timeLimitSeconds, actions, expectedErrorCode, stableSpawns = false, productionRate = 1 }) {
  return {
    id,
    territories: territories ?? baseTerritories({ stableSpawns, productionRate }),
    spawnAssignments: SPAWN_ASSIGNMENTS,
    modifiersBySlot: modifiers,
    timeLimitSeconds,
    battlefieldId: FIXTURE_BATTLEFIELD_ID,
    actions,
    ...(expectedErrorCode ? { expectedErrorCode } : {}),
  };
}

function buildScenarios() {
  const scenarios = [];
  let n = 0;

  // 1. All four slots dispatching at distinct ticks (captures by both teams
  //    against the neutral fortress; long enough for arrivals and combat).
  n++;
  scenarios.push(scenario({
    id: `s${n}_all_four_slots_captures`,
    timeLimitSeconds: 12,
    actions: [
      canonicalAction(0, 0, 0, 0, 'a_west'),
      canonicalAction(1, 1, 1, 0, 'a_east'),
      canonicalAction(100, 2, 2, 0, 'b_west'),
      canonicalAction(150, 3, 3, 0, 'b_east'),
      canonicalAction(300, 4, 0, 1, 'a_west', 'center'),
      canonicalAction(350, 5, 2, 1, 'b_west', 'center'),
    ],
  }));

  // 2. Both teammates dispatching from ONE shared territory (same tick and
  //    across ticks): the second dispatch must see the halved garrison.
  n++;
  scenarios.push(scenario({
    id: `s${n}_shared_source_both_teammates`,
    timeLimitSeconds: 4,
    actions: [
      canonicalAction(0, 0, 0, 0, 'a_west'),
      canonicalAction(0, 1, 1, 0, 'a_west'),
      canonicalAction(2, 2, 1, 1, 'a_west'),
      canonicalAction(3, 3, 2, 0, 'b_west'),
    ],
  }));

  // 3. Same-tick command storm: five actions in one tick from all four
  //    slots, input deliberately out of serverSeq order.
  n++;
  scenarios.push(scenario({
    id: `s${n}_same_tick_storm`,
    timeLimitSeconds: 3,
    actions: [
      canonicalAction(5, 4, 0, 1, 'a_west'),
      canonicalAction(5, 0, 0, 0, 'a_west'),
      canonicalAction(5, 3, 3, 0, 'b_east'),
      canonicalAction(5, 1, 1, 0, 'a_east'),
      canonicalAction(5, 2, 2, 0, 'b_west'),
    ],
  }));

  // 4. Shuffled input log: the SAME canonical log fed in a different array
  //    order must produce an identical outcome (canonicalization proof).
  n++;
  const canonicalLog = [
    canonicalAction(0, 0, 0, 0, 'a_west'),
    canonicalAction(2, 1, 1, 0, 'a_east'),
    canonicalAction(10, 2, 2, 0, 'b_west'),
    canonicalAction(20, 3, 3, 0, 'b_east'),
    canonicalAction(60, 4, 0, 1, 'a_west', 'center'),
  ];
  scenarios.push(scenario({ id: `s${n}_log_canonical_order`, timeLimitSeconds: 6, actions: canonicalLog }));
  n++;
  scenarios.push(scenario({ id: `s${n}_log_shuffled_order`, timeLimitSeconds: 6, actions: [canonicalLog[3], canonicalLog[0], canonicalLog[4], canonicalLog[2], canonicalLog[1]] }));

  // 5. Teammate reinforcement: both team-A slots feed the same friendly
  //    territory; same for team B.
  n++;
  scenarios.push(scenario({
    id: `s${n}_teammate_reinforcement`,
    timeLimitSeconds: 8,
    actions: [
      canonicalAction(0, 0, 0, 0, 'a_west', 'a_east'),
      canonicalAction(0, 1, 1, 0, 'a_east', 'a_west'),
      canonicalAction(0, 2, 2, 0, 'b_west', 'b_east'),
      canonicalAction(0, 3, 3, 0, 'b_east', 'b_west'),
      canonicalAction(100, 4, 2, 1, 'b_west', 'b_east'),
      canonicalAction(120, 5, 3, 1, 'b_east', 'b_west'),
    ],
  }));

  // 6. Stable-source speed multipliers: dispatches originate from 'stable'
  //    typed spawns with per-slot speed careers.
  n++;
  scenarios.push(scenario({
    id: `s${n}_stable_source_speed`,
    territories: baseTerritories({ stableSpawns: true }),
    timeLimitSeconds: 6,
    actions: [
      canonicalAction(0, 0, 0, 0, 'a_west'),
      canonicalAction(0, 1, 1, 0, 'a_east'),
      canonicalAction(0, 2, 2, 0, 'b_west'),
      canonicalAction(0, 3, 3, 0, 'b_east'),
    ],
  }));

  // 7. Production boundary-sensitive values: accumulator churn with the
  //    1.1*1.5-style rates from the historical FMA razor edge, long enough
  //    to cross integer grant boundaries repeatedly.
  n++;
  scenarios.push(scenario({
    id: `s${n}_production_boundary_churn`,
    modifiers: MODIFIER_SETS.boundary_production,
    territories: baseTerritories({ productionRate: 1.1 }),
    timeLimitSeconds: 30,
    actions: [
      canonicalAction(0, 0, 0, 0, 'a_west', 'a_east'),
      canonicalAction(100, 1, 2, 0, 'b_west', 'b_east'),
      canonicalAction(500, 2, 1, 0, 'a_east', 'center'),
      canonicalAction(900, 3, 3, 0, 'b_east', 'center'),
      canonicalAction(1200, 4, 0, 1, 'a_west', 'center'),
    ],
  }));

  // 8. Idle / time-limit outcome: no actions at all; the time-limit
  //    tiebreak (territory count, then total units) decides deterministically
  //    on both engines (the enemy team's larger spawn garrisons win it).
  n++;
  scenarios.push(scenario({ id: `s${n}_idle_time_limit_draw`, timeLimitSeconds: 2, actions: [] }));

  // 9. Mismatched team strength with capture races on the center.
  n++;
  scenarios.push(scenario({
    id: `s${n}_mismatched_teams_center_race`,
    modifiers: MODIFIER_SETS.mixed_teams,
    timeLimitSeconds: 15,
    actions: [
      canonicalAction(0, 0, 0, 0, 'a_west'),
      canonicalAction(0, 1, 2, 0, 'b_west'),
      canonicalAction(50, 2, 1, 0, 'a_east', 'center'),
      canonicalAction(50, 3, 3, 0, 'b_east', 'center'),
      canonicalAction(200, 4, 0, 1, 'a_west', 'center'),
      canonicalAction(220, 5, 2, 1, 'b_west', 'center'),
    ],
  }));

  // 10. Fail-closed malformed logs: TS and Go must produce the SAME error
  //     code (nothing is silently skipped in the 2v2 replay).
  const malformed = [
    { id: 'invalid_schema_version', expected: 'invalid_schema_version', actions: [action(1, 0, 0, 0, 0, 'a_west', 'center')] },
    // NOTE: non-integer ticks cannot be represented on the Go wire (int tick
    // field); invalid-tick coverage here uses a negative tick, and fractional
    // ticks are covered by the game-core unit tests on the TS side only.
    { id: 'invalid_tick_negative', expected: 'invalid_tick', actions: [canonicalAction(-1, 0, 0, 0, 'a_west')] },
    { id: 'duplicate_server_sequence', expected: 'invalid_server_sequence', actions: [canonicalAction(0, 0, 0, 0, 'a_west'), canonicalAction(0, 0, 1, 0, 'a_east')] },
    { id: 'client_sequence_gap', expected: 'invalid_client_sequence', actions: [canonicalAction(0, 0, 0, 0, 'a_west'), canonicalAction(0, 1, 0, 2, 'a_west', 'center')] },
    { id: 'invalid_slot', expected: 'invalid_slot', actions: [{ ...canonicalAction(0, 0, 0, 0, 'a_west'), slot: 4 }] },
    { id: 'cross_team_source', expected: 'slot_not_permitted', actions: [canonicalAction(0, 0, 2, 0, 'a_west')] },
    { id: 'missing_source', expected: 'invalid_source', actions: [canonicalAction(0, 0, 0, 0, 'no_such_tower')] },
    { id: 'missing_target', expected: 'invalid_target', actions: [canonicalAction(0, 0, 0, 0, 'a_west', 'no_such_tower')] },
    { id: 'self_target', expected: 'invalid_dispatch', actions: [canonicalAction(0, 0, 0, 0, 'a_west', 'a_west')] },
    { id: 'too_many_actions', expected: 'too_many_actions', actions: Array.from({ length: 481 }, (_, i) => canonicalAction(0, i, i % 4, Math.floor(i / 4), 'a_west', 'center')) },
  ];
  for (const malformedCase of malformed) {
    n++;
    scenarios.push(scenario({
      id: `s${n}_invalid_${malformedCase.id}`,
      timeLimitSeconds: 2,
      actions: malformedCase.actions,
      expectedErrorCode: malformedCase.expected,
    }));
  }

  // -----------------------------------------------------------------------
  // Production 2v2 battlefield scenarios (Phase 6, quad_citadel §7.3):
  // deterministic ordering comes from the shipped battlefields.json
  // definition itself (createInitial2v2Territories), not from the
  // test-only fixture ordering.
  // -----------------------------------------------------------------------

  // Q1. All four slots dispatching from their own spawns (§7.3 bases), with
  //     capture races on the center from both teams.
  n++;
  scenarios.push(quadScenario({
    id: `s${n}_quad_citadel_all_four_slots_dispatch`,
    timeLimitSeconds: 12,
    actions: [
      canonicalAction(0, 0, 0, 0, 'a_base_w', 'n_center'),
      canonicalAction(0, 1, 1, 0, 'a_base_e', 'a_gate_e'),
      canonicalAction(100, 2, 2, 0, 'b_base_e', 'n_center'),
      canonicalAction(150, 3, 3, 0, 'b_base_w', 'b_gate_e'),
      canonicalAction(300, 4, 0, 1, 'a_base_w', 'a_gate_w'),
      canonicalAction(350, 5, 2, 1, 'b_base_e', 'b_gate_w'),
    ],
  }));

  // Q2. Teammate shared-source dispatch: both Team A slots dispatch from
  //     ONE team-shared territory (a_base_w) — team ownership is shared
  //     from the first tick (§2.3); mirrored by Team B from b_base_e.
  n++;
  scenarios.push(quadScenario({
    id: `s${n}_quad_citadel_teammate_shared_source`,
    timeLimitSeconds: 6,
    actions: [
      canonicalAction(0, 0, 0, 0, 'a_base_w', 'a_gate_w'),
      canonicalAction(0, 1, 1, 0, 'a_base_w', 'a_base_e'),
      canonicalAction(0, 2, 2, 0, 'b_base_e', 'b_gate_w'),
      canonicalAction(0, 3, 3, 0, 'b_base_e', 'b_base_w'),
      canonicalAction(120, 4, 1, 1, 'a_base_w', 'n_center'),
      canonicalAction(140, 5, 3, 1, 'b_base_e', 'n_center'),
    ],
  }));

  // Q3. Simultaneous opposing arrivals at the center: a_base_w, a_base_e,
  //     and b_base_e are all equidistant from n_center, so three armies
  //     arrive on the same tick and resolution order must match exactly.
  n++;
  scenarios.push(quadScenario({
    id: `s${n}_quad_citadel_center_clash`,
    timeLimitSeconds: 8,
    actions: [
      canonicalAction(0, 0, 0, 0, 'a_base_w', 'n_center'),
      canonicalAction(0, 1, 1, 0, 'a_base_e', 'n_center'),
      canonicalAction(0, 2, 2, 0, 'b_base_e', 'n_center'),
      canonicalAction(0, 3, 3, 0, 'b_base_w', 'n_center'),
    ],
  }));

  // Q4. Teammate reinforcement over the trunk road: each team feeds its
  //     sibling base, then pushes the reinforced garrison onward.
  n++;
  scenarios.push(quadScenario({
    id: `s${n}_quad_citadel_teammate_reinforcement`,
    timeLimitSeconds: 10,
    actions: [
      canonicalAction(0, 0, 0, 0, 'a_base_w', 'a_base_e'),
      canonicalAction(0, 1, 2, 0, 'b_base_e', 'b_base_w'),
      canonicalAction(100, 2, 1, 0, 'a_base_e', 'a_gate_e'),
      canonicalAction(100, 3, 3, 0, 'b_base_w', 'b_gate_w'),
      canonicalAction(300, 4, 0, 1, 'a_base_w', 'a_gate_w'),
      canonicalAction(320, 5, 2, 1, 'b_base_e', 'b_gate_e'),
    ],
  }));

  // Q5. Stable speed modifiers on the real map: capture the stable-typed
  //     corner spurs first, then dispatch FROM the stables so the stable
  //     source multiplier compounds with per-slot speed careers
  //     (boundary_production includes speeds at the 1.0 s march clamp and
  //     the 1.525 career razor edge).
  n++;
  scenarios.push(quadScenario({
    id: `s${n}_quad_citadel_stable_speed`,
    modifiers: MODIFIER_SETS.boundary_production,
    timeLimitSeconds: 8,
    actions: [
      canonicalAction(0, 0, 0, 0, 'a_base_w', 'n_corner_sw'),
      canonicalAction(0, 1, 2, 0, 'b_base_e', 'n_corner_ne'),
      canonicalAction(60, 2, 0, 1, 'n_corner_sw', 'n_corner_se'),
      canonicalAction(60, 3, 2, 1, 'n_corner_ne', 'n_corner_nw'),
      canonicalAction(200, 4, 1, 0, 'n_corner_sw', 'a_gate_w'),
      canonicalAction(220, 5, 3, 0, 'n_corner_ne', 'b_gate_w'),
    ],
  }));

  // Q6. Production-boundary churn: base rates 1.2/1.2 with the historical
  //     FMA razor-edge multipliers (1.65, 1.7, 1.1) accumulating across
  //     integer grant boundaries for 30 seconds on quad_citadel.
  n++;
  scenarios.push(quadScenario({
    id: `s${n}_quad_citadel_production_churn`,
    modifiers: MODIFIER_SETS.boundary_production,
    timeLimitSeconds: 30,
    actions: [
      canonicalAction(0, 0, 0, 0, 'a_base_w', 'a_base_e'),
      canonicalAction(100, 1, 2, 0, 'b_base_e', 'b_gate_w'),
      canonicalAction(500, 2, 1, 0, 'a_base_e', 'n_center'),
      canonicalAction(900, 3, 3, 0, 'b_base_w', 'n_center'),
      canonicalAction(1200, 4, 0, 1, 'a_base_w', 'a_gate_w'),
      canonicalAction(1400, 5, 2, 1, 'b_base_e', 'b_gate_e'),
    ],
  }));

  // Q7. Shuffled action-log canonicalization on the real map: the SAME
  //     canonical log fed in reverse array order must produce the identical
  //     canonical order, decisions, and final hash.
  n++;
  const quadCanonicalLog = [
    canonicalAction(0, 0, 0, 0, 'a_base_w', 'n_center'),
    canonicalAction(2, 1, 1, 0, 'a_base_e', 'a_gate_e'),
    canonicalAction(10, 2, 2, 0, 'b_base_e', 'n_center'),
    canonicalAction(20, 3, 3, 0, 'b_base_w', 'b_gate_e'),
    canonicalAction(60, 4, 0, 1, 'a_base_w', 'a_gate_w'),
  ];
  scenarios.push(quadScenario({ id: `s${n}_quad_citadel_log_canonical_order`, timeLimitSeconds: 6, actions: quadCanonicalLog }));
  n++;
  scenarios.push(quadScenario({ id: `s${n}_quad_citadel_log_shuffled_order`, timeLimitSeconds: 6, actions: [quadCanonicalLog[3], quadCanonicalLog[0], quadCanonicalLog[4], quadCanonicalLog[2], quadCanonicalLog[1]] }));

  // Q8. Idle / time-limit resolution: no actions at all; with symmetric
  //     modifiers the time-limit tiebreak (territory count, then units)
  //     must resolve to the same deterministic draw on both engines.
  n++;
  scenarios.push(quadScenario({ id: `s${n}_quad_citadel_idle_time_limit`, timeLimitSeconds: 2, actions: [] }));

  return scenarios;
}

// ---------------------------------------------------------------------------
// TypeScript engine: real simulate2v2Battle + validated checkpoint mirror.
// ---------------------------------------------------------------------------

function runTs2v2Mirror(scenarioInput, canonicalActions) {
  let state = core.createInitial2v2GameState({
    territories: scenarioInput.territories,
    spawnAssignments: scenarioInput.spawnAssignments,
    modifiersBySlot: scenarioInput.modifiersBySlot,
    timeLimitSeconds: scenarioInput.timeLimitSeconds,
    battlefieldId: scenarioInput.battlefieldId,
  });
  let accumulators = {};
  let currentTick = 0;
  let actionsProcessed = 0;
  const maximumTick = Math.floor(state.timeLimitSeconds / core.PVP_SIMULATION_TICK_SECONDS + 1e-9);
  const checkpoints = [];

  const capture = (kind) => {
    checkpoints.push({ kind, at: currentTick * core.PVP_SIMULATION_TICK_SECONDS, status: state.status, ...snapshotState(state, accumulators) });
  };
  const stepUntil = (targetTick) => {
    while (state.status === 'playing' && currentTick < targetTick) {
      const stepped = core.stepSimulation(state, accumulators, core.PVP_SIMULATION_TICK_SECONDS);
      state = stepped.state;
      accumulators = stepped.accumulators;
      currentTick++;
    }
  };

  for (const actionItem of canonicalActions) {
    if (actionItem.tick > maximumTick) throw new core.TwoVTwoSimulationError('invalid_tick');
    stepUntil(actionItem.tick);
    if (state.status !== 'playing') throw new core.TwoVTwoSimulationError('action_after_battle_end');

    const source = state.territories[actionItem.sourceId];
    const target = state.territories[actionItem.targetId];
    if (!source) throw new core.TwoVTwoSimulationError('invalid_source');
    if (!target) throw new core.TwoVTwoSimulationError('invalid_target');

    const owner = core.simulationOwnerForSlot(actionItem.slot);
    if (source.owner !== owner) throw new core.TwoVTwoSimulationError('slot_not_permitted');

    const dispatched = core.dispatchArmy(
      source,
      target,
      owner,
      0.5,
      () => `2v2_${actionItem.tick}_${actionItem.serverSeq}_${actionItem.slot}_${actionItem.clientSeq}`,
      scenarioInput.modifiersBySlot[actionItem.slot].armySpeedMultiplier
    );
    if (!dispatched.success || !dispatched.army || !dispatched.sourceTerritory) {
      throw new core.TwoVTwoSimulationError('invalid_dispatch');
    }
    state = {
      ...state,
      territories: { ...state.territories, [source.id]: dispatched.sourceTerritory },
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
    capture('action');
  }

  stepUntil(maximumTick);
  if (state.status === 'playing') {
    const remainder = state.timeLimitSeconds - state.elapsedTimeSeconds;
    const stepped = core.stepSimulation(state, accumulators, Math.max(0, remainder));
    state = stepped.state;
  }
  capture('final');

  return {
    status: state.status === 'playing' ? 'draw' : state.status,
    stats: state.stats,
    actionsProcessed,
    checkpoints,
    stateHash: core.hashTwoVTwoState(state),
  };
}

function runTsSide(scenarios) {
  const results = [];
  for (const scenarioInput of scenarios) {
    let real = null;
    let errorCode = null;
    try {
      real = core.simulate2v2Battle({
        territories: scenarioInput.territories,
        spawnAssignments: scenarioInput.spawnAssignments,
        modifiersBySlot: scenarioInput.modifiersBySlot,
        timeLimitSeconds: scenarioInput.timeLimitSeconds,
        battlefieldId: scenarioInput.battlefieldId,
        actions: scenarioInput.actions,
      });
    } catch (error) {
      if (!(error instanceof core.TwoVTwoSimulationError)) throw error;
      errorCode = error.code;
    }

    let mirror = null;
    let mirrorErrorCode = null;
    try {
      const canonicalActions = core.canonicalizeTwoVTwoActions(scenarioInput.actions);
      mirror = runTs2v2Mirror(scenarioInput, canonicalActions);
    } catch (error) {
      if (!(error instanceof core.TwoVTwoSimulationError)) throw error;
      mirrorErrorCode = error.code;
    }

    // Fail closed: the mirror must agree with the real engine.
    if ((errorCode ?? null) !== (mirrorErrorCode ?? null)) {
      throw new Error(
        `[${scenarioInput.id}] TS mirror diverged from real simulate2v2Battle: real error=${errorCode} mirror error=${mirrorErrorCode}`
      );
    }
    if (real !== null) {
      if (
        mirror.status !== (real.finalState.status === 'playing' ? 'draw' : real.finalState.status) ||
        mirror.actionsProcessed !== real.actionsProcessed ||
        mirror.stateHash !== real.stateHash ||
        JSON.stringify(mirror.checkpoints.map((c) => c.kind)) !== JSON.stringify(real.canonicalActions.map(() => 'action').concat('final'))
      ) {
        throw new Error(
          `[${scenarioInput.id}] TS mirror diverged from real simulate2v2Battle: real hash=${real.stateHash} actions=${real.actionsProcessed} mirror hash=${mirror.stateHash} actions=${mirror.actionsProcessed}`
        );
      }
    }

    results.push({
      id: scenarioInput.id,
      expectedErrorCode: scenarioInput.expectedErrorCode ?? null,
      errorCode,
      status: real ? (real.finalState.status === 'playing' ? 'draw' : real.finalState.status) : null,
      stateHash: real ? real.stateHash : null,
      actionsProcessed: real ? real.actionsProcessed : null,
      stats: real ? real.finalState.stats : null,
      canonicalActions: real ? real.canonicalActions : (mirror ? mirror.checkpoints && [] : []),
      tsCheckpoints: real ? mirror.checkpoints : [],
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Go engine execution (pinned golang container, or host Go in CI).
// ---------------------------------------------------------------------------

function runGoSide(tsResults, workDir) {
  const scenariosPath = path.join(workDir, 'scenarios_2v2.json');
  const outputPath = path.join(workDir, 'go_2v2_results.json');
  fs.writeFileSync(scenariosPath, JSON.stringify(tsResults.map((result, index) => {
    const scenarioInput = buildScenariosCache[index];
    return {
      id: result.id,
      territories: scenarioInput.territories,
      spawnAssignments: scenarioInput.spawnAssignments,
      modifiersBySlot: scenarioInput.modifiersBySlot,
      timeLimitSeconds: scenarioInput.timeLimitSeconds,
      battlefieldId: scenarioInput.battlefieldId,
      actions: scenarioInput.actions,
      expectedErrorCode: scenarioInput.expectedErrorCode ?? '',
    };
  })), 'utf8');

  if (process.env.CROSS_ENGINE_GO_MODE === 'host') {
    try {
      execFileSync(
        'go',
        ['test', '-run', 'TestParity2v2ReplayDump', '-count=1', '-v', '.'],
        {
          cwd: path.join(REPO_ROOT, 'apps', 'server-nakama'),
          env: { ...process.env, PARITY2V2_SCENARIOS: scenariosPath, PARITY2V2_OUTPUT: outputPath },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
    } catch (error) {
      throw new Error(`Go 2v2 replay test failed:\n${[error.stdout, error.stderr].filter(Boolean).join('\n')}`);
    }
  } else {
    try {
      execFileSync(
        'docker',
        [
          'run', '--rm',
          '-v', `${REPO_ROOT}:/repo:ro`,
          '-v', `${workDir}:/data`,
          '-w', '/repo/apps/server-nakama',
          '-e', `PARITY2V2_SCENARIOS=/data/${path.basename(scenariosPath)}`,
          '-e', `PARITY2V2_OUTPUT=/data/${path.basename(outputPath)}`,
          'golang:1.26.5',
          'go', 'test', '-run', 'TestParity2v2ReplayDump', '-count=1', '-v', '.',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (error) {
      throw new Error(`Go 2v2 replay test failed:\n${[error.stdout, error.stderr].filter(Boolean).map((b) => b.toString()).join('\n')}`);
    }
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error('Go 2v2 replay dump produced no output file (fail closed)');
  }
  const results = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  if (!Array.isArray(results) || results.length !== tsResults.length) {
    throw new Error(`Go 2v2 replay returned ${Array.isArray(results) ? results.length : 'non-array'} results for ${tsResults.length} scenarios`);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Comparison.
// ---------------------------------------------------------------------------

function canonicalActionFingerprint(actionItem) {
  return `${actionItem.tick}:${actionItem.serverSeq}:${actionItem.slot}:${actionItem.clientSeq}:${actionItem.sourceId}:${actionItem.targetId}`;
}

function compareScenario(tsResult, goResult) {
  const problems = [];
  const drifts = [];

  // Error-code agreement (fail-closed parity for malformed logs).
  const tsError = tsResult.errorCode ?? '';
  const goError = goResult.errorCode ?? '';
  if (tsError !== goError) {
    problems.push(`error code mismatch: TS="${tsError}" Go="${goError}"`);
    return { problems, drifts };
  }
  if (tsResult.expectedErrorCode && tsResult.expectedErrorCode !== tsError) {
    problems.push(`expected error code ${tsResult.expectedErrorCode}, TS produced "${tsError}"`);
    return { problems, drifts };
  }
  if (tsError !== '') {
    return { problems, drifts }; // both engines failed closed identically
  }

  // Canonical action order: exact fingerprint equality.
  const tsFingerprints = tsResult.canonicalActions.map(canonicalActionFingerprint);
  const goFingerprints = (goResult.canonicalActions ?? []).map(canonicalActionFingerprint);
  if (JSON.stringify(tsFingerprints) !== JSON.stringify(goFingerprints)) {
    problems.push(`canonical action order mismatch:\n      TS : ${JSON.stringify(tsFingerprints)}\n      Go : ${JSON.stringify(goFingerprints)}`);
  }

  if (tsResult.status !== goResult.status) {
    problems.push(`status mismatch: TS=${tsResult.status} Go=${goResult.status}`);
  }
  if (tsResult.actionsProcessed !== goResult.actionsProcessed) {
    problems.push(`actionsProcessed mismatch: TS=${tsResult.actionsProcessed} Go=${goResult.actionsProcessed}`);
  }

  // Deterministic final-state hash (exact cross-engine equality).
  if (tsResult.stateHash !== goResult.stateHash) {
    problems.push(`final-state hash mismatch: TS=${tsResult.stateHash} Go=${goResult.stateHash}`);
  }

  // Team-level stats (floats with the shared 1v1 tolerance policy).
  const statsLocation = 'final stats';
  for (const key of ['matchDurationSeconds', 'playerUnitsDispatched', 'enemyUnitsDispatched', 'territoriesCapturedByPlayer', 'territoriesCapturedByEnemy']) {
    try {
      compareFloat(`stats.${key}`, tsResult.stats[key] ?? 0, goResult.stats?.[key] ?? 0, drifts, tsResult.id, statsLocation);
    } catch (error) {
      problems.push(error.message);
    }
  }

  // Checkpoints: identical schema and tolerances as the 1v1 harness.
  if (tsResult.tsCheckpoints.length !== (goResult.checkpoints ?? []).length) {
    problems.push(`checkpoint count mismatch: TS=${tsResult.tsCheckpoints.length} Go=${(goResult.checkpoints ?? []).length}`);
  } else {
    for (let i = 0; i < tsResult.tsCheckpoints.length; i++) {
      try {
        compareCheckpoint(tsResult.id, i, tsResult.tsCheckpoints[i], goResult.checkpoints[i], drifts);
      } catch (error) {
        problems.push(`first divergent checkpoint [${i}]: ${error.message}`);
        break;
      }
    }
  }

  return { problems, drifts };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

let buildScenariosCache = [];

async function main() {
  const keepArtifacts = process.argv.includes('--keep-artifacts');
  console.log('====================================================================');
  console.log(' 2v2 Parity Crosscheck: TS simulate2v2Battle vs Go Simulate2v2Battle');
  console.log('====================================================================\n');

  const scenarios = buildScenarios();
  buildScenariosCache = scenarios;
  const errorScenarios = scenarios.filter((s) => s.expectedErrorCode).length;
  console.log(`Generated ${scenarios.length} scenarios (${scenarios.length - errorScenarios} valid + ${errorScenarios} fail-closed malformed).\n`);

  console.log('[1/2] Running TS 2v2 engine (+ validated mirror) and Go authoritative mirror...');
  const tsResults = runTsSide(scenarios);
  const artifactBase = path.join(REPO_ROOT, 'qa-artifacts', 'bot-parity');
  fs.mkdirSync(artifactBase, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(artifactBase, '2v2-'));
  let goResults;
  try {
    goResults = runGoSide(tsResults, workDir);
  } finally {
    if (!keepArtifacts) {
      fs.rmSync(workDir, { recursive: true, force: true });
    } else {
      console.log(`      Artifacts kept in ${workDir}`);
    }
  }
  console.log(`      ${tsResults.length} scenarios simulated on both engines.\n`);

  console.log('[2/2] Comparing canonical order, checkpoints, stats, hashes, and error codes...');
  let failureCount = 0;
  for (let i = 0; i < scenarios.length; i++) {
    const { problems, drifts } = compareScenario(tsResults[i], goResults[i]);
    if (problems.length > 0) {
      failureCount++;
      console.log(`\n  [MISMATCH] ${tsResults[i].id}`);
      for (const problem of problems) console.log(`    - ${problem}`);
      if (drifts.length > 0) {
        const worst = drifts.reduce((a, b) => (b.relative > a.relative ? b : a));
        console.log(`    (largest tolerated float drift before divergence: ${worst.field} at ${worst.location}, relative ${worst.relative.toExponential(3)})`);
      }
    } else {
      const driftNote = drifts.length > 0 ? ` (${drifts.length} sub-tolerance float drifts)` : '';
      const outcome = tsResults[i].errorCode ? `fail-closed=${tsResults[i].errorCode}` : `status=${goResults[i].status} hash=${goResults[i].stateHash}`;
      console.log(`  [OK] ${tsResults[i].id}: ${outcome}${driftNote}`);
    }
  }

  if (failureCount > 0) {
    console.error(`\n[2V2 PARITY CROSSCHECK FAILED] ${failureCount}/${scenarios.length} scenarios diverged.`);
    process.exit(1);
  }
  console.log('\n[2V2 PARITY CROSSCHECK PASSED] All scenarios agree across engines.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('\n[2V2 PARITY CROSSCHECK FAILED]', error);
    process.exit(1);
  });
}
