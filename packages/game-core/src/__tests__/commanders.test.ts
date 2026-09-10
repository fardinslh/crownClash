import { describe, expect, it } from 'vitest';
import {
  createDefaultCareer,
  getPlayerUpgradeModifiers,
  isCommanderUnlocked,
  normalizeCommanderId,
} from '../index.js';

describe('commanders', () => {
  it('defaults unknown commander values to Crown Guard', () => {
    expect(normalizeCommanderId('forged')).toBe('crown_guard');
    expect(createDefaultCareer('p1').selectedCommanderId).toBe('crown_guard');
  });

  it('unlocks sidegrades at kingdom power milestones', () => {
    expect(isCommanderUnlocked('quartermaster', 9)).toBe(false);
    expect(isCommanderUnlocked('quartermaster', 10)).toBe(true);
    expect(isCommanderUnlocked('vanguard', 24)).toBe(false);
    expect(isCommanderUnlocked('vanguard', 25)).toBe(true);
  });

  it('applies deterministic Quartermaster tradeoffs after upgrades', () => {
    const career = {
      ...createDefaultCareer('p2'),
      productionLevel: 5,
      armySpeedLevel: 5,
      selectedCommanderId: 'quartermaster' as const,
    };
    expect(getPlayerUpgradeModifiers(career)).toEqual({
      startingUnits: 20,
      productionRateMultiplier: 1.61,
      armySpeedMultiplier: 1.17,
    });
  });

  it('applies deterministic Vanguard tradeoffs', () => {
    const career = { ...createDefaultCareer('p3'), selectedCommanderId: 'vanguard' as const };
    expect(getPlayerUpgradeModifiers(career)).toEqual({
      startingUnits: 17,
      productionRateMultiplier: 1,
      armySpeedMultiplier: 1.15,
    });
  });
});
