import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BACKDROP_ASPECT, computeBackdropTiles } from '../HubLayouts.js';

describe('computeBackdropTiles', () => {
  it('covers the full screen height with tiles as wide as the screen', () => {
    for (const [w, h] of [[400, 720], [400, 900], [520, 720], [360, 640]]) {
      const tiles = computeBackdropTiles(w, h);
      expect(tiles.length).toBeGreaterThanOrEqual(1);
      expect(tiles.every((t) => t.width === w)).toBe(true);
      const bottom = tiles.at(-1)!.y + tiles.at(-1)!.height;
      expect(bottom).toBeGreaterThanOrEqual(h);
      // No wasted tile: the previous one must not already reach the bottom.
      if (tiles.length > 1) expect(tiles.at(-2)!.y + tiles.at(-2)!.height).toBeLessThan(h);
    }
  });

  it('abuts tiles exactly and mirrors every second one so seams vanish', () => {
    const tiles = computeBackdropTiles(400, 900);
    tiles.forEach((tile, i) => {
      expect(tile.flipY).toBe(i % 2 === 1);
      if (i > 0) expect(tile.y).toBeCloseTo(tiles[i - 1].y + tiles[i - 1].height);
    });
    expect(tiles[0].y).toBe(0);
  });

  it('keeps the band aspect ratio and returns nothing for an unusable viewport', () => {
    const [tile] = computeBackdropTiles(400, 720);
    expect(tile.width / tile.height).toBeCloseTo(BACKDROP_ASPECT);
    expect(computeBackdropTiles(0, 720)).toEqual([]);
    expect(computeBackdropTiles(400, Number.NaN)).toEqual([]);
  });
});

describe('hub art budget', () => {
  const hub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../public/assets/hub');

  it('keeps the menu backdrop and Kingdom art small enough for a first hub paint', () => {
    const size = (file: string) => fs.statSync(path.join(hub, file)).size;
    expect(size('hub_meadow.webp')).toBeLessThanOrEqual(60 * 1024);
    for (const file of fs.readdirSync(hub).filter((f) => f.endsWith('.webp'))) {
      expect(size(file), `${file} is too heavy for the hub`).toBeLessThanOrEqual(60 * 1024);
    }
  });

  it('exports the backdrop at the aspect the tiler assumes', () => {
    // WebP VP8 header: width/height are 14-bit values at bytes 26-29.
    const buf = fs.readFileSync(path.join(hub, 'hub_meadow.webp'));
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    expect(width / height).toBeCloseTo(BACKDROP_ASPECT, 2);
  });
});
