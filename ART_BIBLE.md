# Crown Clash — Art Bible & Visual Direction
**Version:** 1.4
**Target Platform:** Mobile WebViews (Bale, Eitaa, Telegram, Mobile Web)
**Visual Style:** Stylized 2.5D (Blender renders → optimized 2D sprites at runtime)
**Primary Goal:** Instant tactical readability, bright volumetric cartoon environments, and polished composition on compact mobile screens.

**v1.2:** one bright cartoon direction across four battlefields: warm pale stone,
rounded foliage, natural terrain color masses, restrained ownership rings and
distinct environment identities. All four boards use the same 45° dimetric camera
and ground framing. The controlled source pipeline is documented in
`docs/art/README.md`; the scene builder is `art/blender/build_battlefield_scene.py`.
This environment revision preserves shared troops and HUD design.

**v1.3:** wider vertical building spacing through `art/arena-layout.json`:
positions expand by `1.22` before the same camera projection, while sprite sizes,
plinth shapes, counts and authoritative travel rules stay unchanged.

**v1.4:** lush baked meadow cover: dense short grass and clover rosettes between
the paths, taller grass in the fringe, and brighter map-specific greens. All
growth stays in the existing ground texture; tactical lanes and reserved features
remain clear and runtime prop counts stay capped at 24.

---

## 1. Visual Pillars

1. **Instant Readability at Arm’s Length:**
   Players on 5-inch to 6.7-inch mobile screens must immediately recognize territory ownership, tier, and unit strength in under 100 milliseconds.
2. **Readable Cartoon Volumes:**
   Broad medieval silhouettes, softened edges, light warm stone and clustered
   foliage carry the scene. Roofs, timber, stone and metal separate clearly at
   128–160px; tiny masonry marks and high-frequency texture never replace shape.
   Soft contact shadows ground each object without dark halos.
3. **High Color Contrast:**
   Bright, saturated team accents against a calm green battlefield and pale stone.
   The existing dark HUD framing remains unchanged.
4. **Strict Asset Cohesion:**
   Every visual asset—whether handcrafted or assisted by AI—must share the camera projection, lighting direction, controlled material palette, and edge language. Assets must never appear as if they were assembled from random asset stores.

---

## 2. Camera & Projection Standards

All 3D source assets rendered in Blender must use a **locked orthographic camera rig**. This ensures perfect 2.5D alignment when rendered as 2D sprites in Phaser.

| Property | Value | Rationale |
| :--- | :--- | :--- |
| **Camera Type** | `Orthographic` | Eliminates perspective distortion across different screen positions. |
| **Rotation (Euler)** | `X: 45.0°, Y: 0.0°, Z: 0.0°` | Straight-on dimetric (Clash Royale-style diorama): the camera sits due south of the subject at a 45° pitch, so every sprite grounds on the board exactly like the client's board projection (`apps/game/src/art/boardProjection.ts` — same pitch, yaw 0). |
| **Orthographic Scale** | Default `6.0`; fixed per-builder crops | `CAMERA_FRAMING` keeps each building's established relative scale. |
| **Clip Start / End** | `0.1m` / `100.0m` | Avoids Z-fighting or camera clipping. Ground diorama plates use a 300-unit stand-off with a 600-unit far clip (see `build_battlefield_scene.py` GROUND_DIORAMA_*). |

### Board Projection & Diorama Ground Plates

The battlefield itself is authored in a **flat authoritative world space** (380×640 logical px, `battlefields.json`; server simulation, roads and hit radii are untouched). Every battlefield renders that world through an affine dimetric projection in `boardProjection.ts`:

