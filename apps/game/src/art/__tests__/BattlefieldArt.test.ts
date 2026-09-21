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
  getArenaAccentPositions,
  getBattlefieldRuntimeAssets,
  listRuntimeSpritePaths,
  PROCEDURAL_FALLBACK_KEYS,
  resolveTerritoryTextureKey,
  TERRITORY_TEXTURE_KEYS,
  territoryHitAreaSize,
  toPhaserAssetPath,
  usesDedicatedSpritePack,
} from '../BattlefieldArt.js';

const PUBLIC_DIR = path.resolve(__dirname, '../../../public');
const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const PY_BUILDER = path.join(REPO_ROOT, 'art/blender/build_battlefield_scene.py');
const MANIFEST_PATH = path.join(REPO_ROOT, 'art/asset-manifest.json');

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
        // Target size is a sane power-of-two-ish runtime dimension.
        expect([128, 160, 256]).toContain(sprite.targetSize);
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

  it('declares every texture key the resolver can emit, in both packs', () => {
    const expected = new Set(TERRITORY_TEXTURE_KEYS);
    for (const [packId, pack] of Object.entries(ASSET_MANIFEST.packs)) {
      expect(Object.keys(pack.sprites), `pack ${packId} must cover all resolver keys`).toEqual([...expected]);
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
        expect(image.width, `${runtimePath} width`).toBe(entry.targetSize);
        expect(image.height, `${runtimePath} height`).toBe(entry.targetSize);
        // Art Bible section 14: keep each territory sprite under 80 KB.
        expect(image.bytes, `${runtimePath} exceeds the 80KB budget`).toBeLessThan(80 * 1024);
      }
    }
  });

  it('refuses to activate a dedicated pack whose optimized files are absent', () => {
    // Dedicated packs are declared before their masters are rendered. These
    // assertions flip to hard file-existence guards the moment an `active`
    // flag is turned on, so a pack can never go live half-rendered.
    for (const packId of ['crown_cross', 'twin_passes'] as const) {
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

describe('battlefield preload through the manifest', () => {
  it('loads every battlefield through the manifest with complete owner variants', () => {
    for (const battlefield of BATTLEFIELDS) {
      const assetSet = getBattlefieldRuntimeAssets(battlefield.id);
      expect(assetSet.battlefieldId).toBe(battlefield.id);
      expect(assetSet.packId).toBe(ASSET_MANIFEST.battlefieldPacks[battlefield.id]);
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
      // Per-battlefield set budget (Art Bible section 14).
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
    expect(battlefieldIdFromLaunchData({ botMatch: { battlefieldId: 'royal_ring' }, liveMatch: { state: {} } })).toBe(
      'royal_ring'
    );
    // Unknown ids fall back to the default battlefield.
    expect(battlefieldIdFromLaunchData({ botMatch: { battlefieldId: 'nope' as BattlefieldId } })).toBe('crown_cross');
  });

  it('GameScene preload has no hardcoded territory list and consumes the manifest', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../scenes/GameScene.ts'), 'utf8');
    // No hardcoded territory preload list may return.
    expect(source.includes('assets/territories/')).toBe(false);
    // Preload must derive the battlefield and load through the manifest.
    expect(source).toContain('battlefieldIdFromLaunchData(launchData)');
    expect(source).toContain('listRuntimeSpritePaths(battlefieldId)');
  });

  it('ships dedicated packs only for battlefields that have them', () => {
    expect(usesDedicatedSpritePack('crown_cross')).toBe(true);
    expect(usesDedicatedSpritePack('twin_passes')).toBe(true);
    expect(usesDedicatedSpritePack('royal_ring')).toBe(false);
  });

  it('selects the active twin_passes dedicated pack for the twin_passes battlefield', () => {
    expect(ASSET_MANIFEST.battlefieldPacks.twin_passes).toBe('twin_passes');
    const pack = ASSET_MANIFEST.packs.twin_passes;
    expect(pack.active).toBe(true);

    const sprites = listRuntimeSpritePaths('twin_passes');
    expect(Object.keys(sprites)).toEqual([...TERRITORY_TEXTURE_KEYS]);
    // The whole pack lives in the dedicated directory.
    for (const filePath of Object.values(sprites)) {
      expect(filePath.startsWith('assets/territories/twin_passes/')).toBe(true);
    }
  });

  it('resolves twin_passes territory roles to distinct dedicated assets with full owner variants', () => {
    const battlefield = getBattlefield('twin_passes');
    const byId = Object.fromEntries(battlefield.territories.map((t) => [t.id, t]));
    const sprites = listRuntimeSpritePaths('twin_passes');

    // Roles on the real layout: tier-2 pass keeps, tier-1 stable gates.
    expect(resolveTerritoryTextureKey({ ...byId.p_base, owner: 'player' })).toBe('citadel_player');
    expect(resolveTerritoryTextureKey({ ...byId.e_base, owner: 'enemy' })).toBe('citadel_enemy');
    expect(resolveTerritoryTextureKey({ ...byId.n_west_pass, owner: 'player' })).toBe('crown_keep_player');
    expect(resolveTerritoryTextureKey({ ...byId.n_east_pass, owner: 'neutral' })).toBe('crown_keep_neutral');
    expect(resolveTerritoryTextureKey({ ...byId.n_west_gate_s, owner: 'enemy' })).toBe('stable_enemy');
    expect(resolveTerritoryTextureKey({ ...byId.n_east_gate_n, owner: 'neutral' })).toBe('stable_neutral');

    // Every key resolves to its own dedicated file (no aliases).
    const paths = Object.values(sprites);
    expect(new Set(paths).size).toBe(paths.length);

    // Player, enemy, and neutral variants are distinct dedicated files.
    for (const prefix of ['citadel', 'crown_keep', 'outpost', 'barracks', 'stable']) {
      const keys = paths.filter((p) => p.includes(prefix));
      expect(new Set(keys).size, `${prefix} variants must be distinct files`).toBe(keys.length);
    }

    // Every resolvable file exists on disk.
    for (const filePath of paths) {
      expect(fs.existsSync(path.join(PUBLIC_DIR, filePath)), `missing ${filePath}`).toBe(true);
    }
  });

  it('keeps dedicated packs byte-distinct from each other for the same texture keys', () => {
    for (const key of TERRITORY_TEXTURE_KEYS) {
      const crownCross = fs.readFileSync(path.join(PUBLIC_DIR, listRuntimeSpritePaths('crown_cross')[key]));
      const twinPasses = fs.readFileSync(path.join(PUBLIC_DIR, listRuntimeSpritePaths('twin_passes')[key]));
      expect(
        crownCross.equals(twinPasses),
        `${key} is byte-identical between crown_cross and twin_passes`
      ).toBe(false);
    }
  });

  it('falls back safely to the generic pack for battlefields without dedicated art', () => {
    expect(ASSET_MANIFEST.battlefieldPacks.royal_ring).toBe('generic');
    const royalRing = getBattlefieldRuntimeAssets('royal_ring');
    expect(royalRing.packId).toBe('generic');
    for (const filePath of Object.values(royalRing.sprites)) {
      expect(fs.existsSync(path.join(PUBLIC_DIR, filePath)), `missing generic sprite ${filePath}`).toBe(true);
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
    for (const packId of ['crown_cross', 'twin_passes'] as const) {
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

  it('places decorative accents clear of territories, roads, and the arena frame', () => {
    for (const battlefield of BATTLEFIELDS) {
      const accents = getArenaAccentPositions(battlefield.id as BattlefieldId);
      for (const accent of accents) {
        // Inside the arena frame (8px inset, Art Bible layout).
        expect(accent.x).toBeGreaterThan(24);
        expect(accent.x).toBeLessThan(376);
        expect(accent.y).toBeGreaterThan(100);
        expect(accent.y).toBeLessThan(640);

        for (const territory of battlefield.territories) {
          const distance = Math.hypot(accent.x - territory.x, accent.y - territory.y);
          expect(distance, `${accent.kind} at ${accent.x},${accent.y} too close to ${territory.id}`)
            .toBeGreaterThanOrEqual(territory.radius + 16);
        }

        for (const [idA, idB] of battlefield.roads) {
          const a = battlefield.territories.find((t) => t.id === idA)!;
          const b = battlefield.territories.find((t) => t.id === idB)!;
          const roadDistance = distancePointToSegment(accent.x, accent.y, a.x, a.y, b.x, b.y);
          expect(roadDistance, `${accent.kind} at ${accent.x},${accent.y} too close to road ${idA}-${idB}`)
            .toBeGreaterThanOrEqual(14);
        }
      }
      // Art Bible section 12: at most 8 accents per battlefield.
      expect(accents.length).toBeLessThanOrEqual(8);
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
