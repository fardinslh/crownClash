#!/usr/bin/env python3
"""Crown Clash battlefield scene builder (Blender Python).

Builds the standard Crown Clash 2.5D render scene and renders the sprite kit
declared in the canonical runtime asset manifest (`art/asset-manifest.json`),
per ART_BIBLE.md sections 2-8 and 10-14:

  - fixed orthographic dimetric camera (55 deg pitch / 45 deg yaw), aimed at
    the asset origin via a track-to constraint
  - fixed three-point lighting rig (warm key, cool fill, white rim)
  - fixed world ambient (slate #161B26, strength 0.4)
  - controlled Principled-BSDF material palette (Art Bible palette), rebuilt
    after every scene clear so materials always have live users
  - named collections: CC_Terrain, CC_Roads, CC_Structures, CC_Props,
    CC_Shadows, CC_Foreground
  - deterministic render configuration (fixed seed, no noise variation,
    `--samples` controls Cycles samples, `--opaque` disables film
    transparency)
  - transparent-background PNG masters at 512x512

The set of rendered assets comes from the manifest: for a pack render, every
sprite entry's `blenderRenderName`/`blenderBuilder`/`blenderOwner` triple is
rendered exactly once. Asset/kit combinations are validated (and the manifest
loaded) *before* the `bpy` module is required, so bad invocations fail fast on
machines without Blender.

Run headless (verified with Blender 5.2.2 LTS; works with any recent Blender):

  blender --background --factory-startup --python art/blender/build_battlefield_scene.py -- \\
      --pack crown_cross --output art/blender/renders/crown_cross

Render one asset from a pack:

  blender --background --factory-startup --python art/blender/build_battlefield_scene.py -- \\
      --pack crown_cross --asset tier3_player_hq --output art/blender/renders/single

Render one authoring-only prop (not part of any runtime pack):

  blender --background --factory-startup --python art/blender/build_battlefield_scene.py -- \\
      --asset prop_crystal_cluster --output art/blender/renders/props

The script only uses the `bpy` module shipped with Blender and the Python
standard library. It never reads network resources and never writes outside
the requested output directory.
"""

import argparse
import json
import math
import os
import sys

# ---------------------------------------------------------------------------
# Art Bible constants (single source of truth mirrored from ART_BIBLE.md)
# ---------------------------------------------------------------------------

CAMERA_PITCH_DEG = 55.0
CAMERA_YAW_DEG = 45.0
CAMERA_DISTANCE = 12.0
CAMERA_ORTHO_SCALE = 6.0
CAMERA_CLIP_START = 0.1
CAMERA_CLIP_END = 100.0

KEY_LIGHT_COLOR = (1.0, 0.96, 0.90)       # warm champagne #FFF5E6
KEY_LIGHT_ENERGY = 4.0
KEY_LIGHT_ANGLE_RAD = 0.15
FILL_LIGHT_COLOR = (0.66, 0.82, 1.0)      # cool sky blue #A8D2FF
FILL_LIGHT_ENERGY = 1.5
RIM_LIGHT_COLOR = (1.0, 1.0, 1.0)
RIM_LIGHT_ENERGY = 2.8
WORLD_AMBIENT_COLOR = (0x16 / 255, 0x1B / 255, 0x26 / 255)  # slate #161B26
WORLD_AMBIENT_STRENGTH = 0.4

MASTER_RESOLUTION = 512

# Art Bible palette (linear-ish sRGB hex -> normalized RGB)
PALETTE = {
    "team_player": (0x25 / 255, 0x63 / 255, 0xEB / 255),   # #2563EB
    "team_enemy": (0xDC / 255, 0x26 / 255, 0x26 / 255),    # #DC2626
    "team_neutral": (0x64 / 255, 0x74 / 255, 0x8B / 255),  # #64748B
    "stone": (0x47 / 255, 0x55 / 255, 0x69 / 255),         # #475569
    "stone_dark": (0x33 / 255, 0x41 / 255, 0x55 / 255),    # #334155
    "iron": (0x33 / 255, 0x41 / 255, 0x55 / 255),          # #334155
    "gold": (0xF5 / 255, 0x9E / 255, 0x0B / 255),          # #F59E0B
    "gold_light": (0xFD / 255, 0xE0 / 255, 0x47 / 255),    # #FDE047
    "wood": (0x8B / 255, 0x5E / 255, 0x3C / 255),          # treated timber
    "roof_player": (0x25 / 255, 0x63 / 255, 0xEB / 255),
    "roof_enemy": (0xDC / 255, 0x26 / 255, 0x26 / 255),
    "roof_neutral": (0x47 / 255, 0x55 / 255, 0x69 / 255),
    "crag": (0x8B / 255, 0x95 / 255, 0xA7 / 255),          # light weathered rock #8B95A7
    "crystal": (0x93 / 255, 0xC5 / 255, 0xFD / 255),       # #93C5FD
}

BEVEL_WIDTH = 0.04
BEVEL_SEGMENTS = 2

COLLECTIONS = ("CC_Terrain", "CC_Roads", "CC_Structures", "CC_Props", "CC_Shadows", "CC_Foreground")

DEFAULT_MANIFEST_PATH = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "asset-manifest.json")
)

# Authoring-only assets. These builders exist for previews and the future
# arena-layer milestone; they are deliberately NOT referenced by any runtime
# pack in the manifest, so they are never rendered by `--pack` and never ship
# unused runtime files. `--asset` can still render them for authoring.
EXTENDED_ASSETS = {
    "prop_crystal_cluster": ("build_crystal_cluster", "neutral"),
    "prop_stacked_stones": ("build_stacked_stones", "neutral"),
    "prop_petite_pennant": ("build_pennant", "player"),
    "road_segment_straight": ("build_road_segment", "neutral"),
    "terrain_platform_tile": ("build_platform_tile", "neutral"),
}

