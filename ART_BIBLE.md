# Crown Clash — Art Bible & Visual Direction
**Version:** 1.1
**Target Platform:** Mobile WebViews (Bale, Eitaa, Telegram, Mobile Web)
**Visual Style:** Stylized 2.5D (Rendered from Blender → 2D Texture Atlas at Runtime)
**Primary Goal:** Maximum instant tactical readability, vibrant stylized toy-like charm, and high-end visual polish on compact mobile screens.

**v1.1 additions:** terrain proportions, road appearance, decorative-object scale, line
weight & edge treatment, canonical resolution standards, mobile readability rules, and
the Blender source pipeline (see `docs/art/README.md`). The authoritative scene-builder
script is `art/blender/build_battlefield_scene.py`.

---

## 1. Visual Pillars

1. **Instant Readability at Arm’s Length:**
   Players on 5-inch to 6.7-inch mobile screens must immediately recognize territory ownership, tier, and unit strength in under 100 milliseconds.
2. **Believable Miniatures (Semi-Realistic Direction):**
   Realistic medieval silhouettes at miniature scale — human-scale doors, voussoir
   arches, framed windows, natural foliage — with tight edge bevels and grounded
   contact shadows. Detail must survive downscaling to 64–160px sprites; thin, fragile
   geometry and photographic noise are still avoided.
3. **High Color Contrast:**
   Bright, saturated team accents against a rich, dark tactical arena background.
4. **Strict Asset Cohesion:**
   Every visual asset—whether handcrafted or assisted by AI—must share identical camera projection, lighting direction, material roughness, and line weight. Assets must never appear as if they were assembled from random asset stores.

---

## 2. Camera & Projection Standards

All 3D source assets rendered in Blender must use a **locked orthographic camera rig**. This ensures perfect 2.5D alignment when rendered as 2D sprites in Phaser.

| Property | Value | Rationale |
| :--- | :--- | :--- |
| **Camera Type** | `Orthographic` | Eliminates perspective distortion across different screen positions. |
| **Rotation (Euler)** | `X: 45.0°, Y: 0.0°, Z: 0.0°` | Straight-on dimetric (Clash Royale-style diorama): the camera sits due south of the subject at a 45° pitch, so every sprite grounds on the board exactly like the client's board projection (`apps/game/src/art/boardProjection.ts` — same pitch, yaw 0). |
| **Orthographic Scale** | `6.0` (standard 2m asset) | Keeps all assets rendered at identical relative scale. |
| **Clip Start / End** | `0.1m` / `100.0m` | Avoids Z-fighting or camera clipping. Ground diorama plates use a 300-unit stand-off with a 600-unit far clip (see `build_battlefield_scene.py` GROUND_DIORAMA_*). |

### Board Projection & Diorama Ground Plates

The battlefield itself is authored in a **flat authoritative world space** (380×640 logical px, `battlefields.json`; server simulation, roads and hit radii are untouched). Every battlefield renders that world through an affine dimetric projection in `boardProjection.ts`:

