# Battlefield Art Pipeline (Blender → Runtime)

Deterministic 2.5D battlefield art pipeline. The visual direction lives in
[`ART_BIBLE.md`](../../ART_BIBLE.md) (sections 2–8, 10–15).

## Canonical asset manifest

[`art/asset-manifest.json`](../../art/asset-manifest.json) is the single source of
truth for the runtime sprite mapping. It is consumed by all of:

- **GameScene preload** (`apps/game/src/art/BattlefieldArt.ts`) — loads exactly the
  active battlefield pack's sprite paths (no hardcoded list in the scene);
- **the Blender scene builder** — renders each pack's `blenderRenderName` entries;
- **the optimizer** (`tools/blender/optimize_outputs.sh`) — maps each master to its
  runtime filename, size tier, and output format/path;
- **the art tests** — enforce file existence, exact dimensions, and byte budgets.

Every sprite entry declares: texture key (what GameScene resolves), Blender render
name (the 512×512 PNG master), runtime filename, target dimensions, and runtime path.

### Runtime texture keys

| Keys | Meaning | Dedicated-pack size |
| :--- | :--- | :--- |
| `citadel_player`, `citadel_enemy` | Tier-3 bases (ownership is id-based) | 160×160 |
| `crown_keep_player/enemy/neutral` | All tier-2 territories | 128×128 |
| `outpost_player/enemy/neutral` | Tier-1 fortresses | 128×128 |
| `barracks_player/enemy/neutral` | Tier-1 barracks | 128×128 |
| `stable_player/enemy/neutral` | Tier-1 stables | 128×128 |

All owner variants are preloaded up front, so capture-driven owner swaps never
reference an unloaded texture.

### Packs

- **Generic pack** (`assets/territories/`, PNG, 256×256, `active: true`): the legacy
  shared sprite pack used by *every* battlefield today. It ships only the original 8
  files, so `barracks_*`/`stable_*` keys deliberately **alias** the matching
  `outpost_*.png` files (identical visuals). This is explicit in the manifest
  (`aliasOf`), not accidental.
- **crown_cross dedicated pack** (`assets/territories/crown_cross/`, WebP, declared,
  **`active: false` until rendered**): 14 distinct files with per-tier sizes above.
  Every key gets its own file — no aliases. A test fails if the pack is activated
  before all of its optimized files exist. Activating it is a one-line change:
  set `active: true` and point `battlefieldPacks.crown_cross` at `crown_cross`.

Blender master names (e.g. `tier3_player_hq.png`) live only under
`art/blender/renders/` and are never shipped; runtime names (e.g.
`citadel_player.webp`) live only under `apps/game/public/assets/` and are the only
files Phaser loads.

## Commands

```bash
# 1. Render the full crown_cross master kit (requires Blender 4.x; deterministic).
#    The kit comes from the manifest's crown_cross pack.
tools/blender/render_battlefield.sh crown_cross
#    or with an explicit binary:
BLENDER_BIN=/Applications/Blender.app/Contents/MacOS/Blender \
  tools/blender/render_battlefield.sh crown_cross

# 2. Optimize masters into runtime assets. Reads the manifest; fails hard when a
#    master is missing, the format cannot be produced (e.g. no cwebp), or the
#    source directory has no PNGs. Never copies 512x512 masters through.
tools/blender/optimize_outputs.sh \
  art/blender/renders/crown_cross \
  crown_cross

# 3. Rebuild and verify the game
npm run build && npm test
```

Useful single-asset and authoring invocations:

```bash
# One manifest sprite (validation happens before Blender is required):
blender --background --factory-startup --python art/blender/build_battlefield_scene.py -- \
  --pack crown_cross --asset tier3_player_hq --output art/blender/renders/single

# Quick quality check with fewer samples; --opaque disables film transparency:
blender --background --factory-startup --python art/blender/build_battlefield_scene.py -- \
  --pack crown_cross --samples 16 --opaque --output /tmp/cc-preview
```

## Determinism

The scene builder uses a fixed orthographic camera (55°/45° dimetric, track-to
constrained onto the asset origin), a fixed three-point lighting rig, a fixed world
ambient, and `cycles.seed = 0` with `use_animated_seed = False` (`--samples`
controls sample count). Re-rendering the same pack on the same Blender build
produces identical PNGs. Asset generators use no randomness. Each asset renders in
a freshly cleared scene; the material palette is rebuilt after the clear, so
repeated kit renders never accumulate orphan cameras, lights, worlds, collections,
or materials.

## Runtime asset rules

- Masters: 512×512 RGBA PNG (transparent film), always written by the builder.
- Runtime: WebP with alpha (dedicated packs) or PNG (generic pack); 128×128 for
  tiers 1–2, 160×160 for tier 3; keep each territory sprite < 80 KB and the
  per-battlefield pack < 500 KB (enforced by tests).
- If a texture file is missing or fails to load, GameScene falls back to a procedural
  texture (`createProceduralTerritoryFallbackTexture`); the game must never render
  broken/black sprites.

## Adding another battlefield

1. Add the battlefield to `apps/server-nakama/battlefields.json` (authoritative
   geometry: territories + roads). Game data flows to client and server from there.
2. Add a pack for it in `art/asset-manifest.json` (reuse the existing
   `blenderBuilder` values; only silhouettes/palette accents should differ) and map
   the battlefield id to it in `battlefieldPacks` (keep it `active: false` until
   step 4 succeeds).
3. `tools/blender/render_battlefield.sh <pack-id>` then
   `tools/blender/optimize_outputs.sh art/blender/renders/<pack-id> <pack-id>`.
4. Flip the pack to `active: true` only after the optimized files exist under
   `apps/game/public/assets/territories/<id>/` — the manifest activation test
   enforces this.
5. `apps/game/src/art/__tests__/BattlefieldArt.test.ts` picks the new mapping up
   automatically; extend it only for new texture keys or new pack shapes.
