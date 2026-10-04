# Battlefield Art Pipeline (Blender → Runtime)

Production caches fixed sprite filenames for 30 days. `GameScene.preload()`
adds `?v=cartoon-meadow-v1.4` to ground, building and shared prop requests.
Bump that revision whenever this baked map kit changes, and update the preload
regression test, so returning players receive matching terrain and buildings.

Deterministic 2.5D battlefield art pipeline, Art Bible v1.4: bright cartoon
volumes, warm pale stone, natural terrain color masses and clustered foliage.
The visual direction lives in
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
  the reference cartoon kit in `art/blender/crown_cross_kit.py`: warm pale stone,
  broad roofs and timber, soft chamfers and readable fortification shapes. Citadel,
  crown keep, outpost, barracks and stable remain distinct at 128/160px. Team color
  lives on roofs, banners and shields; tight contact shadows ground each building.
- **environment shared pack** (`assets/environment/`, WebP, `spriteKind: "prop"`,
  active): birch, apple and pine trees, clustered bushes, grass, rocks and pennants
  through the same kit and rig. Runtime sizes are 64–128px. Deterministic positions
  in `getArenaPropPositions` are generated against roads, sockets, spacing and the
  art-only exclusions in [`art/arena-dressing-zones.json`](../../art/arena-dressing-zones.json).
  That shared logical-world source reserves Twin Passes river/banks
  `x 166–234, y 133–653` and Royal Ring court radius `108` about `(200, 360)`;
  inclusive boundaries apply to rendered props and baked ground scatter. Tests
  validate the reserved geometry and every checked-in placement. At most 24 prop
  images render per battlefield; trees stay at the edges.
- **twin_passes dedicated pack** (`assets/territories/twin_passes/`, WebP, active):
  shared architecture in highland stone with pine/crag accents; ground identity
  comes from a natural river, banks and bridge on the existing crossing road.
- **royal_ring dedicated pack** (`assets/territories/royal_ring/`, WebP, active):
  palace limestone, cream trim and gold ornament; calm stone courts and segmented
  hedges define the garden environment.
- **quad_citadel dedicated pack** (`assets/territories/quad_citadel/`, WebP, active):
  warm war-camp timber, canvas and matte iron; four distinct trampled camps and
  border rocks define the open grassland.
- **grounds shared pack** (`assets/grounds/`, WebP, `spriteKind: "ground"`, active):
  one plate for each of the four battlefields, all through the same 45°/0° dimetric
  rig as the buildings. `1140×2502` RGBA PNG masters become `760×1668` WebP runtime
  plates. The authoritative `380×640` logical tactical rect retains its exact roads
  and sockets. [`art/arena-layout.json`](../../art/arena-layout.json) expands Y
  positions by `1.22` about `(200, 398)` before projection, leaving sprite sizes,
  plinth radii/lift and travel times unchanged. Blender uses the same factor for
  roads/sockets and authored river/bridge, garden and camp geometry. Client
  `unproject` and baked dressing exclusions invert the spacing for correct logical
  hit tests and reserved zones. Composed meadow fringe fills tall phones. Natural
  grass color masses, worn continuous road edges, soft terrain relief and focused
  border clusters replace repeated mowing stripes and scattered tiny marks.
  Broad light variation comes from the grass material; translucent sun-pool discs
  are not layered over the terrain.
  Lush cover is baked in `_ground_scatter`: overlapping clover rosettes and dense
  short tufts fill available lawns, with taller clumps in the fringe. Green blades
  and leaves check road/socket clearance as well as shared reserved zones. Camp
  cores stay trampled while their outer verges regrow. This adds no runtime prop
  images, shader effects or texture pixels. Tiny grass cones share one baked
  Blender mesh/material set, avoiding thousands of object/operator updates during
  export; the normal building and prop primitive helpers keep their existing path.
  Raised stone plinth tops retain the `6.2` world-pixel lift contract with
  `PLINTH_TOP_LIFT`; `groundPlateImageRect` centers each image on the projected world
  rect so roads and sockets align exactly. No gameplay coordinate, touch radius,
  server data or public API changes. Background scenery is baked into the plate.
  `getArenaGroundSprite` resolves the plate; a missing/inactive plate keeps the
  existing vector fallback. Over a loaded plate the route overlay/inlay use `0.06`
  alpha and ownership has one `2px` primary-colored ring with `0.06` fill; the extra
  dark base-plate stroke is hidden only on baked plinths. Capture updates preserve
  that treatment, while selection/drag feedback and fallback grounding remain.
  Render/optimize: `tools/blender/render_battlefield.sh grounds`, then
  `tools/blender/optimize_outputs.sh art/blender/renders/grounds grounds`.

Every dedicated key gets its own file — no aliases. A test fails if a pack is
activated before all of its optimized files exist, or if two dedicated packs ship
byte-identical files for the same key.

All packs render through the same Art Bible rig. Standalone building, prop and
troop meshes carry the section-6 per-vertex `VerticalShade` attribute that their
materials multiply into the base color. Baked terrain and edge flora use explicit
materials without that sprite-only attribute, preventing missing-attribute black
surfaces during ground rendering.