* `project(x, y)` maps world → screen at 45° pitch (foreshorten = cos 45°): ground circles become ellipses, roads recede, gameplay objects sort by screen Y (painter's algorithm).
* `unproject` reverses it for hit testing; `PLINTH_TOP_LIFT` anchors territory visuals on the raised plinth tops baked under every socket (6.2 world px — must track `DIORAMA_PLINTH_HEIGHT - DIORAMA_PLINTH_SINK + DIORAMA_PLINTH_LIP_RISE` in `crown_cross_kit.py`).
* Every battlefield's ground plate (1140×2502 master, 760×1668 runtime WebP) is rendered through the same rig, centered on the world rect (`GROUND_DIORAMA_AIM` = plane (0,0,0)), so image rows map world y at exactly the projection's v formula — the baked roads and plinths land under the projected sockets 1:1. The plate bakes a 250-unit meadow fringe beyond each end of the 640-unit world rect, so tall viewports fill with board while shorter ones crop the fringe symmetrically (no empty backdrop on any phone).
* Boards without a dimetric plate (grounds pack inactive, or a future flat-shipped map) fall back to the stretched identity layout: pixel-identical to the flat board at the 400×720 baseline, stretching vertically to fill taller viewports (`DIMETRIC_BATTLEFIELDS` gates the rollout).

---

## 3. Lighting Rig & World Setup

A standardized 3-point stylized lighting rig creates consistent depth, warm top highlights, and cool ambient shadows.

```
                  [ Key Light (Sun) ]
                 Top-Left (45° azimuth, 60° elevation)
                 Warm Sunlight (#FFF5E6, Energy: 4.0)
                         \
                          \
   [ Rim Light ]           [ 3D Model ]           [ Fill Light (Sky) ]
   Back-Right              Center (0,0,0)         Opposite Key
   Pure White (#FFFFFF)                           Cool Sky Blue (#A8D2FF)
   Energy: 2.5                                    Energy: 1.5
```

### Lighting Parameters
* **Key Light (Sun):**
  * Type: `Sun`
  * Rotation: `X: 45°, Y: 25°, Z: -40°`
  * Color: Warm Champagne `#FFF5E6`
  * Strength: `4.0`
  * Shadow Softness / Angle: `0.15 rad` (crisp contact shadows with subtle edge softening).
* **Fill Light (Area / Sky):**
  * Type: `Sun` or `Large Area Light`
  * Color: Cool Sky Blue `#A8D2FF`
  * Strength: `1.5`
  * Purpose: Injects cool ambient tones into shadows, preventing pitch-black contrast.
* **Rim Light (Backlight):**
  * Type: `Spot` or `Sun` pointing toward the camera from behind the model.
  * Color: Clean Rim White `#FFFFFF`
  * Strength: `2.8`
  * Purpose: Carves strong silhouette separation between the building edges and the arena floor.
* **World Ambient:**
  * Background Color: Neutral Slate `#161B26`
  * Ambient Strength: `0.4`
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
* **Banners & Roof Tiles:** Dyed in the exact Team Primary color to establish immediate ownership.
* **Stone Structures:** Neutral warm/cool gray stonework `#475569` with beveled edges and moss/crevice shading.
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
  * Single cylindrical stone tower with wooden conical tiled roof.
  * 1 small team pennant flag.
  * Compact footprint.
* **Tier 2 — Crown Keep (Center Strategic Stronghold):**
  * Octagonal reinforced ramparts, heavy stone battlements, central gilded crown spire.
  * Two team banners draped over stone walls.
* **Tier 3 — Citadel / Capital Base (Player & Enemy HQ):**
  * Grand fortified keep flanked by twin defensive turrets and reinforced archway gate.
  * Massive team banner, gilded masonry corners, prominent visual weight.

**Crown Cross kit (approved semi-realistic direction):** believable medieval
silhouettes at miniature scale — slate stone with pale trim courses, voussoir arches,
framed windows, corner quoins and human-scale doors; tight 0.02–0.03 edge bevels instead
of toy-rounds; only roofs, banners and shields carry team color. Citadels are curtain-wall
keeps with corner towers, a gatehouse and a pitched-roof keep; the Crown Keep is a
crenellated octagon with a gilded crown ring; outposts are stone watchtowers with timber
watch rooms; barracks are quoined stone halls with a chimney; stables are half-timbered
plaster halls with open stalls. Each building bakes its own tight contact shadow
(`contact_disc`), never the wide rig blob. Models live in `art/blender/crown_cross_kit.py`,
render through the canonical rig, and use per-builder crops (`CAMERA_FRAMING`) that never
change the 45°/0° view.

**War shape & 2.5D depth (every fortress):** buildings read as war architecture, not
houses — timber fighting galleries (hoardings) project from the curtain walls of citadels,
ring the keep's outer wall and bretèche the outpost shaft; every gate hangs an iron
portcullis grille; merlons are heavy and machicolations overhang the towers; barracks and
stables carry corbie-step gables and pennant poles at the gable corners; stables jetty a
hay loft over the stalls under its own pitched roof. Depth reads through baked seams:
dark shadow strips under every hoarding floor, roof eave and the jetty, stepped
three-course plinths, chunky chamfered edges (0.03 bevels, 3 segments) and a deeper
vertical ramp for buildings (0.62/1.22 vs the shared 0.80/1.12 props/units ramp), all
inside the unchanged per-builder framing crops.

**Per-map fortress themes:** every battlefield's buildings are the same architecture
family built from that map's local materials, so fortresses always look like they belong
to their own meadow (kit `_BUILDING_THEMES` + themed builders `build_highland_*` /
`build_palace_*` / `build_warcamp_*` in `build_battlefield_scene.py`):

* **Crown Cross** — slate stone, pale trim (`build_cross_*`): the reference look.
* **Twin Passes** — rough highland granite, pale schist trim, heavy oak lintels, and a
  jittered crag-stone ring around every base (`build_highland_*`).
* **Royal Ring** — cream limestone, pale marble trim, rich gold ornament (keystone,
  parapet caps, collar bands, taller crown points) and polished iron (`build_palace_*`).
* **Quad Citadel** — dark war-camp timber, aged wood trim, canvas and hay, matte-iron
  banding, and a pointed-log palisade ring around every base (`build_warcamp_*`).

Ownership readability never changes: team color always lives on roofs, banners and
shields in every theme.

**Shared troops:** four sprites (leader/follower x player/enemy) of an armoured knight in
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
  * Stone masonry: `0.65 – 0.80` (chalky, solid).
  * Wood beams/timber: `0.50 – 0.65` (treated wood).
  * Cloth banners: `0.70 – 0.85` (velvet/cotton feel).
  * Gold crowns / Iron trim: `0.25 – 0.40` with `Metallic: 0.8 – 1.0` (smooth specular glints).
* **Beveling Mandatory:**
  * No 90° razor-sharp edges! Every sharp edge must have a 2-segment bevel with `width: 0.04m` to catch specular edge highlights from the sun.
* **Color Gradients:**
  * Vertical color gradient applied to all models: slightly darker at ground contact, slightly brighter at upper peaks (simulates atmospheric bounce).
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
* **Color Space:** AgX or Filmic standard with medium-high contrast.

### Runtime Game Assets (Phaser Client)
* **Format:** WebP texture atlas (lossless or 90% quality lossy).
* **Runtime Resolution:** `128 × 128` (Tiers 1 & 2), `160 × 160` (Tier 3 Citadel).
* **Mipmapping:** Enabled for smooth scaling across high-DPI retina screens.

### File Naming Convention
```
territory_{tier}_{owner}_{state}.png

Examples:
territory_tier1_neutral_idle.png
territory_tier1_player_idle.png
territory_tier1_enemy_idle.png
territory_tier2_center_idle.png
territory_tier3_player_hq.png
territory_tier3_enemy_hq.png
unit_convoy_player.png
unit_convoy_enemy.png
```

---

## 9. Blender Python Automation Script

To guarantee that any 3D asset rendered for Crown Clash obeys the exact camera, lighting, and render settings, the following Python script can be run inside Blender:

```python
import bpy
import math

def setup_crown_clash_scene():
    # 1. Clean default scene objects
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)

    # 2. Setup Orthographic Camera
    cam_data = bpy.data.cameras.new(name="CrownClash_OrthoCam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 6.0
    cam_data.clip_start = 0.1
    cam_data.clip_end = 100.0

    cam_obj = bpy.data.objects.new("CrownClash_OrthoCam", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    # Position camera: 45° pitch, 0° yaw (dimetric)
    cam_obj.location = (0.0, -12.0, 12.0)
    cam_obj.rotation_euler = (math.radians(45.0), 0.0, 0.0)

    # 3. Setup Key Light (Sun)
    key_light_data = bpy.data.lights.new(name="Key_Sun", type='SUN')
    key_light_data.energy = 4.0
    key_light_data.color = (1.0, 0.96, 0.90) # Warm Champagne
    key_light_data.angle = math.radians(8.5)
    key_light_obj = bpy.data.objects.new("Key_Sun", key_light_data)
    key_light_obj.rotation_euler = (math.radians(45.0), math.radians(25.0), math.radians(-40.0))
    bpy.context.collection.objects.link(key_light_obj)

    # 4. Setup Fill Light (Sky Sun)
    fill_light_data = bpy.data.lights.new(name="Fill_Sky", type='SUN')
    fill_light_data.energy = 1.5
    fill_light_data.color = (0.65, 0.82, 1.0) # Cool Sky Blue
    fill_light_obj = bpy.data.objects.new("Fill_Sky", fill_light_data)
    fill_light_obj.rotation_euler = (math.radians(-30.0), math.radians(-15.0), math.radians(140.0))
    bpy.context.collection.objects.link(fill_light_obj)

    # 5. Render Settings (512x512 Transparent PNG)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES' # or 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'

    print("Crown Clash Blender scene configured successfully.")

if __name__ == "__main__":
    setup_crown_clash_scene()
```

The canonical, full-featured scene builder is `art/blender/build_battlefield_scene.py`
(deterministic camera, lighting rig, material palette, named collections, and headless
render CLI). Its render kit is driven by the canonical runtime asset manifest,
`art/asset-manifest.json`, which also drives GameScene preload and the optimizer.
The snippet above is illustrative only.

---

## 10. Terrain Proportions (2.5D Arena)

* **Arena floor:** a single rendered ground plate per battlefield (`grounds` pack,
  spriteKind `ground`), covering the full tactical area (380 × 640 logical px) and
  placed at depth 1. Territory platforms, roads, props and units render on top of the
  plate; the plate never scrolls. Identity boards ship 760 × 1280 WebP plates; the
  diorama board (Crown Cross) ships 760 × 960 — the plate image is centered on the
  projected world rect and additionally carries the baked plinth headroom above and
  extruded slab skirt below (see section 2, Board Projection).
* **Baked terrain:** each plate is rendered in Blender from the authoritative
  `battlefields.json` geometry — roads, sockets and identity zones can never drift
  from gameplay. Un-migrated battlefields render straight top-down; diorama
  battlefields (Crown Cross) render through the same 45°/0° dimetric rig as the
  sprites, so the playfield itself carries depth: an extruded two-course earth-slab
  skirt under the meadow and a raised stone plinth with a proud lip under every
  territory socket (plinth radius mirrors the client `socketRadius` 1:1, lip mirrors
  `plateRadius`). Every battlefield is a meadow: Crown Cross a quiet royal
  meadow with mow-stripe rings and one worn green court at the contested centre; Twin
  Passes a highland pasture with a brook, banks, crags and faint mow stripes; Royal Ring
  a manicured palace lawn with gravel courts and a hedge ring; Quad Citadel an olive
  war-camp meadow with four trampled dirt camps and crossroads. Plates carry 3D
  micro-relief (deterministic trig dunes that catch the sun, pressed flat under roads,
  sockets and plate borders), clustered scatter (grass tufts, tall patches, flower and
  clover clusters, pebbles, sparse shoulder grass reclaiming the lane edges) rooted on
  the relief, three soft warm sun pools per battlefield (stacked alpha-stepped discs,
  total centre lift ≤ 0.05, fixed positions clear of the centre identity feature), and
  organic-edged dirt roads with dry-grass shoulders.
* **Vector fallback:** if the ground pack is inactive or a plate fails to load,
  GameScene falls back to the flat painted vector ground layers; the baked plate simply
  replaces them when present (`if (!ground)` gates in `GameScene.createArenaBackground`).
* **Grass dressing:** rendered grass tufts scatter across every battlefield
  (9–11 per map, see the environment pack) at prop layer depth, plus low-contrast
  painted blades on the Crown Cross floor. Grass never overlaps sockets, roads
  or the arena frame (enforced by BattlefieldArt tests).
* **Territory platforms:** circular, diameter = `2 × territory radius` (+5px ownership
  ring/plinth; Quad Citadel tunes bespoke sockets — 23/29/36 by tier — because its
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
  organic sine-jittered edges, ruts and dry-grass shoulders) from the authoritative
  segments. Over a plate the vector layer thins to a **single soft recessed lane**
  (~12px, shadow color, ≤ 0.14 alpha) plus quiet inlay dots (≤ 0.10 alpha): the
  baked dirt road carries the visuals and the vector lane is only the tactical route
  guide — no second road surface, no terminals, no cobbled joints. The full
  three-pass treatment (18px shadow / 12px stone / terminals / joints) renders only
  on the vector fallback when no plate loaded.
* Width: 18px shadow / 12px stone. Roads must never exceed the territory socket
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
* Budget: ≤ 24 static props per battlefield, created once at scene build. They render
  above roads (depth 2) and below **every** territory platform — flat depth 10 under
  the whole territory band on both layouts (identity: 20; diorama: painter band) —
  so no tree or bush can ever cover a building regardless of screen position: props
  frame the board, gameplay objects always stay on top.

## 13. Line Weight & Edge Treatment

* Silhouette outline: 2–2.5px (team-dark color) on every interactive object.
* Ownership ring: 2.5px at 0.92+ alpha — the strongest consistent line on screen.
* Grid/motif lines: 1–2px at ≤ 0.16 alpha — structure, never noise. Wide-spaced
  technical grain is capped at 0.05 alpha so it can never turn the terrain into graph
  paper on a phone-sized board.
* Every bevel/edge highlight is a single pass (no stacked strokes); glow only from
  the pre-defined `glow` team color at ≤ 0.12 fill alpha.

## 14. Canonical Resolutions

| Stage | Format | Size | Notes |
| :--- | :--- | :--- | :--- |
| Blender master render | PNG, RGBA, transparent film | 512 × 512 per asset | fixed ortho rig, AgX/Filmic view transform |
| Blender ground master | PNG, RGBA, transparent film | 1140 × 1920 per battlefield | top-down identity plates; diorama plates 1140 × 1440 through the 45°/0° dimetric rig |
| Runtime territory sprite | WebP (alpha) or optimized PNG | 128 × 128 (tiers 1–2), 160 × 160 (tier 3) | crisp at 2× DPR; mipmapped |
| Runtime ground plate | WebP (alpha) | 760 × 1280 identity, 760 × 960 diorama | 1:1 with the 380 × 640 logical field at 2× DPR; the diorama plate adds baked plinth headroom + slab skirt |
| Runtime atlas (optional) | WebP atlas | ≤ 1024 × 1024 | only when it reduces requests without hurting maintainability |
| Units | WebP/PNG | 64 × 64 | small on-screen footprint; leader/follower × player/enemy × front/back/side facings |

Budgets (section 14): territory/prop sprites stay under 80KB each; a full-field ground
plate stays under 128KB (one plate loads per match); a battlefield's whole runtime set
(sprites + its ground plate) stays under 500KB.

## 15. Mobile Readability Requirements

* Ownership (team color + ring), type (role icon), and unit count must be readable at
  360 × 800, the smallest supported viewport, without zooming.
* Minimum on-screen territory diameter: ~44 physical px at DPR 2 on a 360px viewport.
* Unit badges: ≥ 38 × 22 logical px with ≥ 14px bold numerals.
* Contrast: team primaries against the meadow green floor ≥ 4.5:1; prop alpha ≤ 0.35 so
  ambiance never competes with ownership color.
* Verify at 360 × 800, 390 × 844, and 430 × 932 before shipping a visual change.
