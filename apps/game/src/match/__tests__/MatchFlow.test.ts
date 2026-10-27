import { describe, expect, it } from 'vitest';
import { INTRO_GO_MS, INTRO_STEP_MS, isIntroHolding, matchIntroSchedule, shouldPlayMatchIntro } from '../MatchIntro.js';
import { resolveLocalEndCause } from '../EndBeat.js';

describe('match intro', () => {
  it('counts 3-2-1, says GO, then finishes, in time order', () => {
    const steps = matchIntroSchedule();
    expect(steps.map((s) => s.phase)).toEqual([3, 2, 1, 'go', 'done']);
    expect(steps.map((s) => s.atMs)).toEqual([0, INTRO_STEP_MS, INTRO_STEP_MS * 2, INTRO_STEP_MS * 3, INTRO_STEP_MS * 3 + INTRO_GO_MS]);
  });

  it('holds the battle only during the numbers; GO already plays', () => {
    expect([3, 2, 1].every((p) => isIntroHolding(p as 3 | 2 | 1))).toBe(true);
    expect(isIntroHolding('go')).toBe(false);
    expect(isIntroHolding('done')).toBe(false);
  });

  it('plays for fresh bot battles only', () => {
    const fresh = { liveMode: false, trainingMode: false, stressMode: false, elapsedSeconds: 0 };
    expect(shouldPlayMatchIntro(fresh)).toBe(true);
    expect(shouldPlayMatchIntro({ ...fresh, liveMode: true })).toBe(false);
    expect(shouldPlayMatchIntro({ ...fresh, trainingMode: true })).toBe(false);
    expect(shouldPlayMatchIntro({ ...fresh, stressMode: true })).toBe(false);
    expect(shouldPlayMatchIntro({ ...fresh, elapsedSeconds: 12 })).toBe(false);
  });
});

describe('end beat cause', () => {
  it('reports the time limit or an elimination without naming a winner', () => {
    expect(resolveLocalEndCause({ elapsedSeconds: 90, timeLimitSeconds: 90 })).toBe('time_up');
    expect(resolveLocalEndCause({ elapsedSeconds: 41.5, timeLimitSeconds: 90 })).toBe('eliminated');
  });
});
