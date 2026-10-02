import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BATTLEFIELDS,
  getBattlefield,
  type BattlefieldId,
} from '@crown-clash/game-core';
import {
  ASSET_MANIFEST,
  blenderMasterPath,
  battlefieldIdFromLaunchData,
  createProceduralTerritoryFallbackTexture,
  getArenaGroundSprite,
  getArenaPropPositions,
  getBattlefieldRuntimeAssets,
  GROUND_TEXTURE_KEYS,
  listEnvironmentPropSpritePaths,
  listRuntimeSpritePaths,
  PROCEDURAL_FALLBACK_KEYS,
  PROP_TEXTURE_KEYS,
  resolveTerritoryTextureKey,
  runtimeTerritoryTextureKey,
  TERRITORY_TEXTURE_KEYS,
  territoryHitAreaSize,
  territoryArtFootprint,
  toPhaserAssetPath,
  usesDedicatedSpritePack,
} from '../BattlefieldArt.js';

const PUBLIC_DIR = path.resolve(__dirname, '../../../public');
const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const PY_BUILDER = path.join(REPO_ROOT, 'art/blender/build_battlefield_scene.py');
const MANIFEST_PATH = path.join(REPO_ROOT, 'art/asset-manifest.json');
/** Every battlefield with its own dedicated sprite pack. */
const DEDICATED_PACKS = ['crown_cross', 'twin_passes', 'royal_ring', 'quad_citadel'] as const;

function distancePointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSquared));
  const closestX = ax + abx * t;
  const closestY = ay + aby * t;
  return Math.hypot(px - closestX, py - closestY);
}

function readRuntimeImageDimensions(absolute: string): { width: number; height: number; bytes: number } {
  const buffer = fs.readFileSync(absolute);
  if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      bytes: buffer.length,
    };
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    const chunk = buffer.subarray(12, 16).toString('ascii');
    if (chunk !== 'VP8X') throw new Error(`${absolute} uses unsupported WebP chunk ${chunk}`);
    const readUint24LE = (offset: number) =>
      buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
    return {
      width: readUint24LE(24) + 1,
      height: readUint24LE(27) + 1,
      bytes: buffer.length,
    };
  }
  throw new Error(`${absolute} is neither PNG nor extended WebP`);
}

