import type { Team, TerritoryType } from './types.js';

export type BattlefieldId = 'crown_cross' | 'twin_passes' | 'royal_ring';

export type RoadConnection = readonly [string, string];

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
  readonly name: string;
  readonly subtitle: string;
  readonly accent: number;
  readonly territories: readonly BattlefieldTerritoryTemplate[];
  readonly roads: readonly RoadConnection[];
}

export interface BotMatchTicket {
  readonly matchId: string;
  readonly battlefieldId: BattlefieldId;
}

export const DEFAULT_BATTLEFIELD_ID: BattlefieldId = 'crown_cross';

export const BATTLEFIELDS: readonly BattlefieldDefinition[] = Object.freeze([
  {
    id: 'crown_cross',
    name: 'Crown Cross',
    subtitle: 'Control the central keep',
    accent: 0xf59e0b,
    territories: [
      { id: 'p_base', name: 'Player Fortress', x: 200, y: 610, radius: 36, owner: 'player', units: 20, maxUnits: 65, productionRate: 1.2, tier: 3, type: 'fortress' },
      { id: 'e_base', name: 'Enemy Citadel', x: 200, y: 110, radius: 36, owner: 'enemy', units: 20, maxUnits: 65, productionRate: 1.2, tier: 3, type: 'fortress' },
      { id: 'n_bot_left', name: 'Southwest Barracks', x: 85, y: 485, radius: 27, owner: 'neutral', units: 8, maxUnits: 40, productionRate: 0.9, tier: 1, type: 'barracks' },
      { id: 'n_bot_right', name: 'Southeast Stable', x: 315, y: 485, radius: 27, owner: 'neutral', units: 8, maxUnits: 40, productionRate: 0.9, tier: 1, type: 'stable' },
      { id: 'n_center', name: 'Crown Keep', x: 200, y: 360, radius: 32, owner: 'neutral', units: 14, maxUnits: 55, productionRate: 1.1, tier: 2, type: 'fortress' },
      { id: 'n_mid_left', name: 'West Barracks', x: 75, y: 360, radius: 26, owner: 'neutral', units: 10, maxUnits: 40, productionRate: 0.85, tier: 1, type: 'barracks' },
      { id: 'n_mid_right', name: 'East Barracks', x: 325, y: 360, radius: 26, owner: 'neutral', units: 10, maxUnits: 40, productionRate: 0.85, tier: 1, type: 'barracks' },
      { id: 'n_top_left', name: 'Northwest Stable', x: 85, y: 235, radius: 27, owner: 'neutral', units: 8, maxUnits: 40, productionRate: 0.9, tier: 1, type: 'stable' },
      { id: 'n_top_right', name: 'Northeast Barracks', x: 315, y: 235, radius: 27, owner: 'neutral', units: 8, maxUnits: 40, productionRate: 0.9, tier: 1, type: 'barracks' },
    ],
    roads: [
      ['p_base', 'n_bot_left'],
      ['p_base', 'n_center'],
      ['p_base', 'n_bot_right'],
      ['n_bot_left', 'n_mid_left'],
      ['n_bot_right', 'n_mid_right'],
      ['n_mid_left', 'n_center'],
      ['n_mid_right', 'n_center'],
      ['n_mid_left', 'n_top_left'],
      ['n_mid_right', 'n_top_right'],
      ['n_center', 'e_base'],
      ['n_top_left', 'e_base'],
      ['n_top_right', 'e_base'],
      ['n_bot_left', 'n_center'],
      ['n_bot_right', 'n_center'],
      ['n_top_left', 'n_center'],
      ['n_top_right', 'n_center'],
    ],
  },
  {
    id: 'twin_passes',
    name: 'Twin Passes',
    subtitle: 'Fast towers rule the flanks',
    accent: 0x38bdf8,
    territories: [
      { id: 'p_base', name: 'Player Fortress', x: 200, y: 610, radius: 36, owner: 'player', units: 20, maxUnits: 65, productionRate: 1.2, tier: 3, type: 'fortress' },
      { id: 'e_base', name: 'Enemy Citadel', x: 200, y: 110, radius: 36, owner: 'enemy', units: 20, maxUnits: 65, productionRate: 1.2, tier: 3, type: 'fortress' },
      { id: 'n_west_gate_s', name: 'Southwest Gate', x: 100, y: 490, radius: 27, owner: 'neutral', units: 8, maxUnits: 40, productionRate: 0.9, tier: 1, type: 'stable' },
      { id: 'n_west_pass', name: 'West Pass', x: 90, y: 360, radius: 28, owner: 'neutral', units: 14, maxUnits: 45, productionRate: 1.0, tier: 2, type: 'barracks' },
      { id: 'n_west_gate_n', name: 'Northwest Gate', x: 100, y: 230, radius: 27, owner: 'neutral', units: 8, maxUnits: 40, productionRate: 0.9, tier: 1, type: 'stable' },
      { id: 'n_east_gate_s', name: 'Southeast Gate', x: 300, y: 490, radius: 27, owner: 'neutral', units: 8, maxUnits: 40, productionRate: 0.9, tier: 1, type: 'stable' },
      { id: 'n_east_pass', name: 'East Pass', x: 310, y: 360, radius: 28, owner: 'neutral', units: 14, maxUnits: 45, productionRate: 1.0, tier: 2, type: 'barracks' },
      { id: 'n_east_gate_n', name: 'Northeast Gate', x: 300, y: 230, radius: 27, owner: 'neutral', units: 8, maxUnits: 40, productionRate: 0.9, tier: 1, type: 'stable' },
    ],
    roads: [
      ['p_base', 'n_west_gate_s'],
      ['p_base', 'n_east_gate_s'],
      ['n_west_gate_s', 'n_west_pass'],
      ['n_east_gate_s', 'n_east_pass'],
      ['n_west_pass', 'n_east_pass'],
      ['n_west_pass', 'n_west_gate_n'],
      ['n_east_pass', 'n_east_gate_n'],
      ['n_west_gate_n', 'e_base'],
      ['n_east_gate_n', 'e_base'],
    ],
  },
  {
    id: 'royal_ring',
    name: 'Royal Ring',
    subtitle: 'Choose your attack lane',
    accent: 0xa78bfa,
    territories: [
      { id: 'p_base', name: 'Player Fortress', x: 200, y: 610, radius: 36, owner: 'player', units: 20, maxUnits: 65, productionRate: 1.2, tier: 3, type: 'fortress' },
      { id: 'e_base', name: 'Enemy Citadel', x: 200, y: 110, radius: 36, owner: 'enemy', units: 20, maxUnits: 65, productionRate: 1.2, tier: 3, type: 'fortress' },
      { id: 'n_ring_sw', name: 'Southwest Bastion', x: 125, y: 505, radius: 26, owner: 'neutral', units: 9, maxUnits: 40, productionRate: 0.9, tier: 1, type: 'barracks' },
      { id: 'n_ring_se', name: 'Southeast Bastion', x: 275, y: 505, radius: 26, owner: 'neutral', units: 9, maxUnits: 40, productionRate: 0.9, tier: 1, type: 'barracks' },
      { id: 'n_ring_w_s', name: 'West Lower Outpost', x: 65, y: 415, radius: 26, owner: 'neutral', units: 8, maxUnits: 40, productionRate: 0.85, tier: 1, type: 'stable' },
      { id: 'n_ring_e_s', name: 'East Lower Outpost', x: 335, y: 415, radius: 26, owner: 'neutral', units: 8, maxUnits: 40, productionRate: 0.85, tier: 1, type: 'stable' },
      { id: 'n_ring_w_n', name: 'West Upper Outpost', x: 65, y: 305, radius: 26, owner: 'neutral', units: 8, maxUnits: 40, productionRate: 0.85, tier: 1, type: 'stable' },
      { id: 'n_ring_e_n', name: 'East Upper Outpost', x: 335, y: 305, radius: 26, owner: 'neutral', units: 8, maxUnits: 40, productionRate: 0.85, tier: 1, type: 'stable' },
      { id: 'n_ring_nw', name: 'Northwest Bastion', x: 125, y: 215, radius: 26, owner: 'neutral', units: 9, maxUnits: 40, productionRate: 0.9, tier: 1, type: 'barracks' },
      { id: 'n_ring_ne', name: 'Northeast Bastion', x: 275, y: 215, radius: 26, owner: 'neutral', units: 9, maxUnits: 40, productionRate: 0.9, tier: 1, type: 'barracks' },
    ],
    roads: [
      ['p_base', 'n_ring_sw'],
      ['p_base', 'n_ring_se'],
      ['n_ring_sw', 'n_ring_se'],
      ['n_ring_sw', 'n_ring_w_s'],
      ['n_ring_se', 'n_ring_e_s'],
      ['n_ring_w_s', 'n_ring_w_n'],
      ['n_ring_e_s', 'n_ring_e_n'],
      ['n_ring_w_n', 'n_ring_nw'],
      ['n_ring_e_n', 'n_ring_ne'],
      ['n_ring_nw', 'n_ring_ne'],
      ['n_ring_nw', 'e_base'],
      ['n_ring_ne', 'e_base'],
    ],
  },
]);

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
