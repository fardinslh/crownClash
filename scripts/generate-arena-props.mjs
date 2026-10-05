#!/usr/bin/env node
// Dev-time generator for the arena prop placement tables in
// apps/game/src/art/BattlefieldArt.ts.
//
// Reads the authoritative battlefield geometry
// (apps/server-nakama/battlefields.json) and deterministically picks prop
// positions that are provably clear of territory sockets, roads, the arena
// frame, art-only ground features and each other. Prints a TypeScript literal
// block to paste. The output is re-validated by BattlefieldArt.test.ts, so regenerating
// can never silently break gameplay readability.
//
// Usage: node scripts/generate-arena-props.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const battlefields = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'apps/server-nakama/battlefields.json'), 'utf8')
);
const dressingZones = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'art/arena-dressing-zones.json'), 'utf8')
).battlefields;

const artLayout = JSON.parse(fs.readFileSync(path.join(repoRoot, 'art/arena-layout.json'), 'utf8'));
const propSize = { tree_birch: 104 * artLayout.presentation.treeScale,
  tree_apple: 100 * artLayout.presentation.treeScale, tree_pine: 100 * artLayout.presentation.treeScale,
  pennant: 64, bush: 44, rock: 32, grass_tuft: 34 };
const projectedY = (y) => (y - 398) * Math.SQRT1_2 * artLayout.verticalSpacing;

function buildingBounds(battlefield, territory) {
  const top = territory.type === 'fortress' && territory.tier === 3 && territory.y <= 150;
  const footprints = artLayout.buildingFootprints[battlefield.id] ?? artLayout.buildingFootprints.default;
  const [oldSize, oldY] = top ? footprints.topCitadel : footprints[`tier${territory.tier}`];
  const role = territory.tier === 3 ? 'citadel' : territory.tier === 2 ? 'keep'
    : territory.type === 'fortress' ? 'outpost' : territory.type;
  const [ortho, aim] = artLayout.buildingFraming[role];
  const size = oldSize * artLayout.presentation.buildingScale;
  const groundY = projectedY(territory.y) - 6.2 * Math.SQRT1_2;
  const y = groundY + oldY
    - (size - oldSize) * aim * Math.SQRT1_2 / ortho;
  const quad = battlefield.id === 'quad_citadel';
  const badgeY = quad ? territory.tier === 3 ? top ? 13 : 18 : territory.tier === 2 ? 18 : 14
    : territory.tier === 3 ? 25 : territory.tier === 2 ? 21 : 17;
  const iconY = quad && territory.tier === 3 ? badgeY : badgeY + 21;
  // Include selected-building growth; full image bounds are conservative.
  return { left: territory.x - size * .54 - 5, right: territory.x + size * .54 + 5,
    top: y - size * .54 - 5, bottom: Math.max(y + size * .54, groundY + iconY + 9) + 5 };
}

// Deterministic wish lists per battlefield: kind pools tuned per map theme.
// Grass-heavy on purpose: the meadow ground reads alive with scattered tufts.
const WISH_LISTS = {
  crown_cross: [
    'tree_birch', 'bush', 'grass_tuft', 'grass_tuft', 'tree_apple', 'rock', 'grass_tuft',
    'pennant', 'bush', 'tree_birch', 'grass_tuft', 'tree_apple', 'grass_tuft', 'rock',
    'pennant', 'bush', 'grass_tuft', 'tree_birch', 'grass_tuft', 'tree_apple', 'rock',
    'bush', 'grass_tuft', 'grass_tuft',
  ],
  twin_passes: [
    'tree_pine', 'rock', 'grass_tuft', 'bush', 'tree_pine', 'grass_tuft', 'grass_tuft',
    'pennant', 'rock', 'tree_pine', 'bush', 'grass_tuft', 'tree_pine', 'grass_tuft',
    'pennant', 'rock', 'bush', 'grass_tuft', 'bush', 'tree_pine', 'grass_tuft', 'grass_tuft',
  ],
  royal_ring: [
    'tree_apple', 'bush', 'grass_tuft', 'grass_tuft', 'bush', 'pennant', 'grass_tuft',
    'tree_apple', 'bush', 'pennant', 'rock', 'grass_tuft', 'bush', 'tree_apple',
    'grass_tuft', 'grass_tuft', 'pennant', 'bush', 'grass_tuft', 'rock', 'grass_tuft',
    'grass_tuft',
  ],
  quad_citadel: [
    'grass_tuft', 'bush', 'rock', 'tree_pine', 'grass_tuft', 'grass_tuft', 'rock',
    'pennant', 'bush', 'grass_tuft', 'tree_pine', 'rock', 'grass_tuft', 'grass_tuft',
    'bush', 'grass_tuft', 'tree_pine', 'grass_tuft', 'rock', 'grass_tuft', 'bush',
    'grass_tuft', 'grass_tuft',
  ],
};

