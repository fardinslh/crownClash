"""
Crown Clash - 2.5D Territory Asset Generator
Generates and renders stylized 2.5D orthographic fortress sprites
strictly adhering to the specifications in ART_BIBLE.md.
"""

import math
import os
import bpy

OUTPUT_DIR = os.path.abspath(r"E:\MyProjects\crownClash\apps\game\public\assets\territories")
RESOLUTION = 256 # 256x256 master sprite (ultra-crisp for 54px - 72px retina canvas)

TEAM_COLORS = {
    'player': (0.145, 0.388, 0.922, 1.0),   # #2563eb
    'enemy': (0.863, 0.149, 0.149, 1.0),    # #dc2626
    'neutral': (0.392, 0.455, 0.545, 1.0),  # #64748b
}

def setup_render_engine():
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = RESOLUTION
    scene.render.resolution_y = RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'

def setup_camera_and_lights():
    # Remove existing objects
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)

    # 1. Orthographic Camera per Art Bible: 55° pitch, 45° yaw
    cam_data = bpy.data.cameras.new(name="CrownClash_OrthoCam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 4.4
    cam_data.clip_start = 0.1
    cam_data.clip_end = 100.0

    cam_obj = bpy.data.objects.new("CrownClash_OrthoCam", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    cam_obj.location = (10.0, -10.0, 12.0)
    cam_obj.rotation_euler = (math.radians(55.0), 0.0, math.radians(45.0))

    # 2. Key Light (Sun) - Warm Champagne, top-left
    key_light_data = bpy.data.lights.new(name="Key_Sun", type='SUN')
    key_light_data.energy = 4.2
    key_light_data.color = (1.0, 0.96, 0.90)
    key_obj = bpy.data.objects.new("Key_Sun", key_light_data)
    key_obj.rotation_euler = (math.radians(45.0), math.radians(25.0), math.radians(-40.0))
    bpy.context.collection.objects.link(key_obj)

    # 3. Fill Light (Sun) - Cool Sky Blue
    fill_light_data = bpy.data.lights.new(name="Fill_Sky", type='SUN')
    fill_light_data.energy = 1.6
    fill_light_data.color = (0.65, 0.82, 1.0)
    fill_obj = bpy.data.objects.new("Fill_Sky", fill_light_data)
    fill_obj.rotation_euler = (math.radians(-30.0), math.radians(-15.0), math.radians(140.0))
    bpy.context.collection.objects.link(fill_obj)

    # 4. Rim Light (Sun) - Pure White back highlight
    rim_light_data = bpy.data.lights.new(name="Rim_Sun", type='SUN')
    rim_light_data.energy = 2.4
    rim_light_data.color = (1.0, 1.0, 1.0)
    rim_obj = bpy.data.objects.new("Rim_Sun", rim_light_data)
    rim_obj.rotation_euler = (math.radians(-60.0), math.radians(-20.0), math.radians(20.0))
    bpy.context.collection.objects.link(rim_obj)

def get_or_create_material(name, color_rgba, roughness=0.5, metallic=0.0):
    mat = bpy.data.materials.get(name)
    if not mat:
        mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = color_rgba
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = metallic
    return mat

def assign_material(obj, mat):
    if not obj.data.materials:
        obj.data.materials.append(mat)
    else:
        obj.data.materials[0] = mat

def clear_mesh_objects():
    for obj in list(bpy.data.objects):
        if obj.type == 'MESH':
            bpy.data.objects.remove(obj, do_unlink=True)

# ----------------- MODEL GENERATORS -----------------

def build_outpost(team):
    """Builds Tier 1 Outpost watchtower"""
    team_mat = get_or_create_material(f"Mat_Team_{team}", TEAM_COLORS[team], roughness=0.4)
    stone_mat = get_or_create_material("Mat_Stone", (0.28, 0.33, 0.40, 1.0), roughness=0.8)
    dark_stone = get_or_create_material("Mat_DarkStone", (0.16, 0.20, 0.26, 1.0), roughness=0.85)
    wood_mat = get_or_create_material("Mat_Wood", (0.22, 0.14, 0.08, 1.0), roughness=0.7)

    # 1. Beveled Stone Plinth
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=1.05, depth=0.35, location=(0, 0, 0.175))
    assign_material(bpy.context.active_object, dark_stone)

    # 2. Main Tower Shaft
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.8, depth=1.3, location=(0, 0, 0.95))
    assign_material(bpy.context.active_object, stone_mat)

    # 3. Upper Battlements Platform
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.96, depth=0.25, location=(0, 0, 1.7))
    assign_material(bpy.context.active_object, dark_stone)

    # 4. Stylized Conical Roof with Team Color
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=1.08, depth=1.0, location=(0, 0, 2.3))
    assign_material(bpy.context.active_object, team_mat)

    # 5. Roof Finial Ball
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.14, location=(0, 0, 2.9))
    gold_mat = get_or_create_material("Mat_Gold", (0.95, 0.72, 0.15, 1.0), roughness=0.3, metallic=0.7)
    assign_material(bpy.context.active_object, gold_mat)

    # 6. Front Wooden Archway Door
    bpy.ops.mesh.primitive_cube_add(size=0.35, location=(0, -0.78, 0.45))
    bpy.context.active_object.scale = (1.0, 0.3, 1.6)
    assign_material(bpy.context.active_object, wood_mat)

