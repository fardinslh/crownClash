/**
 * Bot-parity simulation harness (client side).
 *
 * Deterministically reproduces the exact GameScene bot-match prediction loop
 * (20 ms fixed steps, AI ticks every PVP_AI_TICK_SECONDS, action recording via
 * recordDispatchActions semantics) using the shared @crown-clash/game-core
 * engine, and replays the recorded actions through the real TS replay engine
 * (core.simulatePvpBattle) used for authoritative comparison.
 *
 * The replay-mirror below duplicates core.simulatePvpBattle step-for-step but
 * emits state checkpoints so a cross-implementation diff (against the Go
 * server replay) can localize the FIRST diverging state. The mirror is
 * validated on every run by asserting its summary equals the real
 * core.simulatePvpBattle summary; if they ever disagree, the harness fails
 * closed rather than trusting the mirror.
 *
 * This module is engine-only (no Nakama dependency) so both the crosscheck
 * orchestrator and the e2e smoke test can import it.
 */

import * as core from '../../packages/game-core/dist/packages/game-core/src/index.js';

const EPSILON = 1e-9;

function assert(condition, message) {
  if (!condition) throw new Error(`[harness] ${message}`);
}

/**
 * Mirrors GameScene.stepBotMatch + executeAiTurn + the player input/dispatch
 * path, including recordDispatchActions semantics (one shared atSeconds per
 * dispatch volley, sequence = matchActions.length, atSeconds rounded to ms).
 *
 * playerPolicy: {
 *   firstActionAt: number,     // match seconds of the first dispatch attempt
 *   interval: number,          // seconds between dispatch attempts
 *   maxActions: number,        // stop generating after this many actions
 *   multiSources: number,      // how many player territories per coordinated dispatch
 * }
 * A null playerPolicy generates an idle match (defeat path).
 */
export function runClientPrediction({ battlefieldId, playerModifiers, playerPolicy }) {
  const enemyModifiers = { startingUnits: 20, productionRateMultiplier: 1, armySpeedMultiplier: 1 };
  let state = core.createInitialGameState({
    timeLimit: core.PVP_TIME_LIMIT_SECONDS,
    playerModifiers,
    enemyModifiers,
    battlefieldId,
  });
  let accumulators = {};
  let aiNextTick = core.PVP_AI_TICK_SECONDS;
  const actions = [];
  let nextPlayerActionAt = playerPolicy ? playerPolicy.firstActionAt : null;
  let playerActionIndex = 0;

  const recordDispatchActions = (armies) => {
    const atSeconds = Math.round(state.elapsedTimeSeconds * 1000) / 1000;
    for (const army of armies) {
      if (actions.length >= core.MAX_PVP_ACTIONS) return;
      actions.push({
        sequence: actions.length,
        atSeconds,
        sourceId: army.sourceId,
        targetId: army.targetId,
      });
    }
  };

  // Mirrors the pointer-input handler: dispatchMultipleArmies from the
  // selected player territories toward the target, then record.
  const dispatchPlayerVolley = (sources, target) => {
    const multiDispatch = core.dispatchMultipleArmies(
      sources,
      target,
      'player',
      0.5,
      playerModifiers.armySpeedMultiplier
    );
    if (multiDispatch.armies.length > 0) {
      Object.assign(state.territories, multiDispatch.updatedSources);
      state.armies.push(...multiDispatch.armies);
      state.stats.playerUnitsDispatched += multiDispatch.totalUnitsDispatched;
      recordDispatchActions(multiDispatch.armies);
    }
  };

  while (state.status === 'playing') {
    // Input phase: Phaser processes pointer input between update() calls, so a
    // dispatch lands at the current grid time before the next 20 ms step.
    while (
      playerPolicy &&
      nextPlayerActionAt !== null &&
      state.elapsedTimeSeconds >= nextPlayerActionAt - EPSILON
    ) {
      const move = core.evaluateAiMove(state.territories, 'player', 8);
      if (move && actions.length < core.MAX_PVP_ACTIONS) {
        const sourceIds = [move.fromId];
        if (playerPolicy.multiSources > 1) {
          // Coordinated attack: additional player territories with enough units.
          const extras = Object.values(state.territories)
            .filter(
              (t) =>
                t.owner === 'player' &&
                t.id !== move.fromId &&
                t.id !== move.toId &&
                t.units >= 8
            )
            .sort((a, b) => b.units - a.units)
            .slice(0, playerPolicy.multiSources - 1)
            .map((t) => t.id);
          sourceIds.push(...extras);
        }
        const sources = sourceIds
          .map((id) => state.territories[id])
          .filter(Boolean);
        if (sources.length > 0) dispatchPlayerVolley(sources, state.territories[move.toId]);
      }
      playerActionIndex++;
      if (playerPolicy.maxActions > 0 && playerActionIndex >= playerPolicy.maxActions) {
        nextPlayerActionAt = null;
      } else {
        nextPlayerActionAt += playerPolicy.interval;
      }
    }
    if (state.status !== 'playing') break;

    // One 20 ms simulation tick (mirrors stepBotMatch's fixed clock).
    const result = core.stepSimulation(state, accumulators, core.PVP_SIMULATION_TICK_SECONDS);
    state = result.state;
    accumulators = result.accumulators;

    // AI turn inside the tick loop (mirrors GameScene's aiNextTick check).
    if (
      state.status === 'playing' &&
      state.elapsedTimeSeconds >= aiNextTick - EPSILON
    ) {
      const move = core.evaluateAiMove(state.territories, 'enemy', 8);
      if (move) {
        const source = state.territories[move.fromId];
        const target = state.territories[move.toId];
        if (source && target) {
          const dispatch = core.dispatchArmy(source, target, 'enemy', 0.5, undefined, 1);
          if (dispatch.success && dispatch.army && dispatch.sourceTerritory) {
            state.territories[source.id] = dispatch.sourceTerritory;
            state.armies.push(dispatch.army);
            state.stats.enemyUnitsDispatched += dispatch.army.units;
          }
        }
      }
      aiNextTick += core.PVP_AI_TICK_SECONDS;
    }

    if (state.elapsedTimeSeconds >= core.PVP_TIME_LIMIT_SECONDS + 1) break;
  }

  return {
    status: state.status === 'playing' ? 'draw' : state.status,
    stats: state.stats,
    finalState: state,
    actions,
  };
}