VALID_OWNERS = ("player", "enemy", "neutral")


def fail_with_usage_error(message):
    """Validation failure BEFORE any Blender dependency is required (exit 2)."""
    sys.stderr.write(f"[build_battlefield_scene] {message}\n")
    raise SystemExit(2)


# ---------------------------------------------------------------------------
# Manifest loading + validation (pure stdlib: no bpy required)
# ---------------------------------------------------------------------------

def load_asset_manifest(manifest_path):
    try:
        with open(manifest_path, "r", encoding="utf-8") as handle:
            manifest = json.load(handle)
    except OSError as error:
        fail_with_usage_error(f"cannot read asset manifest {manifest_path!r}: {error}")
    except json.JSONDecodeError as error:
        fail_with_usage_error(f"asset manifest {manifest_path!r} is not valid JSON: {error}")
    packs = manifest.get("packs")
    if not isinstance(packs, dict) or not packs:
        fail_with_usage_error(f"asset manifest {manifest_path!r} declares no packs")
    return manifest


def resolve_assets_to_render(manifest, pack_id, asset_name):
    """Validates the requested pack/asset combination and returns the render
    list as (render_name, builder_name, owner) tuples.

    Runs before `require_bpy()` so unsupported combinations fail fast on any
    machine, with or without Blender installed.
    """
    # Authoring-only extended asset (not part of any runtime pack).
    if asset_name and asset_name in EXTENDED_ASSETS:
        builder_name, owner = EXTENDED_ASSETS[asset_name]
        return [(asset_name, builder_name, owner)]

    packs = manifest["packs"]
    if not pack_id:
        fail_with_usage_error("--asset requires --pack <id> (or use an authoring asset such as prop_crystal_cluster)")
    pack = packs.get(pack_id)
    if pack is None:
        fail_with_usage_error(f"unknown pack {pack_id!r}; known packs: {', '.join(sorted(packs))}")
    sprites = pack.get("sprites")
    if not isinstance(sprites, dict) or not sprites:
        fail_with_usage_error(f"pack {pack_id!r} declares no sprites")

    if asset_name:
        selected = [sprite for sprite in sprites.values() if sprite.get("blenderRenderName") == asset_name]
        if not selected:
            known = ", ".join(sorted(str(sprite.get("blenderRenderName")) for sprite in sprites.values()))
            fail_with_usage_error(f"pack {pack_id!r} has no asset {asset_name!r}; known render names: {known}")
    else:
        selected = list(sprites.values())

    assets = []
    seen_render_names = set()
    for sprite in selected:
        render_name = sprite.get("blenderRenderName")
        builder_name = sprite.get("blenderBuilder")
        owner = sprite.get("blenderOwner")
        if not render_name or builder_name not in BUILDERS:
            fail_with_usage_error(
                f"pack {pack_id!r} sprite {render_name!r} references unknown builder {builder_name!r}"
            )
        if owner not in VALID_OWNERS:
            fail_with_usage_error(f"pack {pack_id!r} sprite {render_name!r} has invalid owner {owner!r}")
        if render_name in seen_render_names:
            fail_with_usage_error(f"pack {pack_id!r} declares duplicate render name {render_name!r}")
        seen_render_names.add(render_name)
        assets.append((render_name, builder_name, owner))
    return assets


def parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--pack",
        help="render every sprite declared by this manifest pack (e.g. crown_cross)",
    )
    parser.add_argument(
        "--asset",
        help="render a single asset by Blender render name (e.g. tier3_player_hq, requires --pack)",
    )
    parser.add_argument(
        "--manifest",
        default=DEFAULT_MANIFEST_PATH,
        help=f"runtime asset manifest (default: {DEFAULT_MANIFEST_PATH})",
    )
    parser.add_argument("--output", default="art/blender/renders", help="output directory for PNG masters")
    parser.add_argument("--samples", type=int, default=64, help="Cycles samples (fixed seed, deterministic)")
    parser.add_argument("--opaque", action="store_true", help="disable transparent film background")
    args = parser.parse_args(argv)
    if not args.pack and not args.asset:
        parser.error("choose --pack <id> or --asset <render-name> --pack <id>")
    return args


# ---------------------------------------------------------------------------
# Blender bootstrap (import bpy lazily so validation/--help work without it)
# ---------------------------------------------------------------------------

def require_bpy():
    try:
        import bpy  # noqa: F401
    except ImportError:
        sys.stderr.write(
            "This script must run inside Blender, e.g.:\n"
            "  blender --background --factory-startup --python art/blender/build_battlefield_scene.py -- --help\n"
        )
        raise SystemExit(3)


# ---------------------------------------------------------------------------
# Scene primitives
# ---------------------------------------------------------------------------

def link_to_collection(name):
    import bpy
    if name in bpy.data.collections:
        return bpy.data.collections[name]
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    return collection


def move_to_collection(obj, collection_name):
    import bpy
    for coll in list(obj.users_collection):
        coll.objects.unlink(obj)
    link_to_collection(collection_name).objects.link(obj)


def make_material(name, color, roughness, metallic=0.0):
    import bpy
    if name in bpy.data.materials:
        material = bpy.data.materials[name]
        if material.users == 0:
            # Stale leftover from a previous clear: refresh its settings so the
            # palette always matches the current Art Bible constants.
            material.use_nodes = True
        return material
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return material


