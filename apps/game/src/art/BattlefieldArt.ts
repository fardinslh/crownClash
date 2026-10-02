import type { BattlefieldId, Territory } from '@crown-clash/game-core';
import { normalizeBattlefieldId } from '@crown-clash/game-core';
import { THEME } from '../theme.js';
import rawAssetManifest from '../../../../art/asset-manifest.json' with { type: 'json' };

/**
 * Battlefield presentation layer (Art Bible sections 10-15).
 *
 * The canonical runtime asset manifest is `art/asset-manifest.json` (imported
 * below). It is the single source of truth shared by:
 *  - GameScene preload (which loads exactly the active pack's sprite paths);
 *  - the Blender scene builder (which renders each pack's blenderRenderName);
 *  - the optimizer (which maps masters to runtime filenames/sizes/format);
 *  - the art tests (which enforce file existence, dimensions, and budgets).
 *
 * This module also owns:
 *  - the texture-key resolver (which keys GameScene may emit per territory);
 *  - which texture keys have a procedural fallback if a file fails to load;
 *  - restrained per-battlefield arena accents (static, non-interactive, and
 *    provably clear of territories, roads, and touch targets).
 *
 * Territory geometry always comes from the authoritative battlefield data in
 * `apps/server-nakama/battlefields.json`; nothing in this module moves or
 * resizes gameplay objects.
 */

export type TerritoryTextureKey =
  | 'citadel_player'
  | 'citadel_enemy'
  | 'crown_keep_player'
  | 'crown_keep_enemy'
  | 'crown_keep_neutral'
  | 'outpost_player'
  | 'outpost_enemy'
  | 'outpost_neutral'
  | 'barracks_player'
  | 'barracks_enemy'
  | 'barracks_neutral'
  | 'stable_player'
  | 'stable_enemy'
  | 'stable_neutral';

/** Sprite kinds of the shared environment prop pack (all battlefields). */
export type PropTextureKey =
  | 'tree_birch'
  | 'tree_apple'
  | 'tree_pine'
  | 'bush'
  | 'grass_tuft'
  | 'rock'
  | 'pennant';

export const PROP_TEXTURE_KEYS: readonly PropTextureKey[] = Object.freeze([
  'tree_birch',
  'tree_apple',
  'tree_pine',
  'bush',
  'grass_tuft',
  'rock',
  'pennant',
]);

/** Sprite keys of the rendered ground-plate pack: one per battlefield id. */
export const GROUND_TEXTURE_KEYS: readonly BattlefieldId[] = Object.freeze([
  'crown_cross',
  'twin_passes',
  'royal_ring',
  'quad_citadel',
]);

/** Repo-relative prefix under which Phaser serves static assets. */
const PUBLIC_ROOT_PREFIX = 'apps/game/public/';

export interface RuntimeSpriteManifestEntry {
  /** Name of the 512x512 PNG master rendered by the Blender scene builder. */
  readonly blenderRenderName: string;
  /** Builder function inside art/blender/build_battlefield_scene.py. */
  readonly blenderBuilder: string;
  readonly blenderOwner: 'player' | 'enemy' | 'neutral';
  readonly runtimeFilename: string;
  readonly targetSize: number;
  /**
   * Non-square runtime dimensions (ground plates); when present they override
   * the square targetSize in the optimizer and the runtime file must match.
   */
  readonly targetWidth?: number;
  readonly targetHeight?: number;
  /** Repo-relative path of the optimized runtime file GameScene loads. */
  readonly runtimePath: string;
  /** Set when this key deliberately reuses another key's runtime file. */
  readonly aliasOf?: string;
}

export interface RuntimeSpritePackManifest {
  readonly label: string;
  /** Repo-relative directory holding the pack's runtime files. */
  readonly packDirectory: string;
  readonly runtimeFormat: 'png' | 'webp';
  /** False while the pack's runtime files have not been rendered yet. */
  readonly active: boolean;
  /**
   * 'territory' (default) packs carry building sprites; 'prop' packs carry
   * environment props; 'ground' packs carry the full-field ground plates.
   */
  readonly spriteKind: 'territory' | 'prop' | 'ground';
  readonly sprites: Readonly<Record<string, RuntimeSpriteManifestEntry>>;
}