function snapshotState(state, accumulators) {
  const territories = {};
  for (const [id, t] of Object.entries(state.territories)) {
    territories[id] = { owner: t.owner, units: t.units, productionRate: t.productionRate };
  }
  const armies = state.armies.map((a) => ({
    id: a.id,
    owner: a.owner,
    units: a.units,
    sourceId: a.sourceId,
    targetId: a.targetId,
    progress: a.progress,
    speed: a.speed,
  }));
  return { territories, armies, accumulators: { ...accumulators } };
}

// Exported for the 2v2 cross-engine harness (bot_parity_2v2_crosscheck.mjs),
// whose checkpoints use the identical snapshot structure.
export { snapshotState };

/**
 * Mirrors core.simulatePvpBattle exactly, adding state checkpoints after each
 * AI tick, each player action, and at the end. Its final summary is asserted
 * against the real core.simulatePvpBattle result by runTsReplay.
 */
export function runTsReplayMirror({ battlefieldId, playerModifiers, enemyModifiers, actions }) {
  let state = core.createInitialGameState({
    timeLimit: core.PVP_TIME_LIMIT_SECONDS,
    playerModifiers,
    enemyModifiers,
    battlefieldId,
  });
  let accumulators = {};
  let currentTime = 0;
  let nextAiTick = core.PVP_AI_TICK_SECONDS;
  let aiActionIndex = 0;
  let actionIndex = 0;
  const checkpoints = [];

  const capture = (kind) => {
    checkpoints.push({ kind, at: currentTime, status: state.status, ...snapshotState(state, accumulators) });
  };

  const stepTo = (timestamp) => {
    while (
      state.status === 'playing' &&
      currentTime + core.PVP_SIMULATION_TICK_SECONDS <= timestamp + EPSILON
    ) {
      const step = core.stepSimulation(state, accumulators, core.PVP_SIMULATION_TICK_SECONDS);
      state = step.state;
      accumulators = step.accumulators;
      currentTime += core.PVP_SIMULATION_TICK_SECONDS;
    }
    const remainder = timestamp - currentTime;
    if (state.status === 'playing' && remainder > 0) {
      const step = core.stepSimulation(state, accumulators, remainder);
      state = step.state;
      accumulators = step.accumulators;
    }
    const clockCorrection = timestamp - state.elapsedTimeSeconds;
    if (state.status === 'playing' && clockCorrection > 0) {
      const step = core.stepSimulation(state, accumulators, clockCorrection);
      state = step.state;
      accumulators = step.accumulators;
    }
    currentTime = timestamp;
  };

  const executeAiAction = () => {
    if (state.status !== 'playing') return;
    const move = core.evaluateAiMove(state.territories, 'enemy', 8);
    if (!move) return;
    state = dispatchFromState(state, move.fromId, move.toId, 'enemy', enemyModifiers?.armySpeedMultiplier ?? 1, `pvp_ai_${aiActionIndex++}`);
  };

  for (const action of actions) {
    while (state.status === 'playing' && nextAiTick <= action.atSeconds) {
      stepTo(nextAiTick);
      executeAiAction();
      capture('ai_tick');
      nextAiTick += core.PVP_AI_TICK_SECONDS;
    }
    if (state.status !== 'playing') break;

    stepTo(action.atSeconds);
    if (state.status !== 'playing') break;

    try {
      state = dispatchFromState(state, action.sourceId, action.targetId, 'player', playerModifiers?.armySpeedMultiplier ?? 1, `pvp_player_${action.sequence}`);
      actionIndex++;
      capture('player_action');
    } catch (error) {
      // Mirror core.simulatePvpBattle: replay-invalid actions are skipped.
      if (!(error instanceof core.PvpSimulationError)) throw error;
      capture('skipped_action');
    }
  }

  while (state.status === 'playing' && nextAiTick <= core.PVP_TIME_LIMIT_SECONDS) {
    stepTo(nextAiTick);
    executeAiAction();
    capture('ai_tick');
    nextAiTick += core.PVP_AI_TICK_SECONDS;
  }

  if (state.status === 'playing') {
    stepTo(core.PVP_TIME_LIMIT_SECONDS);
  }

  capture('final');
  return {
    status: state.status === 'playing' ? 'draw' : state.status,
    stats: state.stats,
    durationSeconds: Math.floor(state.elapsedTimeSeconds),
    actionsProcessed: actionIndex,
    checkpoints,
  };
}