def build_crown_keep(team):
    """Builds Tier 2 Strategic Crown Keep with Royal Crown & Bastions"""
    team_mat = get_or_create_material(f"Mat_Team_{team}", TEAM_COLORS[team], roughness=0.35)
    stone_mat = get_or_create_material("Mat_Stone", (0.30, 0.35, 0.42, 1.0), roughness=0.75)
    dark_stone = get_or_create_material("Mat_DarkStone", (0.16, 0.20, 0.26, 1.0), roughness=0.85)
    gold_mat = get_or_create_material("Mat_Gold", (0.96, 0.72, 0.12, 1.0), roughness=0.25, metallic=0.8)
    gem_mat = get_or_create_material("Mat_Gem", (0.95, 0.15, 0.25, 1.0), roughness=0.15, metallic=0.2)

    # 1. Grand Octagonal Plinth
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=1.35, depth=0.4, location=(0, 0, 0.2))
    assign_material(bpy.context.active_object, dark_stone)

    # 2. Central Keep Body
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=1.05, depth=1.5, location=(0, 0, 1.1))
    assign_material(bpy.context.active_object, stone_mat)

    # 3. 4 Corner Turret Bastions
    corner_coords = [(-0.85, -0.85), (0.85, -0.85), (-0.85, 0.85), (0.85, 0.85)]
    for cx, cy in corner_coords:
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.32, depth=1.75, location=(cx, cy, 1.15))
        assign_material(bpy.context.active_object, stone_mat)

        # Turret roofs with team colors
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.38, depth=0.5, location=(cx, cy, 2.25))
        assign_material(bpy.context.active_object, team_mat)

    # 4. Central Battlements Rim
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=1.18, depth=0.25, location=(0, 0, 1.95))
    assign_material(bpy.context.active_object, gold_mat)

    # 5. Golden Royal Crown on Central Spire
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.6, depth=0.35, location=(0, 0, 2.2))
    assign_material(bpy.context.active_object, gold_mat)

    # Crown 4 Corner Points
    for px, py in [(-0.45, 0), (0.45, 0), (0, -0.45), (0, 0.45)]:
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.14, depth=0.32, location=(px, py, 2.5))
        assign_material(bpy.context.active_object, gold_mat)

    # Center Gem
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.2, location=(0, 0, 2.45))
    assign_material(bpy.context.active_object, gem_mat)

