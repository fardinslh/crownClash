import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getBattlefield, BATTLEFIELDS } from '@crown-clash/game-core';

describe('GameScene Battlefield Road Data Source', () => {
  it('obtains road connections dynamically from battlefield definitions for all battlefields', () => {
    for (const def of BATTLEFIELDS) {
      const battlefield = getBattlefield(def.id);
      expect(battlefield.roads).toBeDefined();
      expect(battlefield.roads.length).toBeGreaterThan(0);

      const terrIds = new Set(battlefield.territories.map((t) => t.id));
      for (const [idA, idB] of battlefield.roads) {
        expect(terrIds.has(idA)).toBe(true);
        expect(terrIds.has(idB)).toBe(true);
      }
    }

    expect(getBattlefield('crown_cross').roads).toHaveLength(16);
    expect(getBattlefield('twin_passes').roads).toHaveLength(9);
    expect(getBattlefield('royal_ring').roads).toHaveLength(12);
  });

  it('proves GameScene.ts contains no local hardcoded road connections array and reads from battlefield data', () => {
    const gameScenePath = path.resolve(__dirname, '../GameScene.ts');
    const source = fs.readFileSync(gameScenePath, 'utf8');

    // Asserts GameScene obtains roads via getBattlefield
    expect(source).toMatch(/getBattlefield\s*\(\s*this\.battlefieldId\s*\)/);
    expect(source).toMatch(/const\s+connections\s*=\s*battlefield\.roads/);

    // Asserts no hardcoded road tuple literals exist in GameScene
    expect(source).not.toContain("['p_base', 'n_bot_left']");
    expect(source).not.toContain("['p_base', 'n_center']");
    expect(source).not.toContain("['n_mid_left', 'n_center']");
    expect(source).not.toContain("['n_west_gate_s', 'n_west_pass']");
    expect(source).not.toContain("['n_ring_sw', 'n_ring_w_s']");
  });
});
