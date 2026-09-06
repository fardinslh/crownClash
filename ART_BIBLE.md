# Crown Clash — Art Bible & Visual Direction
**Version:** 1.0  
**Target Platform:** Mobile WebViews (Bale, Eitaa, Telegram, Mobile Web)  
**Visual Style:** Stylized 2.5D (Rendered from Blender → 2D Texture Atlas at Runtime)  
**Primary Goal:** Maximum instant tactical readability, vibrant stylized toy-like charm, and high-end visual polish on compact mobile screens.

---

## 1. Visual Pillars

1. **Instant Readability at Arm’s Length:**  
   Players on 5-inch to 6.7-inch mobile screens must immediately recognize territory ownership, tier, and unit strength in under 100 milliseconds.
2. **Chunky & Stylized (Toy-Like Miniature Realm):**  
   Thick silhouettes, exaggerated bevels, soft contact shadows, and tactile materials (stonework, polished wood, royal metals, bold cloth banners). Avoid photo-realism or thin, fragile geometry.
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
| **Rotation (Euler)** | `X: 55.0°, Y: 0.0°, Z: 45.0°` | Classic 2.5D dimetric perspective; showcases roof and front facades equally. |
| **Orthographic Scale** | `6.0` (standard 2m asset) | Keeps all assets rendered at identical relative scale. |
| **Clip Start / End** | `0.1m` / `100.0m` | Avoids Z-fighting or camera clipping. |

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

    # Position camera: 55° pitch, 45° yaw
    cam_obj.location = (10.0, -10.0, 12.0)
    cam_obj.rotation_euler = (math.radians(55.0), 0.0, math.radians(45.0))

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
