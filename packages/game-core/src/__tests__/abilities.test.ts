import { describe, expect, it } from 'vitest';
import {
  ABILITY_CONFIG, applyPlayerAbility, createInitialGameState, isShielded, resolveArrival, simulatePvpBattle,
  stepSimulation, type GameState, type PvpAction,
} from '../index.js';

const v4 = (): GameState => ({ ...createInitialGameState({ gameplayRulesVersion: 4 }), elapsedTimeSeconds: ABILITY_CONFIG.unlockSeconds });

describe('v4 commander abilities', () => {
  it('royal shield doubles the tower defence until it expires', () => {
    const shielded = applyPlayerAbility(v4(), 'crown_guard', 'p_base', 'p_base', 1, 'a')!;
    expect(shielded.state.playerAbilityUsed).toBe(true);
    expect(isShielded(shielded.state, 'p_base')).toBe(true);
    const base = shielded.state.territories.p_base;
    const plain = resolveArrival(base, base.units * 1.5, 'enemy');
    const boosted = resolveArrival(base, base.units * 1.5, 'enemy', ABILITY_CONFIG.shieldDefenseMultiplier);
    expect(plain.captured).toBe(true);
    expect(boosted.captured).toBe(false);
    let state = shielded.state;
    let accumulators = {};
    for (let i = 0; i < ABILITY_CONFIG.shieldDurationMs / 20 + 1; i++) {
      const step = stepSimulation(state, accumulators, 0.02); state = step.state; accumulators = step.accumulators;
    }
    expect(isShielded(state, 'p_base')).toBe(false);
  });

  it('supply drop adds units once', () => {
    const start = v4();
    const result = applyPlayerAbility(start, 'quartermaster', 'p_base', 'p_base', 1, 'a')!;
    expect(result.state.territories.p_base.units).toBe(start.territories.p_base.units + ABILITY_CONFIG.supplyUnits);
    expect(applyPlayerAbility(result.state, 'quartermaster', 'p_base', 'p_base', 1, 'b')).toBeNull();
  });

  it('vanguard charge sends the whole garrison down a legal road', () => {
    const start = v4();
    const result = applyPlayerAbility(start, 'vanguard', 'p_base', 'n_bot_left', 1, 'charge')!;
    expect(result.army?.units).toBe(start.territories.p_base.units);
    expect(result.state.territories.p_base.units).toBe(0);
    expect(applyPlayerAbility(v4(), 'vanguard', 'p_base', 'e_base', 1, 'x')).toBeNull();
  });

  it('is unavailable before unlock, on v3, on enemy towers and without a commander', () => {
    const early = { ...v4(), elapsedTimeSeconds: ABILITY_CONFIG.unlockSeconds - 0.02 };
    expect(applyPlayerAbility(early, 'quartermaster', 'p_base', 'p_base', 1, 'a')).toBeNull();
    expect(applyPlayerAbility({ ...v4(), gameplayRulesVersion: 3 }, 'quartermaster', 'p_base', 'p_base', 1, 'a')).toBeNull();
    expect(applyPlayerAbility(v4(), 'quartermaster', 'e_base', 'e_base', 1, 'a')).toBeNull();
    expect(applyPlayerAbility(v4(), undefined, 'p_base', 'p_base', 1, 'a')).toBeNull();
  });

  it('replays ability actions once and ignores them without the ticket commander', () => {
    const actions: PvpAction[] = [
      { sequence: 0, atSeconds: 16, sourceId: 'p_base', targetId: 'p_base', kind: 'ability' },
      { sequence: 1, atSeconds: 17, sourceId: 'p_base', targetId: 'p_base', kind: 'ability' },
    ];
    const withCommander = simulatePvpBattle({ gameplayRulesVersion: 4, actions, commanderId: 'quartermaster' });
    const without = simulatePvpBattle({ gameplayRulesVersion: 4, actions });
    expect(withCommander.summary.actionsProcessed).toBe(1);
    expect(without.summary.actionsProcessed).toBe(0);
    expect(() => simulatePvpBattle({ gameplayRulesVersion: 4, actions: [{ ...actions[0], kind: 'bogus' as 'ability' }] }))
      .toThrow('invalid_action_kind');
  });

  it('keeps shield and ability flags through JSON resume', () => {
    const shielded = applyPlayerAbility(v4(), 'crown_guard', 'p_base', 'p_base', 1, 'a')!.state;
    const resumed = JSON.parse(JSON.stringify(shielded)) as GameState;
    expect(resumed.playerAbilityUsed).toBe(true);
    expect(isShielded(resumed, 'p_base')).toBe(true);
  });
});