* `project(x, y)` first applies the shared `verticalSpacing = 1.22` to positions about world center `(200, 398)`, then projects at 45° pitch. Local circles/plinths keep `ry/rx = cos 45°`; buildings retain their existing size. Roads, marching positions and hit-test inversion follow the expanded placement. The extra spacing changes presentation, not server coordinates or travel duration.
* `unproject` reverses it for hit testing; `PLINTH_TOP_LIFT` anchors territory visuals on the raised plinth tops baked under every socket (6.2 world px — must track `DIORAMA_PLINTH_HEIGHT - DIORAMA_PLINTH_SINK + DIORAMA_PLINTH_LIP_RISE` in `crown_cross_kit.py`).
* Every battlefield's ground plate (1140×2502 master, 760×1668 runtime WebP) uses the same centered rig (`GROUND_DIORAMA_AIM` = plane (0,0,0)). Blender reads `arena-layout.json` too, so expanded roads and plinths land under the projected sockets 1:1. River/bridge, garden court and camp geometry use the same expansion; foliage exclusions invert it back to authoritative logical coordinates. The established plate extent retains meadow fringe around the expanded playfield, filling tall phones while shorter ones crop symmetrically.
* Projection is selected by battlefield (`DIMETRIC_BATTLEFIELDS`), independently
  of texture loading. Missing/inactive plates use vector ground in the current
  projection; all four current maps stay dimetric. Future maps outside that set
  use the stretched identity layout.

---

## 3. Lighting Rig & World Setup

A standardized 3-point stylized lighting rig creates consistent depth, warm top highlights, and cool ambient shadows.

```
                  [ Key Light (Sun) ]
                 Top-Left (45° azimuth, 60° elevation)
                 Warm Sunlight (#FFF5E6, Energy: 2.2)
                         \
                          \
   [ Rim Light ]           [ 3D Model ]           [ Fill Light (Sky) ]
   Back-Right              Center (0,0,0)         Opposite Key
   Pure White (#FFFFFF)                           Cool Sky Blue (#A8D2FF)
   Energy: 1.35                                    Energy: 0.8
```

### Lighting Parameters
* **Key Light (Sun):**
  * Type: `Sun`
  * Rotation: `X: 45°, Y: 25°, Z: -40°`
  * Color: Warm Champagne `#FFF5E6`
  * Strength: `2.2`
  * Shadow Softness / Angle: `0.15 rad` (crisp contact shadows with subtle edge softening).
* **Fill Light (Area / Sky):**
  * Type: `Sun`
  * Color: Cool Sky Blue `#A8D2FF`
  * Strength: `0.8`
  * Purpose: Injects cool ambient tones into shadows, preventing pitch-black contrast.
* **Rim Light (Backlight):**
  * Type: `Sun`, behind-right of the model.
  * Color: Clean Rim White `#FFFFFF`
  * Strength: `1.35`
  * Purpose: Carves strong silhouette separation between the building edges and the arena floor.
* **World Ambient:**
  * Background Color: Neutral Slate `#161B26`
  * Ambient Strength: `0.28`
  * Ambient Occlusion: Factor `1.0`, Distance `0.8m`.

---

## 4. Color Palette & Team Theming

The color language reinforces team allegiance and territorial dominance:

```
TEAM BLUE (Player)      TEAM RED (Enemy)        NEUTRAL (Unclaimed)     ACCENT / REWARD
Primary:   #2563EB      Primary:   #DC2626      Primary:   #64748B      Gold:      #F59E0B
Highlight: #60A5FA      Highlight: #F87171      Highlight: #94A3B8      Crown Rim: #FDE047
Shadow:    #1E3A8A      Shadow:    #7F1D1D      Shadow:    #334155      Victory:   #10B981
```

### Palette Rules
* **Banners & Roof Tiles:** Use the team's blue/red/neutral hue with controlled
  source-color lifts for AgX lighting. Runtime ownership rings use the exact
  team-primary color; rendered cloth colors need not equal its hex value.
* **Stone Structures:** Light warm limestone and cream trim, broad beveled surfaces
  and soft crevice shading; highland stone may be cooler, but never charcoal-heavy.
* **Trim & Metalwork:** Stylized iron `#334155` for regular buildings; polished royal gold `#F59E0B` for the central Crown Keep and Tier 3 Citadels.

---

## 5. Territory Tier Proportions & Silhouettes

Every territory must have a distinctive silhouette so players instantly recognize its tier and strategic value without reading text.

```
       [ Tier 1: Outpost ]          [ Tier 2: Crown Keep ]          [ Tier 3: Citadel ]

               /\                             👑                             🏰
              |  |                        /--------\                    |~|      |~|
             /____\                      |   ||||   |                   | |======| |
            |      |                     |   ||||   |                   | | [  ] | |
            |______|                     |__________|                   |_|______|_|
       Radius: ~27px (Base)           Radius: ~32px (Center)        Radius: ~36px (HQ)
       Units: 8 - 40                  Units: 14 - 55                Units: 20 - 65
       Rate: 0.85 - 0.9/s             Rate: 1.1/s                   Rate: 1.2/s
```