def material_palette():
    """Art Bible section 4/6: one controlled palette, reused by every asset.

    Called AFTER clear_default_scene() (see build_asset) so every material it
    returns has live users and is never invalidated by the next clear.
    """
    return {
        "stone": make_material("CC_Stone", PALETTE["stone"], 0.72),
        "stone_dark": make_material("CC_StoneDark", PALETTE["stone_dark"], 0.78),
        "crag": make_material("CC_Crag", PALETTE["crag"], 0.82),
        "wood": make_material("CC_Wood", PALETTE["wood"], 0.58),
        "gold": make_material("CC_Gold", PALETTE["gold"], 0.30, metallic=0.95),
        "gold_light": make_material("CC_GoldLight", PALETTE["gold_light"], 0.28, metallic=0.9),
        "banner_player": make_material("CC_BannerPlayer", PALETTE["team_player"], 0.78),
        "banner_enemy": make_material("CC_BannerEnemy", PALETTE["team_enemy"], 0.78),
        "banner_neutral": make_material("CC_BannerNeutral", PALETTE["team_neutral"], 0.80),
        "roof_player": make_material("CC_RoofPlayer", PALETTE["roof_player"], 0.55),
        "roof_enemy": make_material("CC_RoofEnemy", PALETTE["roof_enemy"], 0.55),
        "roof_neutral": make_material("CC_RoofNeutral", PALETTE["roof_neutral"], 0.60),
        "crystal": make_material("CC_Crystal", PALETTE["crystal"], 0.22, metallic=0.1),
        "iron": make_material("CC_Iron", PALETTE["iron"], 0.38, metallic=0.85),
    }


def banner_material(palette, owner):
    return {
        "player": palette["banner_player"],
        "enemy": palette["banner_enemy"],
        "neutral": palette["banner_neutral"],
    }[owner]


def roof_material(palette, owner):
    return {
        "player": palette["roof_player"],
        "enemy": palette["roof_enemy"],
        "neutral": palette["roof_neutral"],
    }[owner]


def bevel_object(obj, width=BEVEL_WIDTH):
    """Art Bible section 6: no razor edges — 2-segment bevel on every asset."""
    import bmesh
    mesh = obj.data
    bmesh_ops = bmesh.ops
    bmesh_inst = bmesh.new()
    bmesh_inst.from_mesh(mesh)
    bevel_result = bmesh_ops.bevel(
        bmesh_inst,
        geom=list(bmesh_inst.verts) + list(bmesh_inst.edges),
        offset=width,
        segments=BEVEL_SEGMENTS,
        profile=0.5,
        affect="EDGES",
        clamp_overlap=True,
    )
    bmesh_inst.to_mesh(mesh)
    bmesh_inst.free()
    return bevel_result


def add_primitive(builder, name, collection):
    import bpy
    obj = builder()
    obj.name = name
    obj.data.name = name
    move_to_collection(obj, collection)
    return obj


# ---------------------------------------------------------------------------
# Asset builders (toy-like, chunky, Art Bible section 5 silhouettes)
# ---------------------------------------------------------------------------

def build_citadel(palette, owner):
    """Tier 3 HQ: grand keep + twin turrets + archway + gilded corners."""
    import bpy

    def new_cube(name, size, location):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
        obj = bpy.context.active_object
        obj.name = name
        obj.scale = (size[0], size[1], size[2])
        bpy.ops.object.transform_apply(scale=True)
        return obj

    keep = new_cube("citadel_keep", (1.7, 1.7, 1.9), (0.0, 0.0, 0.95))
    keep.data.materials.append(palette["stone"])
    bevel_object(keep)

    turret_specs = ((-0.95, -0.95, 0.0), (0.95, -0.95, 0.0), (-0.95, 0.95, 0.0), (0.95, 0.95, 0.0))
    for index, (x, y, z) in enumerate(turret_specs):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.42, depth=2.5, location=(x, y, 1.25 + z * 0))
        turret = bpy.context.active_object
        turret.name = f"citadel_turret_{index}"
        turret.data.materials.append(palette["stone"])
        bevel_object(turret)

        bpy.ops.mesh.primitive_cone_add(radius1=0.55, depth=0.85, location=(x, y, 2.8))
        roof = bpy.context.active_object
        roof.name = f"citadel_roof_{index}"
        roof.data.materials.append(roof_material(palette, owner))
        bevel_object(roof)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, -0.86, 0.55))
    gate = bpy.context.active_object
    gate.name = "citadel_gate"
    gate.scale = (0.6, 0.25, 1.1)
    bpy.ops.object.transform_apply(scale=True)
    gate.data.materials.append(palette["iron"])
    bevel_object(gate)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.98, 2.3))
    banner = bpy.context.active_object
    banner.name = "citadel_banner"
    banner.scale = (0.85, 0.08, 0.9)
    bpy.ops.object.transform_apply(scale=True)
    banner.data.materials.append(banner_material(palette, owner))
    bevel_object(banner)

    bpy.ops.mesh.primitive_cylinder_add(radius=0.18, depth=0.34, location=(0.0, 0.0, 2.15))
    spire = bpy.context.active_object
    spire.name = "citadel_spire"
    spire.data.materials.append(palette["gold"])
    bevel_object(spire)