export interface AssetManifest {
  readonly version: number;
  readonly masterFormat: string;
  readonly masterResolution: number;
  readonly packs: Readonly<Record<string, RuntimeSpritePackManifest>>;
  readonly battlefieldPacks: Readonly<Record<string, string>>;
}

/** The complete set of texture keys the resolver can emit. */
const RESOLVER_TEXTURE_KEYS: readonly TerritoryTextureKey[] = Object.freeze([
  'citadel_player',
  'citadel_enemy',
  'crown_keep_player',
  'crown_keep_enemy',
  'crown_keep_neutral',
  'outpost_player',
  'outpost_enemy',
  'outpost_neutral',
  'barracks_player',
  'barracks_enemy',
  'barracks_neutral',
  'stable_player',
  'stable_enemy',
  'stable_neutral',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function fail(message: string): never {
  throw new Error(`asset-manifest.json: ${message}`);
}

/**
 * Runtime-validates the raw manifest import so a malformed manifest fails at
 * module load (and in every test run) instead of producing broken preload
 * paths at runtime.
 */
export function parseAssetManifest(raw: unknown): AssetManifest {
  if (!isRecord(raw)) fail('manifest root must be an object');
  const { version, masterFormat, masterResolution, packs, battlefieldPacks } = raw;
  if (typeof version !== 'number') fail('version must be a number');
  if (typeof masterFormat !== 'string') fail('masterFormat must be a string');
  if (typeof masterResolution !== 'number') fail('masterResolution must be a number');
  if (!isRecord(packs) || Object.keys(packs).length === 0) fail('packs must be a non-empty object');
  if (!isRecord(battlefieldPacks) || Object.keys(battlefieldPacks).length === 0) {
    fail('battlefieldPacks must be a non-empty object');
  }

  const parsedPacks: Record<string, RuntimeSpritePackManifest> = {};
  for (const [packId, rawPack] of Object.entries(packs)) {
    if (!isRecord(rawPack)) fail(`pack ${packId} must be an object`);
    const { label, packDirectory, runtimeFormat, active, spriteKind, sprites } = rawPack;
    if (typeof packDirectory !== 'string' || packDirectory.length === 0) {
      fail(`pack ${packId} packDirectory must be a non-empty string`);
    }
    if (runtimeFormat !== 'png' && runtimeFormat !== 'webp') {
      fail(`pack ${packId} runtimeFormat must be "png" or "webp"`);
    }
    if (typeof active !== 'boolean') fail(`pack ${packId} active must be a boolean`);
    if (
      spriteKind !== undefined &&
      spriteKind !== 'territory' &&
      spriteKind !== 'prop' &&
      spriteKind !== 'ground'
    ) {
      fail(`pack ${packId} spriteKind must be "territory", "prop", or "ground"`);
    }
    const kind = spriteKind === 'prop' ? 'prop' : spriteKind === 'ground' ? 'ground' : 'territory';
    const allowedKeys =
      kind === 'prop' ? PROP_TEXTURE_KEYS : kind === 'ground' ? GROUND_TEXTURE_KEYS : RESOLVER_TEXTURE_KEYS;
    if (!isRecord(sprites) || Object.keys(sprites).length === 0) {
      fail(`pack ${packId} sprites must be a non-empty object`);
    }

    const parsedSprites: Record<string, RuntimeSpriteManifestEntry> = {};
    for (const [textureKey, rawSprite] of Object.entries(sprites)) {
      if (!(allowedKeys as readonly string[]).includes(textureKey)) {
        fail(`pack ${packId} declares unknown ${kind} texture key ${textureKey}`);
      }
      if (!isRecord(rawSprite)) fail(`pack ${packId} sprite ${textureKey} must be an object`);
      const { blenderRenderName, blenderBuilder, blenderOwner, runtimeFilename, targetSize, targetWidth, targetHeight, runtimePath, aliasOf } =
        rawSprite;
      if (typeof blenderRenderName !== 'string' || blenderRenderName.length === 0) {
        fail(`pack ${packId}/${textureKey} blenderRenderName must be a non-empty string`);
      }
      if (typeof blenderBuilder !== 'string' || blenderBuilder.length === 0) {
        fail(`pack ${packId}/${textureKey} blenderBuilder must be a non-empty string`);
      }
      if (blenderOwner !== 'player' && blenderOwner !== 'enemy' && blenderOwner !== 'neutral') {
        fail(`pack ${packId}/${textureKey} blenderOwner must be player, enemy, or neutral`);
      }
      if (typeof runtimeFilename !== 'string' || !runtimeFilename.toLowerCase().endsWith(`.${runtimeFormat}`)) {
        fail(`pack ${packId}/${textureKey} runtimeFilename must end with .${runtimeFormat}`);
      }
      if (typeof targetSize !== 'number' || !Number.isInteger(targetSize) || targetSize <= 0) {
        fail(`pack ${packId}/${textureKey} targetSize must be a positive integer`);
      }
      if (targetWidth !== undefined && (typeof targetWidth !== 'number' || !Number.isInteger(targetWidth) || targetWidth <= 0)) {
        fail(`pack ${packId}/${textureKey} targetWidth must be a positive integer when present`);
      }
      if (targetHeight !== undefined && (typeof targetHeight !== 'number' || !Number.isInteger(targetHeight) || targetHeight <= 0)) {
        fail(`pack ${packId}/${textureKey} targetHeight must be a positive integer when present`);
      }
      if (typeof runtimePath !== 'string' || runtimePath !== `${packDirectory}/${runtimeFilename}`) {
        fail(`pack ${packId}/${textureKey} runtimePath must equal packDirectory/runtimeFilename`);
      }
      if (aliasOf !== undefined && typeof aliasOf !== 'string') {
        fail(`pack ${packId}/${textureKey} aliasOf must be a string when present`);
      }
      parsedSprites[textureKey] = {
        blenderRenderName,
        blenderBuilder,
        blenderOwner,
        runtimeFilename,
        targetSize,
        ...(targetWidth === undefined ? {} : { targetWidth }),
        ...(targetHeight === undefined ? {} : { targetHeight }),
        runtimePath,
        ...(aliasOf === undefined ? {} : { aliasOf }),
      };
    }
    parsedPacks[packId] = {
      label: typeof label === 'string' ? label : packId,
      packDirectory,
      runtimeFormat,
      active,
      spriteKind: kind,
      sprites: parsedSprites,
    };
  }
  return {
    version,
    masterFormat,
    masterResolution,
    packs: parsedPacks,
    battlefieldPacks: battlefieldPacks as Record<string, string>,
  };
}

/** Canonical runtime asset manifest (validated at module load). */
export const ASSET_MANIFEST: AssetManifest = Object.freeze(parseAssetManifest(rawAssetManifest));

/** Repo-relative master directory for a pack's Blender render name (informational). */
export function blenderMasterPath(packId: string, entry: RuntimeSpriteManifestEntry): string {
  return `art/blender/renders/${packId}/${entry.blenderRenderName}.${ASSET_MANIFEST.masterFormat}`;
}

export interface BattlefieldRuntimeAssetSet {
  readonly battlefieldId: BattlefieldId;
  /** Pack id backing this battlefield. */
  readonly packId: string;
  /** Directory under apps/game/public/ holding the battlefield's sprite pack. */
  readonly spriteDirectory: string;
  /** Texture key -> public-relative file path loaded by Phaser's loader. */
  readonly sprites: Readonly<Record<string, string>>;
}

/** Public-relative Phaser path for a manifest runtime path. */
export function toPhaserAssetPath(runtimePath: string): string {
  if (!runtimePath.startsWith(PUBLIC_ROOT_PREFIX)) {
    fail(`runtime path ${runtimePath} must live under ${PUBLIC_ROOT_PREFIX}`);
  }
  return runtimePath.slice(PUBLIC_ROOT_PREFIX.length);
}

/**
 * Resolves the battlefield's active sprite pack through the manifest. Every
 * battlefield maps to a pack id; battlefields without dedicated art share the
 * generic legacy pack.
 */
export function getBattlefieldRuntimeAssets(battlefieldId: BattlefieldId): BattlefieldRuntimeAssetSet {
  const packId = ASSET_MANIFEST.battlefieldPacks[battlefieldId] ?? 'generic';
  const pack = ASSET_MANIFEST.packs[packId];
  if (!pack) fail(`battlefield ${battlefieldId} references unknown pack ${packId}`);
  const sprites: Record<string, string> = {};
  for (const [textureKey, entry] of Object.entries(pack.sprites)) {
    sprites[textureKey] = toPhaserAssetPath(entry.runtimePath);
  }
  return Object.freeze({
    battlefieldId,
    packId,
    spriteDirectory: pack.packDirectory,
    sprites: Object.freeze(sprites),
  });
}

/**
 * Preload list for a battlefield: every texture key the resolver can emit for
 * that battlefield's territories, mapped to its active pack's file paths.
 * Loading all owner variants up front guarantees capture-driven swaps never
 * reference an unloaded texture.
 */
export function listRuntimeSpritePaths(battlefieldId: BattlefieldId): Readonly<Record<string, string>> {
  return getBattlefieldRuntimeAssets(battlefieldId).sprites;
}

/** Phaser's texture cache survives scene changes, so pack keys must not collide. */
export function runtimeTerritoryTextureKey(battlefieldId: BattlefieldId, textureKey: string): string {
  return `cc_${getBattlefieldRuntimeAssets(battlefieldId).packId}_${textureKey}`;
}

/** True when a battlefield's active pack is a dedicated per-battlefield pack. */
export function usesDedicatedSpritePack(battlefieldId: BattlefieldId): boolean {
  const packId = ASSET_MANIFEST.battlefieldPacks[battlefieldId] ?? 'generic';
  return packId !== 'generic' && ASSET_MANIFEST.packs[packId]?.active === true;
}

/** Launch data shape GameScene receives via Phaser scene settings. */
export interface SceneLaunchData {
  botMatch?: { battlefieldId?: BattlefieldId };
  liveMatch?: { state?: { battlefieldId?: BattlefieldId } };
  liveMatch2v2?: { state?: { battlefieldId?: BattlefieldId } };
}

/**
 * Derives the battlefield id from scene launch data. Usable from preload()
 * (which runs before create()), and mirrors GameScene.create()'s derivation:
 * bot matches key off the server ticket, live matches off the authoritative
 * initial state, and anything unknown falls back to the default battlefield.
 */
export function battlefieldIdFromLaunchData(launchData: SceneLaunchData | undefined): BattlefieldId {
  return normalizeBattlefieldId(
    launchData?.botMatch?.battlefieldId ??
      launchData?.liveMatch2v2?.state?.battlefieldId ??
      launchData?.liveMatch?.state?.battlefieldId
  );
}

export const TERRITORY_TEXTURE_KEYS: readonly string[] = RESOLVER_TEXTURE_KEYS;

/** Every key the resolver can emit has a procedural fallback (never a broken sprite). */
export const PROCEDURAL_FALLBACK_KEYS: ReadonlySet<string> = new Set(RESOLVER_TEXTURE_KEYS);

/** Phaser container interactive size for a territory (unchanged legacy hit area). */
export function territoryHitAreaSize(radius: number): number {
  return radius * 2.5;
}

/** Presentation-only dimensions. Territory coordinates, radii and hit areas never change. */
export function territoryArtFootprint(battlefieldId: BattlefieldId, territory: Territory): {
  socketRadius: number;
  plateRadius: number;
  ringRadius: number;
  shadowWidth: number;
  shadowHeight: number;
  spriteSize: number;
  spriteY: number;
  badgeY: number;
  sharedCueX: number;
  sharedCueY: number;
  roleIconX: number;
  roleIconY: number;
} {
  const quad = battlefieldId === 'quad_citadel';
  const crown = battlefieldId === 'crown_cross';
  const topCitadel = territory.type === 'fortress' && territory.tier === 3 && territory.y <= 150;
  // Quad Citadel's base/corner centers are only sqrt(3400) px apart. These
  // radii leave visible air between their sockets without altering geometry.
  // Every other battlefield keeps a compact +5 socket: the ownership ring
  // and the baked plinth stay one readable step inside the hit area while
  // adjacent platforms get real air between them (radius+10 left the flank
  // columns nearly touching at phone size).
  const socketRadius = quad
    ? territory.tier === 3 ? 29 : territory.tier === 2 ? 36 : 23
    : topCitadel ? 32 : territory.radius + 5;
  const badgeY = quad
    ? territory.tier === 3 ? topCitadel ? 13 : 18 : territory.tier === 2 ? 18 : 14
    : territory.tier === 3 ? 25 : territory.tier === 2 ? 21 : 17;
  return {
    socketRadius,
    plateRadius: socketRadius - 3,
    ringRadius: socketRadius,
    shadowWidth: socketRadius * 2,
    shadowHeight: socketRadius * 0.75,
    // Building sprites: sized for presence but compact enough that adjacent
    // fortresses keep clear air between their silhouettes on every phone —
    // the board layout scales together at every viewport, so the separation
    // reads identically from 360px to 430px wide screens.
    spriteSize: crown ? topCitadel ? 72 : territory.tier === 3 ? 86 : territory.tier === 2 ? 76 : 64 : quad
      ? territory.tier === 3 ? 58 : territory.tier === 2 ? 68 : 44
      : topCitadel ? 74 : territory.tier === 3 ? 92 : territory.tier === 2 ? 80 : 64,
    spriteY: crown ? topCitadel ? 2 : -15 : topCitadel ? 6 : quad ? -5 : -8,
    badgeY,
    sharedCueX: territory.x < 200 ? -33 : 33,
    sharedCueY: badgeY,
    roleIconX: quad && territory.tier === 3 ? territory.x < 200 ? 33 : -33 : 0,
    roleIconY: quad && territory.tier === 3 ? badgeY : badgeY + 21,
  };
}

/**
 * Resolves the sprite texture key for a territory. Ownership is the loudest
 * signal: citadels use their owner's texture and everything else keys on the
 * current owner so captures repaint instantly. Tier-2 territories always use
 * the stronghold silhouette; tier-1 keys on the territory type so barracks,
 * stables, and fortresses stay visually distinct.
 */
export function resolveTerritoryTextureKey(territory: Territory): string {
  if (territory.id === 'p_base') {
    return territory.owner === 'player' ? 'citadel_player' : 'citadel_enemy';
  }
  if (territory.id === 'e_base') {
    return territory.owner === 'enemy' ? 'citadel_enemy' : 'citadel_player';
  }
  if (territory.tier >= 2) {
    return `crown_keep_${territory.owner}`;
  }
  if (territory.type === 'barracks') {
    return `barracks_${territory.owner}`;
  }
  if (territory.type === 'stable') {
    return `stable_${territory.owner}`;
  }
  return `outpost_${territory.owner}`;
}

interface TextureRegistry {
  exists(key: string): boolean;
  addCanvas(key: string, canvas: HTMLCanvasElement): unknown;
}

/**
 * Creates a minimal stylized fallback texture for a territory sprite key when
 * its file failed to load: chunky tier silhouette in the owner's color with a
 * soft top-left key-light edge (Art Bible lighting). Returns the registry key
 * to use (the original key when no canvas support exists, so callers degrade
 * gracefully instead of throwing).
 */
export function createProceduralTerritoryFallbackTexture(
  textures: TextureRegistry | undefined,
  textureKey: string
): string {
  if (!textures || typeof textures.exists !== 'function' || typeof textures.addCanvas !== 'function') {
    return textureKey;
  }
  const fallbackKey = `cc_fallback_${textureKey}`;
  if (textures.exists(fallbackKey) || textures.exists(textureKey)) {
    return textures.exists(textureKey) ? textureKey : fallbackKey;
  }
  if (!PROCEDURAL_FALLBACK_KEYS.has(textureKey)) {
    return textureKey;
  }
  if (typeof document === 'undefined' || !document.createElement) {
    return textureKey;
  }

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  // Fail soft when a canvas/context stub lacks the drawing API: degrade to
  // the plain key instead of breaking scene creation.
  if (!ctx || typeof ctx.fillRect !== 'function' || typeof ctx.beginPath !== 'function') {
    return textureKey;
  }

  const owner = textureKey.endsWith('player') ? 'player' : textureKey.endsWith('enemy') ? 'enemy' : 'neutral';
  const isCitadel = textureKey.startsWith('citadel');
  const isKeep = textureKey.startsWith('crown_keep');
  const isBarracks = textureKey.startsWith('barracks');
  const isStable = textureKey.startsWith('stable');
  const team = THEME.teams[owner as 'player' | 'enemy' | 'neutral'];

  // Contact shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.beginPath();
  ctx.ellipse(64, 112, 44, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Chunky silhouette: citadel (wide keep + turrets), keep (octagon),
  // barracks (hall + roof slab), stable (long low hall), outpost (tower)
  ctx.fillStyle = `#${team.dark.toString(16).padStart(8, '0').slice(2)}`;
  if (isCitadel) {
    ctx.fillRect(24, 40, 80, 72);
    ctx.fillRect(16, 52, 16, 60);
    ctx.fillRect(96, 52, 16, 60);
  } else if (isKeep) {
    ctx.beginPath();
    ctx.moveTo(28, 112);
    ctx.lineTo(28, 60);
    ctx.lineTo(64, 36);
    ctx.lineTo(100, 60);
    ctx.lineTo(100, 112);
    ctx.closePath();
    ctx.fill();
  } else if (isBarracks) {
    ctx.fillRect(18, 58, 92, 54);
  } else if (isStable) {
    ctx.fillRect(14, 72, 100, 40);
  } else {
    ctx.fillRect(48, 44, 32, 68);
  }

  // Body in team primary + top-left key-light edge
  ctx.fillStyle = `#${team.primary.toString(16).padStart(8, '0').slice(2)}`;
  if (isCitadel) ctx.fillRect(30, 46, 68, 64);
  else if (isKeep) ctx.fillRect(34, 62, 62, 48);
  else if (isBarracks) ctx.fillRect(24, 66, 80, 44);
  else if (isStable) ctx.fillRect(20, 78, 88, 32);
  else ctx.fillRect(52, 50, 24, 60);
  ctx.fillStyle = 'rgba(255, 245, 230, 0.55)'; // warm champagne key light
  if (isCitadel) ctx.fillRect(30, 46, 12, 64);
  else if (isKeep) ctx.fillRect(34, 62, 10, 48);
  else if (isBarracks) ctx.fillRect(24, 66, 10, 44);
  else if (isStable) ctx.fillRect(20, 78, 8, 32);
  else ctx.fillRect(52, 50, 8, 60);

  textures.addCanvas(fallbackKey, canvas);
  return fallbackKey;
}

// ---------------------------------------------------------------------------
// Arena props: rendered flora, stones and pennants (semi-realistic direction)
// ---------------------------------------------------------------------------

export type ArenaPropKind = PropTextureKey;

export interface ArenaProp {
  readonly x: number;
  readonly y: number;
  readonly kind: ArenaPropKind;
}

/** Display height (logical px) and blend alpha per prop kind (bottom-anchored). */
export const ARENA_PROP_DISPLAY: Readonly<
  Record<ArenaPropKind, { readonly height: number; readonly alpha: number }>
> = Object.freeze({
  tree_birch: { height: 104, alpha: 1 },
  tree_apple: { height: 100, alpha: 1 },
  tree_pine: { height: 100, alpha: 1 },
  bush: { height: 44, alpha: 1 },
  grass_tuft: { height: 34, alpha: 0.9 },
  rock: { height: 32, alpha: 1 },
  pennant: { height: 64, alpha: 0.95 },
});

/**
 * Static environment prop placements per battlefield: birch and apple groves
 * for Crown Cross, pine and rock for Twin Passes, orchard bushes for Royal
 * Ring, dry scrub for Quad Citadel. Generated by
 * scripts/generate-arena-props.mjs against the authoritative battlefield
 * geometry and re-validated by BattlefieldArt.test.ts: every prop stays clear
 * of territory sockets, roads and the arena frame, and trees are edge-only so
 * they never crowd the contested middle.
 */
export function getArenaPropPositions(battlefieldId: BattlefieldId): readonly ArenaProp[] {
    if (battlefieldId === 'crown_cross') {
      return Object.freeze([
        { x: 42, y: 158, kind: 'tree_birch' },
        { x: 283, y: 319, kind: 'bush' },
        { x: 94, y: 539, kind: 'grass_tuft' },
        { x: 298, y: 616, kind: 'grass_tuft' },
        { x: 295, y: 160, kind: 'tree_apple' },
        { x: 183, y: 445, kind: 'rock' },
        { x: 219, y: 422, kind: 'grass_tuft' },
        { x: 147, y: 518, kind: 'pennant' },
        { x: 149, y: 242, kind: 'bush' },
        { x: 354, y: 566, kind: 'tree_birch' },
        { x: 140, y: 133, kind: 'grass_tuft' },
        { x: 365, y: 610, kind: 'tree_apple' },
        { x: 65, y: 412, kind: 'grass_tuft' },
        { x: 232, y: 455, kind: 'rock' },
        { x: 182, y: 203, kind: 'pennant' },
        { x: 246, y: 195, kind: 'bush' },
        { x: 182, y: 473, kind: 'grass_tuft' },
        { x: 105, y: 628, kind: 'tree_birch' },
        { x: 122, y: 554, kind: 'grass_tuft' },
        { x: 58, y: 562, kind: 'tree_apple' },
        { x: 252, y: 473, kind: 'rock' },
        { x: 178, y: 274, kind: 'bush' },
        { x: 106, y: 285, kind: 'grass_tuft' },
        { x: 126, y: 168, kind: 'grass_tuft' },
      ] as readonly ArenaProp[]);
    }
    if (battlefieldId === 'twin_passes') {
      return Object.freeze([
        { x: 79, y: 602, kind: 'tree_pine' },
        { x: 289, y: 287, kind: 'rock' },
        { x: 36, y: 285, kind: 'grass_tuft' },
        { x: 179, y: 386, kind: 'bush' },
        { x: 273, y: 148, kind: 'tree_pine' },
        { x: 322, y: 293, kind: 'grass_tuft' },
        { x: 276, y: 429, kind: 'grass_tuft' },
        { x: 184, y: 197, kind: 'pennant' },
        { x: 197, y: 545, kind: 'rock' },
        { x: 58, y: 157, kind: 'tree_pine' },
        { x: 207, y: 176, kind: 'bush' },
        { x: 217, y: 518, kind: 'grass_tuft' },
        { x: 365, y: 430, kind: 'tree_pine' },
        { x: 359, y: 242, kind: 'grass_tuft' },
        { x: 155, y: 430, kind: 'pennant' },
        { x: 49, y: 458, kind: 'rock' },
        { x: 43, y: 220, kind: 'bush' },
        { x: 170, y: 322, kind: 'grass_tuft' },
        { x: 204, y: 485, kind: 'bush' },
        { x: 351, y: 555, kind: 'tree_pine' },
        { x: 147, y: 338, kind: 'grass_tuft' },
        { x: 247, y: 437, kind: 'grass_tuft' },
      ] as readonly ArenaProp[]);
    }
    if (battlefieldId === 'royal_ring') {
      return Object.freeze([
        { x: 128, y: 337, kind: 'tree_apple' },
        { x: 163, y: 427, kind: 'bush' },
        { x: 340, y: 151, kind: 'grass_tuft' },
        { x: 217, y: 518, kind: 'grass_tuft' },
        { x: 45, y: 214, kind: 'bush' },
        { x: 44, y: 602, kind: 'pennant' },
        { x: 227, y: 374, kind: 'grass_tuft' },
        { x: 364, y: 233, kind: 'tree_apple' },
        { x: 238, y: 418, kind: 'bush' },
        { x: 192, y: 194, kind: 'pennant' },
        { x: 368, y: 346, kind: 'rock' },
        { x: 260, y: 115, kind: 'grass_tuft' },
        { x: 150, y: 394, kind: 'bush' },
        { x: 308, y: 598, kind: 'tree_apple' },
        { x: 113, y: 265, kind: 'grass_tuft' },
        { x: 113, y: 400, kind: 'grass_tuft' },
        { x: 158, y: 301, kind: 'pennant' },
        { x: 234, y: 269, kind: 'bush' },
        { x: 200, y: 376, kind: 'grass_tuft' },
        { x: 184, y: 332, kind: 'rock' },
        { x: 193, y: 256, kind: 'grass_tuft' },
        { x: 340, y: 511, kind: 'grass_tuft' },
      ] as readonly ArenaProp[]);
    }
    if (battlefieldId === 'quad_citadel') {
      return Object.freeze([
        { x: 282, y: 302, kind: 'grass_tuft' },
        { x: 46, y: 276, kind: 'bush' },
        { x: 340, y: 376, kind: 'rock' },
        { x: 50, y: 340, kind: 'tree_pine' },
        { x: 65, y: 457, kind: 'grass_tuft' },
        { x: 352, y: 257, kind: 'grass_tuft' },
        { x: 155, y: 205, kind: 'rock' },
        { x: 359, y: 332, kind: 'pennant' },
        { x: 37, y: 437, kind: 'bush' },
        { x: 182, y: 293, kind: 'grass_tuft' },
        { x: 284, y: 386, kind: 'tree_pine' },
        { x: 184, y: 197, kind: 'rock' },
        { x: 130, y: 421, kind: 'grass_tuft' },
        { x: 210, y: 448, kind: 'grass_tuft' },
        { x: 344, y: 485, kind: 'bush' },
        { x: 231, y: 528, kind: 'grass_tuft' },
        { x: 122, y: 329, kind: 'tree_pine' },
        { x: 184, y: 152, kind: 'grass_tuft' },
        { x: 65, y: 412, kind: 'rock' },
        { x: 360, y: 394, kind: 'grass_tuft' },
        { x: 233, y: 202, kind: 'bush' },
        { x: 205, y: 277, kind: 'grass_tuft' },
        { x: 340, y: 286, kind: 'grass_tuft' },
      ] as readonly ArenaProp[]);
    }
  return [];
}

/** Texture key for a prop sprite (pack-shared, so a fixed prefix is safe). */
export function arenaPropTextureKey(kind: ArenaPropKind): string {
  return `cc_prop_${kind}`;
}

/** Preload paths for every environment prop sprite (shared across battlefields). */
export function listEnvironmentPropSpritePaths(): Readonly<Record<PropTextureKey, string>> {
  for (const pack of Object.values(ASSET_MANIFEST.packs)) {
    if (pack.spriteKind === 'prop' && pack.active) {
      const sprites: Record<string, string> = {};
      for (const [textureKey, entry] of Object.entries(pack.sprites)) {
        sprites[textureKey] = toPhaserAssetPath(entry.runtimePath);
      }
      return Object.freeze(sprites);
    }
  }
  // No active prop pack: preload nothing (the prop layer renders no images).
  return Object.freeze({} as Record<PropTextureKey, string>);
}

/** A battlefield's rendered ground plate, if the ground pack is active. */
export interface ArenaGroundSprite {
  /** Phaser texture key (namespaced per pack, like the territory keys). */
  readonly textureKey: string;
  /** Public-relative path for Phaser's loader. */
  readonly path: string;
}

/**
 * Resolves the battlefield's rendered full-field ground plate from the shared
 * `grounds` pack. Returns null when the pack is inactive so GameScene falls
 * back to the flat vector ground; unknown battlefield ids fall back to the
 * default battlefield's plate.
 */
export function getArenaGroundSprite(battlefieldId: BattlefieldId): ArenaGroundSprite | null {
  const id = normalizeBattlefieldId(battlefieldId);
  const pack = ASSET_MANIFEST.packs['grounds'];
  if (!pack || pack.spriteKind !== 'ground' || !pack.active) return null;
  const entry = pack.sprites[id];
  if (!entry) return null;
  return {
    textureKey: `cc_ground_${id}`,
    path: toPhaserAssetPath(entry.runtimePath),
  };
}

/**
 * Draws one soft key-light crescent at the top-left of a ground socket
 * (Art Bible section 13: single-pass edge highlight, no stacked strokes).
 */
export function drawSocketRimLight(
  graphics: {
    fillStyle(color: number, alpha?: number): unknown;
    fillCircle(x: number, y: number, radius: number): unknown;
  },
  socketX: number,
  socketY: number,
  socketRadius: number
): void {
  // Small warm circle peeking past the socket's top-left edge, then the
  // socket color re-covers the inner half: reads as a lit rim, zero extra
  // display objects.
  graphics.fillStyle(0xfff5e6, 0.16);
  graphics.fillCircle(socketX - socketRadius * 0.55, socketY - socketRadius * 0.55, socketRadius * 0.32);
}