// Per-kind clearances (px). Trees are tall and get the widest berth.
const CLEARANCE = {
  tree_birch: { territory: 44, road: 20, spacing: 42, edgeOnly: true },
  tree_apple: { territory: 44, road: 20, spacing: 42, edgeOnly: true },
  tree_pine: { territory: 44, road: 20, spacing: 42, edgeOnly: true },
  pennant: { territory: 32, road: 14, spacing: 30, edgeOnly: false },
  bush: { territory: 28, road: 13, spacing: 30, edgeOnly: false },
  rock: { territory: 26, road: 13, spacing: 26, edgeOnly: false },
  grass_tuft: { territory: 24, road: 12, spacing: 22, edgeOnly: false },
};

const BOUNDS = { xMin: 30, xMax: 370, yMin: 105, yMax: 635 };
const TREE_X_MIN = 130;
const TREE_X_MAX = 270;

function distancePointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function generate(battlefield) {
  const wish = WISH_LISTS[battlefield.id];
  const placed = [];
  const territories = battlefield.territories;
  const roads = battlefield.roads.map(([a, b]) => ({
    a: territories.find((t) => t.id === a),
    b: territories.find((t) => t.id === b),
  }));

  const fits = (kind, x, y) => {
    if (x < BOUNDS.xMin || x > BOUNDS.xMax || y < BOUNDS.yMin || y > BOUNDS.yMax) return false;
    if (dressingZones[battlefield.id].some((zone) => zone.shape === 'rectangle'
      ? x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY
      : Math.hypot(x - zone.x, y - zone.y) <= zone.radius)) return false;
    if (CLEARANCE[kind].edgeOnly && x > TREE_X_MIN && x < TREE_X_MAX) return false;
    for (const territory of territories) {
      if (Math.hypot(x - territory.x, y - territory.y) < territory.radius + CLEARANCE[kind].territory) {
        return false;
      }
    }
    const size = propSize[kind];
    const py = projectedY(y);
    const [left, top, right, bottom] = artLayout.propVisibleBounds[kind];
    for (const territory of territories) {
      const bounds = buildingBounds(battlefield, territory);
      if (x + (right - .5) * size > bounds.left && x + (left - .5) * size < bounds.right &&
          py + (bottom - 1) * size > bounds.top && py + (top - 1) * size < bounds.bottom) return false;
    }
    for (const road of roads) {
      if (distancePointToSegment(x, y, road.a.x, road.a.y, road.b.x, road.b.y) < CLEARANCE[kind].road) {
        return false;
      }
    }
    for (const prop of placed) {
      const spacing = Math.max(CLEARANCE[kind].spacing, CLEARANCE[prop.kind].spacing);
      if (Math.hypot(x - prop.x, y - prop.y) < spacing) return false;
    }
    return true;
  };

  // Deterministic candidate order: seeded LCG shuffle so props spread across
  // the whole field instead of piling onto the first free rows.
  const candidates = [];
  for (let y = BOUNDS.yMin; y <= BOUNDS.yMax; y += 9) {
    for (let x = BOUNDS.xMin; x <= BOUNDS.xMax; x += 7) {
      const jitterX = ((x * 13 + y * 7) % 5) - 2;
      const jitterY = ((x * 11 + y * 3) % 5) - 2;
      candidates.push({ x: x + jitterX, y: y + jitterY });
    }
  }
  let seed = 104729;
  for (const ch of battlefield.id) {
    seed = (seed * 131 + ch.charCodeAt(0)) & 0x7fffffff;
  }
  const nextRandom = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRandom() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  // Reserve the scarce tree/pennant clearings before placing small tufts.
  for (const kind of [...wish].sort((a, b) => propSize[b] - propSize[a])) {
    for (const candidate of candidates) {
      if (fits(kind, candidate.x, candidate.y)) {
        placed.push({ kind, x: candidate.x, y: candidate.y });
        break;
      }
    }
  }
  if (placed.length !== wish.length) throw new Error(`${battlefield.id}: only ${placed.length}/${wish.length} props fit`);
  return placed;
}

for (const battlefield of battlefields) {
  const props = generate(battlefield);
  const kinds = {};
  for (const prop of props) kinds[prop.kind] = (kinds[prop.kind] ?? 0) + 1;
  console.error(`# ${battlefield.id}: ${props.length} props`, kinds);
  console.log(`    if (battlefieldId === '${battlefield.id}') {`);
  console.log('      return Object.freeze([');
  for (const prop of props) {
    console.log(`        { x: ${prop.x}, y: ${prop.y}, kind: '${prop.kind}' },`);
  }
  console.log('      ] as readonly ArenaProp[]);');
  console.log('    }');
}