def build_crown_keep(palette, _owner):
    """Tier 2 center stronghold: octagonal ramparts + gilded crown spire."""
    import bpy

    bpy.ops.mesh.primitive_cylinder_add(radius=1.45, depth=1.15, vertices=8, location=(0.0, 0.0, 0.575))
    rampart = bpy.context.active_object
    rampart.name = "keep_rampart"
    rampart.data.materials.append(palette["stone"])
    bevel_object(rampart)

    bpy.ops.mesh.primitive_cylinder_add(radius=1.55, depth=0.22, vertices=8, location=(0.0, 0.0, 1.25))
    parapet = bpy.context.active_object
    parapet.name = "keep_parapet"
    parapet.data.materials.append(palette["stone_dark"])
    bevel_object(parapet)

    bpy.ops.mesh.primitive_cylinder_add(radius=0.62, depth=1.5, vertices=8, location=(0.0, 0.0, 1.9))
    tower = bpy.context.active_object
    tower.name = "keep_tower"
    tower.data.materials.append(palette["stone"])
    bevel_object(tower)

    for index in range(5):
        angle = (index / 5.0) * math.pi * 2.0
        bpy.ops.mesh.primitive_cone_add(
            radius1=0.11, depth=0.3,
            location=(0.34 * math.cos(angle), 0.34 * math.sin(angle), 2.8),
        )
        point = bpy.context.active_object
        point.name = f"keep_crown_point_{index}"
        point.data.materials.append(palette["gold_light"])
        bevel_object(point)

    bpy.ops.mesh.primitive_cylinder_add(radius=0.16, depth=0.5, location=(0.0, 0.0, 2.95))
    spire = bpy.context.active_object
    spire.name = "keep_spire"
    spire.data.materials.append(palette["gold"])
    bevel_object(spire)


def build_watchtower(palette, owner):
    """Tier 1 watchtower: cylindrical stone tower + conical roof + pennant."""
    import bpy

    bpy.ops.mesh.primitive_cylinder_add(radius=0.72, depth=2.2, location=(0.0, 0.0, 1.1))
    tower = bpy.context.active_object
    tower.name = "watchtower_shaft"
    tower.data.materials.append(palette["stone"])
    bevel_object(tower)

    bpy.ops.mesh.primitive_cylinder_add(radius=0.88, depth=0.28, location=(0.0, 0.0, 2.3))
    gallery = bpy.context.active_object
    gallery.name = "watchtower_gallery"
    gallery.data.materials.append(palette["wood"])
    bevel_object(gallery)

    bpy.ops.mesh.primitive_cone_add(radius1=0.8, depth=1.0, location=(0.0, 0.0, 2.9))
    roof = bpy.context.active_object
    roof.name = "watchtower_roof"
    roof.data.materials.append(roof_material(palette, owner))
    bevel_object(roof)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, -0.4, 3.6))
    flag = bpy.context.active_object
    flag.name = "watchtower_flag"
    flag.scale = (0.06, 0.5, 0.3)
    bpy.ops.object.transform_apply(scale=True)
    flag.data.materials.append(banner_material(palette, owner))
    bevel_object(flag)


def build_barracks(palette, owner):
    """Tier 1 barracks: stone hall with pitched dyed roof and banner."""
    import bpy

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 0.7))
    hall = bpy.context.active_object
    hall.name = "barracks_hall"
    hall.scale = (1.9, 1.3, 1.4)
    bpy.ops.object.transform_apply(scale=True)
    hall.data.materials.append(palette["stone"])
    bevel_object(hall)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 1.75))
    roof = bpy.context.active_object
    roof.name = "barracks_roof"
    roof.scale = (2.05, 1.45, 0.55)
    bpy.ops.object.transform_apply(scale=True)
    roof.data.materials.append(roof_material(palette, owner))
    bevel_object(roof)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.7, -0.66, 1.1))
    door = bpy.context.active_object
    door.name = "barracks_door"
    door.scale = (0.4, 0.08, 0.8)
    bpy.ops.object.transform_apply(scale=True)
    door.data.materials.append(palette["wood"])
    bevel_object(door)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(-0.85, 0.3, 1.5))
    banner = bpy.context.active_object
    banner.name = "barracks_banner"
    banner.scale = (0.06, 0.42, 0.62)
    bpy.ops.object.transform_apply(scale=True)
    banner.data.materials.append(banner_material(palette, owner))
    bevel_object(banner)


def build_stable(palette, owner):
    """Tier 1 stable: long timber hall, gentle shed roof, hay-tone accents."""
    import bpy

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 0.55))
    hall = bpy.context.active_object
    hall.name = "stable_hall"
    hall.scale = (2.0, 1.1, 1.1)
    bpy.ops.object.transform_apply(scale=True)
    hall.data.materials.append(palette["wood"])
    bevel_object(hall)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.2, 1.3))
    roof = bpy.context.active_object
    roof.name = "stable_roof"
    roof.scale = (2.15, 0.9, 0.4)
    bpy.ops.object.transform_apply(scale=True)
    roof.data.materials.append(roof_material(palette, owner))
    bevel_object(roof)

    for index, x in enumerate((-0.55, 0.55)):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.09, depth=1.3, location=(x, -0.5, 0.65))
        post = bpy.context.active_object
        post.name = f"stable_post_{index}"
        post.data.materials.append(palette["stone_dark"])
        bevel_object(post)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.95, 0.3, 1.2))
    banner = bpy.context.active_object
    banner.name = "stable_banner"
    banner.scale = (0.06, 0.36, 0.5)
    bpy.ops.object.transform_apply(scale=True)
    banner.data.materials.append(banner_material(palette, owner))
    bevel_object(banner)


# ---------------------------------------------------------------------------
# twin_passes builders: fortified mountain-passes theme (chunky crag forms,
# crenellated square towers, gatehouse across the pass, owner-colored accents)
# ---------------------------------------------------------------------------

