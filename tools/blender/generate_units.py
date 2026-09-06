"""
Crown Clash - 2.5D Army Unit Token Generator
Generates and renders stylized 2.5D orthographic unit tokens and squad followers
strictly adhering to the specifications in ART_BIBLE.md.
"""

import math
import os
import bpy

OUTPUT_DIR = os.path.abspath(r"E:\MyProjects\crownClash\apps\game\public\assets\units")
RESOLUTION = 128  # 128x128 sprite for unit tokens

TEAM_COLORS = {
    'player': (0.145, 0.388, 0.922, 1.0),   # #2563eb
    'enemy': (0.863, 0.149, 0.149, 1.0),    # #dc2626
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
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)

    # 1. Orthographic Camera per Art Bible: 55° pitch, 45° yaw
    cam_data = bpy.data.cameras.new(name="CrownClash_OrthoCam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 2.6  # Tightly frames the 2.5D miniature
    cam_data.clip_start = 0.1
    cam_data.clip_end = 100.0

    cam_obj = bpy.data.objects.new("CrownClash_OrthoCam", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    cam_obj.location = (8.0, -8.0, 9.5)
    cam_obj.rotation_euler = (math.radians(55.0), 0.0, math.radians(45.0))

    # 2. Key Light (Sun) - Warm Champagne, top-left
    key_light_data = bpy.data.lights.new(name="Key_Sun", type='SUN')
    key_light_data.energy = 4.6
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
    rim_light_data.energy = 2.8
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

def build_toy_knight(team, is_leader=True):
    """
    Builds a stylized 2.5D toy knight warrior figurine:
    - Round beveled plinth
    - Armored torso with team tunic
    - Knight Greathelm with glowing visor / team plume
    - Heraldic heater shield with team heraldry
    - Gleaming royal sword/lance
    """
    team_mat = get_or_create_material(f"Mat_Knight_Team_{team}", TEAM_COLORS[team], roughness=0.35)
    steel_mat = get_or_create_material("Mat_Knight_Steel", (0.75, 0.80, 0.88, 1.0), roughness=0.25, metallic=0.9)
    dark_steel = get_or_create_material("Mat_Knight_DarkSteel", (0.20, 0.24, 0.32, 1.0), roughness=0.5, metallic=0.7)
    gold_mat = get_or_create_material("Mat_Knight_Gold", (0.95, 0.74, 0.18, 1.0), roughness=0.25, metallic=0.85)

    scale = 1.0 if is_leader else 0.8
    Z_OFFSET = 0.35

    # 1. Round Beveled Plinth
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.75 * scale, depth=0.18, location=(0, 0, Z_OFFSET + 0.09))
    assign_material(bpy.context.active_object, dark_steel)

    # 2. Torso (Armored Breastplate)
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.42 * scale, depth=0.55 * scale, location=(0, 0, Z_OFFSET + 0.45 * scale))
    assign_material(bpy.context.active_object, team_mat)

    # Belt / Waistband
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.46 * scale, depth=0.12 * scale, location=(0, 0, Z_OFFSET + 0.24 * scale))
    assign_material(bpy.context.active_object, gold_mat if is_leader else dark_steel)

    # 3. Helmet (Chunky Greathelm)
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.38 * scale, depth=0.45 * scale, location=(0, 0, Z_OFFSET + 0.85 * scale))
    assign_material(bpy.context.active_object, steel_mat)

    # Visor slit
    bpy.ops.mesh.primitive_cube_add(size=0.15 * scale, location=(0, -0.32 * scale, Z_OFFSET + 0.85 * scale))
    bpy.context.active_object.scale = (2.2, 0.6, 0.5)
    assign_material(bpy.context.active_object, dark_steel)

    # 4. Team Helmet Plume / Crest
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.20 * scale, depth=0.45 * scale, location=(0, 0, Z_OFFSET + 1.20 * scale))
    assign_material(bpy.context.active_object, team_mat)

    # Leader Crown / Golden Horn
    if is_leader:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.14 * scale, location=(0, 0, Z_OFFSET + 1.45 * scale))
        assign_material(bpy.context.active_object, gold_mat)

    # 5. Heraldic Shield (Left Side)
    shield_x = -0.48 * scale
    shield_y = -0.15 * scale
    shield_z = Z_OFFSET + 0.55 * scale
    # Shield Body
    bpy.ops.mesh.primitive_cube_add(size=0.32 * scale, location=(shield_x, shield_y, shield_z))
    bpy.context.active_object.scale = (0.4, 1.4, 2.0)
    bpy.context.active_object.rotation_euler = (0, math.radians(-15), math.radians(20))
    assign_material(bpy.context.active_object, team_mat)
    # Shield Gold Boss
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.12 * scale, location=(shield_x - 0.08 * scale, shield_y, shield_z))
    assign_material(bpy.context.active_object, gold_mat)

    # 6. Sword / Lance (Right Side)
    sword_x = 0.48 * scale
    sword_y = -0.10 * scale
    sword_z = Z_OFFSET + 0.65 * scale
    # Blade
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.06 * scale, depth=1.0 * scale, location=(sword_x, sword_y, sword_z + 0.2 * scale))
    bpy.context.active_object.rotation_euler = (math.radians(-20), math.radians(15), 0)
    assign_material(bpy.context.active_object, steel_mat)
    # Hilt / Guard
    bpy.ops.mesh.primitive_cube_add(size=0.08 * scale, location=(sword_x, sword_y, sword_z - 0.25 * scale))
    bpy.context.active_object.scale = (2.2, 0.8, 0.6)
    assign_material(bpy.context.active_object, gold_mat)

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
        ("unit_leader_player.png", lambda: build_toy_knight('player', is_leader=True)),
        ("unit_leader_enemy.png", lambda: build_toy_knight('enemy', is_leader=True)),
        ("unit_follower_player.png", lambda: build_toy_knight('player', is_leader=False)),
        ("unit_follower_enemy.png", lambda: build_toy_knight('enemy', is_leader=False)),
    ]

    for filename, builder in tasks:
        clear_mesh_objects()
        builder()
        render_sprite(filename)

    print("ALL 4 2.5D CROWN CLASH TOY KNIGHT SPRITES RENDERED SUCCESSFULLY!")

if __name__ == "__main__":
    main()
