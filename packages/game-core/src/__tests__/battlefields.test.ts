import { describe, expect, it } from 'vitest';
import {
  BATTLEFIELDS,
  createDefaultTerritories,
  createInitialGameState,
  getBattlefield,
  normalizeBattlefieldMode,
  normalizeBattlefieldId,
  simulatePvpBattle,
  validateAllBattlefields,
  validateBattlefieldDefinition,
  type BattlefieldDefinition,
} from '../index.js';

describe('data-driven battlefield architecture', () => {
  it('validates all production battlefields without error', () => {
    expect(() => validateAllBattlefields(BATTLEFIELDS)).not.toThrow();
  });

  it('declares every existing battlefield as 1v1', () => {
    expect(BATTLEFIELDS.map((battlefield) => battlefield.mode)).toEqual(['1v1', '1v1', '1v1']);
  });

  it('defaults legacy battlefield JSON without a mode to 1v1', () => {
    expect(normalizeBattlefieldMode(undefined)).toBe('1v1');
  });

  it('rejects unknown battlefield modes', () => {
    expect(() => normalizeBattlefieldMode('3v3')).toThrow(/Invalid battlefield mode/);
  });

  it('defines a unique, valid visual identity for every battlefield', () => {
    expect(new Set(BATTLEFIELDS.map((battlefield) => battlefield.visual.motif)).size).toBe(
      BATTLEFIELDS.length
    );
    expect(new Set(BATTLEFIELDS.map((battlefield) => battlefield.visual.field)).size).toBe(
      BATTLEFIELDS.length
    );
    for (const battlefield of BATTLEFIELDS) {
      expect(battlefield.visual.motif).toBe(battlefield.id);
      expect(battlefield.visual.motifColor).toBe(battlefield.accent);
    }
  });

  describe('validation rules', () => {
    const baseValid = BATTLEFIELDS[0];

    it('rejects duplicate territory IDs', () => {
      const invalid: BattlefieldDefinition = {
        ...baseValid,
        territories: [
          ...baseValid.territories,
          { ...baseValid.territories[0] },
        ],
      };
      expect(() => validateBattlefieldDefinition(invalid)).toThrow(/Duplicate territory ID/);
    });

    it('rejects road with nonexistent endpoint', () => {
      const invalid: BattlefieldDefinition = {
        ...baseValid,
        roads: [...baseValid.roads, ['p_base', 'non_existent_tower']],
      };
      expect(() => validateBattlefieldDefinition(invalid)).toThrow(/Road endpoint "non_existent_tower" does not exist/);
    });

    it('rejects self-roads', () => {
      const invalid: BattlefieldDefinition = {
        ...baseValid,
        roads: [...baseValid.roads, ['p_base', 'p_base']],
      };
      expect(() => validateBattlefieldDefinition(invalid)).toThrow(/Self-road/);
    });

    it('rejects duplicate undirected roads', () => {
      const invalid: BattlefieldDefinition = {
        ...baseValid,
        roads: [...baseValid.roads, ['n_bot_left', 'p_base']], // ['p_base', 'n_bot_left'] already exists
      };
      expect(() => validateBattlefieldDefinition(invalid)).toThrow(/Duplicate road/);
    });

    it('rejects missing or multiple player bases', () => {
      const noPlayerBase: BattlefieldDefinition = {
        ...baseValid,
        territories: baseValid.territories.filter((t) => t.owner !== 'player'),
      };
      expect(() => validateBattlefieldDefinition(noPlayerBase)).toThrow(/exactly one player base/);

      const twoPlayerBases: BattlefieldDefinition = {
        ...baseValid,
        territories: [
          ...baseValid.territories,
          { ...baseValid.territories[2], id: 'p_base_2', owner: 'player' },
        ],
      };
      expect(() => validateBattlefieldDefinition(twoPlayerBases)).toThrow(/exactly one player base/);
    });

    it('rejects missing or multiple enemy bases', () => {
      const noEnemyBase: BattlefieldDefinition = {
        ...baseValid,
        territories: baseValid.territories.filter((t) => t.owner !== 'enemy'),
      };
      expect(() => validateBattlefieldDefinition(noEnemyBase)).toThrow(/exactly one enemy base/);
    });

    it('rejects battlefields without neutral territories', () => {
      const noNeutrals: BattlefieldDefinition = {
        ...baseValid,
        territories: baseValid.territories.filter((t) => t.owner !== 'neutral'),
        roads: [['p_base', 'e_base']],
      };
      expect(() => validateBattlefieldDefinition(noNeutrals)).toThrow(/at least one neutral territory/);
    });

    it('rejects territories outside safe battlefield bounds', () => {
      const outOfBoundsX: BattlefieldDefinition = {
        ...baseValid,
        territories: baseValid.territories.map((t) =>
          t.id === 'n_mid_left' ? { ...t, x: 5 } : t
        ),
      };
      expect(() => validateBattlefieldDefinition(outOfBoundsX)).toThrow(/exceeds safe battlefield bounds/);

      const outOfBoundsY: BattlefieldDefinition = {
        ...baseValid,
        territories: baseValid.territories.map((t) =>
          t.id === 'e_base' ? { ...t, y: 40 } : t
        ),
      };
      expect(() => validateBattlefieldDefinition(outOfBoundsY)).toThrow(/exceeds safe battlefield bounds/);
    });

    it('rejects asymmetric layouts', () => {
      const asymmetricCoords: BattlefieldDefinition = {
        ...baseValid,
        territories: baseValid.territories.map((t) =>
          t.id === 'n_top_left' ? { ...t, x: 99 } : t
        ),
      };
      expect(() => validateBattlefieldDefinition(asymmetricCoords)).toThrow(/has no symmetric counterpart/);

      const asymmetricAttributes: BattlefieldDefinition = {
        ...baseValid,
        territories: baseValid.territories.map((t) =>
          t.id === 'n_top_left' ? { ...t, units: 99 } : t
        ),
      };
      expect(() => validateBattlefieldDefinition(asymmetricAttributes)).toThrow(/matching attributes/);
    });

    it('rejects structurally identical maps in validateAllBattlefields', () => {
      const duplicates: readonly BattlefieldDefinition[] = [
        baseValid,
        {
          ...baseValid,
          id: 'twin_passes',
          visual: { ...baseValid.visual, motif: 'twin_passes' },
        },
      ];
      expect(() => validateAllBattlefields(duplicates)).toThrow(/not structurally distinct/);
    });

    it('ensures returned runtime territories do not mutate source definitions', () => {
      const runtime = createDefaultTerritories(undefined, undefined, 'crown_cross');
      runtime.p_base.units = 999;
      runtime.p_base.productionRate = 888;
      runtime.n_center.units = 777;

      const def = getBattlefield('crown_cross');
      const defPBase = def.territories.find((t) => t.id === 'p_base')!;
      const defCenter = def.territories.find((t) => t.id === 'n_center')!;

      expect(defPBase.units).toBe(20);
      expect(defPBase.productionRate).toBe(1.2);
      expect(defCenter.units).toBe(14);
    });
  });

  describe('baseline preservation: crown_cross', () => {
    it('preserves baseline territory count, IDs, attributes, and roads', () => {
      const def = getBattlefield('crown_cross');
      expect(def.id).toBe('crown_cross');
      expect(def.territories).toHaveLength(9);
      expect(def.roads).toHaveLength(16);

      const terrMap = new Map(def.territories.map((t) => [t.id, t]));
      expect(terrMap.get('p_base')).toMatchObject({
        x: 200,
        y: 610,
        radius: 36,
        owner: 'player',
        tier: 3,
        type: 'fortress',
        units: 20,
        maxUnits: 65,
      });
      expect(terrMap.get('e_base')).toMatchObject({
        x: 200,
        y: 110,
        radius: 36,
        owner: 'enemy',
        tier: 3,
        type: 'fortress',
        units: 20,
        maxUnits: 65,
      });
      expect(terrMap.get('n_center')).toMatchObject({
        x: 200,
        y: 360,
        radius: 32,
        owner: 'neutral',
        tier: 2,
        type: 'fortress',
        units: 14,
        maxUnits: 55,
      });
      expect(terrMap.get('n_bot_left')).toMatchObject({
        x: 85,
        y: 485,
        type: 'barracks',
        units: 8,
      });
      expect(terrMap.get('n_bot_right')).toMatchObject({
        x: 315,
        y: 485,
        type: 'stable',
        units: 8,
      });
      expect(terrMap.get('n_top_left')).toMatchObject({
        x: 85,
        y: 235,
        type: 'stable',
        units: 8,
      });
      expect(terrMap.get('n_top_right')).toMatchObject({
        x: 315,
        y: 235,
        type: 'barracks',
        units: 8,
      });
    });
  });

  describe('truly distinct maps: twin_passes and royal_ring', () => {
    it('differs by territory count, territory IDs, and road graphs', () => {
      const cross = getBattlefield('crown_cross');
      const passes = getBattlefield('twin_passes');
      const ring = getBattlefield('royal_ring');

      // Territory counts are completely different
      expect(cross.territories).toHaveLength(9);
      expect(passes.territories).toHaveLength(8);
      expect(ring.territories).toHaveLength(10);

      // Road counts are different
      expect(cross.roads).toHaveLength(16);
      expect(passes.roads).toHaveLength(9);
      expect(ring.roads).toHaveLength(12);

      // Twin Passes has unique pass choke IDs and no center tower
      const passIds = passes.territories.map((t) => t.id);
      expect(passIds).toContain('n_west_pass');
      expect(passIds).toContain('n_east_pass');
      expect(passIds).not.toContain('n_center');
      expect(passIds).not.toContain('n_bot_left');

      // Royal Ring has unique perimeter bastion/outpost IDs and no center tower
      const ringIds = ring.territories.map((t) => t.id);
      expect(ringIds).toContain('n_ring_sw');
      expect(ringIds).toContain('n_ring_se');
      expect(ringIds).toContain('n_ring_nw');
      expect(ringIds).toContain('n_ring_ne');
      expect(ringIds).not.toContain('n_center');
      expect(ringIds).not.toContain('n_west_pass');
    });

    it('maintains competitive 2-fold symmetry for all three maps', () => {
      for (const def of BATTLEFIELDS) {
        expect(() => validateBattlefieldDefinition(def)).not.toThrow();
      }
    });
  });

  describe('compatibility & deterministic replay', () => {
    it('normalizes missing or invalid battlefield IDs to crown_cross', () => {
      expect(normalizeBattlefieldId(undefined)).toBe('crown_cross');
      expect(normalizeBattlefieldId('forged_map')).toBe('crown_cross');
      expect(normalizeBattlefieldId(null)).toBe('crown_cross');
      expect(normalizeBattlefieldId(123)).toBe('crown_cross');

      expect(getBattlefield('unknown_map').id).toBe('crown_cross');
      expect(createInitialGameState({ battlefieldId: 'crown_cross' }).battlefieldId).toBe('crown_cross');
    });

    it('replays deterministically on each selected battlefield', () => {
      const actionsByBattlefield = {
        crown_cross: [
          { sequence: 0, atSeconds: 0, sourceId: 'p_base', targetId: 'n_center' },
          { sequence: 1, atSeconds: 4, sourceId: 'p_base', targetId: 'n_bot_left' },
        ],
        twin_passes: [
          { sequence: 0, atSeconds: 0, sourceId: 'p_base', targetId: 'n_west_gate_s' },
          { sequence: 1, atSeconds: 4, sourceId: 'p_base', targetId: 'n_east_gate_s' },
        ],
        royal_ring: [
          { sequence: 0, atSeconds: 0, sourceId: 'p_base', targetId: 'n_ring_sw' },
          { sequence: 1, atSeconds: 4, sourceId: 'p_base', targetId: 'n_ring_se' },
        ],
      } as const;

      for (const { id } of BATTLEFIELDS) {
        const options = {
          actions: actionsByBattlefield[id],
          battlefieldId: id,
        };
        const first = simulatePvpBattle(options);
        const second = simulatePvpBattle(options);

        expect(first).toEqual(second);
        expect(first.finalState.battlefieldId).toBe(id);
      }
    });

    it('applies player and enemy upgrade modifiers correctly on all battlefields', () => {
      for (const { id } of BATTLEFIELDS) {
        const territories = createDefaultTerritories(
          { startingUnits: 35, productionRateMultiplier: 1.5, armySpeedMultiplier: 1.2 },
          { startingUnits: 28, productionRateMultiplier: 1.25, armySpeedMultiplier: 1.0 },
          id
        );
        expect(territories.p_base.units).toBe(35);
        expect(territories.p_base.productionRate).toBeCloseTo(1.2 * 1.5);
        expect(territories.e_base.units).toBe(28);
        expect(territories.e_base.productionRate).toBeCloseTo(1.2 * 1.25);
      }
    });

    it('asserts complete field parity across IDs, names, coordinates, radius, ownership, units, maxUnits, production, tier/type, and roads', () => {
      for (const def of BATTLEFIELDS) {
        const runtimeTerritories = createDefaultTerritories(undefined, undefined, def.id);

        expect(Object.keys(runtimeTerritories)).toHaveLength(def.territories.length);

        for (const template of def.territories) {
          const terr = runtimeTerritories[template.id];
          expect(terr).toBeDefined();
          expect(terr.id).toBe(template.id);
          expect(terr.name).toBe(template.name);
          expect(terr.x).toBe(template.x);
          expect(terr.y).toBe(template.y);
          expect(terr.radius).toBe(template.radius);
          expect(terr.owner).toBe(template.owner);
          const expectedUnits =
            template.id === 'p_base' || template.owner === 'player'
              ? 20
              : template.id === 'e_base' || template.owner === 'enemy'
              ? 20
              : template.units;
          expect(terr.units).toBe(expectedUnits);
          expect(terr.maxUnits).toBe(template.maxUnits);
          expect(terr.productionRate).toBeCloseTo(template.productionRate);
          expect(terr.tier).toBe(template.tier);
          expect(terr.type).toBe(template.type);
        }

        expect(def.roads).toHaveLength(def.roads.length);
        for (const [a, b] of def.roads) {
          expect(runtimeTerritories[a]).toBeDefined();
          expect(runtimeTerritories[b]).toBeDefined();
        }
      }
    });
  });
});