/** Runs a python3 snippet against the Blender builder module (no bpy needed). */
function runBuilderPython(script: string, ...args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('python3', ['-c', script, PY_BUILDER, ...args], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

function loadBuilderModule(modName: string): string {
  return `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location(${JSON.stringify(modName)}, sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
`;
}

describe('canonical runtime asset manifest', () => {
  it('parses at module load and every entry maps a Blender render name to a runtime file', () => {
    expect(ASSET_MANIFEST.version).toBeGreaterThanOrEqual(1);
    expect(Object.keys(ASSET_MANIFEST.packs)).toContain('generic');

    for (const [packId, pack] of Object.entries(ASSET_MANIFEST.packs)) {
      const renderNames = new Set<string>();
      for (const [textureKey, sprite] of Object.entries(pack.sprites)) {
        // Runtime filename and path agree with each other and the pack format.
        expect(sprite.runtimeFilename.endsWith(`.${pack.runtimeFormat}`)).toBe(true);
        expect(sprite.runtimePath).toBe(`${pack.packDirectory}/${sprite.runtimeFilename}`);
        if (pack.spriteKind === 'ground') {
          // Ground plates are full-field non-square plates: the optimizer
          // resizes through the explicit targetWidth/targetHeight pair.
          expect(sprite.targetWidth, `${packId}/${textureKey} ground targetWidth`).toBeGreaterThan(0);
          expect(sprite.targetHeight, `${packId}/${textureKey} ground targetHeight`).toBeGreaterThan(0);
          expect(sprite.targetSize, `${packId}/${textureKey} ground targetSize`).toBe(sprite.targetHeight);
        } else {
          // Target size is a sane power-of-two-ish runtime dimension.
          expect([64, 96, 128, 160, 256]).toContain(sprite.targetSize);
        }
        // The Blender builder referenced by the manifest exists in the scene
        // builder script, and render names stay unique per pack (a duplicate
        // would silently overwrite another master).
        expect(
          fs.readFileSync(PY_BUILDER, 'utf8').includes(`"${sprite.blenderBuilder}": build_`),
          `builder ${sprite.blenderBuilder} of ${packId}/${textureKey} missing from the Blender script`
        ).toBe(true);
        expect(renderNames.has(sprite.blenderRenderName), `duplicate render name ${sprite.blenderRenderName} in ${packId}`).toBe(false);
        renderNames.add(sprite.blenderRenderName);
        // Aliases must point at a real key with the same runtime file.
        if (sprite.aliasOf !== undefined) {
          const target = pack.sprites[sprite.aliasOf];
          expect(target, `alias ${textureKey} points at unknown key ${sprite.aliasOf}`).toBeDefined();
          expect(sprite.runtimePath).toBe(target.runtimePath);
        }
      }
    }
  });

  it('declares every texture key the resolver can emit, in every pack of its kind', () => {
    const territoryKeys = new Set(TERRITORY_TEXTURE_KEYS);
    const propKeys = new Set(PROP_TEXTURE_KEYS);
    const groundKeys = new Set(GROUND_TEXTURE_KEYS);
    for (const [packId, pack] of Object.entries(ASSET_MANIFEST.packs)) {
      const expected =
        pack.spriteKind === 'prop' ? propKeys : pack.spriteKind === 'ground' ? groundKeys : territoryKeys;
      expect(
        Object.keys(pack.sprites).sort(),
        `pack ${packId} must cover exactly its kind's keys`
      ).toEqual([...expected].sort());
    }
  });

  it('activates only packs whose runtime files exist at the manifest path, size, and budget', () => {
    for (const [packId, pack] of Object.entries(ASSET_MANIFEST.packs)) {
      const uniquePaths = [...new Set(Object.values(pack.sprites).map((sprite) => sprite.runtimePath))];
      for (const runtimePath of uniquePaths) {
        const absolute = path.join(REPO_ROOT, runtimePath);
        if (!pack.active) {
          // Inactive packs are pipeline targets: their files may not exist yet,
          // but the activation test below will fail if they are activated
          // before they are rendered and optimized.
          continue;
        }
        expect(fs.existsSync(absolute), `active pack ${packId} is missing runtime file ${runtimePath}`).toBe(true);
        const image = readRuntimeImageDimensions(absolute);
        const entry = Object.values(pack.sprites).find((sprite) => sprite.runtimePath === runtimePath)!;
        if (pack.spriteKind === 'ground') {
          // Ground plates are non-square: width/height must match the
          // manifest's targetWidth/targetHeight pair exactly.
          expect(image.width, `${runtimePath} width`).toBe(entry.targetWidth);
          expect(image.height, `${runtimePath} height`).toBe(entry.targetHeight);
        } else {
          expect(image.width, `${runtimePath} width`).toBe(entry.targetSize);
          expect(image.height, `${runtimePath} height`).toBe(entry.targetSize);
        }
        // Art Bible section 14 budgets: territory/prop sprites stay under
        // 80KB; a full-field ground plate is the whole arena in one file, so
        // it gets the plate budget (one plate loads per match).
        const byteBudget = pack.spriteKind === 'ground' ? 128 * 1024 : 80 * 1024;
        expect(image.bytes, `${runtimePath} exceeds the budget`).toBeLessThan(byteBudget);
      }
    }
  });

  it('refuses to activate a dedicated pack whose optimized files are absent', () => {
    // Dedicated packs are declared before their masters are rendered. These
    // assertions flip to hard file-existence guards the moment an `active`
    // flag is turned on, so a pack can never go live half-rendered.
    for (const packId of DEDICATED_PACKS) {
      const pack = ASSET_MANIFEST.packs[packId];
      expect(pack.runtimeFormat).toBe('webp');
      // Dedicated packs must not use aliases: every key gets its own file.
      expect(new Set(Object.values(pack.sprites).map((sprite) => sprite.runtimePath)).size).toBe(
        Object.keys(pack.sprites).length
      );
      for (const sprite of Object.values(pack.sprites)) {
        expect(blenderMasterPath(packId, sprite)).toBe(
          `art/blender/renders/${packId}/${sprite.blenderRenderName}.png`
        );
      }
      if (!pack.active) continue;
      for (const sprite of Object.values(pack.sprites)) {
        expect(
          fs.existsSync(path.join(REPO_ROOT, sprite.runtimePath)),
          `activated dedicated pack is missing ${sprite.runtimePath}`
        ).toBe(true);
      }
    }
  });

  it('maps runtime paths into the exact public directory Phaser serves', () => {
    for (const pack of Object.values(ASSET_MANIFEST.packs)) {
      expect(pack.packDirectory.startsWith('apps/game/public/')).toBe(true);
      for (const sprite of Object.values(pack.sprites)) {
        const phaserPath = toPhaserAssetPath(sprite.runtimePath);
        expect(phaserPath.startsWith('assets/')).toBe(true);
      }
    }
  });
});

describe('rendered ground plates', () => {
  it('ships one non-square ground plate per battlefield at the manifest size and budget', () => {
    const pack = ASSET_MANIFEST.packs['grounds'];
    expect(pack).toBeDefined();
    expect(pack!.spriteKind).toBe('ground');
    expect(pack!.active).toBe(true);
    expect(pack!.runtimeFormat).toBe('webp');
    expect(Object.keys(pack!.sprites).sort()).toEqual([...GROUND_TEXTURE_KEYS].sort());
    for (const [id, sprite] of Object.entries(pack!.sprites)) {
      expect(sprite.runtimePath.startsWith('apps/game/public/assets/grounds/'), `${id} ground path`).toBe(true);
      const absolute = path.join(REPO_ROOT, sprite.runtimePath);
      expect(fs.existsSync(absolute), `missing ground plate ${sprite.runtimePath}`).toBe(true);
      const image = readRuntimeImageDimensions(absolute);
      expect(image.width, `${id} ground width`).toBe(sprite.targetWidth);
      expect(image.height, `${id} ground height`).toBe(sprite.targetHeight);
      // Full-field plate budget (Art Bible section 14): one plate loads per
      // match, so the plate budget replaces the per-sprite 80KB rule.
      expect(image.bytes, `${id} ground plate exceeds the 128KB plate budget`).toBeLessThan(128 * 1024);
    }
  });

  it('resolves each battlefield ground plate with pack-namespaced texture keys', () => {
    for (const battlefield of BATTLEFIELDS) {
      const ground = getArenaGroundSprite(battlefield.id);
      expect(ground, `${battlefield.id} ground plate`).not.toBeNull();
      if (!ground) continue;
      expect(ground.textureKey).toBe(`cc_ground_${battlefield.id}`);
      expect(ground.path.startsWith('assets/grounds/'), `${battlefield.id} ground phaser path`).toBe(true);
      expect(fs.existsSync(path.join(PUBLIC_DIR, ground.path)), `missing ${ground.path}`).toBe(true);
    }
    // Every battlefield renders its own field: distinct paths and texture keys.
    const paths = BATTLEFIELDS.map((b) => getArenaGroundSprite(b.id)!.path);
    expect(new Set(paths).size).toBe(paths.length);
    const keys = BATTLEFIELDS.map((b) => getArenaGroundSprite(b.id)!.textureKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the flat vector ground as the fallback when the plate is missing', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../scenes/GameScene.ts'), 'utf8');
    // Preload resolves the plate through the manifest, the baked image only
    // renders when the texture actually exists, and the vector ground layers
    // stay as the no-plate fallback.
    expect(source).toContain('getArenaGroundSprite');
    expect(source).toContain('textures.exists');
    expect(source).toContain('if (!ground)');
  });
});

describe('battlefield preload through the manifest', () => {
  it('loads every battlefield through the manifest with complete owner variants', () => {
    for (const battlefield of BATTLEFIELDS) {
      const assetSet = getBattlefieldRuntimeAssets(battlefield.id);
      expect(assetSet.battlefieldId).toBe(battlefield.id);
      // Battlefields without a dedicated pack (e.g. quad_citadel in its
      // no-art phase) resolve through the generic pack fallback.
      expect(assetSet.packId).toBe(ASSET_MANIFEST.battlefieldPacks[battlefield.id] ?? 'generic');
      const spriteEntries = Object.entries(assetSet.sprites);
      expect(spriteEntries.length).toBeGreaterThan(0);

      // Capture-driven owner changes swap texture keys at runtime: every owner
      // variant of every resolvable key must be preloaded.
      let totalBytes = 0;
      const seen = new Set<string>();
      for (const filePath of Object.values(assetSet.sprites)) {
        const absolute = path.join(PUBLIC_DIR, filePath);
        expect(fs.existsSync(absolute), `missing runtime sprite ${filePath}`).toBe(true);
        if (!seen.has(filePath)) {
          seen.add(filePath);
          totalBytes += fs.statSync(absolute).size;
        }
      }
      // Per-battlefield set budget (Art Bible section 14). The rendered ground
      // plate ships with the same battlefield's match load, so it counts
      // against the same 500KB.
      const ground = getArenaGroundSprite(battlefield.id);
      if (ground) {
        const groundAbsolute = path.join(PUBLIC_DIR, ground.path);
        expect(fs.existsSync(groundAbsolute), `missing ground plate ${ground.path}`).toBe(true);
        totalBytes += fs.statSync(groundAbsolute).size;
      }
      expect(totalBytes, `${battlefield.id} sprite set exceeds the 500KB budget`).toBeLessThan(500 * 1024);
    }
  });

  it('resolves a texture key for every territory of every battlefield, all preloadable and fallback-covered', () => {
    for (const battlefield of BATTLEFIELDS) {
      const sprites = listRuntimeSpritePaths(battlefield.id);
      for (const template of battlefield.territories) {
        for (const owner of ['player', 'enemy', 'neutral'] as const) {
          const territory = { ...template, owner };
          const key = resolveTerritoryTextureKey(territory);
          expect(TERRITORY_TEXTURE_KEYS).toContain(key);
          expect(sprites[key], `${battlefield.id} preload misses ${key}`).toBeDefined();
          expect(PROCEDURAL_FALLBACK_KEYS.has(key), `no fallback for ${key}`).toBe(true);
        }
      }
    }
  });

  it('keys tier-1 visuals on the territory type so barracks/stable renders are never unused', () => {
    const battlefield = getBattlefield('crown_cross');
    const byId = Object.fromEntries(battlefield.territories.map((t) => [t.id, t]));
    expect(resolveTerritoryTextureKey({ ...byId.p_base, owner: 'player' })).toBe('citadel_player');
    expect(resolveTerritoryTextureKey({ ...byId.p_base, owner: 'enemy' })).toBe('citadel_enemy');
    expect(resolveTerritoryTextureKey({ ...byId.e_base, owner: 'enemy' })).toBe('citadel_enemy');
    expect(resolveTerritoryTextureKey({ ...byId.e_base, owner: 'player' })).toBe('citadel_player');
    expect(resolveTerritoryTextureKey({ ...byId.n_center, owner: 'neutral' })).toBe('crown_keep_neutral');
    expect(resolveTerritoryTextureKey({ ...byId.n_center, owner: 'player' })).toBe('crown_keep_player');
    // Tier-1 stables and barracks key on type (distinct visuals in dedicated
    // packs; aliased to the outpost files in the generic pack).
    expect(resolveTerritoryTextureKey({ ...byId.n_top_left, owner: 'enemy' })).toBe('stable_enemy');
    expect(resolveTerritoryTextureKey({ ...byId.n_mid_left, owner: 'neutral' })).toBe('barracks_neutral');
    // The active dedicated pack serves distinct role silhouettes.
    const sprites = listRuntimeSpritePaths('crown_cross');
    expect(sprites.stable_enemy).not.toBe(sprites.outpost_enemy);
    expect(sprites.barracks_neutral).not.toBe(sprites.outpost_neutral);
  });

  it('keeps citadel keys tied to the fortress ids and tier-2 keys to ownership across battlefields', () => {
    const twinPasses = getBattlefield('twin_passes');
    const tier2 = twinPasses.territories.find((t) => t.tier === 2 && t.id !== 'p_base' && t.id !== 'e_base');
    if (tier2) {
      expect(resolveTerritoryTextureKey({ ...tier2, owner: 'player' })).toBe('crown_keep_player');
    }
  });

  it('derives the battlefield from launch data the same way preload and create do', () => {
    expect(battlefieldIdFromLaunchData(undefined)).toBe('crown_cross');
    expect(battlefieldIdFromLaunchData({ botMatch: { battlefieldId: 'royal_ring' } })).toBe('royal_ring');
    expect(battlefieldIdFromLaunchData({ liveMatch: { state: { battlefieldId: 'twin_passes' } } })).toBe('twin_passes');
    expect(battlefieldIdFromLaunchData({ liveMatch2v2: { state: { battlefieldId: 'quad_citadel' } } })).toBe('quad_citadel');
    expect(battlefieldIdFromLaunchData({ botMatch: { battlefieldId: 'royal_ring' }, liveMatch: { state: {} } })).toBe(
      'royal_ring'
    );
    // Unknown ids fall back to the default battlefield.
    expect(battlefieldIdFromLaunchData({ botMatch: { battlefieldId: 'nope' as BattlefieldId } })).toBe('crown_cross');
  });

  it('keeps territory textures from different packs distinct in Phaser cache', () => {
    const key = 'citadel_player';
    const royal = runtimeTerritoryTextureKey('royal_ring', key);
    const crown = runtimeTerritoryTextureKey('crown_cross', key);
    const quad = runtimeTerritoryTextureKey('quad_citadel', key);
    expect(new Set([royal, crown, quad]).size).toBe(3);
    expect(runtimeTerritoryTextureKey('royal_ring', key)).toBe(royal);
    expect(runtimeTerritoryTextureKey('royal_ring', 'citadel_enemy')).not.toBe(royal);
  });

  it('keeps top citadels below the HUD while leaving hit areas unchanged', () => {
    for (const battlefieldId of DEDICATED_PACKS) {
      for (const territory of getBattlefield(battlefieldId).territories) {
        if (territory.tier !== 3 || territory.y > 150) continue;
        const art = territoryArtFootprint(battlefieldId, territory);
        expect(territory.y - art.ringRadius).toBeGreaterThanOrEqual(72);
        expect(territory.y + art.spriteY - 2 - art.spriteSize / 2).toBeGreaterThanOrEqual(70);
        expect(territoryHitAreaSize(territory.radius)).toBe(territory.radius * 2.5);
      }
    }
  });

  it('leaves air between every Quad Citadel socket without moving gameplay centers', () => {
    const territories = getBattlefield('quad_citadel').territories;
    for (let i = 0; i < territories.length; i += 1) {
      for (let j = i + 1; j < territories.length; j += 1) {
        const a = territories[i];
        const b = territories[j];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const artA = territoryArtFootprint('quad_citadel', a);
        const artB = territoryArtFootprint('quad_citadel', b);
        expect(distance - artA.socketRadius - artB.socketRadius, `${a.id}/${b.id} socket gap`).toBeGreaterThan(2);
      }
    }
  });

  it('GameScene preload has no hardcoded territory list and consumes the manifest', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../scenes/GameScene.ts'), 'utf8');
    // No hardcoded territory preload list may return.
    expect(source.includes('assets/territories/')).toBe(false);
    // Preload must derive the battlefield and load through the manifest.
    expect(source).toContain('battlefieldIdFromLaunchData(launchData)');
    expect(source).toContain('listRuntimeSpritePaths(battlefieldId)');
    expect(source).toContain('runtimeTerritoryTextureKey(battlefieldId, textureKey)');
  });

  it('ships dedicated packs only for battlefields that have them', () => {
    for (const battlefieldId of DEDICATED_PACKS) {
      expect(usesDedicatedSpritePack(battlefieldId)).toBe(true);
    }
  });

  it('selects the active dedicated pack for each dedicated battlefield', () => {
    for (const battlefieldId of DEDICATED_PACKS) {
      expect(ASSET_MANIFEST.battlefieldPacks[battlefieldId]).toBe(battlefieldId);
      const pack = ASSET_MANIFEST.packs[battlefieldId];
      expect(pack.active).toBe(true);

      const sprites = listRuntimeSpritePaths(battlefieldId);
      expect(Object.keys(sprites)).toEqual([...TERRITORY_TEXTURE_KEYS]);
      // The whole pack lives in its dedicated directory.
      for (const filePath of Object.values(sprites)) {
        expect(filePath.startsWith(`assets/territories/${battlefieldId}/`)).toBe(true);
      }
    }
  });

  it('resolves each dedicated battlefield territory roles to distinct dedicated assets with full owner variants', () => {
    for (const battlefieldId of DEDICATED_PACKS) {
      const battlefield = getBattlefield(battlefieldId);
      const sprites = listRuntimeSpritePaths(battlefieldId);

      // Bases resolve to their owner's citadel; every other territory on the
      // real layout resolves through the type/tier rules.
      for (const template of battlefield.territories) {
        if (template.id === 'p_base') {
          expect(resolveTerritoryTextureKey({ ...template, owner: 'player' })).toBe('citadel_player');
          continue;
        }
        if (template.id === 'e_base') {
          expect(resolveTerritoryTextureKey({ ...template, owner: 'enemy' })).toBe('citadel_enemy');
          continue;
        }
        for (const owner of ['player', 'enemy', 'neutral'] as const) {
          const key = resolveTerritoryTextureKey({ ...template, owner });
          expect(sprites[key], `${battlefieldId} misses ${key}`).toBeDefined();
          expect(sprites[key].startsWith(`assets/territories/${battlefieldId}/`)).toBe(true);
        }
      }

      // Every key resolves to its own dedicated file (no aliases).
      const paths = Object.values(sprites);
      expect(new Set(paths).size).toBe(paths.length);

      // Player, enemy, and neutral variants are distinct dedicated files.
      for (const prefix of ['citadel', 'crown_keep', 'outpost', 'barracks', 'stable']) {
        const keys = paths.filter((p) => p.includes(prefix));
        expect(new Set(keys).size, `${battlefieldId}: ${prefix} variants must be distinct files`).toBe(keys.length);
      }

      // Every resolvable file exists on disk.
      for (const filePath of paths) {
        expect(fs.existsSync(path.join(PUBLIC_DIR, filePath)), `missing ${filePath}`).toBe(true);
      }
    }

    // Pins the type/tier rules on real layouts (one per dedicated battlefield).
    const crownCross = Object.fromEntries(getBattlefield('crown_cross').territories.map((t) => [t.id, t]));
    expect(resolveTerritoryTextureKey({ ...crownCross.n_top_left, owner: 'enemy' })).toBe('stable_enemy');
    expect(resolveTerritoryTextureKey({ ...crownCross.n_mid_left, owner: 'neutral' })).toBe('barracks_neutral');
    const twinPasses = Object.fromEntries(getBattlefield('twin_passes').territories.map((t) => [t.id, t]));
    expect(resolveTerritoryTextureKey({ ...twinPasses.n_west_pass, owner: 'player' })).toBe('crown_keep_player');
    expect(resolveTerritoryTextureKey({ ...twinPasses.n_west_gate_s, owner: 'enemy' })).toBe('stable_enemy');
  });

  it('keeps dedicated packs byte-distinct from each other for the same texture keys', () => {
    for (let a = 0; a < DEDICATED_PACKS.length; a += 1) {
      for (let b = a + 1; b < DEDICATED_PACKS.length; b += 1) {
        const packA = DEDICATED_PACKS[a];
        const packB = DEDICATED_PACKS[b];
        for (const key of TERRITORY_TEXTURE_KEYS) {
          const fileA = fs.readFileSync(path.join(PUBLIC_DIR, listRuntimeSpritePaths(packA)[key]));
          const fileB = fs.readFileSync(path.join(PUBLIC_DIR, listRuntimeSpritePaths(packB)[key]));
          expect(fileA.equals(fileB), `${key} is byte-identical between ${packA} and ${packB}`).toBe(false);
        }
      }
    }
  });

  it('keeps the generic pack complete and safe fallbacks for unknown battlefields', () => {
    // The generic pack stays active and complete for any future battlefield.
    const generic = ASSET_MANIFEST.packs.generic;
    expect(generic.active).toBe(true);
    expect(Object.keys(generic.sprites)).toEqual([...TERRITORY_TEXTURE_KEYS]);
    for (const sprite of Object.values(generic.sprites)) {
      expect(fs.existsSync(path.join(REPO_ROOT, sprite.runtimePath)), `missing ${sprite.runtimePath}`).toBe(true);
    }
    // Unknown battlefield ids fall back to the default battlefield's pack.
    expect(battlefieldIdFromLaunchData({ botMatch: { battlefieldId: 'nope' as BattlefieldId } })).toBe('crown_cross');
  });
});

