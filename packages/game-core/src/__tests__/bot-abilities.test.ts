import { describe, expect, it } from 'vitest';
import {
  ABILITY_CONFIG, BOT_COMMANDER, chooseBotAbility, createInitialGameState, dispatchArmy, simulatePvpBattle, tacticalNeighbors,
  type BotDifficulty, type GameState,
} from '../index.js';

const v4 = (): GameState => ({
  ...createInitialGameState({ gameplayRulesVersion: 4 }),
  elapsedTimeSeconds: ABILITY_CONFIG.unlockSeconds,
});

/**
 * A tower the bot owns right next to the player's base, with a real player
 * army (legal road, `units` strong) already `progress` of the way to it.
 */
function threatened(units: number, progress: number): { state: GameState; towerId: string } {
  const state = v4();
  const towerId = tacticalNeighbors(state, 'p_base')[0];
  const tower = { ...state.territories[towerId], owner: 'enemy' as const, units: 10 };
  const territories = { ...state.territories, [towerId]: tower };
  const dispatched = dispatchArmy(territories.p_base, tower, 'player', .5, () => 'raid', 1, { ...state, territories });
  const army = { ...dispatched.army!, units, progress };
  return { state: { ...state, territories, armies: [army] }, towerId };
}

const moves = [{ fromId: 'e_base', toId: 'n_bot_right' }, { fromId: 'e_base', toId: 'n_center' }];

describe('bot commander ability choice', () => {
  it('only exists for normal and hard difficulties', () => {
    expect(BOT_COMMANDER.easy).toBeUndefined();
    expect(BOT_COMMANDER.normal).toBeDefined();
    expect(BOT_COMMANDER.hard).toBeDefined();
  });

  it('never fires without a commander, before unlock, on v3, or twice', () => {
    expect(chooseBotAbility(v4(), 'enemy', undefined, moves)).toBeNull();
    expect(chooseBotAbility({ ...v4(), elapsedTimeSeconds: ABILITY_CONFIG.unlockSeconds - 0.02 }, 'enemy', 'vanguard', moves)).toBeNull();
    expect(chooseBotAbility({ ...v4(), gameplayRulesVersion: 3 }, 'enemy', 'vanguard', moves)).toBeNull();
    expect(chooseBotAbility({ ...v4(), enemyAbilityUsed: true }, 'enemy', 'vanguard', moves)).toBeNull();
  });

  it('vanguard turns the first planned attack into the charge', () => {
    const choice = chooseBotAbility(v4(), 'enemy', 'vanguard', moves)!;
    expect(choice).toMatchObject({ sourceId: 'e_base', targetId: 'n_bot_right' });
    expect(choice.moves).toEqual([moves[1]]);
    expect(chooseBotAbility(v4(), 'enemy', 'vanguard', [])).toBeNull();
  });

  it('quartermaster feeds the first attack when nothing is under threat', () => {
    expect(chooseBotAbility(v4(), 'enemy', 'quartermaster', moves)).toMatchObject({ sourceId: 'e_base', targetId: 'e_base', moves });
    expect(chooseBotAbility(v4(), 'enemy', 'quartermaster', [])).toBeNull();
  });

  it('crown guard waits for a real threat that the shield can save', () => {
    expect(chooseBotAbility(v4(), 'enemy', 'crown_guard', moves)).toBeNull();

    // 10 defenders, 12 attackers: lethal unshielded, repelled with the 2x shield.
    const close = threatened(12, 0.9);
    expect(chooseBotAbility(close.state, 'enemy', 'crown_guard', [])).toMatchObject({ sourceId: close.towerId, targetId: close.towerId });

    // Too strong for the shield to matter: keep the ability for later.
    const overwhelming = threatened(60, 0.9);
    expect(chooseBotAbility(overwhelming.state, 'enemy', 'crown_guard', [])).toBeNull();

    // Still too far away for an 8 s shield to cover the fight.
    const far = threatened(12, 0);
    far.state.armies[0] = { ...far.state.armies[0], speed: far.state.armies[0].speed / 20 };
    expect(chooseBotAbility(far.state, 'enemy', 'crown_guard', [])).toBeNull();
  });

  it('quartermaster rescues a threatened tower in preference to feeding an attack', () => {
    // +5 defenders turn a 10 vs 14 loss into a hold.
    const close = threatened(14, 0.5);
    expect(chooseBotAbility(close.state, 'enemy', 'quartermaster', moves)).toMatchObject({ sourceId: close.towerId, targetId: close.towerId });
    // Beyond saving: fall back to feeding the first attack.
    const doomed = threatened(60, 0.5);
    expect(chooseBotAbility(doomed.state, 'enemy', 'quartermaster', moves)).toMatchObject({ sourceId: 'e_base', targetId: 'e_base' });
  });
});

describe('bot ability in the authoritative replay', () => {
  const used = (botDifficulty: BotDifficulty) => {
    const result = simulatePvpBattle({ gameplayRulesVersion: 4, botDifficulty, actions: [] });
    return result.finalState?.enemyAbilityUsed === true;
  };

  it('is replayed deterministically', () => {
    const a = simulatePvpBattle({ gameplayRulesVersion: 4, botDifficulty: 'hard', actions: [] });
    const b = simulatePvpBattle({ gameplayRulesVersion: 4, botDifficulty: 'hard', actions: [] });
    expect(a.summary).toEqual(b.summary);
  });

  it('is never used on easy or on v3', () => {
    expect(used('easy')).toBe(false);
    const v3 = simulatePvpBattle({ gameplayRulesVersion: 3, botDifficulty: 'hard', actions: [] });
    expect(v3.finalState?.enemyAbilityUsed).not.toBe(true);
  });

  it('hard bot spends its charge once it has a plan', () => {
    expect(used('hard')).toBe(true);
  });
});
