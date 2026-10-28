// Exports the HD art tier (only downloaded by the `high` render tier, see apps/game/src/render/RenderProfile.ts)
// from the Blender masters in art/blender/renders (git-ignored: run this where the masters exist).
//
//   buildings and props  -> assets/hd/<same path as the SD file>.webp, up to 3x the SD size, never above the master
//   ground plates        -> the 1140x2502 masters as they are (the SD plate is 760x1668)
//   marching units       -> assets/hd/units/*.png at 256 px (SD is 128 px)
//
// It also writes apps/game/src/art/hd-art-manifest.json: every HD file the client may request with its pixel
// size, so the loader never asks for a file that does not exist and the display code can normalise sizes.
// Usage: node scripts/export-hd-art.mjs   (needs cwebp and ffmpeg; HD_QUALITY overrides q=88, HD_MASTERS the master dir;
// units are only re-exported when the master dir has a units folder)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'art/asset-manifest.json'), 'utf8'));
// HD_MASTERS points at another master set (e.g. art/blender/renders-vivid); the default is the shipped renders.
const renders = path.resolve(root, process.env.HD_MASTERS ?? 'art/blender/renders');
const publicRoot = path.join(root, 'apps/game/public');
const hdRoot = path.join(publicRoot, 'assets/hd');
const quality = process.env.HD_QUALITY ?? '88';
const SIZE_FACTOR = 3;
// The HD set carries the colour grade (a battle-camera filter cost ~14 fps on a fast phone, baked colour costs nothing):
// saturation x1.25 and a gentle S-curve for contrast. Alpha is preserved. HD_GRADE=0 exports the masters ungraded.
const GRADE = process.env.HD_GRADE === '0' ? null : "format=rgba,hue=s=1.25,curves=all='0/0 0.25/0.22 0.75/0.79 1/1'";
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hd-'));
const graded = (master) => {
  if (!GRADE) return master;
  const out = path.join(tmpDir, path.basename(master));
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', master, '-vf', GRADE, out]);
  return out;
};
const UNIT_SIZE = 256;
const entries = {};

const pngSize = (file) => {
  const buffer = fs.readFileSync(file);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};
const assetRelative = (runtimePath) => runtimePath.replace(/^apps\/game\/public\//, '');
const record = (assetPath, width, height, file) => {
  entries[assetPath] = { hd: assetPath.replace(/^assets\//, 'assets/hd/'), width, height, bytes: fs.statSync(file).size };
};

for (const [packId, pack] of Object.entries(manifest.packs)) {
  // The generic pack is the PNG fallback for battlefields without dedicated art: it stays SD.
  if (packId === 'generic' || !pack.active) continue;
  // A pack missing from the chosen master set (e.g. the ground plates) falls back to the shipped renders.
  const chosen = path.join(renders, packId);
  const mastersDir = fs.existsSync(chosen) ? chosen : path.join(root, 'art/blender/renders', packId);
  const done = new Set();
  for (const [textureKey, sprite] of Object.entries(pack.sprites)) {
    if (done.has(sprite.runtimePath)) continue;
    done.add(sprite.runtimePath);
    const master = path.join(mastersDir, `${sprite.blenderRenderName}.png`);
    if (!fs.existsSync(master)) throw new Error(`Missing master for ${packId}/${textureKey}: ${master}`);
    const masterSize = pngSize(master);
    const assetPath = assetRelative(sprite.runtimePath);
    const dest = path.join(publicRoot, assetPath.replace(/^assets\//, 'assets/hd/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let width, height;
    if (pack.spriteKind === 'ground') {
      // Ground plates keep the master's pixels; it is already the largest honest size.
      [width, height] = [masterSize.width, masterSize.height];
      execFileSync('cwebp', ['-quiet', '-q', '82', graded(master), '-o', dest]);
    } else {
      const sd = sprite.targetWidth ?? sprite.targetSize;
      const target = Math.min(masterSize.width, sd * SIZE_FACTOR);
      [width, height] = [target, target];
      execFileSync('cwebp', ['-quiet', '-q', quality, '-alpha_q', '100', '-resize', String(target), String(target), graded(master), '-o', dest]);
    }
    record(assetPath, width, height, dest);
  }
}

// Marching units: same file names as the SD set, 256 px PNG with alpha.
// Units come from the chosen masters when that set has them, otherwise from the shipped renders.
const unitsDir = fs.existsSync(path.join(renders, 'units')) ? path.join(renders, 'units') : path.join(root, 'art/blender/renders/units');
const unitDest = path.join(hdRoot, 'units');
fs.mkdirSync(unitDest, { recursive: true });
for (const file of fs.readdirSync(unitsDir).filter((f) => f.endsWith('.png')).sort()) {
  const dest = path.join(unitDest, file);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(unitsDir, file), '-vf', `${GRADE ? `${GRADE},` : ''}scale=${UNIT_SIZE}:${UNIT_SIZE}:flags=lanczos`, dest]);
  record(`assets/units/${file}`, UNIT_SIZE, UNIT_SIZE, dest);
}

const sorted = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : 1)));
fs.writeFileSync(path.join(root, 'apps/game/src/art/hd-art-manifest.json'), `${JSON.stringify({ version: 'hd-v2', files: sorted }, null, 2)}\n`);
const total = Object.values(sorted).reduce((n, e) => n + e.bytes, 0);
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`${Object.keys(sorted).length} HD files, ${(total / 1024 / 1024).toFixed(2)} MB total`);
