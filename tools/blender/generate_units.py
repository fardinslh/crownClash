"""
Crown Clash - shared army unit sprites.

Renders the troop sprites (leader/follower x player/enemy x facing) used by
every battlefield. The knight model lives in art/blender/crown_cross_kit.py
(-Y is the knight's march heading, so the front render shows the knight
marching toward the camera) and renders through the canonical Art Bible rig
of art/blender/build_battlefield_scene.py (same camera angle, lighting,
world and Cycles settings as the structures), then downscales to the 128px
runtime PNGs.

Facings (march heading relative to the camera at rig yaw 0):
  front  toward the viewer (world south) — also shipped under the legacy
         no-suffix name so existing consumers keep working;
  back   away from the viewer (world north);
  side   to screen-right (world east); the client flipX-mirrors the side
         sprite for screen-left (west) marches.

Usage:
  blender --background --factory-startup --python-exit-code 1 \
      --python tools/blender/generate_units.py
"""

import importlib.util
import math
import shutil
import subprocess
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[2]
SCENE_SCRIPT = ROOT / 'art/blender/build_battlefield_scene.py'
MASTER_DIR = ROOT / 'art/blender/renders/units'
OUTPUT_DIR = ROOT / 'apps/game/public/assets/units'
RUNTIME_SIZE = 128
SAMPLES = 64

# Orthographic crop and aim height that frame a knight inside the 512px master.
ORTHO_SCALE = 2.30
AIM_HEIGHT = 0.77

UNITS = (
    ('unit_leader_player', 'player', True),
    ('unit_leader_enemy', 'enemy', True),
    ('unit_follower_player', 'player', False),
    ('unit_follower_enemy', 'enemy', False),
)

# (suffix, yaw): the knight's default heading is -Y (toward the camera at
# rig yaw 0), so the yaw rotates the march heading — 0 keeps it facing the
# viewer, pi turns it away (north), pi/2 points it at +X (world east).
FACINGS = (
    ('front', 0.0),
    ('back', math.pi),
    ('side', math.pi / 2.0),
)


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def rotate_knight_yaw(yaw):
    """Rigidly rotates the whole knight about the world Z axis.

    Every knight part is an axis-aligned primitive placed in world space
    (the kit's knight uses no per-part rotations), so rotating each part's
    position about the origin and adding the yaw to its euler-Z composes an
    exact rigid rotation of the assembled figure."""
    cos_yaw, sin_yaw = math.cos(yaw), math.sin(yaw)
    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        x, y = obj.location.x, obj.location.y
        obj.location = (x * cos_yaw - y * sin_yaw, x * sin_yaw + y * cos_yaw, obj.location.z)
        obj.rotation_euler = (
            obj.rotation_euler.x,
            obj.rotation_euler.y,
            obj.rotation_euler.z + yaw,
        )


def downscale(master, runtime):
    if shutil.which('sips'):
        command = ['sips', '-s', 'format', 'png', '-z', str(RUNTIME_SIZE), str(RUNTIME_SIZE), str(master), '--out', str(runtime)]
    elif shutil.which('magick'):
        command = ['magick', str(master), '-resize', f'{RUNTIME_SIZE}x{RUNTIME_SIZE}', str(runtime)]
    else:
        raise SystemExit('generate_units: install ImageMagick (brew install imagemagick) or use macOS sips to downscale masters.')
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL)
    if not runtime.is_file():
        raise SystemExit(f'generate_units: downscale reported success but {runtime} is missing.')


def render_unit(rig, kit, name, owner, leader, yaw):
    rig.clear_default_scene()
    rig.build_camera()
    rig.build_lighting_rig()
    rig.build_world()
    rig.apply_camera_framing_values(ORTHO_SCALE, AIM_HEIGHT)
    kit.knight(kit.kmats(owner, rig.make_material), leader)
    if yaw:
        rotate_knight_yaw(yaw)
    # The kit's materials multiply in the rig's section-6 vertical gradient,
    # but the kit builds its own beveled primitives, so the VerticalShade
    # attribute must be written per mesh or the sprite renders solid black.
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            rig.shade_vertical_gradient(obj)
    rig.configure_render(str(MASTER_DIR), True, SAMPLES)
    master = MASTER_DIR / f'{name}.png'
    bpy.context.scene.render.filepath = str(master)
    bpy.ops.render.render(write_still=True)
    return master


def main():
    rig = load_module('battlefield_rig', SCENE_SCRIPT)
    sys.path.insert(0, str(SCENE_SCRIPT.parent))
    import crown_cross_kit as kit

    MASTER_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for base, owner, leader in UNITS:
        for suffix, yaw in FACINGS:
            name = f'{base}_{suffix}'
            master = render_unit(rig, kit, name, owner, leader, yaw)
            downscale(master, OUTPUT_DIR / f'{name}.png')
            print(f'[crown-clash] rendered {name} -> {OUTPUT_DIR / (name + ".png")}')
            if suffix == 'front':
                # The legacy no-suffix sprite IS the front view: keep every
                # existing consumer (fallback paths, tests) working unchanged.
                downscale(master, OUTPUT_DIR / f'{base}.png')
    print(f'[crown-clash] {len(UNITS) * len(FACINGS)} facing troop sprites rendered')


if __name__ == '__main__':
    main()