describe('Blender builder CLI (validated without Blender)', () => {
  it('accepts and reports --samples and --opaque instead of ignoring them', () => {
    const script = `${loadBuilderModule('ccbuild_args')}
args = mod.parse_args(["--pack", "crown_cross", "--samples", "32", "--opaque", "--output", "out"])
print(json.dumps({"samples": args.samples, "opaque": args.opaque, "pack": args.pack, "output": args.output}))
`;
    const result = runBuilderPython(script, MANIFEST_PATH);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.samples).toBe(32);
    expect(parsed.opaque).toBe(true);
    expect(parsed.pack).toBe('crown_cross');
    expect(parsed.output).toBe('out');

    const defaults = runBuilderPython(
      `${loadBuilderModule('ccbuild_args_default')}
args = mod.parse_args(["--pack", "crown_cross"])
print(json.dumps({"samples": args.samples, "opaque": args.opaque, "manifest": args.manifest.endswith("asset-manifest.json")}))
`,
      MANIFEST_PATH
    );
    expect(defaults.status).toBe(0);
    const parsedDefaults = JSON.parse(defaults.stdout);
    expect(parsedDefaults.samples).toBe(64);
    expect(parsedDefaults.opaque).toBe(false);
    expect(parsedDefaults.manifest).toBe(true);
  });

  it('rejects unsupported pack/asset combinations before requiring Blender (exit 2)', () => {
    const unknownAsset = runBuilderPython(
      `${loadBuilderModule('ccbuild_bad_asset')}
manifest = mod.load_asset_manifest(sys.argv[2])
try:
    mod.resolve_assets_to_render(manifest, "crown_cross", "does_not_exist")
    print("NO_ERROR")
except SystemExit as error:
    print(f"EXIT_{error.code}")
`,
      MANIFEST_PATH
    );
    expect(unknownAsset.stdout.trim()).toBe('EXIT_2');

    // main() validates the pack BEFORE require_bpy(): on machines without
    // Blender this must still exit 2 with a usage error, never an ImportError.
    const unknownPack = runBuilderPython(
      `${loadBuilderModule('ccbuild_bad_pack')}
try:
    mod.main(["--pack", "not_a_pack"])
    print("NO_ERROR")
except SystemExit as error:
    print(f"EXIT_{error.code}")
except ImportError as error:
    print(f"IMPORT_ERROR:{error}")
`,
      MANIFEST_PATH
    );
    expect(unknownPack.stdout.trim()).toBe('EXIT_2');
  });

  it('renders exactly each dedicated manifest pack: builder, owner, and render names agree', () => {
    for (const packId of DEDICATED_PACKS) {
      const result = runBuilderPython(
        `${loadBuilderModule('ccbuild_kit')}
manifest = mod.load_asset_manifest(sys.argv[2])
assets = mod.resolve_assets_to_render(manifest, ${JSON.stringify(packId)}, None)
print(json.dumps([[name, builder, owner] for name, builder, owner in assets]))
`,
        MANIFEST_PATH
      );
      expect(result.status).toBe(0);
      const resolved = JSON.parse(result.stdout) as Array<[string, string, string]>;
      const expected = Object.values(ASSET_MANIFEST.packs[packId].sprites).map((sprite) => [
        sprite.blenderRenderName,
        sprite.blenderBuilder,
        sprite.blenderOwner,
      ]);
      expect(resolved).toEqual(expected);
    }
  });
});