def build_crag_citadel(palette, owner):
    """twin_passes tier 3 HQ: keep carved into a stepped crag with bastions."""
    import bpy

    def new_cube(name, size, location, material):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
        obj = bpy.context.active_object
        obj.name = name
        obj.scale = size
        bpy.ops.object.transform_apply(scale=True)
        obj.data.materials.append(material)
        bevel_object(obj)
        return obj

    # Stepped mountain base: broad lower crag, smaller upper crag.
    new_cube("crag_citadel_base", (2.3, 2.3, 0.7), (0.0, 0.0, 0.35), palette["crag"])
    new_cube("crag_citadel_upper", (1.8, 1.8, 0.6), (0.0, 0.0, 0.95), palette["crag"])

    # Central stone keep with crenellated parapet.
    new_cube("crag_citadel_keep", (1.3, 1.3, 1.3), (0.0, 0.0, 1.85), palette["stone"])
    for index, (x, y) in enumerate(((-0.5, -0.5), (0.5, -0.5), (-0.5, 0.5), (0.5, 0.5))):
        new_cube(f"crag_citadel_crenel_{index}", (0.3, 0.3, 0.3), (x, y, 2.62), palette["stone_dark"])

    # Flanking round bastions with team-roofed caps and gold beacons.
    for index, x in enumerate((-0.95, 0.95)):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.42, depth=1.7, location=(x, 0.0, 1.35))
        bastion = bpy.context.active_object
        bastion.name = f"crag_citadel_bastion_{index}"
        bastion.data.materials.append(palette["stone"])
        bevel_object(bastion)

        bpy.ops.mesh.primitive_cylinder_add(radius=0.5, depth=0.22, location=(x, 0.0, 2.28))
        cap = bpy.context.active_object
        cap.name = f"crag_citadel_bastion_cap_{index}"
        cap.data.materials.append(palette["stone_dark"])
        bevel_object(cap)

        bpy.ops.mesh.primitive_cone_add(radius1=0.34, depth=0.55, location=(x, 0.0, 2.62))
        beacon = bpy.context.active_object
        beacon.name = f"crag_citadel_beacon_{index}"
        beacon.data.materials.append(roof_material(palette, owner))
        bevel_object(beacon)

    # Iron gate facing the camera side and a team banner on the keep.
    new_cube("crag_citadel_gate", (0.62, 0.24, 0.95), (0.0, -1.02, 1.0), palette["iron"])
    new_cube("crag_citadel_banner", (0.7, 0.08, 0.62), (0.0, 0.0, 2.95), banner_material(palette, owner))
    bpy.ops.mesh.primitive_cylinder_add(radius=0.14, depth=0.34, location=(0.0, 0.0, 3.3))
    spire = bpy.context.active_object
    spire.name = "crag_citadel_spire"
    spire.data.materials.append(palette["gold"])
    bevel_object(spire)


def build_pass_gate(palette, owner):
    """twin_passes tier 2 keep: fortified gatehouse straddling the pass."""
    import bpy

    def new_cube(name, size, location, material):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
        obj = bpy.context.active_object
        obj.name = name
        obj.scale = size
        bpy.ops.object.transform_apply(scale=True)
        obj.data.materials.append(material)
        bevel_object(obj)
        return obj

    # Two chunky crag towers flanking the pass.
    for index, x in enumerate((-0.95, 0.95)):
        new_cube(f"pass_gate_tower_{index}", (0.85, 0.85, 2.1), (x, 0.0, 1.05), palette["crag"])
        # Crenel pair on each tower top.
        new_cube(f"pass_gate_crenel_a_{index}", (0.24, 0.24, 0.3), (x - 0.24, 0.0, 2.24), palette["stone_dark"])
        new_cube(f"pass_gate_crenel_b_{index}", (0.24, 0.24, 0.3), (x + 0.24, 0.0, 2.24), palette["stone_dark"])
        # Team banner draped on each tower's camera-facing face (readable at 128px).
        new_cube(f"pass_gate_banner_{index}", (0.5, 0.09, 0.85), (x, -0.45, 1.35), banner_material(palette, owner))

    # Connecting wall over the pass with an iron gate.
    new_cube("pass_gate_wall", (1.15, 0.5, 1.25), (0.0, 0.0, 0.83), palette["stone"])
    new_cube("pass_gate_arch", (0.72, 0.55, 0.9), (0.0, -0.08, 0.48), palette["iron"])

    # Gilded crown points along the wall top (keeps the crown-keep language).
    for index, x in enumerate((-0.3, 0.0, 0.3)):
        bpy.ops.mesh.primitive_cone_add(radius1=0.11, depth=0.3, location=(x, 0.0, 1.6))
        point = bpy.context.active_object
        point.name = f"pass_gate_crown_point_{index}"
        point.data.materials.append(palette["gold_light"])
        bevel_object(point)

    bpy.ops.mesh.primitive_cylinder_add(radius=0.15, depth=0.42, location=(0.0, 0.0, 1.85))
    spire = bpy.context.active_object
    spire.name = "pass_gate_spire"
    spire.data.materials.append(palette["gold"])
    bevel_object(spire)


