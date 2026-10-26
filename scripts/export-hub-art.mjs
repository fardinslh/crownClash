// Exports the 256 px hub-only Kingdom sprites from the 512 px Blender masters
// (art/blender/renders is git-ignored, so run this where the masters exist).
// Battle sprites in territories/crown_cross are deliberately not touched.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const masters = path.join(root, 'art/blender/renders/crown_cross');
const out = path.join(root, 'apps/game/public/assets/hub');
const SIZE = 256;

const SPRITES = {
  kingdom_outpost: 'tier1_watchtower_player_idle',
  kingdom_barracks: 'tier1_barracks_player_idle',
  kingdom_crown_keep: 'tier2_center_player_idle',
  kingdom_citadel: 'tier3_player_hq',
};

fs.mkdirSync(out, { recursive: true });
for (const [name, master] of Object.entries(SPRITES)) {
  const src = path.join(masters, `${master}.png`);
  if (!fs.existsSync(src)) throw new Error(`Missing master render: ${src}`);
  const dest = path.join(out, `${name}.webp`);
  execFileSync('cwebp', ['-quiet', '-q', '90', '-alpha_q', '100', '-resize', String(SIZE), String(SIZE), src, '-o', dest]);
  console.log(`${name}.webp ${fs.statSync(dest).size} bytes`);
}
