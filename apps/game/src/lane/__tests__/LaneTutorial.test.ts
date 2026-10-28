import { describe, expect, it } from 'vitest';
import { cutLane, createInitialGameState, emptyLaneState, openLane } from '@crown-clash/game-core';
import { LANE_TUTORIAL_CONQUER_SECONDS, LANE_TUTORIAL_DONE_KEY, LaneTutorial, laneTutorialDone, markLaneTutorialDone } from '../LaneTutorial.js';

const fresh = () => createInitialGameState({ gameplayRulesVersion: 3, battlefieldId: 'crown_cross' });

describe('LaneTutorial', () => {
  it('starts on the drag step with a hand from a tower the player holds to a legal target', () => {
    const state = fresh();
    const view = new LaneTutorial().update(state, emptyLaneState(), 0);
    expect(view?.step).toBe('drag');
    expect(view?.hand).not.toBeNull();
    const from = Object.values(state.territories).find((t) => t.x === view!.hand!.from.x && t.y === view!.hand!.from.y);
    expect(from?.owner).toBe('player');
  });

  it('moves to cut once a lane is open, then to conquer once it is cut, then finishes', () => {
    const state = fresh();
    state.territories.p_base.units = 30;
    const tutorial = new LaneTutorial();
    let lanes = emptyLaneState();
    expect(tutorial.update(state, lanes, 1)?.step).toBe('drag');
    lanes = openLane(state, lanes, 'player', 'p_base', 'n_bot_left');
    const cutView = tutorial.update(state, lanes, 2);
    expect(cutView?.step).toBe('cut');
    expect(cutView?.hand).not.toBeNull();
    lanes = cutLane(lanes, 'player', 'p_base', 'n_bot_left');
    const conquer = tutorial.update(state, lanes, 3);
    expect(conquer?.step).toBe('conquer');
    expect(conquer?.hand).toBeNull();
    expect(tutorial.update(state, lanes, 3 + LANE_TUTORIAL_CONQUER_SECONDS - 0.1)?.step).toBe('conquer');
    expect(tutorial.update(state, lanes, 3 + LANE_TUTORIAL_CONQUER_SECONDS)).toBeNull();
    expect(tutorial.finished).toBe(true);
    expect(tutorial.update(state, lanes, 100)).toBeNull();
  });

  it('does not skip the cut step when the lane vanishes before it was ever seen', () => {
    const state = fresh();
    const tutorial = new LaneTutorial();
    expect(tutorial.update(state, emptyLaneState(), 5)?.step).toBe('drag');
    expect(tutorial.update(state, emptyLaneState(), 9)?.step).toBe('drag');
  });

  it('remembers completion in storage and survives a broken storage', () => {
    const data = new Map<string, string>();
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    expect(laneTutorialDone(store)).toBe(false);
    markLaneTutorialDone(store);
    expect(data.get(LANE_TUTORIAL_DONE_KEY)).toBe('1');
    expect(laneTutorialDone(store)).toBe(true);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(laneTutorialDone(broken)).toBe(false);
    expect(() => markLaneTutorialDone(broken)).not.toThrow();
  });
});