* **Tier 1 — Watchtower / Outpost:**
  * Single stout stone tower with a layered conical team roof and broad gallery.
  * One prominent team banner on the front face.
  * Compact footprint.
* **Tier 2 — Crown Keep (Center Strategic Stronghold):**
  * Octagonal reinforced ramparts, heavy stone battlements, central gilded crown spire.
  * Two team banners draped over stone walls.
* **Tier 3 — Citadel / Capital Base (Player & Enemy HQ):**
  * Four roofed corner towers, a central pitched-roof keep and an arched gate.
  * Broad battlements, a clear team banner and prominent visual weight.

**Crown Cross kit (reference cartoon direction):** warm pale stone, clear team roofs,
chunky parapets, softened chamfers and broad timber framing. Citadels retain corner
towers and a readable gatehouse; the Crown Keep retains its gilded crown; outposts,
barracks and open-front stables must remain distinguishable at actual mobile size.
Depth comes from broad highlights, restrained shadow seams and tight contact shadows,
not dense tiny details. Models share `art/blender/crown_cross_kit.py` and the canonical
rig; per-builder `CAMERA_FRAMING` crops preserve the 45°/0° view and runtime footprint.

**Per-map themes:** reuse this architecture family and controlled palette with local
accents; the differences must be visible in the ground as well as the buildings.

* **Crown Cross** — royal meadow, warm pale stone and garden borders: the reference.
* **Twin Passes** — highland stone, pine and crags; a natural riverbank and bridge
  aligned to the existing crossing road.
* **Royal Ring** — palace limestone, cream courts, gold details and segmented hedges.
* **Quad Citadel** — four distinct camps in open grassland, warm timber, trampled
  ground and border rocks.

Ownership readability never changes: team color always lives on roofs, banners and
shields in every theme.

**Shared troops:** twelve sprites (leader/follower × player/enemy × front/back/side) of an armoured knight in
a marching pose — greathelm with visor slit, fauld lames, pauldrons, tabard and heater
shield in team cloth, sword at the low ready; leaders add a crest fin and cape. Rendered
by `tools/blender/generate_units.py` through the same rig, 128px runtime PNGs, shared by
every battlefield. Sprite scale is driven per frame by `computeMarchStride`, so size
changes must be made there and respect reduced motion.

**Environment props (all battlefields):** rendered flora and stones — birch, apple and
pine trees, bushes, grass tufts, rocks and pennants — from the same kit and rig
(`environment` pack in `art/asset-manifest.json`). Placements are static per battlefield
(generated by `scripts/generate-arena-props.mjs`), provably clear of territory sockets,
roads and the arena frame, with trees edge-only; props render between roads and platforms
so gameplay objects always stay on top.

---

## 6. Materials & Shading Rules

* **Shader Type:** Principled BSDF (Roughness/Metallic).
* **Roughness Targets:**
  * Building masonry: `0.68 – 0.82`; timber: `0.65 – 0.75`.
  * Building roofs: `0.48 – 0.50`; cloth banners: `0.76`.
  * Building gold: roughness `0.25 – 0.35`, metallic `0.55`; iron:
    roughness `0.35 – 0.55`, metallic `0.60`. Shared troop materials stay unchanged.
* **Beveling Mandatory:**
  * Building boxes use broad 3-segment chamfers capped at `0.09` model units
    (or 24% of the smallest dimension); rounded cylinders use
    `min(0.075, depth × 0.22, radius × 0.18)`. Building roof courses use
    `0.055–0.065` bevels with 3 segments. Shared troop primitives keep their
    existing narrower bevels; do not enlarge unit silhouettes as part of environment work.
* **Color Gradients:**
  * Standalone building, prop and troop sprites carry a vertical color gradient:
    darker at ground contact and brighter at upper peaks. Baked terrain and edge
    flora use explicit materials without the sprite-only `VerticalShade` multiply.
  * Buildings use a deeper ramp (`0.62 → 1.22`) than shared props/units (`0.80 → 1.12`): fortress volumes ground harder and crown brighter, so the 2.5D depth reads at sprite size.

---