def build_crag_watchtower(palette, owner):
    """twin_passes tier 1 fortress: square crag watchtower with crenels + flag."""
    import bpy

    def new_cube(name, size, location, material):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
        obj = bpy.context.active_object
        obj.name = name
        obj.scale = size
        bpy.ops.object.transform_apply(scale=True)
        obj.data.materials.append(material)
        bevel_object(obj)
        return obj

    # Rock plinth the tower rises from.
    new_cube("crag_watchtower_plinth", (1.5, 1.5, 0.5), (0.0, 0.0, 0.25), palette["stone_dark"])

    # Square stone tower body.
    new_cube("crag_watchtower_shaft", (0.95, 0.95, 1.9), (0.0, 0.0, 1.45), palette["stone"])

    # Corner crenels on the parapet.
    for index, (x, y) in enumerate(((-0.38, -0.38), (0.38, -0.38), (-0.38, 0.38), (0.38, 0.38))):
        new_cube(f"crag_watchtower_crenel_{index}", (0.26, 0.26, 0.32), (x, y, 2.56), palette["stone_dark"])

    # Team banner draped on the tower's camera-facing face (readable at 128px).
    new_cube("crag_watchtower_banner", (0.62, 0.08, 0.85), (0.0, -0.5, 1.55), banner_material(palette, owner))

    # Owner flag on an iron pole.
    bpy.ops.mesh.primitive_cylinder_add(radius=0.05, depth=0.9, location=(0.0, 0.0, 3.1))
    pole = bpy.context.active_object
    pole.name = "crag_watchtower_pole"
    pole.data.materials.append(palette["iron"])
    bevel_object(pole)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.26, 0.0, 3.28))
    flag = bpy.context.active_object
    flag.name = "crag_watchtower_flag"
    flag.scale = (0.42, 0.05, 0.28)
    bpy.ops.object.transform_apply(scale=True)
    flag.data.materials.append(banner_material(palette, owner))
    bevel_object(flag)


def build_pass_barracks(palette, owner):
    """twin_passes tier 1 barracks: stone hall under a heavy crag-slab roof."""
    import bpy

    def new_cube(name, size, location, material, rotation=None):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
        obj = bpy.context.active_object
        obj.name = name
        obj.scale = size
        if rotation is not None:
            obj.rotation_euler = rotation
        bpy.ops.object.transform_apply(scale=True, rotation=rotation is not None)
        obj.data.materials.append(material)
        bevel_object(obj)
        return obj

    new_cube("pass_barracks_hall", (1.9, 1.3, 1.1), (0.0, 0.0, 0.55), palette["stone"])
    # Team-colored pitched roof (the barracks' readable ownership accent).
    new_cube("pass_barracks_roof", (2.1, 1.5, 0.42), (0.0, 0.0, 1.3), roof_material(palette, owner), rotation=(0.0, 0.12, 0.0))
    # Crag ridge cap keeps the mountain material language.
    new_cube("pass_barracks_ridge", (2.15, 0.5, 0.2), (0.0, 0.0, 1.62), palette["crag"])
    new_cube("pass_barracks_door", (0.4, 0.08, 0.75), (0.55, -0.66, 0.42), palette["wood"])
    new_cube("pass_barracks_banner", (0.06, 0.4, 0.58), (-0.85, -0.5, 1.35), banner_material(palette, owner))


def build_pass_stable(palette, owner):
    """twin_passes tier 1 stable: long timber shelter built against a crag wall."""
    import bpy

    def new_cube(name, size, location, material, rotation=None):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
        obj = bpy.context.active_object
        obj.name = name
        obj.scale = size
        if rotation is not None:
            obj.rotation_euler = rotation
        bpy.ops.object.transform_apply(scale=True, rotation=rotation is not None)
        obj.data.materials.append(material)
        bevel_object(obj)
        return obj

    # Rock back wall the shelter leans on.
    new_cube("pass_stable_backwall", (2.2, 0.34, 1.5), (0.0, 0.52, 0.75), palette["stone_dark"])
    # Long low timber shelter.
    new_cube("pass_stable_hall", (2.1, 1.0, 0.85), (0.0, -0.1, 0.43), palette["wood"])
    # Shed crag roof sloping off the back wall.
    new_cube("pass_stable_roof", (2.2, 1.35, 0.28), (0.0, 0.12, 1.02), palette["crag"], rotation=(0.18, 0.0, 0.0))
    # Team awning over the open front (the stable's readable ownership accent).
    new_cube("pass_stable_awning", (1.5, 0.3, 0.14), (0.1, -0.62, 0.98), banner_material(palette, owner), rotation=(0.22, 0.0, 0.0))
    # Hay store in gold tones at the open front.
    new_cube("pass_stable_hay", (0.55, 0.45, 0.4), (-0.65, -0.28, 0.2), palette["gold_light"])
    new_cube("pass_stable_banner", (0.06, 0.34, 0.46), (0.85, -0.4, 1.15), banner_material(palette, owner))


def build_road_segment(palette, _owner):
    """Recessed stone lane slab (Art Bible section 11). Authoring-only asset."""
    import bpy

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, -0.06))
    slab = bpy.context.active_object
    slab.name = "road_slab"
    slab.scale = (1.6, 6.0, 0.12)
    bpy.ops.object.transform_apply(scale=True)
    slab.data.materials.append(palette["stone"])
    bevel_object(slab)

    for index in range(5):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.09, depth=0.05, location=(0.0, -2.0 + index, 0.02))
        inlay = bpy.context.active_object
        inlay.name = f"road_inlay_{index}"
        inlay.data.materials.append(palette["gold"])
        bevel_object(inlay)


