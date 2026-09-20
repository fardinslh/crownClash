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
    const { label, packDirectory, runtimeFormat, active, sprites } = rawPack;
    if (typeof packDirectory !== 'string' || packDirectory.length === 0) {
      fail(`pack ${packId} packDirectory must be a non-empty string`);
    }
    if (runtimeFormat !== 'png' && runtimeFormat !== 'webp') {
      fail(`pack ${packId} runtimeFormat must be "png" or "webp"`);
    }
    if (typeof active !== 'boolean') fail(`pack ${packId} active must be a boolean`);
    if (!isRecord(sprites) || Object.keys(sprites).length === 0) {
      fail(`pack ${packId} sprites must be a non-empty object`);
    }

    const parsedSprites: Record<string, RuntimeSpriteManifestEntry> = {};
    for (const [textureKey, rawSprite] of Object.entries(sprites)) {
      if (!(RESOLVER_TEXTURE_KEYS as readonly string[]).includes(textureKey)) {
        fail(`pack ${packId} declares unknown texture key ${textureKey}`);
      }
      if (!isRecord(rawSprite)) fail(`pack ${packId} sprite ${textureKey} must be an object`);
      const { blenderRenderName, blenderBuilder, blenderOwner, runtimeFilename, targetSize, runtimePath, aliasOf } =
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
        runtimePath,
        ...(aliasOf === undefined ? {} : { aliasOf }),
      };
    }
    parsedPacks[packId] = {
      label: typeof label === 'string' ? label : packId,
      packDirectory,
      runtimeFormat,
      active,
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

/** True when a battlefield's active pack is a dedicated per-battlefield pack. */
export function usesDedicatedSpritePack(battlefieldId: BattlefieldId): boolean {
  const packId = ASSET_MANIFEST.battlefieldPacks[battlefieldId] ?? 'generic';
  return packId !== 'generic' && ASSET_MANIFEST.packs[packId]?.active === true;
}

/** Launch data shape GameScene receives via Phaser scene settings. */
export interface SceneLaunchData {
  botMatch?: { battlefieldId?: BattlefieldId };
  liveMatch?: { state?: { battlefieldId?: BattlefieldId } };
}

/**
 * Derives the battlefield id from scene launch data. Usable from preload()
 * (which runs before create()), and mirrors GameScene.create()'s derivation:
 * bot matches key off the server ticket, live matches off the authoritative
 * initial state, and anything unknown falls back to the default battlefield.
 */
export function battlefieldIdFromLaunchData(launchData: SceneLaunchData | undefined): BattlefieldId {
  return normalizeBattlefieldId(
    launchData?.botMatch?.battlefieldId ?? launchData?.liveMatch?.state?.battlefieldId
  );
}

export const TERRITORY_TEXTURE_KEYS: readonly string[] = RESOLVER_TEXTURE_KEYS;

/** Every key the resolver can emit has a procedural fallback (never a broken sprite). */
export const PROCEDURAL_FALLBACK_KEYS: ReadonlySet<string> = new Set(RESOLVER_TEXTURE_KEYS);

/** Phaser container interactive size for a territory (unchanged legacy hit area). */
export function territoryHitAreaSize(radius: number): number {
  return radius * 2.5;
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
// Arena accents (static, non-interactive, provably clear of gameplay)
// ---------------------------------------------------------------------------

export interface ArenaAccent {
  readonly x: number;
  readonly y: number;
  readonly kind: 'crystal' | 'stones' | 'pennant';
}

/**
 * Restrained decorative accents per battlefield (Art Bible section 12: max 8,
 * <= 24px tall, never within territory radius + 16px of a territory center or
 * 14px of a road segment). Crown Cross ships four corner accents; other
 * battlefields keep their existing presentation until their kits are rendered.
 */
export function getArenaAccentPositions(battlefieldId: BattlefieldId): readonly ArenaAccent[] {
  if (battlefieldId === 'crown_cross') {
    return Object.freeze([
      { x: 40, y: 150, kind: 'crystal' },
      { x: 360, y: 150, kind: 'stones' },
      { x: 40, y: 570, kind: 'stones' },
      { x: 360, y: 570, kind: 'crystal' },
    ] as readonly ArenaAccent[]);
  }
  return [];
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

/**
 * Draws the battlefield's decorative accents into a single static Graphics
 * object. All shapes are static one-time draws (no per-frame allocations).
 */
export function drawArenaAccents(
  graphics: {
    fillStyle(color: number, alpha?: number): unknown;
    lineStyle(width: number, color: number, alpha?: number): unknown;
    fillCircle(x: number, y: number, radius: number): unknown;
    fillEllipse(x: number, y: number, width: number, height: number): unknown;
    fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): unknown;
    lineBetween(x1: number, y1: number, x2: number, y2: number): unknown;
  },
  battlefieldId: BattlefieldId
): void {
  for (const accent of getArenaAccentPositions(battlefieldId)) {
    // Contact shadow first (grounding), then the prop in muted ambiance alpha.
    graphics.fillStyle(0x000000, 0.22);
    graphics.fillEllipse(accent.x, accent.y + 8, 22, 7);

    if (accent.kind === 'crystal') {
      graphics.fillStyle(THEME.teams.neutral.light, 0.3);
      graphics.fillTriangle(accent.x - 8, accent.y + 6, accent.x - 2, accent.y - 14, accent.x + 4, accent.y + 6);
      graphics.fillTriangle(accent.x + 1, accent.y + 6, accent.x + 6, accent.y - 8, accent.x + 11, accent.y + 6);
    } else if (accent.kind === 'stones') {
      graphics.fillStyle(PALETTE_ACCENT_STONE, 0.32);
      graphics.fillCircle(accent.x - 4, accent.y + 3, 6);
      graphics.fillCircle(accent.x + 5, accent.y + 4, 5);
      graphics.fillCircle(accent.x, accent.y - 3, 4);
    } else {
      graphics.lineStyle(1.5, PALETTE_ACCENT_IRON, 0.4);
      graphics.lineBetween(accent.x, accent.y + 7, accent.x, accent.y - 14);
      graphics.fillStyle(THEME.teams.player.primary, 0.35);
      graphics.fillTriangle(accent.x, accent.y - 14, accent.x, accent.y - 7, accent.x + 12, accent.y - 10.5);
    }
  }
}

const PALETTE_ACCENT_STONE = 0x64748b;
const PALETTE_ACCENT_IRON = 0x475569;