def build_citadel(team):
    """Builds Tier 3 Citadel Castle Fortress with dual high towers & gate"""
    team_mat = get_or_create_material(f"Mat_Team_{team}", TEAM_COLORS[team], roughness=0.35)
    stone_mat = get_or_create_material("Mat_Stone", (0.30, 0.34, 0.42, 1.0), roughness=0.8)
    dark_stone = get_or_create_material("Mat_DarkStone", (0.16, 0.20, 0.26, 1.0), roughness=0.85)
    gold_mat = get_or_create_material("Mat_Gold", (0.95, 0.72, 0.15, 1.0), roughness=0.3, metallic=0.7)
    wood_mat = get_or_create_material("Mat_Wood", (0.22, 0.14, 0.08, 1.0), roughness=0.7)

    # 1. Massive Curtain Wall Base
    bpy.ops.mesh.primitive_cube_add(size=2.3, location=(0, 0, 0.25))
    bpy.context.active_object.scale = (1.0, 0.9, 0.22)
    assign_material(bpy.context.active_object, dark_stone)

    # 2. Central Fortress Keep
    bpy.ops.mesh.primitive_cube_add(size=1.4, location=(0, 0, 0.95))
    bpy.context.active_object.scale = (0.95, 0.85, 0.9)
    assign_material(bpy.context.active_object, stone_mat)

    # 3. Keep Battlements
    bpy.ops.mesh.primitive_cube_add(size=1.5, location=(0, 0, 1.65))
    bpy.context.active_object.scale = (0.95, 0.85, 0.18)
    assign_material(bpy.context.active_object, dark_stone)

    # 4. Dual Flank High Guard Towers (Left & Right)
    for tx in [-1.15, 1.15]:
        # Tower Body
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.45, depth=2.1, location=(tx, -0.1, 1.15))
        assign_material(bpy.context.active_object, stone_mat)

        # Tower Balcony Rim
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.52, depth=0.2, location=(tx, -0.1, 2.25))
        assign_material(bpy.context.active_object, dark_stone)

        # Conical Steep Roof with Team Color
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.55, depth=0.85, location=(tx, -0.1, 2.75))
        assign_material(bpy.context.active_object, team_mat)

        # Golden Spire Tip
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.1, location=(tx, -0.1, 3.25))
        assign_material(bpy.context.active_object, gold_mat)

    # 5. Grand Castle Portcullis Gateway
    bpy.ops.mesh.primitive_cube_add(size=0.55, location=(0, -0.95, 0.55))
    bpy.context.active_object.scale = (1.1, 0.35, 1.5)
    assign_material(bpy.context.active_object, wood_mat)

# ----------------- MAIN RENDER LOOP -----------------

def render_sprite(filename):
    out_path = os.path.join(OUTPUT_DIR, filename)
    bpy.context.scene.render.filepath = out_path
    print(f"Rendering: {filename}...")
    bpy.ops.render.render(write_still=True)
    print(f"-> Saved: {out_path}")

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    setup_render_engine()
    setup_camera_and_lights()

    tasks = [
        ("outpost_neutral.png", lambda: build_outpost('neutral')),
        ("outpost_player.png", lambda: build_outpost('player')),
        ("outpost_enemy.png", lambda: build_outpost('enemy')),
        ("crown_keep_neutral.png", lambda: build_crown_keep('neutral')),
        ("crown_keep_player.png", lambda: build_crown_keep('player')),
        ("crown_keep_enemy.png", lambda: build_crown_keep('enemy')),
        ("citadel_player.png", lambda: build_citadel('player')),
        ("citadel_enemy.png", lambda: build_citadel('enemy')),
    ]

    for filename, builder in tasks:
        clear_mesh_objects()
        builder()
        render_sprite(filename)

    print("ALL 8 2.5D CROWN CLASH TERRITORY SPRITES RENDERED SUCCESSFULLY!")

if __name__ == "__main__":
    main()