def build_platform_tile(palette, _owner):
    """Circular territory platform with plinth bevel (authoring-only asset)."""
    import bpy

    bpy.ops.mesh.primitive_cylinder_add(radius=1.6, depth=0.22, vertices=48, location=(0.0, 0.0, 0.11))
    platform = bpy.context.active_object
    platform.name = "platform_disc"
    platform.data.materials.append(palette["stone_dark"])
    bevel_object(platform)

    bpy.ops.mesh.primitive_torus_add(
        major_radius=1.6, minor_radius=0.09, location=(0.0, 0.0, 0.22)
    )
    ring = bpy.context.active_object
    ring.name = "platform_ring"
    ring.data.materials.append(palette["iron"])
    bevel_object(ring)


def build_crystal_cluster(palette, _owner):
    """Ambient prop: small crystal cluster (<= 0.5m tall). Authoring-only."""
    import bpy

    for index, (x, z, scale) in enumerate(((-0.18, 0.0, 1.0), (0.16, 0.0, 0.7), (0.0, 0.0, 1.3))):
        bpy.ops.mesh.primitive_cone_add(
            radius1=0.14 * scale, depth=0.55 * scale,
            location=(x, 0.0, 0.27 * scale + z),
            rotation=(0.12 * (1 if index % 2 else -1), 0.0, 0.0),
        )
        shard = bpy.context.active_object
        shard.name = f"prop_crystal_{index}"
        shard.data.materials.append(palette["crystal"])
        bevel_object(shard)


def build_stacked_stones(palette, _owner):
    """Ambient prop: three stacked weathered stones (<= 0.45m). Authoring-only."""
    import bpy

    specs = ((0.0, 0.0, 0.22, 0.34), (0.1, 0.06, 0.55, 0.26), (-0.06, 0.04, 0.8, 0.2))
    for index, (x, y, z, radius) in enumerate(specs):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=radius, location=(x, y, z))
        stone = bpy.context.active_object
        stone.name = f"prop_stone_{index}"
        stone.data.materials.append(palette["stone"])
        bevel_object(stone)


def build_pennant(palette, owner):
    """Ambient prop: petite team pennant on an iron staff. Authoring-only."""
    import bpy

    bpy.ops.mesh.primitive_cylinder_add(radius=0.035, depth=0.9, location=(0.0, 0.0, 0.45))
    staff = bpy.context.active_object
    staff.name = "prop_pennant_staff"
    staff.data.materials.append(palette["iron"])
    bevel_object(staff)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.16, 0.0, 0.72))
    cloth = bpy.context.active_object
    cloth.name = "prop_pennant_cloth"
    cloth.scale = (0.32, 0.02, 0.2)
    bpy.ops.object.transform_apply(scale=True)
    cloth.data.materials.append(banner_material(palette, owner))
    bevel_object(cloth)


BUILDERS = {
    "build_citadel": build_citadel,
    "build_crown_keep": build_crown_keep,
    "build_watchtower": build_watchtower,
    "build_barracks": build_barracks,
    "build_stable": build_stable,
    "build_crag_citadel": build_crag_citadel,
    "build_pass_gate": build_pass_gate,
    "build_crag_watchtower": build_crag_watchtower,
    "build_pass_barracks": build_pass_barracks,
    "build_pass_stable": build_pass_stable,
    "build_road_segment": build_road_segment,
    "build_platform_tile": build_platform_tile,
    "build_crystal_cluster": build_crystal_cluster,
    "build_stacked_stones": build_stacked_stones,
    "build_pennant": build_pennant,
}

ASSET_COLLECTION = {
    "build_citadel": "CC_Structures",
    "build_crown_keep": "CC_Structures",
    "build_watchtower": "CC_Structures",
    "build_barracks": "CC_Structures",
    "build_stable": "CC_Structures",
    "build_crag_citadel": "CC_Structures",
    "build_pass_gate": "CC_Structures",
    "build_crag_watchtower": "CC_Structures",
    "build_pass_barracks": "CC_Structures",
    "build_pass_stable": "CC_Structures",
    "build_road_segment": "CC_Roads",
    "build_platform_tile": "CC_Terrain",
    "build_crystal_cluster": "CC_Props",
    "build_stacked_stones": "CC_Props",
    "build_pennant": "CC_Props",
}


# ---------------------------------------------------------------------------
# Rig, world, render configuration
# ---------------------------------------------------------------------------

