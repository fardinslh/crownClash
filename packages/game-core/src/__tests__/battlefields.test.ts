import { describe, expect, it } from 'vitest';
import {
  BATTLEFIELDS,
  createDefaultTerritories,
  createInitial2v2Territories,
  createInitialGameState,
  createLocalBotMatchTicket,
  getBattlefield,
  normalizeBattlefieldMode,
  normalizeBattlefieldId,
  simulate2v2Battle,
  simulatePvpBattle,
  validateAllBattlefields,
  validateBattlefieldDefinition,
  type BattlefieldDefinition,
  type SlotModifiers,
  type TwoVTwoSpawnAssignment,
} from '../index.js';

const ONE_V_ONE_BATTLEFIELDS = BATTLEFIELDS.filter((b) => b.mode === '1v1');
const QUAD_CITADEL = getBattlefield('quad_citadel');

describe('data-driven battlefield architecture', () => {
  it('validates all production battlefields without error', () => {
    expect(() => validateAllBattlefields(BATTLEFIELDS)).not.toThrow();
  });

  it('ships exactly four battlefields: three 1v1 maps and the 2v2 quad_citadel', () => {
    expect(BATTLEFIELDS.map((battlefield) => battlefield.id)).toEqual([
      'crown_cross',
      'twin_passes',
      'royal_ring',
      'quad_citadel',
    ]);
    expect(BATTLEFIELDS.map((battlefield) => battlefield.mode)).toEqual(['1v1', '1v1', '1v1', '2v2']);
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

    it('maintains competitive 2-fold symmetry for all four maps', () => {
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

    it('replays deterministically on each 1v1 battlefield', () => {
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

      for (const id of ONE_V_ONE_BATTLEFIELDS.map((b) => b.id) as Array<'crown_cross' | 'twin_passes' | 'royal_ring'>) {
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

    it('applies player and enemy upgrade modifiers correctly on 1v1 battlefields', () => {
      for (const { id } of ONE_V_ONE_BATTLEFIELDS) {
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

describe('quad_citadel: the first dedicated 2v2 battlefield (§7.3)', () => {
  it('has exactly 13 territories and exactly 20 roads', () => {
    expect(QUAD_CITADEL.territories).toHaveLength(13);
    expect(QUAD_CITADEL.roads).toHaveLength(20);
  });

  it('keeps the deterministic territory order: frozen, complete, duplicate-free', () => {
    expect(QUAD_CITADEL.territories.map((t) => t.id)).toEqual([
      'a_base_w', 'a_base_e', 'b_base_w', 'b_base_e',
      'a_gate_w', 'a_gate_e', 'b_gate_w', 'b_gate_e',
      'n_corner_sw', 'n_corner_se', 'n_corner_nw', 'n_corner_ne',
      'n_center',
    ]);
    expect(new Set(QUAD_CITADEL.territories.map((t) => t.id)).size).toBe(13);
  });

  it('declares exactly four starting fortresses: two Team A, two Team B', () => {
    const byId = new Map(QUAD_CITADEL.territories.map((t) => [t.id, t]));
    const aSpawns = ['a_base_w', 'a_base_e'];
    const bSpawns = ['b_base_w', 'b_base_e'];
    for (const id of aSpawns) {
      expect(byId.get(id)).toMatchObject({ owner: 'player', tier: 3, type: 'fortress', units: 20, maxUnits: 65, productionRate: 1.2, radius: 36 });
    }
    for (const id of bSpawns) {
      expect(byId.get(id)).toMatchObject({ owner: 'enemy', tier: 3, type: 'fortress', units: 20, maxUnits: 65, productionRate: 1.2, radius: 36 });
    }
    expect(QUAD_CITADEL.territories.filter((t) => t.owner === 'player')).toHaveLength(2);
    expect(QUAD_CITADEL.territories.filter((t) => t.owner === 'enemy')).toHaveLength(2);
  });

  it('is an exact 180-degree mirror: involution, mirror attributes, self-mirrored center, closed roads', () => {
    const mirrorOf = (t: { x: number; y: number }) =>
      QUAD_CITADEL.territories.find((o) => Math.abs(o.x - (400 - t.x)) < 1e-4 && Math.abs(o.y - (720 - t.y)) < 1e-4);

    const mirror = new Map<string, string>();
    for (const territory of QUAD_CITADEL.territories) {
      const counterpart = mirrorOf(territory);
      expect(counterpart, `${territory.id} has no mirror`).toBeDefined();
      mirror.set(territory.id, counterpart!.id);
      expect(counterpart!.radius).toBe(territory.radius);
      expect(counterpart!.tier).toBe(territory.tier);
      expect(counterpart!.type).toBe(territory.type);
      expect(counterpart!.units).toBe(territory.units);
      expect(counterpart!.maxUnits).toBe(territory.maxUnits);
      expect(counterpart!.productionRate).toBe(territory.productionRate);
    }
    // Involution + exactly one self-mirror (the center).
    for (const [id, mirrored] of mirror) {
      expect(mirror.get(mirrored)).toBe(id);
    }
    expect([...mirror.entries()].filter(([, m]) => m === mirror.get(m)!)).toEqual([['n_center', 'n_center']]);
    // Team A / Team B spawn pairs map across teams.
    expect(mirror.get('a_base_w')).toBe('b_base_e');
    expect(mirror.get('a_base_e')).toBe('b_base_w');
    expect(mirror.get('n_center')).toBe('n_center');

    // Road closure: every edge's mirror edge exists and no edge maps to itself.
    const roadKeys = new Set(QUAD_CITADEL.roads.map(([a, b]) => [a, b].sort().join('<->')));
    expect(roadKeys.size).toBe(20);
    for (const [a, b] of QUAD_CITADEL.roads) {
      const mirrorKey = [mirror.get(a)!, mirror.get(b)!].sort().join('<->');
      expect(roadKeys.has(mirrorKey), `road ${a}-${b} mirror ${mirrorKey} missing`).toBe(true);
      expect(mirrorKey).not.toBe([a, b].sort().join('<->'));
    }

    // Degrees: center 4, every other territory 3.
    const degree: Record<string, number> = {};
    for (const territory of QUAD_CITADEL.territories) degree[territory.id] = 0;
    for (const [a, b] of QUAD_CITADEL.roads) {
      degree[a] += 1;
      degree[b] += 1;
    }
    for (const [id, count] of Object.entries(degree)) {
      expect(count, `degree of ${id}`).toBe(id === 'n_center' ? 4 : 3);
    }
  });

  it('keeps quad_citadel out of every 1v1 selection path', () => {
    // The local bot ticket must never pick the 2v2 map.
    for (let attempt = 0; attempt < 500; attempt++) {
      expect(createLocalBotMatchTicket().battlefieldId).not.toBe('quad_citadel');
    }
    // All three 1v1 ids remain individually resolvable, and the 2v2 map
    // resolves by explicit id only (2v2 ticket flow), never by default.
    expect(normalizeBattlefieldId('quad_citadel')).toBe('quad_citadel');
    expect(normalizeBattlefieldId(undefined)).toBe('crown_cross');
    expect(normalizeBattlefieldId('forged_map')).toBe('crown_cross');
  });

  it('creates definition-order verbatim 2v2 runtime territories', () => {
    const territories = createInitial2v2Territories('quad_citadel');
    expect(Object.keys(territories)).toEqual(QUAD_CITADEL.territories.map((t) => t.id));
    for (const template of QUAD_CITADEL.territories) {
      expect(territories[template.id]).toEqual({ ...template });
    }
    expect(() => createInitial2v2Territories('crown_cross')).toThrow(/battlefield_mode/);
  });

  it('replays the 2v2 sim deterministically on quad_citadel with all four slots', () => {
    const territories = createInitial2v2Territories('quad_citadel');
    const spawnAssignments: TwoVTwoSpawnAssignment[] = [
      { slot: 0, territoryId: 'a_base_w' },
      { slot: 1, territoryId: 'a_base_e' },
      { slot: 2, territoryId: 'b_base_e' },
      { slot: 3, territoryId: 'b_base_w' },
    ];
    const modifiersBySlot: SlotModifiers = {
      0: { startingUnits: 20, productionRateMultiplier: 1, armySpeedMultiplier: 1 },
      1: { startingUnits: 24, productionRateMultiplier: 1.1, armySpeedMultiplier: 1.2 },
      2: { startingUnits: 28, productionRateMultiplier: 1.2, armySpeedMultiplier: 1.4 },
      3: { startingUnits: 32, productionRateMultiplier: 1.3, armySpeedMultiplier: 1.6 },
    };
    const options = {
      territories,
      spawnAssignments,
      modifiersBySlot,
      timeLimitSeconds: 12,
      battlefieldId: 'quad_citadel' as const,
      actions: [
        { schemaVersion: 2 as const, tick: 0, serverSeq: 0, slot: 0 as const, clientSeq: 0, sourceId: 'a_base_w', targetId: 'n_center' },
        { schemaVersion: 2 as const, tick: 0, serverSeq: 1, slot: 1 as const, clientSeq: 0, sourceId: 'a_base_e', targetId: 'a_gate_e' },
        { schemaVersion: 2 as const, tick: 100, serverSeq: 2, slot: 2 as const, clientSeq: 0, sourceId: 'b_base_e', targetId: 'n_center' },
        { schemaVersion: 2 as const, tick: 150, serverSeq: 3, slot: 3 as const, clientSeq: 0, sourceId: 'b_base_w', targetId: 'b_gate_e' },
      ],
    };
    const first = simulate2v2Battle(options);
    const second = simulate2v2Battle(options);
    expect(first.stateHash).toBe(second.stateHash);
    expect(first.canonicalActions).toHaveLength(4);
    expect(first.finalState.battlefieldId).toBe('quad_citadel');
    expect(first.actionsProcessed).toBe(4);
  });

  describe('malformed 2v2 definitions fail closed', () => {
    const base = QUAD_CITADEL;

    it('rejects a broken mirrored coordinate', () => {
      const invalid: BattlefieldDefinition = {
        ...base,
        territories: base.territories.map((t) => (t.id === 'n_corner_sw' ? { ...t, x: 61 } : t)),
      };
      expect(() => validateBattlefieldDefinition(invalid)).toThrow(/has no symmetric counterpart/);
    });

    it('rejects a broken mirrored road', () => {
      // Replace the closed bottom corridor with its unclosed mirror.
      const invalid: BattlefieldDefinition = {
        ...base,
        roads: base.roads.map(([a, b]) => (a === 'n_corner_sw' && b === 'n_corner_se' ? ['n_corner_nw', 'n_center'] : [a, b])),
      };
      expect(() => validateBattlefieldDefinition(invalid)).toThrow(/no symmetric counterpart/);
    });

    it('rejects wrong Team A spawn counts', () => {
      const invalid: BattlefieldDefinition = {
        ...base,
        territories: base.territories.map((t) => (t.id === 'a_base_e' ? { ...t, owner: 'neutral' as const } : t)),
      };
      expect(() => validateBattlefieldDefinition(invalid)).toThrow(/exactly two Team A starting fortresses/);
    });

    it('rejects wrong Team B spawn counts', () => {
      const invalid: BattlefieldDefinition = {
        ...base,
        territories: base.territories.map((t) => (t.id === 'b_base_w' ? { ...t, owner: 'neutral' as const } : t)),
      };
      expect(() => validateBattlefieldDefinition(invalid)).toThrow(/exactly two Team B starting fortresses/);
    });

    it('rejects non-fortress 2v2 spawns', () => {
      const invalid: BattlefieldDefinition = {
        ...base,
        territories: base.territories.map((t) => (t.id === 'a_base_w' ? { ...t, tier: 2 as const } : t)),
      };
      expect(() => validateBattlefieldDefinition(invalid)).toThrow(/must be a tier-3 fortress/);
    });

    it('rejects a 1v1 spawn convention smuggled into a 2v2 map', () => {
      const invalid: BattlefieldDefinition = {
        ...base,
        territories: base.territories.map((t) => (t.id === 'a_base_w' ? { ...t, id: 'p_base' } : t)),
      };
      expect(() => validateBattlefieldDefinition(invalid)).toThrow(/exactly two Team A starting fortresses/);
    });

    it('rejects 2v2-style double spawns in a 1v1 map (cross-mode)', () => {
      const crownCross = getBattlefield('crown_cross');
      const secondBase = { ...crownCross.territories[0], id: 'p_base_2' };
      const invalid: BattlefieldDefinition = {
        ...crownCross,
        mode: '2v2',
        territories: [...crownCross.territories, secondBase],
      };
      expect(() => validateBattlefieldDefinition(invalid)).toThrow(/exactly two Team A starting fortresses/);
    });

    it('rejects mirror-invariant undirected roads (edges that map to themselves)', () => {
      // Replace the two team trunk roads with cross-team edges whose rotated
      // endpoint set equals their own (a_base_w—b_base_e and a_base_e—
      // b_base_w each rotate onto themselves); degree and road counts are
      // unchanged, so the ONLY failure reason is the self-mapping edge.
      const invalid: BattlefieldDefinition = {
        ...base,
        roads: base.roads.map(([a, b]) => {
          if (a === 'a_base_w' && b === 'a_base_e') return ['a_base_w', 'b_base_e'] as const;
          if (a === 'b_base_w' && b === 'b_base_e') return ['a_base_e', 'b_base_w'] as const;
          return [a, b] as const;
        }),
      };
      expect(invalid.roads).toHaveLength(20);
      expect(() => validateBattlefieldDefinition(invalid)).toThrow(/maps to itself under mirroring/);
    });

    it('rejects duplicate coordinates (exactly one rotational counterpart required)', () => {
      const ghost = { ...base.territories[12], id: 'n_center_ghost' };
      const invalid: BattlefieldDefinition = {
        ...base,
        territories: [...base.territories, ghost],
      };
      expect(() => validateBattlefieldDefinition(invalid)).toThrow(/exactly one symmetric counterpart/);
    });

    it('rejects duplicate territory IDs on the 2v2 map', () => {
      const invalid: BattlefieldDefinition = {
        ...base,
        territories: [...base.territories, { ...base.territories[0] }],
      };
      expect(() => validateBattlefieldDefinition(invalid)).toThrow(/Duplicate territory ID/);
    });
  });

  describe('the three 1v1 maps remain valid and unchanged', () => {
    it('pins territory and road counts for every 1v1 map', () => {
      expect(getBattlefield('crown_cross').territories).toHaveLength(9);
      expect(getBattlefield('crown_cross').roads).toHaveLength(16);
      expect(getBattlefield('twin_passes').territories).toHaveLength(8);
      expect(getBattlefield('twin_passes').roads).toHaveLength(9);
      expect(getBattlefield('royal_ring').territories).toHaveLength(10);
      expect(getBattlefield('royal_ring').roads).toHaveLength(12);
      for (const def of ONE_V_ONE_BATTLEFIELDS) {
        expect(def.mode).toBe('1v1');
        expect(() => validateBattlefieldDefinition(def)).not.toThrow();
        expect(def.territories.map((t) => t.id)).toContain('p_base');
        expect(def.territories.map((t) => t.id)).toContain('e_base');
      }
    });

    it('keeps the strict full-attribute mirror (now including radius and productionRate) green for 1v1', () => {
      for (const def of ONE_V_ONE_BATTLEFIELDS) {
        expect(() => validateBattlefieldDefinition(def)).not.toThrow();
      }
    });
  });
});
