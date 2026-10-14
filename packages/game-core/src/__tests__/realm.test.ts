import { describe, expect, it } from 'vitest';
import { realmModifiers } from '../realm.js';
describe('realm power policy', () => {
  it('caps public power per track and preserves commander sidegrades', () => {
    const result = realmModifiers([20,20,20],[0,3,8],'vanguard','bounded');
    expect(result.levels).toEqual([2,5,10]); expect(result.modifiers.startingUnits).toBe(19);
    expect(result.modifiers.armySpeedMultiplier).toBe(1.322);
  });
  it('gives equal base power independently of purchased upgrades', () => {
    for (const commander of ['crown_guard','quartermaster','vanguard'] as const) {
      expect(realmModifiers([20,20,20],[0,0,0],commander,'equal')).toEqual(realmModifiers([0,0,0],[20,20,20],commander,'equal'));
    }
  });
  it('normalizes hostile values and always returns three tracks', () => {
    const result = realmModifiers([NaN, Infinity, -8, 99], [], 'crown_guard', 'bounded');
    expect(result.levels).toEqual([0,0,0]); expect(result.modifiers).toEqual({startingUnits:20,productionRateMultiplier:1,armySpeedMultiplier:1});
  });
});
