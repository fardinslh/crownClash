import { describe, expect, it } from 'vitest';
import { BATTLEFIELDS } from '@crown-clash/game-core';
import { AMBIENCE_BY_BATTLEFIELD, ambienceBudget, brookCenterX, planAmbience } from '../arenaAmbience.js';
import { isArenaDressingExcluded } from '../BattlefieldArt.js';

describe('arena ambience', () => {
  it('spends nothing on the low tier or under reduced motion', () => {
    expect(ambienceBudget('low', false)).toBe(0);
    expect(ambienceBudget('high', true)).toBe(0);
    expect(ambienceBudget('mid', false)).toBeGreaterThan(0);
    expect(ambienceBudget('mid', false)).toBeLessThan(ambienceBudget('high', false));
    for (const battlefield of BATTLEFIELDS) expect(planAmbience(battlefield.id, 0)).toEqual([]);
  });

  it('keeps every biome within the low-end mote budget and plans deterministically', () => {
    for (const battlefield of BATTLEFIELDS) {
      const full = planAmbience(battlefield.id, 1);
      const mid = planAmbience(battlefield.id, ambienceBudget('mid', false));
      expect(full.length, `${battlefield.id} has no ambient life`).toBeGreaterThan(0);
      expect(full.length).toBeLessThanOrEqual(14);
      expect(mid.length).toBeLessThanOrEqual(8);
      expect(mid.length).toBeLessThan(full.length);
      expect(planAmbience(battlefield.id, 1)).toEqual(full);
      for (const mote of full) {
        expect(mote.x).toBeGreaterThanOrEqual(0);
        expect(mote.x).toBeLessThanOrEqual(400);
        expect(mote.y).toBeGreaterThanOrEqual(100);
        expect(mote.y).toBeLessThanOrEqual(700);
      }
    }
    expect(Object.keys(AMBIENCE_BY_BATTLEFIELD).sort()).toEqual(BATTLEFIELDS.map((b) => b.id).sort());
  });

  it('sparkles only on the Twin Passes brook, inside its reserved water zone', () => {
    for (const battlefield of BATTLEFIELDS) {
      const glints = planAmbience(battlefield.id, 1).filter((mote) => mote.kind === 'glint');
      if (battlefield.id !== 'twin_passes') {
        expect(glints).toEqual([]);
        continue;
      }
      expect(glints.length).toBeGreaterThan(0);
      for (const glint of glints) {
        expect(Math.abs(glint.x - brookCenterX(glint.y))).toBeLessThanOrEqual(8);
        expect(isArenaDressingExcluded('twin_passes', glint.x, glint.y), 'glint left the brook zone').toBe(true);
      }
    }
  });
});