def build_camera():
    """Orthographic Art Bible camera aimed exactly at the asset origin."""
    import bpy
    from mathutils import Vector

    cam_data = bpy.data.cameras.new(name="CC_OrthoCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = CAMERA_ORTHO_SCALE
    cam_data.clip_start = CAMERA_CLIP_START
    cam_data.clip_end = CAMERA_CLIP_END
    cam_obj = bpy.data.objects.new("CC_OrthoCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)

    pitch = math.radians(CAMERA_PITCH_DEG)
    yaw = math.radians(CAMERA_YAW_DEG)
    # Spherical placement on the Art Bible viewing cone (55 deg pitch / 45 deg
    # yaw), then a track-to constraint pins the view direction on the asset
    # origin regardless of future distance or ortho tweaks.
    direction = Vector((
        math.sin(yaw) * math.cos(pitch),
        -math.cos(yaw) * math.cos(pitch),
        math.sin(pitch),
    ))
    cam_obj.location = direction * CAMERA_DISTANCE

    aim = bpy.data.objects.new("CC_CameraAim", None)
    bpy.context.scene.collection.objects.link(aim)
    aim.location = (0.0, 0.0, 0.0)
    constraint = cam_obj.constraints.new("TRACK_TO")
    constraint.target = aim
    constraint.track_axis = "TRACK_NEGATIVE_Z"
    constraint.up_axis = "UP_Y"

    bpy.context.scene.camera = cam_obj
    return cam_obj


def build_lighting_rig():
    import bpy

    key_data = bpy.data.lights.new(name="CC_Key_Sun", type="SUN")
    key_data.energy = KEY_LIGHT_ENERGY
    key_data.color = KEY_LIGHT_COLOR
    key_data.angle = KEY_LIGHT_ANGLE_RAD
    key = bpy.data.objects.new("CC_Key_Sun", key_data)
    bpy.context.scene.collection.objects.link(key)
    key.rotation_euler = (math.radians(45.0), math.radians(25.0), math.radians(-40.0))

    fill_data = bpy.data.lights.new(name="CC_Fill_Sky", type="SUN")
    fill_data.energy = FILL_LIGHT_ENERGY
    fill_data.color = FILL_LIGHT_COLOR
    fill = bpy.data.objects.new("CC_Fill_Sky", fill_data)
    bpy.context.scene.collection.objects.link(fill)
    fill.rotation_euler = (math.radians(-30.0), math.radians(-15.0), math.radians(140.0))

    rim_data = bpy.data.lights.new(name="CC_Rim_Light", type="SUN")
    rim_data.energy = RIM_LIGHT_ENERGY
    rim_data.color = RIM_LIGHT_COLOR
    rim = bpy.data.objects.new("CC_Rim_Light", rim_data)
    bpy.context.scene.collection.objects.link(rim)
    # From behind-right of the subject, toward the camera: back-right is
    # (+X, +Y) in world space with the camera on the (+X, -Y) viewing cone.
    rim.rotation_euler = (math.radians(150.0), math.radians(20.0), math.radians(160.0))


def build_world():
    import bpy
    world = bpy.context.scene.world
    if world is None:
        world = bpy.data.worlds.new("CC_World")
        bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs[0].default_value = (
        WORLD_AMBIENT_COLOR[0], WORLD_AMBIENT_COLOR[1], WORLD_AMBIENT_COLOR[2], 1.0
    )
    background.inputs[1].default_value = WORLD_AMBIENT_STRENGTH


def configure_render(output_dir, transparent=True, samples=64):
    import bpy
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"          # deterministic headless rendering
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.seed = 0                # fixed seed: identical output every run
    scene.cycles.use_animated_seed = False
    scene.render.resolution_x = MASTER_RESOLUTION
    scene.render.resolution_y = MASTER_RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = transparent
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 15
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    os.makedirs(output_dir, exist_ok=True)
    scene.render.filepath = os.path.join(output_dir, "render_")


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def clear_default_scene():
    import bpy
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    # Purge zero-user data blocks so repeated kit renders never accumulate
    # orphan meshes, materials, cameras, lights, images, or worlds. Blocks
    # still referenced (e.g. the active scene world) keep their users.
    for block_name in ("meshes", "materials", "cameras", "lights", "images", "worlds"):
        block_list = getattr(bpy.data, block_name)
        for block in list(block_list):
            if block.users == 0:
                block_list.remove(block)
    for collection in list(bpy.data.collections):
        if collection.users == 0:
            bpy.data.collections.remove(collection)


def build_asset(builder_name, owner):
    """Builds one asset in a freshly cleared, fully rebuilt scene.

    The material palette is created AFTER the clear (which purges zero-user
    materials), so every palette entry has live users and stays valid for the
    whole build. Nothing survives to the next asset except purged-then-rebuilt
    data blocks, so kit renders never accumulate orphan cameras, lights,
    worlds, collections, or materials.
    """
    clear_default_scene()
    build_camera()
    build_lighting_rig()
    build_world()
    for collection_name in COLLECTIONS:
        link_to_collection(collection_name)
    palette = material_palette()
    BUILDERS[builder_name](palette, owner)
    ground = make_contact_shadow()
    if ground is not None:
        move_to_collection(ground, "CC_Shadows")


def make_contact_shadow():
    """A soft flattened dark disc under the asset reads as a contact shadow."""
    import bpy
    bpy.ops.mesh.primitive_cylinder_add(radius=1.75, depth=0.02, vertices=48, location=(0.0, 0.0, 0.01))
    shadow = bpy.context.active_object
    shadow.name = "contact_shadow"
    shadow_material = make_material("CC_ContactShadow", (0.0, 0.0, 0.0), 1.0)
    shadow_material.use_nodes = True
    bsdf = shadow_material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Alpha"].default_value = 0.35
    shadow_material.blend_method = "BLEND"
    shadow.data.materials.append(shadow_material)
    return shadow


def render_asset(output_dir, asset_name, samples, transparent):
    import bpy
    configure_render(output_dir, transparent=transparent, samples=samples)
    bpy.context.scene.render.filepath = os.path.join(output_dir, f"{asset_name}.png")
    bpy.ops.render.render(write_still=True)


def main(argv):
    # Validation order is deliberate: the manifest is loaded and the
    # pack/asset combination is fully validated BEFORE requiring bpy, so bad
    # invocations fail with exit code 2 on any machine.
    args = parse_args(argv)
    manifest = load_asset_manifest(args.manifest)
    assets = resolve_assets_to_render(manifest, args.pack, args.asset)
    require_bpy()

    for render_name, builder_name, owner in assets:
        build_asset(builder_name, owner)
        render_asset(args.output, render_name, samples=args.samples, transparent=not args.opaque)
        print(f"[crown-clash] rendered {render_name} -> {args.output}/{render_name}.png")

    print(f"[crown-clash] done: {len(assets)} master render(s) at {MASTER_RESOLUTION}x{MASTER_RESOLUTION}")


if __name__ == "__main__":
    # Blender forwards everything after '--' to the script.
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    main(argv)