## 7. VFX & Feedback Language

Feedback must be punchy, juicy, and proportional to the action:

| Event | Visual Feedback | Audio / Haptic |
| :--- | :--- | :--- |
| **Territory Capture** | Squash-and-stretch scale pop (`1.25x`), expanding shockwave ring in team color, floating `+X` numbers | Triumphant major chord + Heavy haptic thud |
| **Friendly Reinforcement** | Soft bounce (`1.08x`), glowing green floaters `+X` | Bright chime + Light haptic pip |
| **Defended Combat** | 3-frame lateral shudder, red damage floating numbers `-X` | Soft impact thud + Medium haptic |
| **Marching Convoy** | Directional micro-dots trailing behind lead unit, rhythmic squad bobbing | Low travel whoosh |
| **Victory Fanfare** | Full-screen celebration flash (`#2563EB`), confetti burst, Victory card entrance | Ascending victory fanfare + Triple haptic pulse |

### Living-board ambience (idle, always on)

* Two soft **cloud shadows** drift across every battlefield on slow Lissajous paths
  (periods of minutes, centre alpha ≤ 0.13 fading to 0), rendered above the tactical
  lanes (depth 3) and below every prop, platform and unit — they shade ground and
  roads only, never gameplay objects. On the near-black backdrop outside the plate a
  dark shadow is invisible, so tall viewports need no clipping.
* **Pennant props sway** a few degrees (±2.5°) around their bottom anchor on
  sine loops with staggered phases, so the field never moves in lockstep.
* Both layers are **skipped entirely under `prefers-reduced-motion`** and cost two
  images plus two sines per frame — no particles, no camera motion.
* On viewports taller than the plate image (tablets / desktop portrait) the diorama
  gets miniature framing: a soft contact shadow under the baked slab skirt and a
  faint cool glow behind the board. Phones crop the plate, so the layers stay off.

---

## 8. Asset Master & Export Specifications

### Master Assets (Blender Output)
* **Format:** 32-bit PNG with transparent alpha.
* **Master Resolution:** `512 × 512` pixels per state.
* **Bit Depth:** 8-bit per channel (sRGB).
* **Color Space:** AgX with the medium-high contrast look in the production builder.

### Runtime Game Assets (Phaser Client)
* **Format:** Optimized WebP with alpha; an atlas is optional when measured to help.
* **Runtime Resolution:** `128 × 128` (Tiers 1 & 2), `160 × 160` (Tier 3 Citadel).
* **Filtering:** Linear interpolation with antialiasing; runtime mipmaps are not configured.

### File Naming Convention

Use the manifest's exact `blenderRenderName` for PNG masters and `runtimeFilename`
for shipped WebP files. For example, `tier1_watchtower_player_idle.png` becomes
`outpost_player.webp`; dedicated packs live in their battlefield directory.

---

## 9. Blender Python Automation Script

Use `art/blender/build_battlefield_scene.py` for every environment export. It clears
the scene, configures the locked camera, key/fill/rim energies `2.2 / 0.8 / 1.35`,
world ambient `0.28`, material palette and deterministic render seed, then renders
the manifest-selected kit. Avoid independent illustrative rigs that drift from the
actual production setup. `art/asset-manifest.json` drives render names, GameScene
preload and runtime optimization; `docs/art/README.md` lists commands.

---

## 10. Terrain Proportions (2.5D Arena)

* **Arena floor:** one rendered ground plate per battlefield (`grounds` pack),
  placed at depth 1. All four boards use the 45°/0° dimetric rig and the same
  `1140 × 2502` PNG master → `760 × 1668` runtime WebP. The plate covers the
  `380 × 640` tactical rect with designed scenery extending 250 world units at
  each end; phone viewports crop this fringe symmetrically.
* **Baked terrain:** roads and raised plinths come from the authoritative
  `battlefields.json`. Natural, broad grass color masses replace repeated stripes;
  soft height relief and focused border dressing provide depth. Worn road edges
  remain continuous and readable. The grass material carries broad light variation;
  avoid translucent sun-pool discs intersecting the terrain. Crown Cross has royal
  garden borders; Twin Passes has a river, banks and a crossing bridge; Royal Ring has segmented hedges
  around its palace court; Quad Citadel has four trampled camps and border rocks.
  Keep the contested center quiet and the top/bottom fringe deliberately composed.
