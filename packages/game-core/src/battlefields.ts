import type { MatchMode, Team, TerritoryType } from './types.js';

export type BattlefieldId = 'crown_cross' | 'twin_passes' | 'royal_ring' | 'quad_citadel';

export type RoadConnection = readonly [string, string];

export type BattlefieldMotif = 'crown_cross' | 'twin_passes' | 'royal_ring' | 'quad_citadel';

export interface BattlefieldVisualTheme {
  readonly motif: BattlefieldMotif;
  readonly field: number;
  readonly grid: number;
  readonly road: number;
  readonly roadInlay: number;
  readonly socket: number;
  readonly motifColor: number;
}

export interface BattlefieldTerritoryTemplate {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly owner: Team;
  readonly units: number;
  readonly maxUnits: number;
  readonly productionRate: number;
  readonly tier: 1 | 2 | 3;
  readonly type: TerritoryType;
}

export interface BattlefieldDefinition {
  readonly id: BattlefieldId;
  readonly mode: MatchMode;
  readonly name: string;
  readonly subtitle: string;
  readonly accent: number;
  readonly visual: BattlefieldVisualTheme;
  readonly territories: readonly BattlefieldTerritoryTemplate[];
  readonly roads: readonly RoadConnection[];
}

export interface BotMatchTicket {
  readonly matchId: string;
  readonly battlefieldId: BattlefieldId;
}

import rawBattlefields from '../../../apps/server-nakama/battlefields.json' with { type: 'json' };

export const DEFAULT_BATTLEFIELD_ID: BattlefieldId = 'crown_cross';
export const DEFAULT_MATCH_MODE: MatchMode = '1v1';

export function normalizeBattlefieldMode(value: unknown): MatchMode {
  if (value === undefined) return DEFAULT_MATCH_MODE;
  if (value === '1v1' || value === '2v2') return value;
  throw new Error(`Invalid battlefield mode: ${String(value)}`);
}

export const BATTLEFIELDS: readonly BattlefieldDefinition[] = Object.freeze(
  (rawBattlefields as unknown as readonly (Omit<BattlefieldDefinition, 'mode'> & { readonly mode?: unknown })[]).map((b) =>
    Object.freeze({
      ...b,
      mode: normalizeBattlefieldMode(b.mode),
      visual: Object.freeze({ ...b.visual }),
      territories: Object.freeze(b.territories.map((t) => Object.freeze({ ...t }))),
      roads: Object.freeze(b.roads.map((r) => Object.freeze([r[0], r[1]]) as unknown as RoadConnection)),
    })
  )
);

export function normalizeBattlefieldId(value: unknown): BattlefieldId {
  return BATTLEFIELDS.some((battlefield) => battlefield.id === value)
    ? (value as BattlefieldId)
    : DEFAULT_BATTLEFIELD_ID;
}

export function getBattlefield(value: unknown): BattlefieldDefinition {
  const id = normalizeBattlefieldId(value);
  return BATTLEFIELDS.find((battlefield) => battlefield.id === id) ?? BATTLEFIELDS[0];
}

export function createLocalBotMatchTicket(now = Date.now()): BotMatchTicket {
  // 1v1 selection only: 2v2 battlefields (mode "2v2") can never be picked by
  // the ordinary 1v1 bot-match flow (docs/2v2-architecture.md §3.2.2).
  const oneVOneBattlefields = BATTLEFIELDS.filter((battlefield) => battlefield.mode === '1v1');
  const index = Math.floor(Math.random() * oneVOneBattlefields.length);
  return {
    matchId: `local_${now}_${Math.random().toString(36).slice(2, 10)}`,
    battlefieldId: oneVOneBattlefields[index]?.id ?? DEFAULT_BATTLEFIELD_ID,
  };
}

/**
 * Validates the topological and competitive structural correctness of a battlefield definition.
 * Mode-aware (docs/2v2-architecture.md §7.2): 1v1 maps mandate exactly one
 * player and one enemy HQ; 2v2 maps mandate exactly two Team A and two Team B
 * starting fortresses. Both modes share the same symmetry, road, and bounds
 * invariants. Throws a descriptive Error if any invariant fails.
 */