function dispatchFromState(state, sourceId, targetId, owner, travelSpeedMultiplier, armyId) {
  const source = state.territories[sourceId];
  const target = state.territories[targetId];
  if (!source) throw new core.PvpSimulationError('invalid_source');
  if (!target) throw new core.PvpSimulationError('invalid_target');
  const result = core.dispatchArmy(source, target, owner, 0.5, () => armyId, travelSpeedMultiplier);
  if (!result.success || !result.army || !result.sourceTerritory) {
    throw new core.PvpSimulationError('invalid_dispatch');
  }
  return {
    ...state,
    territories: { ...state.territories, [sourceId]: result.sourceTerritory },
    armies: [...state.armies, result.army],
    stats: {
      ...state.stats,
      playerUnitsDispatched:
        owner === 'player' ? state.stats.playerUnitsDispatched + result.army.units : state.stats.playerUnitsDispatched,
      enemyUnitsDispatched:
        owner === 'enemy' ? state.stats.enemyUnitsDispatched + result.army.units : state.stats.enemyUnitsDispatched,
    },
  };
}

/**
 * Runs the real TS replay engine and the validated checkpoint mirror.
 * Fails closed if the mirror ever disagrees with the real engine.
 */
export function runTsReplay(scenario) {
  const real = core.simulatePvpBattle({
    actions: scenario.actions,
    playerModifiers: scenario.playerModifiers,
    enemyModifiers: scenario.enemyModifiers,
    battlefieldId: scenario.battlefieldId,
  });
  const mirror = runTsReplayMirror(scenario);
  assert(
    real.summary.status === mirror.status &&
      real.summary.actionsProcessed === mirror.actionsProcessed &&
      real.summary.durationSeconds === mirror.durationSeconds,
    `TS replay mirror diverged from real simulatePvpBattle for scenario ${scenario.id}: real=${JSON.stringify(real.summary)} mirror=${mirror.status}/${mirror.actionsProcessed}`
  );
  return { real, mirror };
}
