import hdManifest from './hd-art-manifest.json';

/** Runtime tier of the art set: `sd` is the shipped default, `hd` is only requested by the high render tier. */
export type AssetTier = 'sd' | 'hd';

interface HdEntry {
  readonly hd: string;
  readonly width: number;
  readonly height: number;
}

const HD_FILES = hdManifest.files as Readonly<Record<string, HdEntry>>;
export const HD_ART_VERSION: string = hdManifest.version;

/**
 * The file to request for `path` (relative to the public root, no query string). On the HD tier it is the
 * mirrored file under `assets/hd/` when one was exported, otherwise the SD file, so a missing HD file is
 * never a 404 and a pack without HD art keeps working.
 */
export function resolveArtPath(path: string, tier: AssetTier): string {
  if (tier !== 'hd') return path;
  return HD_FILES[path]?.hd ?? path;
}

/** True when `resolveArtPath` would return an HD file. */
export function hasHdArt(path: string): boolean {
  return Object.prototype.hasOwnProperty.call(HD_FILES, path);
}

/** Pixel size of the HD export of `path`, if any. */
export function hdArtSize(path: string): { readonly width: number; readonly height: number } | undefined {
  const entry = HD_FILES[path];
  return entry ? { width: entry.width, height: entry.height } : undefined;
}