export function validateBattlefieldDefinition(definition: BattlefieldDefinition): void {
  const mode = normalizeBattlefieldMode(definition.mode);
  if (definition.visual.motif !== definition.id) {
    throw new Error(`Battlefield "${definition.id}" must use matching visual motif`);
  }
  for (const [key, color] of Object.entries(definition.visual).filter(([key]) => key !== 'motif')) {
    if (!Number.isInteger(color) || (color as number) < 0 || (color as number) > 0xffffff) {
      throw new Error(`Battlefield "${definition.id}" has invalid visual color "${key}"`);
    }
  }

  // 1. unique territory IDs
  const terrMap = new Map<string, BattlefieldTerritoryTemplate>();
  for (const t of definition.territories) {
    if (terrMap.has(t.id)) {
      throw new Error(`Duplicate territory ID "${t.id}" in battlefield "${definition.id}"`);
    }
    terrMap.set(t.id, t);
  }

  // 2. mode-aware owned starting territories
  const playerBases = definition.territories.filter((t) => t.owner === 'player');
  const enemyBases = definition.territories.filter((t) => t.owner === 'enemy');
  if (mode === '1v1') {
    if (playerBases.length !== 1 || playerBases[0].id !== 'p_base') {
      throw new Error(`Battlefield "${definition.id}" must have exactly one player base (id="p_base")`);
    }

    if (enemyBases.length !== 1 || enemyBases[0].id !== 'e_base') {
      throw new Error(`Battlefield "${definition.id}" must have exactly one enemy base (id="e_base")`);
    }
  } else {
    // 2v2: exactly two Team A spawns ("a_base_w"/"a_base_e", player-owned)
    // and two Team B spawns ("b_base_w"/"b_base_e", enemy-owned), all
    // tier-3 fortresses (§7.3).
    const aSpawnIds = playerBases.map((t) => t.id).sort();
    const bSpawnIds = enemyBases.map((t) => t.id).sort();
    if (aSpawnIds.length !== 2 || aSpawnIds[0] !== 'a_base_e' || aSpawnIds[1] !== 'a_base_w') {
      throw new Error(
        `Battlefield "${definition.id}" must have exactly two Team A starting fortresses (ids "a_base_w" and "a_base_e")`
      );
    }
    if (bSpawnIds.length !== 2 || bSpawnIds[0] !== 'b_base_e' || bSpawnIds[1] !== 'b_base_w') {
      throw new Error(
        `Battlefield "${definition.id}" must have exactly two Team B starting fortresses (ids "b_base_w" and "b_base_e")`
      );
    }
    for (const spawn of [...playerBases, ...enemyBases]) {
      if (spawn.tier !== 3 || spawn.type !== 'fortress') {
        throw new Error(
          `Starting fortress "${spawn.id}" in battlefield "${definition.id}" must be a tier-3 fortress`
        );
      }
    }
  }

  // 4. at least one neutral territory
  const neutrals = definition.territories.filter((t) => t.owner === 'neutral');
  if (neutrals.length < 1) {
    throw new Error(`Battlefield "${definition.id}" must have at least one neutral territory`);
  }

  // 5. every road endpoint exists
  // 6. no self-road
  // 7. no duplicate undirected road
  const seenRoads = new Set<string>();
  for (const [idA, idB] of definition.roads) {
    if (!terrMap.has(idA)) {
      throw new Error(`Road endpoint "${idA}" does not exist in battlefield "${definition.id}"`);
    }
    if (!terrMap.has(idB)) {
      throw new Error(`Road endpoint "${idB}" does not exist in battlefield "${definition.id}"`);
    }
    if (idA === idB) {
      throw new Error(`Self-road [${idA}, ${idB}] in battlefield "${definition.id}"`);
    }
    const roadKey = idA < idB ? `${idA}<->${idB}` : `${idB}<->${idA}`;
    if (seenRoads.has(roadKey)) {
      throw new Error(`Duplicate road "${roadKey}" in battlefield "${definition.id}"`);
    }
    seenRoads.add(roadKey);
  }

  // 8. territories stay inside safe battlefield bounds (400x720 logical canvas, safe margins)
  for (const t of definition.territories) {
    if (
      t.x - t.radius < 15 ||
      t.x + t.radius > 385 ||
      t.y - t.radius < 70 ||
      t.y + t.radius > 650
    ) {
      throw new Error(
        `Territory "${t.id}" at (${t.x}, ${t.y}, r=${t.radius}) exceeds safe battlefield bounds in "${definition.id}"`
      );
    }
  }

  // 9. layout is competitively symmetric (180-deg rotational symmetry);
  // 1v1 additionally pins the single base pair on the rotation axis.
  if (mode === '1v1') {
    const pBase = playerBases[0];
    const eBase = enemyBases[0];
    if (pBase.x !== eBase.x || pBase.y + eBase.y !== 720) {
      throw new Error(`Bases are not symmetric in battlefield "${definition.id}"`);
    }
  }
  const counterpartOf = (
    t: BattlefieldTerritoryTemplate
  ): { match: BattlefieldTerritoryTemplate; count: number } => {
    const rotX = 400 - t.x;
    const rotY = 720 - t.y;
    let match: BattlefieldTerritoryTemplate | undefined;
    let count = 0;
    for (const other of definition.territories) {
      if (Math.abs(other.x - rotX) < 1e-4 && Math.abs(other.y - rotY) < 1e-4) {
        count++;
        match ??= other;
      }
    }
    return { match: match!, count };
  };
  for (const t of definition.territories) {
    const rotX = 400 - t.x;
    const rotY = 720 - t.y;
    const { match, count } = counterpartOf(t);
    if (count === 0) {
      throw new Error(
        `Territory "${t.id}" at (${t.x}, ${t.y}) has no symmetric counterpart at (${rotX}, ${rotY}) in "${definition.id}"`
      );
    }
    if (count > 1) {
      throw new Error(
        `Territory "${t.id}" at (${t.x}, ${t.y}) has ${count} territories at its counterpart coordinate (${rotX}, ${rotY}); exactly one symmetric counterpart is required in "${definition.id}"`
      );
    }
    // Bidirectional ownership mirroring: player<->enemy, neutral<->neutral.
    if (t.owner === 'player' && match.owner !== 'enemy') {
      throw new Error(`Symmetric counterpart for player base "${t.id}" is not enemy owned in "${definition.id}"`);
    }
    if (t.owner === 'enemy' && match.owner !== 'player') {
      throw new Error(`Symmetric counterpart for enemy base "${t.id}" is not player owned in "${definition.id}"`);
    }
    if (t.owner === 'neutral' && match.owner !== 'neutral') {
      throw new Error(`Symmetric counterpart for neutral "${t.id}" is not neutral owned in "${definition.id}"`);
    }
    if (
      t.tier !== match.tier ||
      t.type !== match.type ||
      t.units !== match.units ||
      t.maxUnits !== match.maxUnits ||
      t.productionRate !== match.productionRate ||
      t.radius !== match.radius
    ) {
      throw new Error(
        `Territory "${t.id}" does not have matching attributes with counterpart "${match.id}" in "${definition.id}"`
      );
    }
  }

  // 180-deg road symmetry: for every road [A, B], rot(A) and rot(B) must have
  // a connecting road. 2v2 additionally rejects mirror-INVARIANT undirected
  // roads (roads whose rotated endpoint set equals their own, including when
  // rotation swaps the endpoints) — §7.3 forbids them on quad_citadel. 1v1
  // maps may legitimately contain a mirror-symmetric cross-pass road (e.g.
  // twin_passes [n_west_pass, n_east_pass]).
  for (const [idA, idB] of definition.roads) {
    const tA = terrMap.get(idA)!;
    const tB = terrMap.get(idB)!;
    const rotAX = 400 - tA.x;
    const rotAY = 720 - tA.y;
    const rotBX = 400 - tB.x;
    const rotBY = 720 - tB.y;
    const rotA = definition.territories.find(
      (o) => Math.abs(o.x - rotAX) < 1e-4 && Math.abs(o.y - rotAY) < 1e-4
    )!;
    const rotB = definition.territories.find(
      (o) => Math.abs(o.x - rotBX) < 1e-4 && Math.abs(o.y - rotBY) < 1e-4
    )!;
    const originalKey = roadKey(idA, idB);
    const rotKey = roadKey(rotA.id, rotB.id);
    if (mode === '2v2' && rotKey === originalKey) {
      throw new Error(
        `Road [${idA}, ${idB}] maps to itself under mirroring in "${definition.id}"`
      );
    }
    if (!seenRoads.has(rotKey)) {
      throw new Error(
        `Road [${idA}, ${idB}] has no symmetric counterpart [${rotA.id}, ${rotB.id}] in "${definition.id}"`
      );
    }
  }
}

function roadKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}<->${idB}` : `${idB}<->${idA}`;
}

/**
 * Validates a collection of battlefield definitions and verifies that all maps are structurally distinct.
 */
export function validateAllBattlefields(definitions: readonly BattlefieldDefinition[]): void {
  for (const def of definitions) {
    validateBattlefieldDefinition(def);
  }
  for (let i = 0; i < definitions.length; i++) {
    for (let j = i + 1; j < definitions.length; j++) {
      const a = definitions[i];
      const b = definitions[j];
      const sameCount = a.territories.length === b.territories.length;
      const sameIds =
        sameCount &&
        a.territories.every((t) => b.territories.some((bt) => bt.id === t.id));
      const sameRoads =
        a.roads.length === b.roads.length &&
        a.roads.every(([a1, a2]) =>
          b.roads.some(
            ([b1, b2]) => (a1 === b1 && a2 === b2) || (a1 === b2 && a2 === b1)
          )
        );
      if (sameCount && sameIds && sameRoads) {
        throw new Error(
          `Battlefield "${a.id}" and "${b.id}" are not structurally distinct`
        );
      }
    }
  }
}