* **Vector fallback:** if a plate is missing or inactive, GameScene uses its existing
  flat painted layers. The environment revision preserves this loading-error path.
* **Grass dressing:** dense, low clover rosettes and broad short grass blades fill
  the available meadow between routes; taller clumps concentrate in the fringe.
  Use living green material tones and soft contact shadows. Grass/leaf anchors
  avoid roads, sockets and reserved river/court zones; camp cores remain trampled,
  with greenery reclaiming their outer verges. Bake the cover into the ground plate
  so texture dimensions, runtime prop counts and draw calls do not grow.
* **Territory platforms:** socket radius = `territory radius + 5px`, except the
  top citadel (`32px`) and Quad Citadel's bespoke sockets (`23/36/29px` for
  tiers 1/2/3); Quad Citadel needs these compact sizes because its
  base/corner centers are only sqrt(3400) px apart). Bases (Tier 3, r=36) read ~3×
  larger than the smallest prop. Platform and sprite sizes are presentation-only and
  scale with the board layout, so the separation between adjacent platforms reads
  identically from 360px to 430px wide phones; hit areas stay `radius × 2.5`.
* **Vertical relief:** buildings may rise above their platform (sprite anchored
  bottom-center on the plinth top — `PLINTH_TOP_LIFT`), and on the diorama board the
  playfield itself rises too (plinth platforms, extruded slab skirt) through the fixed
  45°/0° dimetric projection. No terrain parallaxes.

## 11. Road Appearance

* Roads are *recessed stone processional lanes*: a dark contact shadow pass, a solid
  stone-surface pass in the battlefield's `visual.road` color, then a dotted center
  inlay in `visual.roadInlay`.
* On the baked ground plate, the same roads are baked into the plate (dirt roads with
  organic sine-jittered edges, broken paving and dry-grass shoulders) from the authoritative
  segments. Over a plate the vector layer thins to a **single soft recessed lane**
  (~12px, shadow color, ≤ 0.06 alpha) plus quiet inlay dots (≤ 0.06 alpha): the
  baked dirt road carries the visuals and the vector lane is only the tactical route
  guide — no second road surface, no terminals, no cobbled joints. The full
  three-pass treatment (22px shadow / 17px shoulder / 11px stone / terminals / joints) renders only
  on the vector fallback when no plate loaded.
* Fallback width: 22px shadow / 17px shoulder / 11px stone. Roads must never exceed the territory socket
  diameter, so marching convoys visually travel *between* platforms, not over them.
* A subtle key-light rim may run along the top-left edge of each lane (single 1px
  pass, warm champagne, ≤ 0.2 alpha) — the lane must still read as recessed, not raised.

## 12. Decorative-Object Scale & Placement

* Environment props (rendered trees, bushes, grass tufts, rocks, pennants) are
  **ambiance only** and non-interactive. They are rendered sprites from the shared
  `environment` pack, bottom-anchored on the ground plane.
* Small props (bush, grass, rock, pennant) stay under ~64 logical px tall; trees may
  reach ~104px but are edge-only (x < 130 or x > 270 on the 400px field) so the
  contested middle stays readable.
* Props are forbidden within `territory radius + 24px` (small props) to `+44px` (trees)
  of any territory center, and within 12–20px (per kind) of any road segment; placements
  are generated against the authoritative geometry
  (`scripts/generate-arena-props.mjs`) and re-validated by `BattlefieldArt.test.ts`.
* Art-only reserved features live in `art/arena-dressing-zones.json`, in logical
  world coordinates: Twin Passes river/banks `x 166–234, y 133–653`; Royal Ring
  court radius `108` around `(200, 360)`. Boundaries are inclusive; no prop anchor
  or ground scatter may land inside them. This file never changes gameplay data.
* Budget: ≤ 24 static props per battlefield, created once at scene build. They render
  above roads (depth 2) and below **every** territory platform — flat depth 10 under
  the whole territory band on both layouts (identity: 20; diorama: painter band) —
  so no tree or bush can ever cover a building regardless of screen position: props
  frame the board, gameplay objects always stay on top.

## 13. Line Weight & Edge Treatment

