// Shell-level tests for tools/blender/optimize_outputs.sh, using temporary
// fixture PNG masters. No Blender required: these run as part of `npm test`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

const REPO_ROOT = path.resolve(new URL('.', import.meta.url).pathname, '../..');
const OPTIMIZER = path.join(REPO_ROOT, 'tools/blender/optimize_outputs.sh');

const MASTER_SIZE = 512;

// --- minimal PNG encoder (8-bit RGBA, no dependencies) ---------------------

const CRC_TABLE = new Int32Array(256).map((_, index) => {
  let c = index;
  for (let bit = 0; bit < 8; bit += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c;
});

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encodes a solid-color (with alpha) MASTER_SIZE x MASTER_SIZE RGBA PNG. */
function writeMasterPng(filePath, rgba) {
  const stride = MASTER_SIZE * 4 + 1; // + filter byte per scanline
  const raw = Buffer.alloc(stride * MASTER_SIZE);
  for (let y = 0; y < MASTER_SIZE; y += 1) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < MASTER_SIZE; x += 1) {
      const offset = y * stride + 1 + x * 4;
      raw[offset] = rgba[0];
      raw[offset + 1] = rgba[1];
      raw[offset + 2] = rgba[2];
      raw[offset + 3] = rgba[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(MASTER_SIZE, 0);
  ihdr.writeUInt32BE(MASTER_SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA (alpha)
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(filePath, png);
}

function readPngInfo(filePath) {
  const buffer = readFileSync(filePath);
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${filePath} is not a PNG`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer.readUInt8(25),
    bytes: buffer.length,
  };
}

function runOptimizer(args, env = {}) {
  try {
    const stdout = execFileSync('bash', [OPTIMIZER, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      timeout: 60_000,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const err = error;
    return { status: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

/** Picks the PNG resizer the optimizer would find, to gate fixture tests. */
function pngResizerAvailable() {
  for (const tool of ['magick', 'convert', 'sips']) {
    try {
      execFileSync('bash', ['-c', `command -v ${tool} >/dev/null 2>&1`]);
      return tool;
    } catch {
      // keep looking
    }
  }
  return null;
}

/** Builds a fixture manifest pack with the given sprites and repo layout. */
function writeFixtureManifest(fixtures, sprites, extra = {}) {
  const manifest = {
    version: 1,
    masterFormat: 'png',
    masterResolution: MASTER_SIZE,
    packs: {
      fixture_pack: {
        label: 'fixture pack',
        packDirectory: `fixture_output/${extra.packDirectory ?? 'pack'}`,
        runtimeFormat: 'png',
        active: true,
        sprites,
      },
    },
    battlefieldPacks: { fixture_battlefield: 'fixture_pack' },
  };
  const manifestPath = path.join(fixtures, 'asset-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

test('optimizer fails clearly when the masters directory contains no PNG files', () => {
  const fixtures = mkdtempSync(path.join(tmpdir(), 'cc-optimizer-'));
  try {
    const emptyMasters = path.join(fixtures, 'masters');
    mkdirSync(emptyMasters, { recursive: true });
    const result = runOptimizer([emptyMasters, 'fixture_pack'], {
      CC_ASSET_MANIFEST: path.join(fixtures, 'missing-manifest.json'),
    });
    assert.notEqual(result.status, 0, 'empty render directory must fail, not report success');
    assert.match(result.stderr, /no PNG masters/);
  } finally {
    rmSync(fixtures, { recursive: true, force: true });
  }
});

test('optimizer fails naming each manifest-required master that is missing', () => {
  const fixtures = mkdtempSync(path.join(tmpdir(), 'cc-optimizer-'));
  try {
    const masters = path.join(fixtures, 'masters');
    mkdirSync(masters, { recursive: true });
    writeMasterPng(path.join(masters, 'tier1_watchtower_player_idle.png'), [200, 80, 40, 255]);
    const manifestPath = writeFixtureManifest(fixtures, {
      outpost_player: {
        blenderRenderName: 'tier1_watchtower_player_idle',
        blenderBuilder: 'build_watchtower',
        blenderOwner: 'player',
        runtimeFilename: 'outpost_player.png',
        targetSize: 128,
        runtimePath: `fixture_output/pack/outpost_player.png`,
      },
      citadel_player: {
        blenderRenderName: 'tier3_player_hq',
        blenderBuilder: 'build_citadel',
        blenderOwner: 'player',
        runtimeFilename: 'citadel_player.png',
        targetSize: 160,
        runtimePath: `fixture_output/pack/citadel_player.png`,
      },
    });
    const result = runOptimizer([masters, 'fixture_pack', fixtures], { CC_ASSET_MANIFEST: manifestPath });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tier3_player_hq\.png/);
    // Nothing was written for the missing master.
    assert.equal(existsSync(path.join(fixtures, 'fixture_output/pack/citadel_player.png')), false);
  } finally {
    rmSync(fixtures, { recursive: true, force: true });
  }
});

test('optimizer maps render names to runtime files, resizes tiers, and never copies masters', () => {
  const resizer = pngResizerAvailable();
  if (!resizer) {
    test.skip(`no PNG resizer (magick/convert/sips) on this machine; skipping resize fixture test`, () => {});
    return;
  }
  const fixtures = mkdtempSync(path.join(tmpdir(), 'cc-optimizer-'));
  try {
    const masters = path.join(fixtures, 'masters');
    mkdirSync(masters, { recursive: true });
    writeMasterPng(path.join(masters, 'tier3_player_hq.png'), [180, 60, 40, 255]);
    writeMasterPng(path.join(masters, 'tier1_watchtower_player_idle.png'), [60, 120, 220, 255]);
    writeMasterPng(path.join(masters, 'tier1_watchtower_neutral_idle.png'), [90, 90, 90, 140]);

    // barracks_player aliases outpost_player's runtime file (generic-pack
    // style): the optimizer must deduplicate it into a single output file.
    const manifestPath = writeFixtureManifest(fixtures, {
      citadel_player: {
        blenderRenderName: 'tier3_player_hq',
        blenderBuilder: 'build_citadel',
        blenderOwner: 'player',
        runtimeFilename: 'citadel_player.png',
        targetSize: 160,
        runtimePath: `fixture_output/pack/citadel_player.png`,
      },
      outpost_player: {
        blenderRenderName: 'tier1_watchtower_player_idle',
        blenderBuilder: 'build_watchtower',
        blenderOwner: 'player',
        runtimeFilename: 'outpost_player.png',
        targetSize: 128,
        runtimePath: `fixture_output/pack/outpost_player.png`,
      },
      barracks_player: {
        blenderRenderName: 'tier1_barracks_player_idle',
        blenderBuilder: 'build_barracks',
        blenderOwner: 'player',
        runtimeFilename: 'outpost_player.png',
        targetSize: 128,
        runtimePath: `fixture_output/pack/outpost_player.png`,
        aliasOf: 'outpost_player',
      },
      outpost_neutral: {
        blenderRenderName: 'tier1_watchtower_neutral_idle',
        blenderBuilder: 'build_watchtower',
        blenderOwner: 'neutral',
        runtimeFilename: 'outpost_neutral.png',
        targetSize: 128,
        runtimePath: `fixture_output/pack/outpost_neutral.png`,
      },
    });

    const result = runOptimizer([masters, 'fixture_pack', fixtures], { CC_ASSET_MANIFEST: manifestPath });
    assert.equal(result.status, 0, `optimizer failed: ${result.stderr}`);

    // Tier 3 -> 160, tier 1 -> 128, alpha preserved (color type 6).
    const citadel = readPngInfo(path.join(fixtures, 'fixture_output/pack/citadel_player.png'));
    assert.equal(citadel.width, 160);
    assert.equal(citadel.height, 160);
    assert.equal(citadel.colorType, 6, 'alpha channel must survive optimization');

    const outpost = readPngInfo(path.join(fixtures, 'fixture_output/pack/outpost_player.png'));
    assert.equal(outpost.width, 128);
    assert.equal(outpost.height, 128);

    const outpostNeutral = readPngInfo(path.join(fixtures, 'fixture_output/pack/outpost_neutral.png'));
    assert.equal(outpostNeutral.width, 128);
    assert.equal(outpostNeutral.colorType, 6);

    // Exactly the deduplicated runtime files exist (aliases never duplicate output).
    assert.equal(existsSync(path.join(fixtures, 'fixture_output/pack/barracks_player.png')), false);

    // No 512x512 master slipped through as a "runtime" asset.
    for (const file of ['citadel_player.png', 'outpost_player.png', 'outpost_neutral.png']) {
      const info = readPngInfo(path.join(fixtures, `fixture_output/pack/${file}`));
      assert.notEqual(info.width, MASTER_SIZE, `${file} must be resized, not copied`);
    }
  } finally {
    rmSync(fixtures, { recursive: true, force: true });
  }
});

test('optimizer requires cwebp for webp packs and refuses to fake success without it', () => {
  const hasCwebp = (() => {
    try {
      execFileSync('bash', ['-c', 'command -v cwebp >/dev/null 2>&1']);
      return true;
    } catch {
      return false;
    }
  })();
  if (hasCwebp) {
    test.skip('cwebp is installed; the missing-tool path is only exercised without it', () => {});
    return;
  }
  const fixtures = mkdtempSync(path.join(tmpdir(), 'cc-optimizer-'));
  try {
    const masters = path.join(fixtures, 'masters');
    mkdirSync(masters, { recursive: true });
    writeMasterPng(path.join(masters, 'tier3_player_hq.png'), [180, 60, 40, 255]);
    const manifest = {
      version: 1,
      masterFormat: 'png',
      masterResolution: MASTER_SIZE,
      packs: {
        fixture_pack: {
          label: 'fixture pack',
          packDirectory: 'fixture_output/pack',
          runtimeFormat: 'webp',
          active: true,
          sprites: {
            citadel_player: {
              blenderRenderName: 'tier3_player_hq',
              blenderBuilder: 'build_citadel',
              blenderOwner: 'player',
              runtimeFilename: 'citadel_player.webp',
              targetSize: 160,
              runtimePath: 'fixture_output/pack/citadel_player.webp',
            },
          },
        },
      },
      battlefieldPacks: { fixture_battlefield: 'fixture_pack' },
    };
    const manifestPath = path.join(fixtures, 'asset-manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const result = runOptimizer([masters, 'fixture_pack', fixtures], { CC_ASSET_MANIFEST: manifestPath });
    assert.notEqual(result.status, 0, 'missing cwebp must fail, not copy or fake success');
    assert.match(result.stderr, /cwebp/);
    assert.match(result.stderr, /brew install webp/);
    assert.equal(existsSync(path.join(fixtures, 'fixture_output/pack/citadel_player.webp')), false);
  } finally {
    rmSync(fixtures, { recursive: true, force: true });
  }
});
