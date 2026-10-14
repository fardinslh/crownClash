import { describe, expect, it } from 'vitest';
import { BOT_DIFFICULTIES, createInitialGameState, getBotAiTickSeconds, simulatePvpBattle } from '../index.js';

describe('ticket-pinned bot difficulty', () => {
  it('keeps normal replays identical to existing v1/v2/v3 behavior', () => {
    for (const gameplayRulesVersion of [1, 2, 3] as const) {
      const options = { gameplayRulesVersion, actions: [] };
      expect(simulatePvpBattle({ ...options, botDifficulty: 'normal' })).toEqual(simulatePvpBattle(options));
    }
  });
  it('changes reaction time, without changing opening units or production', () => {
    const initial = createInitialGameState({ gameplayRulesVersion: 3 });
    expect(BOT_DIFFICULTIES.map(d => getBotAiTickSeconds(d))).toEqual([3.6, 1.8, .9]);
    const outcomes = BOT_DIFFICULTIES.map(botDifficulty => simulatePvpBattle({ gameplayRulesVersion: 3, botDifficulty, actions: [] }));
    expect(new Set(outcomes.map(o => JSON.stringify(o.finalState))).size).toBe(3);
    expect(initial.territories.e_base.units).toBe(28);
    expect(initial.territories.n_top_right.units).toBe(14);
    for (const result of outcomes) expect(result.summary.status).toBe('defeat');
  });
  it('rejects a fabricated difficulty instead of silently replaying normal', () => {
    expect(() => simulatePvpBattle({ botDifficulty: 'impossible' as 'hard', actions: [] })).toThrow('invalid_bot_difficulty');
  });
});
