"""
Crown Clash - Blender Scene Automation Setup Script
Configures the locked 2.5D orthographic camera, 3-point stylized lighting rig,
and 512x512 transparent PNG render settings defined in ART_BIBLE.md.
"""

import math
try:
    import bpy
except ImportError:
    bpy = None

def setup_crown_clash_scene():
    if not bpy:
        print("Error: This script must be run inside Blender's Python environment.")
        return

    # 1. Clean default scene objects (cube, default light, default cam)
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

    # Position camera: 55° pitch, 45° yaw for standard 2.5D dimetric view
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

    # 5. Render Settings (512x512 Transparent PNG Master)
    scene = bpy.context.scene
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'

    print("Crown Clash Blender scene configured successfully.")

if __name__ == "__main__":
    setup_crown_clash_scene()