* Silhouette outline: 2–2.5px (team-dark color) on every interactive object.
* Ownership ring: one 2px team-primary stroke at 0.92+ alpha with 0.06 glow fill.
  On baked plinths the redundant dark base-plate stroke is hidden, including after
  capture. The vector fallback retains its dark base plate for grounding.
* Grid/motif lines: 1–2px at ≤ 0.16 alpha — structure, never noise. Wide-spaced
  technical grain is capped at 0.05 alpha so it can never turn the terrain into graph
  paper on a phone-sized board.
* Every bevel/edge highlight is a single pass (no stacked strokes); glow only from
  the pre-defined `glow` team color at ≤ 0.06 fill alpha on ownership rings.

## 14. Canonical Resolutions

| Stage | Format | Size | Notes |
| :--- | :--- | :--- | :--- |
| Blender master render | PNG, RGBA, transparent film | 512 × 512 per asset | fixed ortho rig, AgX view transform |
| Blender ground master | PNG, RGBA, transparent film | 1140 × 2502 per battlefield | every board uses the 45°/0° dimetric rig with composed meadow fringe |
| Runtime territory sprite | WebP (alpha) or optimized PNG | 128 × 128 (tiers 1–2), 160 × 160 (tier 3) | linear filtering at runtime |
| Runtime ground plate | WebP (alpha) | 760 × 1668 | unchanged projection and raised plinths; includes top/bottom scenery |
| Runtime atlas (optional) | WebP atlas | ≤ 1024 × 1024 | only when it reduces requests without hurting maintainability |
| Units | PNG | 128 × 128 | existing shared troop pack; leader/follower × player/enemy × front/back/side facings |

Budgets (section 14): territory/prop sprites stay under 80KiB each; a full-field ground
plate stays under 128KiB (one plate loads per match); territory sprites plus the
battlefield's ground plate stay under 500KiB. Report shared assets and decoded
texture memory separately.

## 15. Mobile Readability Requirements

* Ownership (team color + ring), type (role icon), and unit count must be readable
  on small phones, including 360 × 800 and 375 × 667, without zooming.
* Minimum on-screen territory diameter: ~44 physical px at DPR 2 on a 360px viewport.
* Unit badges: ≥ 38 × 22 logical px with ≥ 14px bold numerals.
* Contrast: unit numerals and role badges stay legible over every terrain color;
  muted prop palettes and broad foliage shapes preserve ownership emphasis. Props
  use their declared `ARENA_PROP_DISPLAY` alpha (0.9–1), not a second faded layer.
* Verify at 375 × 667, 360 × 800, 390 × 844, and 430 × 932 before shipping a visual change;
  inspect empty state, marching armies, selection, drag, capture and tutorial.

## 16. Typography

Fonts are bundled and self-hosted (`apps/game/public/fonts`), registered via
`@font-face` in `index.html`, and loaded before Phaser boots (`loadGameFonts` in
`main.ts`). Never load them from a CDN: players on Bale/Eitaa sit in Iran, where
third-party font CDNs are unreliable. Both families are SIL OFL licensed.

| Face | Weights bundled | Role |
| :--- | :--- | :--- |
| Baloo 2 (`FONT_FAMILY`) | 700, 800 | Every label, button, title, and HUD string — chunky rounded display text |
| JetBrains Mono (`MONO_FONT_FAMILY`) | 400, 700 | Width-stable digits: timers, unit counts, score pills |

Rules:

* All canvas text is created through `createText` (`src/ui/TextStyles.ts`), which
  injects the display font, a default weight of 700, and `resolution: renderScale`
  so glyph textures stay crisp under the camera zoom on high-DPI phones. Callers
  override for weight-800 titles (`fontStyle: '900'` maps to the 800 face) or mono
  digits (`fontFamily: MONO_FONT_FAMILY`).
* Never request a weight that is neither bundled nor a CSS alias of one: the font
  shorthand would silently fall back to a system face. Requested 900 resolves to the
  bundled 800; use 700/800 explicitly where possible.
* The loading shell in `index.html` uses the same stack (Baloo 2 800 for the title)
  so the first frame matches in-game typography.
* Persian/Arabic-script player names are not covered by the bundled Latin faces:
  they render through the per-glyph system fallback, exactly as before.
* Strokes on gameplay-critical text follow section 13's line-weight rules
  (single dark stroke, no stacked outlines).
