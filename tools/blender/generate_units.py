"""
Crown Clash - shared army unit sprites.

Renders the four troop sprites (leader/follower x player/enemy) used by every
battlefield. The knight model lives in art/blender/crown_cross_kit.py and is
rendered through the canonical Art Bible rig of art/blender/build_battlefield_scene.py
(same camera angle, lighting, world and Cycles settings as the structures), then
downscaled to the 128px runtime PNGs.

Usage:
  blender --background --factory-startup --python-exit-code 1 \
      --python tools/blender/generate_units.py
"""

import importlib.util
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


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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


def render_unit(rig, kit, name, owner, leader):
    rig.clear_default_scene()
    rig.build_camera()
    rig.build_lighting_rig()
    rig.build_world()
    rig.apply_camera_framing_values(ORTHO_SCALE, AIM_HEIGHT)
    kit.knight(kit.mats(owner, rig.make_material), leader)
    rig.configure_render(str(MASTER_DIR), True, SAMPLES)
    master = MASTER_DIR / f'{name}.png'
    bpy.context.scene.render.filepath = str(master)
    bpy.ops.render.render(write_still=True)
    downscale(master, OUTPUT_DIR / f'{name}.png')
    print(f'[crown-clash] rendered {name} -> {OUTPUT_DIR / (name + ".png")}')


def main():
    rig = load_module('battlefield_rig', SCENE_SCRIPT)
    sys.path.insert(0, str(SCENE_SCRIPT.parent))
    import crown_cross_kit as kit

    MASTER_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, owner, leader in UNITS:
        render_unit(rig, kit, name, owner, leader)
    print('[crown-clash] 4 shared troop sprites rendered')


if __name__ == '__main__':
    main()