describe('battlefield art invariants', () => {
  it('does not change authoritative battlefield geometry', () => {
    // The authoritative source is apps/server-nakama/battlefields.json (shared
    // by server and client). This pins crown_cross coordinates/roads so the
    // visual milestone cannot drift gameplay geometry.
    const authoritative = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../../../../apps/server-nakama/battlefields.json'),
        'utf8'
      )
    ) as Array<Record<string, unknown> & { id: string; territories: unknown[]; roads: unknown }>;
    const crownCross = authoritative.find((b) => b.id === 'crown_cross');
    expect(crownCross).toBeDefined();
    if (!crownCross) return;
    const served = getBattlefield('crown_cross');

    expect(served.territories.map(({ id, name, x, y, radius, tier, type, owner, units, maxUnits, productionRate }) => ({
      id, name, x, y, radius, tier, type, owner, units, maxUnits, productionRate,
    }))).toEqual(crownCross.territories);
    expect(served.roads).toEqual(crownCross.roads);
  });

  it('keeps legacy territory hit areas (radius * 2.5) so touch targets are unchanged', () => {
    expect(territoryHitAreaSize(26)).toBe(65);
    expect(territoryHitAreaSize(27)).toBe(67.5);
    expect(territoryHitAreaSize(32)).toBe(80);
    expect(territoryHitAreaSize(36)).toBe(90);
  });

  it('places environment props clear of territories, roads, the frame and each other', () => {
    // Per-kind clearance floor (px) mirrored from scripts/generate-arena-props.mjs.
    const territoryMargin: Record<string, number> = {
      tree_birch: 44, tree_apple: 44, tree_pine: 44, pennant: 32, bush: 28, rock: 26, grass_tuft: 24,
    };
    const roadMargin: Record<string, number> = {
      tree_birch: 20, tree_apple: 20, tree_pine: 20, pennant: 14, bush: 13, rock: 13, grass_tuft: 12,
    };
    const spacing: Record<string, number> = {
      tree_birch: 42, tree_apple: 42, tree_pine: 42, pennant: 30, bush: 30, rock: 26, grass_tuft: 22,
    };
    for (const battlefield of BATTLEFIELDS) {
      const props = getArenaPropPositions(battlefield.id as BattlefieldId);
      expect(props.length, `${battlefield.id} should carry props`).toBeGreaterThan(0);
      expect(props.length, `${battlefield.id} prop count over budget`).toBeLessThanOrEqual(24);
      for (const prop of props) {
        // Inside the arena frame.
        expect(prop.x).toBeGreaterThan(24);
        expect(prop.x).toBeLessThan(376);
        expect(prop.y).toBeGreaterThan(100);
        expect(prop.y).toBeLessThan(640);
        // Trees never crowd the contested middle.
        if (prop.kind.startsWith('tree')) {
          expect(prop.x < 130 || prop.x > 270, `${prop.kind} at ${prop.x},${prop.y} must stay edge-only`).toBe(true);
        }

        for (const territory of battlefield.territories) {
          const distance = Math.hypot(prop.x - territory.x, prop.y - territory.y);
          expect(distance, `${prop.kind} at ${prop.x},${prop.y} too close to ${territory.id}`)
            .toBeGreaterThanOrEqual(territory.radius + territoryMargin[prop.kind]);
        }

        for (const [idA, idB] of battlefield.roads) {
          const a = battlefield.territories.find((t) => t.id === idA)!;
          const b = battlefield.territories.find((t) => t.id === idB)!;
          const roadDistance = distancePointToSegment(prop.x, prop.y, a.x, a.y, b.x, b.y);
          expect(roadDistance, `${prop.kind} at ${prop.x},${prop.y} too close to road ${idA}-${idB}`)
            .toBeGreaterThanOrEqual(roadMargin[prop.kind]);
        }
      }
      for (let i = 0; i < props.length; i += 1) {
        for (let j = i + 1; j < props.length; j += 1) {
          const one = props[i];
          const other = props[j];
          const required = Math.max(spacing[one.kind], spacing[other.kind]);
          const distance = Math.hypot(one.x - other.x, one.y - other.y);
          expect(distance, `${one.kind} and ${other.kind} overlap at ${one.x},${one.y}`)
            .toBeGreaterThanOrEqual(required);
        }
      }
    }
  });

  it('exposes every declared prop as a preloadable runtime sprite', () => {
    const paths = listEnvironmentPropSpritePaths();
    expect(Object.keys(paths).sort()).toEqual([...PROP_TEXTURE_KEYS].sort());
    for (const [key, filePath] of Object.entries(paths)) {
      expect(filePath.startsWith('assets/environment/'), `prop ${key} path`).toBe(true);
      expect(fs.existsSync(path.join(REPO_ROOT, 'apps/game/public', filePath)), `prop ${key} file`).toBe(true);
    }
  });

  it('creates cached procedural fallback textures and degrades gracefully without canvas support', () => {
    // Minimal DOM stub: a 2D context that records fill usage so the canvas
    // path is genuinely exercised without jsdom.
    const contexts: Array<Record<string, unknown>> = [];
    (globalThis as any).document = {
      createElement: () => {
        const context: Record<string, unknown> = { fillCount: 0 };
        for (const op of ['fillRect', 'beginPath', 'fill', 'ellipse', 'moveTo', 'lineTo', 'closePath']) {
          context[op] = op === 'fill' ? () => { context.fillCount = (context.fillCount as number) + 1; } : () => {};
        }
        context.fillStyle = '';
        contexts.push(context);
        return { width: 0, height: 0, getContext: () => context };
      },
    };

    try {
      const created = new Map();
      const registry = {
        exists: (key: string) => created.has(key),
        addCanvas: (key: string, canvas: HTMLCanvasElement) => {
          created.set(key, canvas);
        },
      };

      const key = createProceduralTerritoryFallbackTexture(registry, 'citadel_player');
      expect(key).toBe('cc_fallback_citadel_player');
      expect(created.has(key)).toBe(true);
      // The silhouette was actually painted.
      expect(contexts[0].fillCount).toBeGreaterThan(0);

      // Second call returns the cached key without recreating.
      expect(createProceduralTerritoryFallbackTexture(registry, 'citadel_player')).toBe(key);
      expect(created.size).toBe(1);
      expect(contexts).toHaveLength(1);

      // Every resolver-emittable key paints a fallback (barracks and stable
      // get their own silhouettes). Each key gets a fresh registry so the
      // fallback texture is actually generated rather than cache-hit.
      for (const textureKey of TERRITORY_TEXTURE_KEYS) {
        const created: Map<string, HTMLCanvasElement> = new Map();
        const perKeyRegistry = {
          exists: (key: string) => created.has(key),
          addCanvas: (key: string, canvas: HTMLCanvasElement) => {
            created.set(key, canvas);
          },
        };
        const context: Record<string, unknown> = { fillCount: 0 };
        for (const op of ['fillRect', 'beginPath', 'fill', 'ellipse', 'moveTo', 'lineTo', 'closePath']) {
          context[op] = op === 'fill' ? () => { context.fillCount = (context.fillCount as number) + 1; } : () => {};
        }
        (globalThis as any).document = {
          createElement: () => ({ width: 0, height: 0, getContext: () => context }),
        };
        const fallback = createProceduralTerritoryFallbackTexture(perKeyRegistry, textureKey);
        expect(fallback).toBe(`cc_fallback_${textureKey}`);
        expect(created.has(fallback)).toBe(true);
        expect(context.fillCount).toBeGreaterThan(0);
      }

      // Unknown keys are passed through untouched.
      expect(createProceduralTerritoryFallbackTexture(registry, 'not_a_texture')).toBe('not_a_texture');
      // No canvas support (texture registries without the DOM) is a no-op.
      delete (globalThis as any).document;
      expect(createProceduralTerritoryFallbackTexture(registry, 'outpost_neutral')).toBe('outpost_neutral');
    } finally {
      delete (globalThis as any).document;
    }
  });
});
