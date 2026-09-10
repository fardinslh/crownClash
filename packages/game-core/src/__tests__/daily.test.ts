import { describe, expect, it } from 'vitest';
import {
  advanceDailyState,
  claimDailyRewardLocally,
  createDailyState,
  formatDailyReset,
  normalizeDailyState,
} from '../daily.js';
import { createDefaultCareer } from '../progression.js';

describe('daily reset display', () => {
  it('formats the remaining server window and clamps expired windows', () => {
    const now = 1_700_000_000_000;
    expect(formatDailyReset(now + 3_661_000, now)).toBe('01:01:01');
    expect(formatDailyReset(now - 1, now)).toBe('00:00:00');
  });

  it('rounds partial seconds up so the countdown does not show zero early', () => {
    expect(formatDailyReset(1_501, 1_000)).toBe('00:00:01');
  });

  it('advances and caps all mission progress from local match settlements', () => {
    const now = Date.UTC(2026, 8, 9, 10);
    const stats = {
      matchDurationSeconds: 40,
      playerUnitsDispatched: 20,
      enemyUnitsDispatched: 10,
      territoriesCapturedByPlayer: 6,
      territoriesCapturedByEnemy: 1,
    };
    let state = advanceDailyState(createDailyState(now), 'victory', stats, now);
    state = advanceDailyState(state, 'victory', stats, now + 1_000);
    state = advanceDailyState(state, 'defeat', stats, now + 2_000);

    expect(state.missions.map((mission) => mission.progress)).toEqual([2, 1, 10]);
    expect(state.missions.every((mission) => mission.complete)).toBe(true);
  });

  it('claims each reward once and unlocks the chest after all mission claims', () => {
    const now = Date.UTC(2026, 8, 9, 10);
    const complete = advanceDailyState(
      advanceDailyState(
        createDailyState(now),
        'victory',
        {
          matchDurationSeconds: 40,
          playerUnitsDispatched: 20,
          enemyUnitsDispatched: 10,
          territoriesCapturedByPlayer: 10,
          territoriesCapturedByEnemy: 1,
        },
        now
      ),
      'defeat',
      {
        matchDurationSeconds: 40,
        playerUnitsDispatched: 20,
        enemyUnitsDispatched: 10,
        territoriesCapturedByPlayer: 0,
        territoriesCapturedByEnemy: 1,
      },
      now + 1_000
    );
    let career = createDefaultCareer('local_player');
    let state = complete;
    for (const type of ['play_matches', 'win_match', 'capture_territories'] as const) {
      const result = claimDailyRewardLocally(state, career, type, `claim_${type}`, now + 2_000);
      expect(result.success).toBe(true);
      state = result.state;
      career = result.newCareer;
    }
    expect(state.chest.unlocked).toBe(true);

    const chest = claimDailyRewardLocally(state, career, 'crown_chest', 'claim_chest', now + 3_000);
    expect(chest.success).toBe(true);
    expect(chest.reward).toBe(75);
    expect(chest.newCareer.coins).toBe(295);
    expect(chest.state.chest.claimed).toBe(true);

    const duplicate = claimDailyRewardLocally(
      chest.state,
      chest.newCareer,
      'crown_chest',
      'claim_chest_again',
      now + 4_000
    );
    expect(duplicate).toMatchObject({ success: false, reason: 'already_claimed', reward: 0 });
    expect(duplicate.newCareer.coins).toBe(295);
  });

  it('resets persisted local progress when Tehran day changes', () => {
    const now = Date.UTC(2026, 8, 9, 10);
    const state = createDailyState(now);
    const next = normalizeDailyState(
      { ...state, missions: state.missions.map((mission) => ({ ...mission, progress: mission.target })) },
      state.resetsAt + 1
    );
    expect(next.dayKey).not.toBe(state.dayKey);
    expect(next.missions.every((mission) => mission.progress === 0)).toBe(true);
  });
});
