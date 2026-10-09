import { describe, expect, it } from 'vitest';
import { GameplayLabBattle, replayGameplayLab } from '../gameplay-lab.js';
import { LAB_RULES_VERSION, gameplayLabRules, getCaptureProductionMultiplier } from '../gameplay-rules.js';
import { createInitialGameState, stepSimulation } from '../simulation.js';
import { dispatchArmy, dispatchMultipleArmies } from '../dispatch.js';
import { evaluateAiMove } from '../ai.js';
import type { GameState, Team } from '../types.js';

function arriving(state: GameState, targetId: string, owner: Team, units = 100): void {
  const t = state.territories[targetId];
  state.armies.push({ id: `arrival_${state.armies.length}`, sourceId: 'p_base', targetId, owner, units,
    startX: 0, startY: 0, targetX: t.x, targetY: t.y, progress: 0, speed: 50, distance: 1 });
}

describe('gameplay lab rules', () => {
  it('rejects variable-duration steps for experimental rules', () => {
    const state = createInitialGameState({ rules: gameplayLabRules('capture_recovery') });
    expect(() => stepSimulation(state, {}, 0.04)).toThrow('gameplay_rules_require_fixed_20ms_tick');
    expect(() => stepSimulation(state, {}, NaN)).toThrow('gameplay_rules_require_fixed_20ms_tick');
  });
  it.each(['player', 'enemy'] as const)('keeps normal speeds for %s without restricting attacks or reinforcement', (owner) => {
    const state = createInitialGameState({ rules: gameplayLabRules('capture_recovery') });
    const source = state.territories[owner === 'player' ? 'p_base' : 'e_base'];
    const connected = state.territories[owner === 'player' ? 'n_bot_left' : 'n_top_right'];
    const remote = state.territories[owner === 'player' ? 'e_base' : 'p_base'];
    const base = dispatchArmy(source, connected, owner);
    const boosted = dispatchArmy(source, connected, owner, 0.5, undefined, 1, state);
    expect(base.success).toBe(true); expect(boosted.success).toBe(true);
    expect(boosted.army!.speed).toBeCloseTo(base.army!.speed, 12);
    expect(boosted.army!.units).toBe(base.army!.units);
    for (const targetOwner of ['neutral', 'player', 'enemy'] as const) {
      const target = { ...remote, owner: targetOwner };
      const result = dispatchArmy(source, target, owner, 0.5, undefined, 1, state);
      expect(result.success).toBe(true);
      expect(result.army!.speed).toBe(dispatchArmy(source, target, owner).army!.speed);
    }
    expect(dispatchArmy(source, source, owner, 0.5, undefined, 1, state).success).toBe(false);
    expect(dispatchArmy({ ...source, owner: 'neutral' }, connected, owner, 0.5, undefined, 1, state).success).toBe(false);
  });

  it('dispatches every selected source at normal travel speeds', () => {
    const state = createInitialGameState({ rules: gameplayLabRules('capture_recovery') });
    state.territories.n_bot_right.owner = 'player'; state.territories.n_bot_right.units = 40;
    const sources = [state.territories.p_base, state.territories.n_bot_right];
    const target = state.territories.n_bot_left;
    const result = dispatchMultipleArmies(sources, target, 'player', 0.5, 1, state);
    expect(result.armies).toHaveLength(2);
    expect(result.armies.map((a) => [a.sourceId, a.units])).toEqual([['p_base', 10], ['n_bot_right', 20]]);
    expect(result.totalUnitsDispatched).toBe(30);
    expect(Object.keys(result.updatedSources)).toEqual(['p_base', 'n_bot_right']);
    expect(result.armies[0].speed).toBeCloseTo(dispatchArmy(sources[0], target, 'player').army!.speed, 12);
    expect(result.armies[1].speed).toBe(dispatchArmy(sources[1], target, 'player').army!.speed);
  });

  it('lets the bot dispatch directly from rear holdings using its existing scoring', () => {
    const battle = new GameplayLabBattle('capture_recovery');
    for (const t of Object.values(battle.state.territories)) { t.owner = 'enemy'; t.units = 12; }
    battle.state.territories.e_base.units = 80;
    battle.state.territories.p_base.owner = 'player'; battle.state.territories.p_base.units = 1;
    const move = evaluateAiMove(battle.state.territories);
    expect(move).toEqual({ fromId: 'e_base', toId: 'p_base' });
    expect(battle.dispatch([move!.fromId], move!.toId, 'enemy').armies).toHaveLength(1);
  });

  it('starts production immediately at 50%, reaches 75% at 1.5s and 100% at exactly 3s', () => {
    const state = createInitialGameState({ rules: gameplayLabRules('capture_recovery') });
    state.territories.n_bot_left.productionRate = 50;
    state.territories.n_bot_left.type = 'fortress';
    state.territories.n_bot_left.maxUnits = 1000;
    arriving(state, 'n_bot_left', 'player');
    let result = stepSimulation(state, { n_bot_left: 0.95 }, 0.02);
    expect(result.resolvedArrivals[0].captured).toBe(true);
    expect(result.state.productionReadyTicks!.n_bot_left).toBe(151);
    expect(result.accumulators.n_bot_left).toBe(0.5); // old progress was discarded, new production already started
    const capturedUnits = result.state.territories.n_bot_left.units;
    const multiplier = () => getCaptureProductionMultiplier(result.state.rules, result.state.simulationTick!, result.state.productionReadyTicks!.n_bot_left);
    expect(multiplier()).toBe(0.5);
    result = stepSimulation(result.state, result.accumulators, 0.02);
    expect(result.state.territories.n_bot_left.units).toBe(capturedUnits + 1);
    while (result.state.simulationTick! < 76) result = stepSimulation(result.state, result.accumulators, 0.02);
    expect(multiplier()).toBe(0.75);
    while (result.state.simulationTick! < 150) result = stepSimulation(result.state, result.accumulators, 0.02);
    expect(multiplier()).toBeLessThan(1);
    const beforeReady = result.state.territories.n_bot_left.units;
    result = stepSimulation(result.state, result.accumulators, 0.02);
    expect(multiplier()).toBe(1);
    expect(result.state.territories.n_bot_left.units).toBe(beforeReady + 1);
  });

  it.each(['player', 'enemy'] as const)('preserves active recovery through repeated recaptures by %s and reinforcement', (firstOwner) => {
    const initial = createInitialGameState({ rules: gameplayLabRules('capture_recovery') });
    initial.territories.n_bot_left.productionRate = 50; initial.territories.n_bot_left.type = 'fortress';
    initial.territories.n_bot_left.maxUnits = 1000;
    arriving(initial, 'n_bot_left', firstOwner);
    let result = stepSimulation(initial, {}, 0.02);
    arriving(result.state, 'n_bot_left', firstOwner, 1);
    result = stepSimulation(result.state, result.accumulators, 0.02);
    expect(result.resolvedArrivals[0].reinforced).toBe(true);
    expect(result.state.productionReadyTicks!.n_bot_left).toBe(151);
    for (let recapture = 0; recapture < 6; recapture++) {
      for (let i = 0; i < 19; i++) result = stepSimulation(result.state, result.accumulators, 0.02);
      const owner = result.state.territories.n_bot_left.owner === 'player' ? 'enemy' : 'player';
      arriving(result.state, 'n_bot_left', owner, 200);
      result = stepSimulation(result.state, result.accumulators, 0.02);
      expect(result.resolvedArrivals[0].captured).toBe(true);
      expect(result.state.productionReadyTicks!.n_bot_left).toBe(151);
      expect(result.state.territories.n_bot_left.owner).toBe(owner);
      const percent = getCaptureProductionMultiplier(result.state.rules, result.state.simulationTick!, 151);
      expect(result.accumulators.n_bot_left).toBeCloseTo(percent, 12);
      const beforeProduction = result.state.territories.n_bot_left.units;
      result = stepSimulation(result.state, result.accumulators, 0.02);
      expect(result.state.territories.n_bot_left.units).toBe(beforeProduction + 1);
      expect(dispatchArmy(result.state.territories.n_bot_left, result.state.territories.n_center, owner, 0.5, undefined, 1, result.state).success).toBe(true);
    }
    while (result.state.simulationTick! < 151) result = stepSimulation(result.state, result.accumulators, 0.02);
    expect(getCaptureProductionMultiplier(result.state.rules, 151, 151)).toBe(1);
    arriving(result.state, 'n_bot_left', result.state.territories.n_bot_left.owner === 'player' ? 'enemy' : 'player', 500);
    result = stepSimulation(result.state, result.accumulators, 0.02);
    expect(result.state.productionReadyTicks!.n_bot_left).toBe(302);
    expect(result.accumulators.n_bot_left).toBe(0.5);
  });

  it('keeps recovery independent per building and does not slow uncaptured bases', () => {
    const state = createInitialGameState({ rules: gameplayLabRules('capture_recovery') });
    arriving(state, 'n_bot_left', 'player');
    let result = stepSimulation(state, {}, 0.02);
    for (let i = 0; i < 49; i++) result = stepSimulation(result.state, result.accumulators, 0.02);
    arriving(result.state, 'n_bot_right', 'enemy');
    result = stepSimulation(result.state, result.accumulators, 0.02);
    expect(result.state.productionReadyTicks).toEqual({ n_bot_left: 151, n_bot_right: 201 });
    expect(getCaptureProductionMultiplier(result.state.rules, 51, 151)).toBeCloseTo(2 / 3);
    expect(getCaptureProductionMultiplier(result.state.rules, 51, 201)).toBe(0.5);
    expect(result.state.territories.p_base.units).toBe(21);
  });

  it('rejects replay records from an incompatible experiment', () => {
    const battle = new GameplayLabBattle('capture_recovery'); battle.quit();
    expect(battle.record.rulesVersion).toBe(LAB_RULES_VERSION);
    expect(() => replayGameplayLab({ ...battle.record, rulesVersion: 1 } as unknown as typeof battle.record)).toThrow('incompatible_lab_rules_version');
  });

  it.each(['capture_recovery'] as const)('replays %s actions to the exact same state', (variant) => {
    const battle = new GameplayLabBattle(variant);
    expect(battle.dispatch(['p_base'], 'n_bot_left').armies).toHaveLength(1);
    for (let i = 0; i < 600; i++) battle.step();
    battle.quit();
    expect(battle.record.actions.some((a) => a.owner === 'enemy')).toBe(true);
    const replay = replayGameplayLab(battle.record);
    expect(replay.state).toEqual(battle.state);
    expect(replay.accumulators).toEqual(battle.accumulators);
    expect(replay.record.captures).toEqual(battle.record.captures);
    expect(replay.record.snapshots).toEqual(battle.record.snapshots);
  });

  it('C uses the existing bot decisions with the same fixed-clock command cadence', () => {
    const lab = new GameplayLabBattle('capture_recovery');
    let state = createInitialGameState({ rules: gameplayLabRules('capture_recovery') });
    let accumulators = {};
    let aiIndex = 0;
    const opening = dispatchArmy(state.territories.p_base, state.territories.n_bot_left, 'player', 0.5, () => 'pvp_player_0');
    expect(opening.success).toBe(true);
    state.territories.p_base = opening.sourceTerritory!;
    state.armies.push(opening.army!);
    state.stats.playerUnitsDispatched += opening.army!.units;
    lab.dispatch(['p_base'], 'n_bot_left');
    for (let tick = 1; tick <= 900; tick++) {
      const result = stepSimulation(state, accumulators, 0.02);
      state = result.state; accumulators = result.accumulators;
      if (state.status === 'playing' && tick % 90 === 0) {
        const move = evaluateAiMove(state.territories);
        if (move) {
          const dispatch = dispatchArmy(state.territories[move.fromId], state.territories[move.toId], 'enemy', 0.5, () => `pvp_ai_${aiIndex++}`);
          expect(dispatch.success).toBe(true);
          state.territories[move.fromId] = dispatch.sourceTerritory!;
          state.armies.push(dispatch.army!);
          state.stats.enemyUnitsDispatched += dispatch.army!.units;
        }
      }
      lab.step();
      expect(lab.state).toEqual(state);
    }
  });
});