Blender master names (e.g. `tier3_player_crag_hq.png`) live only under
`art/blender/renders/` and are never shipped; runtime names (e.g.
`citadel_player.webp`) live only under `apps/game/public/assets/` and are the only
files Phaser loads.

## QA tooling

### Screenshot capture (single-viewport proof)

`scripts/capture-battlefield-qa.mjs` captures the real game per viewport with a
corrected CDP procedure. For the independent screenshot matrix it launches a FRESH
headless Chrome per viewport, keeping viewport/DPR changes out of those captures
so they cannot be mistaken for resize validation. It sets device
metrics with CSS width/height and `deviceScaleFactor: 2` BEFORE navigation,
asserts at capture time that `window.innerWidth`, `window.innerHeight`, and
`devicePixelRatio` match the request and the Phaser canvas client rect fits the
single intended viewport, starts the scene through the `__PHASER_GAME__` QA hook,
waits until the battlefield's pack is actually fetched with no texture load
errors, then captures with `Page.captureScreenshot` (no clip, `fromSurface: true`).
Finally it compares the capture against Phaser's own renderer snapshot of the
same scene — a stitched or duplicated capture would disagree with the canvas
render, so a low mean difference proves exactly one viewport was captured.

Validate live resizing separately after timing benchmarks: keep a loaded scene,
grow and shrink its viewport, then inspect ground/socket alignment, territory hit
targets, active selection and ownership after capture. The relayout tests cover
loaded baked plinths and the missing-ground fallback, including lifted anchors,
selection, ownership-ring thickness/fill alpha and capture before shrinking the
viewport again. Browser QA separately checks the actual renderer and gestures.

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
# Render the twelve shared marching-unit sprites — leader/follower ×
# player/enemy × front/back/side facings (knight model from
# art/blender/crown_cross_kit.py, canonical rig, downscaled to 128px PNGs;
# front also ships under the legacy no-suffix names).
blender --background --factory-startup --python tools/blender/generate_units.py

# 1. Render a pack's master kit (deterministic; verified with Blender 5.2.2 LTS,
#    works with any recent Blender incl. 4.x). The kit comes from the manifest
#    pack of the same id.
tools/blender/render_battlefield.sh crown_cross
tools/blender/render_battlefield.sh twin_passes
mkdir -p art/blender/renders/environment && \
  blender --background --factory-startup --python-exit-code 1 \
    --python art/blender/build_battlefield_scene.py -- \
    --pack environment --output art/blender/renders/environment
#    or with an explicit binary:
BLENDER_BIN=/Applications/Blender.app/Contents/MacOS/Blender \
  tools/blender/render_battlefield.sh twin_passes

# 2. Optimize masters into runtime assets. Reads the manifest; fails hard when a
#    master is missing, the format cannot be produced (e.g. no cwebp), or the
#    source directory has no PNGs. Never copies 512x512 masters through.
tools/blender/optimize_outputs.sh art/blender/renders/crown_cross crown_cross
tools/blender/optimize_outputs.sh art/blender/renders/twin_passes twin_passes
tools/blender/optimize_outputs.sh art/blender/renders/environment environment

# 3. Verify the game and build
npm run typecheck && npm test && npm run build

# 4. Regenerate the per-battlefield environment prop placements (output is pasted
#    into getArenaPropPositions in apps/game/src/art/BattlefieldArt.ts; the test
#    suite re-validates every position against geometry and reserved art zones).
node scripts/generate-arena-props.mjs
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

The scene builder uses a fixed orthographic camera (45° pitch / 0° yaw dimetric,
track-to constrained onto the asset origin — the same projection the client board
layout mirrors in `apps/game/src/art/boardProjection.ts`), a fixed three-point
lighting rig (key `2.2`, fill `0.8`, rim `1.35`), world ambient `0.28`, and
`cycles.seed = 0` with
`use_animated_seed = False` (`--samples` controls sample count). Re-rendering the
same pack on the same Blender build produces identical PNGs. Placement and foliage
variation use fixed-seed random generators, never unseeded randomness. Each asset renders in
a freshly cleared scene; the material palette is rebuilt after the clear, so
repeated kit renders never accumulate orphan cameras, lights, worlds, collections,
or materials.

## Runtime asset rules

- Masters: 512×512 RGBA PNG (transparent film), always written by the builder.
  Ground plate masters: 1140×2502 RGBA PNG through the same 45° dimetric camera.
- Runtime: WebP with alpha (dedicated packs) or PNG (generic pack); 128×128 for
  tiers 1–2, 160×160 for tier 3; all ground plates 760×1668. Keep each territory
  or prop sprite < 80 KiB, each ground plate < 128 KiB, and the per-battlefield runtime set
  (territory sprites + its ground plate) < 500 KiB (enforced by tests).
  Report full match downloads separately (shared props, units and fonts also load)
  and uncompressed texture memory; compressed byte budgets do not bound GPU memory.
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
