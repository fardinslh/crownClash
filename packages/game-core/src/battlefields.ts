import type { MatchMode, Team, TerritoryType } from './types.js';

export type BattlefieldId = 'crown_cross' | 'twin_passes' | 'royal_ring';

export type RoadConnection = readonly [string, string];

export type BattlefieldMotif = 'crown_cross' | 'twin_passes' | 'royal_ring';

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
  const index = Math.floor(Math.random() * BATTLEFIELDS.length);
  return {
    matchId: `local_${now}_${Math.random().toString(36).slice(2, 10)}`,
    battlefieldId: BATTLEFIELDS[index]?.id ?? DEFAULT_BATTLEFIELD_ID,
  };
}

/**
 * Validates the topological and competitive structural correctness of a battlefield definition.
 * Throws a descriptive Error if any invariant fails.
 */
export function validateBattlefieldDefinition(definition: BattlefieldDefinition): void {
  normalizeBattlefieldMode(definition.mode);
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

  // 2. exactly one player base
  const playerBases = definition.territories.filter((t) => t.owner === 'player');
  if (playerBases.length !== 1 || playerBases[0].id !== 'p_base') {
    throw new Error(`Battlefield "${definition.id}" must have exactly one player base (id="p_base")`);
  }

  // 3. exactly one enemy base
  const enemyBases = definition.territories.filter((t) => t.owner === 'enemy');
  if (enemyBases.length !== 1 || enemyBases[0].id !== 'e_base') {
    throw new Error(`Battlefield "${definition.id}" must have exactly one enemy base (id="e_base")`);
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

  // 9. player/enemy layout is competitively symmetric (180-deg rotational symmetry)
  const pBase = playerBases[0];
  const eBase = enemyBases[0];
  if (pBase.x !== eBase.x || pBase.y + eBase.y !== 720) {
    throw new Error(`Bases are not symmetric in battlefield "${definition.id}"`);
  }
  for (const t of definition.territories) {
    const rotX = 400 - t.x;
    const rotY = 720 - t.y;
    const match = definition.territories.find(
      (other) =>
        Math.abs(other.x - rotX) < 1e-4 &&
        Math.abs(other.y - rotY) < 1e-4
    );
    if (!match) {
      throw new Error(
        `Territory "${t.id}" at (${t.x}, ${t.y}) has no symmetric counterpart at (${rotX}, ${rotY}) in "${definition.id}"`
      );
    }
    if (t.owner === 'player' && match.owner !== 'enemy') {
      throw new Error(`Symmetric counterpart for player base "${t.id}" is not enemy owned in "${definition.id}"`);
    }
    if (t.owner === 'neutral' && match.owner !== 'neutral') {
      throw new Error(`Symmetric counterpart for neutral "${t.id}" is not neutral owned in "${definition.id}"`);
    }
    if (t.tier !== match.tier || t.type !== match.type || t.units !== match.units || t.maxUnits !== match.maxUnits) {
      throw new Error(
        `Territory "${t.id}" does not have matching attributes with counterpart "${match.id}" in "${definition.id}"`
      );
    }
  }

  // 180-deg road symmetry: for every road [A, B], rot(A) and rot(B) must have a connecting road
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
    const rotKey = rotA.id < rotB.id ? `${rotA.id}<->${rotB.id}` : `${rotB.id}<->${rotA.id}`;
    if (!seenRoads.has(rotKey)) {
      throw new Error(
        `Road [${idA}, ${idB}] has no symmetric counterpart [${rotA.id}, ${rotB.id}] in "${definition.id}"`
      );
    }
  }
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
