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
  shared sprite pack used by battlefields without dedicated art. It ships only the
  original 8 files, so `barracks_*`/`stable_*` keys deliberately **alias** the
  matching `outpost_*.png` files (identical visuals). This is explicit in the
  manifest (`aliasOf`), not accidental.
- **crown_cross dedicated pack** (`assets/territories/crown_cross/`, WebP, active):
  stone-and-gold battlefield kit.
- **twin_passes dedicated pack** (`assets/territories/twin_passes/`, WebP, active):
  fortified mountain-passes kit — stepped crag citadels with round bastions,
  gatehouse keeps straddling the pass, square crenellated watchtowers on rock
  plinths, crag-slab barracks roofs, and timber stables leaning on a rock wall.
  Ownership accents: blue/red/gray banners, beacons, roofs, and awnings.
- **royal_ring dedicated pack** (`assets/territories/royal_ring/`, WebP, active):
  prestigious royal-arena kit — circular marble plinths with gold trim, dark
  polished keeps with team drum bands, gold-crowned sentry towers, marble
  guardhouses with polished pillars, and round-roofed cavalry pavilions.
  Ownership accents: blue/red/gray drum bands, banners, stripes, and pavilion rims.

Every dedicated key gets its own file — no aliases. A test fails if a pack is
activated before all of its optimized files exist, or if two dedicated packs ship
byte-identical files for the same key.

Blender master names (e.g. `tier3_player_crag_hq.png`) live only under
`art/blender/renders/` and are never shipped; runtime names (e.g.
`citadel_player.webp`) live only under `apps/game/public/assets/` and are the only
files Phaser loads.

## QA tooling

### Screenshot capture (single-viewport proof)

`scripts/capture-battlefield-qa.mjs` captures the real game per viewport with a
corrected CDP procedure. It launches a FRESH headless Chrome per viewport (never
resize a running scene across viewport/DPR changes: mid-scene resizes corrupt the
Phaser EXPAND layout and produce duplicated/stitched captures), sets device
metrics with CSS width/height and `deviceScaleFactor: 2` BEFORE navigation,
asserts at capture time that `window.innerWidth`, `window.innerHeight`, and
`devicePixelRatio` match the request and the Phaser canvas client rect fits the
single intended viewport, starts the scene through the `__PHASER_GAME__` QA hook,
waits until the battlefield's pack is actually fetched with no texture load
errors, then captures with `Page.captureScreenshot` (no clip, `fromSurface: true`).
Finally it compares the capture against Phaser's own renderer snapshot of the
same scene — a stitched or duplicated capture would disagree with the canvas
render, so a low mean difference proves exactly one viewport was captured.

```bash
# Requires the vite dev server (npm run dev in apps/game) and headless Chrome.
node scripts/capture-battlefield-qa.mjs twin_passes qa-artifacts/art-twin-passes
node scripts/capture-battlefield-qa.mjs royal_ring qa-artifacts/art-royal-ring
```

### Supplemental pixel analysis (NOT a substitute for visual inspection)

`tools/blender/analyze_masters.py` and `tools/blender/analyze_screenshot.py`
provide SUPPLEMENTAL, objective checks only: sprite coverage/bounding-box
clipping, mean colors, cross-pack/owner-variant pixel diffs, and capture-vs-render
agreement. They cannot replace a human looking at the captured screenshots —
always eyeball the QA artifacts (composition, readability, clipping, noise) before
accepting a visual change.

```bash
# Pixel stats per master/runtime asset; pass two files for a pairwise diff:
blender --background --factory-startup --python tools/blender/analyze_masters.py -- \
  art/blender/renders/twin_passes/tier3_player_crag_hq.png \
  art/blender/renders/twin_passes/tier3_enemy_crag_hq.png

# Screenshot color census (supplemental):
blender --background --factory-startup --python tools/blender/analyze_screenshot.py -- \
  qa-artifacts/art-twin-passes/twin_passes-360x800.png
```

In-browser scene QA: open the game, then
`window.__PHASER_GAME__.scene.start('GameScene', { source: 'menu', botMatch: { matchId: 'qa_', battlefieldId: 'twin_passes' } })`,
dispatch armies with `scene.executeQaDispatch(...)`, and check
`scene.missingTerritoryTextures` is empty.

## Commands

```bash
# 1. Render a pack's master kit (deterministic; verified with Blender 5.2.2 LTS,
#    works with any recent Blender incl. 4.x). The kit comes from the manifest
#    pack of the same id.
tools/blender/render_battlefield.sh crown_cross
tools/blender/render_battlefield.sh twin_passes
#    or with an explicit binary:
BLENDER_BIN=/Applications/Blender.app/Contents/MacOS/Blender \
  tools/blender/render_battlefield.sh twin_passes

# 2. Optimize masters into runtime assets. Reads the manifest; fails hard when a
#    master is missing, the format cannot be produced (e.g. no cwebp), or the
#    source directory has no PNGs. Never copies 512x512 masters through.
tools/blender/optimize_outputs.sh art/blender/renders/crown_cross crown_cross
tools/blender/optimize_outputs.sh art/blender/renders/twin_passes twin_passes

# 3. Rebuild and verify the game
npm run build && npm test
```

Useful single-asset and authoring invocations:

```bash
# One manifest sprite (validation happens before Blender is required):
blender --background --factory-startup --python art/blender/build_battlefield_scene.py -- \
  --pack twin_passes --asset tier3_player_crag_hq --output art/blender/renders/single

# Quick quality check with fewer samples; --opaque disables film transparency:
blender --background --factory-startup --python art/blender/build_battlefield_scene.py -- \
  --pack twin_passes --samples 16 --opaque --output /tmp/cc-preview
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
