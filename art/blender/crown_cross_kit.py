"""Crown Cross semi-realistic model kit (Blender).

Believable medieval silhouettes with human-scale openings, tighter edge bevels,
rounded towers, layered foliage and PBR material variety (rough stone, worn
timber, polished steel, dyed cloth). Consumed by
art/blender/build_battlefield_scene.py (crown_cross territory sprites and the
shared environment prop pack) and tools/blender/generate_units.py (the four
shared troop sprites), all rendered through the canonical Art Bible rig.
Requires Blender's bpy; the scene builder imports it lazily.
"""
import math
import random

import bpy

TEAM_COLORS = {
    'player': (0.04, 0.22, 0.62),
    'enemy': (0.52, 0.06, 0.07),
    'neutral': (0.14, 0.20, 0.27),
}


# ---------------------------------------------------------------------------
# Primitive helpers (tighter bevels than a toy kit: realism reads in the edges)
# ---------------------------------------------------------------------------

def box(name, size, loc, mat, bevel=.025, rot=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = size
    if rot is not None:
        ob.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=rot is not None, scale=True)
    ob.data.materials.append(mat)
    mod = ob.modifiers.new('soft edges', 'BEVEL')
    mod.width = bevel
    mod.segments = 2
    ob.modifiers.new('weighted normals', 'WEIGHTED_NORMAL')
    return ob


def cyl(name, r, depth, loc, mat, vertices=16, rot=None, r2=None, smooth=False):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=r, depth=depth, location=loc)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r, radius2=r2, depth=depth, location=loc)
    ob = bpy.context.object
    ob.name = name
    if rot is not None:
        ob.rotation_euler = rot
    ob.data.materials.append(mat)
    mod = ob.modifiers.new('edge light', 'BEVEL')
    mod.width = .02
    mod.segments = 2
    ob.modifiers.new('weighted normals', 'WEIGHTED_NORMAL')
    if smooth:
        for poly in ob.data.polygons:
            poly.use_smooth = True
    return ob


def sphere(name, r, loc, mat, scale=(1.0, 1.0, 1.0), smooth=True):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=r, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ob.data.materials.append(mat)
    ob.modifiers.new('weighted normals', 'WEIGHTED_NORMAL')
    if smooth:
        for poly in ob.data.polygons:
            poly.use_smooth = True
    return ob


def ico(name, r, loc, mat, scale=(1.0, 1.0, 1.0), subdivisions=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=r, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ob.data.materials.append(mat)
    ob.modifiers.new('weighted normals', 'WEIGHTED_NORMAL')
    for poly in ob.data.polygons:
        poly.use_smooth = True
    return ob


def roof(name, width, length, z, height, mat, x=0, y=0):
    """True pitched roof with thick eaves and a continuous ridge."""
    verts = [
        (-width / 2, -length / 2, 0), (width / 2, -length / 2, 0),
        (width / 2, length / 2, 0), (-width / 2, length / 2, 0),
        (0, -length / 2, height), (0, length / 2, height),
    ]
    faces = [(0, 3, 2, 1), (0, 1, 4), (3, 5, 2), (0, 4, 5, 3), (1, 2, 5, 4)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    ob.location = (x, y, z)
    ob.data.materials.append(mat)
    mod = ob.modifiers.new('roof edges', 'BEVEL')
    mod.width = .03
    mod.segments = 2
    ob.modifiers.new('weighted normals', 'WEIGHTED_NORMAL')
    return ob


def heater_shield(name, loc, size, face_mat, rim_mat):
    """Flat heater shield slab with a rim and a metal boss."""
    x, y, z = loc
    profile = [(-.5, .60), (.5, .60), (.46, .12), (0, -.60), (-.46, .12)]

    def slab(slab_name, grow, thickness, mat, y_off):
        verts = [(a * size * grow, y_off, b * size * grow) for a, b in profile]
        mesh = bpy.data.meshes.new(slab_name)
        mesh.from_pydata(verts, [], [(0, 1, 2, 3, 4)])
        mesh.update()
        ob = bpy.data.objects.new(slab_name, mesh)
        bpy.context.collection.objects.link(ob)
        ob.location = loc
        solid = ob.modifiers.new('slab', 'SOLIDIFY')
        solid.thickness = thickness
        ob.data.materials.append(mat)
        return ob

    slab(name + '_rim', 1.12, .05 * size / .5, rim_mat, .012)
    slab(name + '_face', 1.0, .04 * size / .5, face_mat, .0)
    sphere(name + '_boss', .07 * size / .5, (x, y - .05, z + .02 * size), rim_mat,
           scale=(1.0, .6, 1.0))


def contact_disc(make_material, radius, alpha, name='contact shadow'):
    """Small tight ground shadow baked under a prop or building base.

    Replaces the rig's wide 1.75-radius blob for this kit: a tight ellipse
    grounds the object without reading as a mud splash at sprite size."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=radius, depth=.02, location=(0, 0, .01))
    ob = bpy.context.object
    ob.name = name
    mat = make_material('ccx_shadow', (0.0, 0.0, 0.0), 1.0, use_gradient=False)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Alpha'].default_value = alpha
    mat.blend_method = 'BLEND'
    ob.data.materials.append(mat)
    return ob


# ---------------------------------------------------------------------------
# Material sets (all use the rig's vertical gradient for depth shading)
# ---------------------------------------------------------------------------

def bmats(owner, make_material):
    """Building materials: worn stone, pale trim, dark recesses, timber, iron."""
    team = TEAM_COLORS[owner]
    return {
        'wall': make_material('rlx_wall', (.23, .27, .33), .88),
        'trim': make_material('rlx_trim', (.36, .40, .46), .78),
        'dark': make_material('rlx_dark', (.11, .14, .19), .92),
        'wood': make_material('rlx_wood', (.21, .13, .08), .72),
        'plaster': make_material('rlx_plaster', (.34, .30, .25), .82),
        'hay': make_material('rlx_hay', (.50, .38, .13), .9),
        'iron': make_material('rlx_iron', (.15, .16, .18), .45, metallic=.85),
        'gold': make_material('rlx_gold', (.62, .44, .15), .35, metallic=.9),
        'roof': make_material('rlx_roof', team, .62),
        'banner': make_material('rlx_banner', team, .85),
    }


def kmats(owner, make_material):
    """Troop materials: polished steel, dyed cloth, oiled leather."""
    team = TEAM_COLORS[owner]
    return {
        'steel': make_material('rkx_steel', (.52, .56, .62), .38, metallic=.9),
        'steel_dark': make_material('rkx_steel_dark', (.30, .33, .38), .5, metallic=.8),
        'cloth': make_material('rkx_cloth', team, .85),
        'leather': make_material('rkx_leather', (.16, .10, .07), .75),
        'gold': make_material('rkx_gold', (.62, .44, .15), .35, metallic=.9),
    }


def tmats(make_material):
    """Flora and stone materials: muted naturals that sit on the dark slate."""
    return {
        'birch_bark': make_material('rtx_bark', (.66, .65, .60), .8),
        'bark_band': make_material('rtx_band', (.16, .15, .13), .85),
        'apple_bark': make_material('rtx_abark', (.22, .14, .09), .8),
        'leaf_dark': make_material('rtx_leafd', (.10, .17, .08), .85),
        'leaf': make_material('rtx_leaf', (.15, .25, .11), .85),
        'apple': make_material('rtx_apple', (.55, .10, .08), .45),
        'stone': make_material('rtx_stone', (.30, .33, .38), .88),
    }


# ---------------------------------------------------------------------------
# Shared structure details
# ---------------------------------------------------------------------------

def arrow_slit(m, x, y, z, rot=None):
    box('slit vertical', (.035, .04, .26), (x, y, z), m['dark'], .008, rot=rot)
    box('slit cross', (.11, .04, .035), (x, y, z), m['dark'], .008, rot=rot)


def window_with_frame(m, x, y, z, w=.16, h=.32, rot=None):
    box('window frame', (w + .08, .05, h + .08), (x, y - .005, z), m['trim'], .012, rot=rot)
    box('window recess', (w, .06, h), (x, y - .045, z), m['dark'], .008, rot=rot)


def arched_gate(m, x, y, z, width=.6, height=.95):
    """Recessed opening with a voussoir arch and a banded plank door."""
    box('gate recess', (width, .12, height), (x, y, z), m['dark'], .01)
    box('door plank L', (width / 2 - .02, .09, height - .12),
        (x - width / 4, y - .01, z), m['wood'], .012)
    box('door plank R', (width / 2 - .02, .09, height - .12),
        (x + width / 4, y - .01, z), m['wood'], .012)
    for z_off in (.22, .68):
        box('door band', (width, .05, .05), (x, y - .05, z + z_off), m['iron'], .008)
    # Voussoirs: radial blocks tracing the arch.
    arch_r = width / 2 + .09
    for step in range(7):
        angle = math.radians(180.0 * (step + .5) / 7)
        vx = x + arch_r * math.cos(angle)
        vz = z + height / 2 + .09 + arch_r * math.sin(angle)
        block = box('voussoir', (.16, .14, .13), (vx, y - .02, vz), m['trim'], .012)
        block.rotation_euler.y = -angle
    box('arch spring L', (.16, .16, height / 2), (x - arch_r - .07, y - .02, z + height / 4), m['trim'], .012)
    box('arch spring R', (.16, .16, height / 2), (x + arch_r + .07, y - .02, z + height / 4), m['trim'], .012)


def merlons(m, span, y, z, count, depth=.22, width=.15, height=.18):
    """Crenellation row along a straight wall: merlons with gaps."""
    gap = span / count
    for i in range(count):
        pos = -span / 2 + gap * (i + .5)
        box('merlon', (width, depth, height), (pos, y, z), m['trim'], .01)


def ring_merlons(m, radius, z, count, size=(.14, .30, .18)):
    """Merlons around a round/octagonal parapet, each facing outward."""
    for i in range(count):
        angle = i * math.tau / count
        box('ring merlon', size, (radius * math.cos(angle), radius * math.sin(angle), z),
            m['trim'], .01, rot=(0, 0, angle - math.pi / 2))


# ---------------------------------------------------------------------------
# Tier 3 citadel (framing 5.15 / aim 1.10 — same crop as the shipped sprite)
# ---------------------------------------------------------------------------

def citadel(m, make_material):
    contact_disc(make_material, 1.45, .25)
    box('plinth step', (2.72, 2.32, .16), (0, 0, .08), m['dark'], .02)
    box('plinth top', (2.55, 2.15, .10), (0, 0, .21), m['wall'], .02)
    # Curtain walls on all four sides, front face at y = -0.88.
    wall_h = 1.32
    wall_z = .26 + wall_h / 2
    box('wall front', (2.10, .26, wall_h), (0, -.88, wall_z), m['wall'], .015)
    box('wall rear', (2.10, .26, wall_h), (0, .88, wall_z), m['wall'], .015)
    box('wall left', (.26, 1.76, wall_h), (-1.02, 0, wall_z), m['wall'], .015)
    box('wall right', (.26, 1.76, wall_h), (1.02, 0, wall_z), m['wall'], .015)
    box('wall walk front', (2.16, .34, .07), (0, -.88, .26 + wall_h + .035), m['trim'], .01)
    merlons(m, 2.02, -.88, .26 + wall_h + .16, 7, depth=.24)
    # Corner towers with string courses, machicolations and conical roofs.
    for tx, ty, tall in ((-1.02, -.88, 0), (1.02, -.88, 0), (-1.02, .88, .18), (1.02, .88, .18)):
        cyl('tower shaft', .38, 2.05 + tall, (tx, ty, .26 + (2.05 + tall) / 2), m['wall'], 12)
        cyl('tower string', .43, .07, (tx, ty, 1.35), m['trim'], 12)
        cyl('tower collar', .47, .17, (tx, ty, .26 + 2.05 + tall - .02), m['trim'], 12)
        arrow_slit(m, tx, ty - .40, 1.05)
        cyl('tower roof', .60, .88, (tx, ty, .26 + 2.05 + tall + .34), m['roof'], 12, r2=.03)
        sphere('tower finial', .05, (tx, ty, .26 + 2.05 + tall + .82), m['gold'])
    # Gatehouse flanking piers with a crenellated top.
    for px in (-.48, .48):
        box('gate pier', (.44, .46, 1.78), (px, -.88, .26 + .89), m['wall'], .018)
        box('pier quoin', (.48, .10, .30), (px, -.88, 1.30), m['trim'], .012)
    arched_gate(m, 0, -.86, .26 + .48, width=.62, height=.95)
    box('gate head', (1.72, .50, .30), (0, -.88, 2.18), m['wall'], .015)
    merlons(m, 1.6, -.88, 2.42, 5, depth=.30)
    # Central keep with quoins, windows and a pitched team roof.
    box('keep body', (1.30, 1.05, 2.05), (0, .12, .26 + 1.025), m['wall'], .018)
    box('keep parapet', (1.42, 1.17, .13), (0, .12, 2.42), m['trim'], .012)
    for qx, qy, qz in ((-.70, -.44, .80), (-.70, -.44, 1.45), (.70, -.44, .80), (.70, -.44, 1.45)):
        box('keep quoin', (.16, .16, .42), (qx, qy, qz), m['trim'], .012)
    window_with_frame(m, -.30, -.42, 1.55)
    window_with_frame(m, .30, -.42, 1.55)
    roof('keep roof', 1.50, 1.24, 2.49, .72, m['roof'], y=.12)
    box('ridge cap', (.10, 1.26, .09), (0, .12, 3.24), m['trim'], .01)
    sphere('ridge finial', .05, (0, .12, 3.30), m['gold'])
    cyl('pennant pole', .02, .42, (0, -.45, 3.28), m['iron'], 6)
    box('pennant', (.02, .26, .15), (.045, -.45, 3.42), m['banner'], .008)
    # Heraldic banner draped on the keep's front face.
    box('banner cloth', (.46, .05, .82), (0, -.365, 1.92), m['banner'], .012)
    box('banner cross V', (.09, .06, .40), (0, -.375, 1.98), m['gold'], .008)
    box('banner cross H', (.30, .06, .09), (0, -.375, 2.06), m['gold'], .008)
    box('banner rod', (.56, .04, .05), (0, -.365, 2.36), m['gold'], .008)
    # Small side details.
    arrow_slit(m, 1.16, -.30, 1.05)
    arrow_slit(m, -1.16, .30, 1.05)


# ---------------------------------------------------------------------------
# Tier 2 crown keep (framing 4.35 / aim 0.85)
# ---------------------------------------------------------------------------

def keep(m, make_material):
    contact_disc(make_material, 1.30, .26)
    cyl('plinth', 1.30, .18, (0, 0, .09), m['dark'], 8)
    cyl('wall', 1.12, 1.30, (0, 0, .83), m['wall'], 8)
    cyl('wall string', 1.18, .07, (0, 0, 1.30), m['trim'], 8)
    cyl('wall parapet', 1.22, .16, (0, 0, 1.51), m['wall'], 8)
    ring_merlons(m, 1.16, 1.68, 8)
    # Inner watch tower with the gilded crown ring.
    cyl('tower', .48, 1.0, (0, 0, 1.70), m['wall'], 8)
    cyl('tower parapet', .56, .12, (0, 0, 2.26), m['trim'], 8)
    window_with_frame(m, 0, -.46, 1.75, w=.14, h=.26)
    cyl('crown band', .53, .09, (0, 0, 2.33), m['gold'], 8)
    for i in range(5):
        a = i * math.tau / 5
        cyl('crown point', .05, .16, (.36 * math.cos(a), .36 * math.sin(a), 2.45), m['gold'], 6)
    cyl('tower roof', .62, .55, (0, 0, 2.55), m['roof'], 8, r2=.02)
    sphere('finial', .05, (0, 0, 2.87), m['gold'])
    # Gate and draped standards on the camera-facing facets.
    arched_gate(m, 0, -1.0, .57, width=.52, height=.80)
    for sx, rot in ((-.42, .10), (.42, -.10)):
        box('wall banner', (.34, .05, .72), (sx, -1.02, 1.05), m['banner'], .012, rot=(0, 0, rot))
        box('banner bar', (.18, .06, .07), (sx, -1.055, 1.28), m['gold'], .008, rot=(0, 0, rot))
    arrow_slit(m, 1.06, .30, 1.15, rot=(0, math.pi / 2, 0))


# ---------------------------------------------------------------------------
# Tier 1 outpost watchtower (framing 4.6 / aim 1.30)
# ---------------------------------------------------------------------------

def outpost(m, make_material):
    contact_disc(make_material, .95, .26)
    cyl('plinth', .85, .16, (0, 0, .08), m['dark'], 8)
    cyl('shaft', .58, 1.90, (0, 0, 1.11), m['wall'], 8)
    cyl('string', .63, .06, (0, 0, 1.20), m['trim'], 8)
    cyl('machicolation', .72, .18, (0, 0, 2.12), m['trim'], 8)
    ring_merlons(m, .66, 2.30, 8, size=(.12, .22, .16))
    cyl('watch room', .42, .32, (0, 0, 2.37), m['wood'], 8)
    cyl('watch roof', .60, .68, (0, 0, 2.87), m['roof'], 8, r2=.02)
    sphere('finial', .045, (0, 0, 3.24), m['gold'])
    arched_gate(m, 0, -.52, .49, width=.38, height=.66)
    arrow_slit(m, 0, -.58, 1.50)
    arrow_slit(m, .585, .30, 1.50, rot=(0, math.pi / 2, 0))
    cyl('pennant pole', .015, .30, (0, 0, 3.34), m['iron'], 6)
    box('pennant', (.015, .20, .12), (.03, 0, 3.40), m['banner'], .006)
    box('wall banner', (.26, .04, .44), (0, -.60, 1.35), m['banner'], .01)
    box('banner emblem', (.05, .05, .16), (0, -.635, 1.35), m['gold'], .008)


# ---------------------------------------------------------------------------
# Tier 1 barracks: stone garrison hall (framing 4.25 / aim 0.70)
# ---------------------------------------------------------------------------

def barracks(m, make_material):
    contact_disc(make_material, 1.35, .25)
    box('foundation', (2.50, 1.85, .16), (0, 0, .08), m['dark'], .02)
    box('body', (2.30, 1.60, 1.25), (0, 0, .785), m['wall'], .02)
    for qx, qy in ((-1.15, -.80), (1.15, -.80), (-1.15, .80), (1.15, .80)):
        for z in (.50, 1.10):
            box('quoin', (.14, .14, .34), (qx, qy, z), m['trim'], .012)
    roof('hall roof', 2.52, 1.90, 1.41, .75, m['roof'])
    box('ridge cap', (.10, 1.92, .08), (0, 0, 2.19), m['trim'], .01)
    box('chimney', (.26, .26, .55), (.78, .42, 1.95), m['wall'], .015)
    box('chimney cap', (.32, .32, .08), (.78, .42, 2.25), m['trim'], .01)
    arched_gate(m, 0, -.81, .56, width=.50, height=.80)
    window_with_frame(m, -.72, -.83, 1.02, w=.15, h=.30)
    window_with_frame(m, .72, -.83, 1.02, w=.15, h=.30)
    for x in (-1.12, 1.12):
        box('buttress', (.16, .14, .85), (x, -.72, .585), m['trim'], .012)
    box('banner', (.34, .05, .62), (0, -.83, 1.12), m['banner'], .012)
    box('banner cross V', (.06, .06, .30), (0, -.855, 1.12), m['gold'], .008)
    box('banner cross H', (.20, .06, .06), (0, -.855, 1.16), m['gold'], .008)
    heater_shield('garrison shield', (.62, -.82, .62), .40, m['banner'], m['gold'])
    window_with_frame(m, 1.16, .15, .95, w=.13, h=.24, rot=(0, 0, math.pi / 2))


# ---------------------------------------------------------------------------
# Tier 1 stable: timber-framed hall with open stalls (framing 4.25 / aim 0.70)
# ---------------------------------------------------------------------------

def stable(m, make_material):
    contact_disc(make_material, 1.35, .25)
    box('foundation', (2.50, 1.95, .14), (0, 0, .07), m['dark'], .02)
    box('body plaster', (2.28, 1.55, 1.05), (0, 0, .665), m['plaster'], .02)
    # Half-timbered front face.
    for x in (-1.08, -.54, 0, .54, 1.08):
        box('timber post', (.10, .05, 1.05), (x, -.775, .665), m['wood'], .012)
    box('timber beam', (2.28, .05, .08), (0, -.775, 1.15), m['wood'], .012)
    roof('stable roof', 2.48, 1.90, 1.19, .70, m['roof'])
    box('ridge cap', (.09, 1.92, .07), (0, 0, 1.94), m['trim'], .01)
    arched_gate(m, 0, -.78, .45, width=.40, height=.66)
    for sx in (-.75, .75):
        box('stall recess', (.55, .10, .62), (sx, -.78, .48), m['dark'], .012)
        box('trough', (.40, .14, .16), (sx, -.86, .28), m['wood'], .012)
        box('hay', (.30, .06, .10), (sx, -.86, .37), m['hay'], .01)
    canopy = box('canopy', (1.9, .5, .06), (0, -1.02, 1.02), m['roof'], .012)
    canopy.rotation_euler = (.14, 0, 0)
    for x in (-.95, .95):
        box('canopy pole', (.07, .07, 1.02), (x, -1.05, .66), m['wood'], .01)
    window_with_frame(m, 1.15, .10, .82, w=.13, h=.22, rot=(0, 0, math.pi / 2))


# ---------------------------------------------------------------------------
# Troop: armoured knight with tabard (leader adds crest and cape)
# Framing 2.30 / aim 0.77 — same crop as the shipped unit sprites.
# ---------------------------------------------------------------------------

def knight(m, leader):
    # Legs in a marching stance (right foot forward, -Y is the march heading).
    for foot_x, foot_y in ((-.10, .04), (.10, -.20)):
        box('foot', (.11, .19, .08), (foot_x, foot_y, .05), m['leather'], .012)
    box('greave L', (.10, .11, .34), (-.10, .04, .30), m['steel_dark'], .015)
    box('greave R', (.10, .11, .34), (.10, -.20, .30), m['steel_dark'], .015)
    sphere('knee L', .065, (-.10, .04, .52), m['steel'])
    sphere('knee R', .065, (.10, -.20, .52), m['steel'])
    box('cuisse L', (.12, .12, .30), (-.10, .04, .74), m['steel_dark'], .015)
    box('cuisse R', (.12, .12, .30), (.10, -.20, .74), m['steel_dark'], .015)
    # Fauld lames over the hips.
    for r, z in ((.21, .98), (.19, 1.05), (.17, 1.12)):
        cyl('fauld lame', r, .05, (0, -.04, z), m['steel'], 14)
    # Breastplate and plackart.
    breast = cyl('breastplate', .205, .40, (0, -.02, 1.33), m['steel'], 14)
    breast.scale = (1.0, .82, 1.0)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
    box('plackart', (.27, .22, .16), (0, -.06, 1.13), m['steel_dark'], .015)
    # Tabard panel and leader cape in team cloth.
    tabard = box('tabard', (.24, .045, .58), (0, -.225, 1.10), m['cloth'], .01)
    tabard.rotation_euler = (.10, 0, 0)
    if leader:
        cape = box('cape', (.28, .04, .60), (0, .21, 1.10), m['cloth'], .01)
        cape.rotation_euler = (-.22, 0, 0)
    # Arms: sword arm forward-low on +X, shield arm reaching to -X.
    for sx in (1, -1):
        shoulder_x = .215 * sx
        sphere('pauldron', .105, (shoulder_x, -.01, 1.44), m['steel'], scale=(1.0, .8, .85))
        upper = cyl('upper arm', .055, .20, (shoulder_x + .02 * sx, -.05, 1.30), m['steel_dark'], 8)
        upper.rotation_euler = (.35 * sx, 0, .25 * sx)
        forearm = cyl('forearm', .048, .22, (shoulder_x + .045 * sx, -.14, 1.12), m['steel_dark'], 8)
        forearm.rotation_euler = (.55 * sx, 0, .12 * sx)
        box('gauntlet', (.085, .10, .10), (shoulder_x + .05 * sx, -.20, 1.00), m['steel'], .012)
    # Helm: cylindrical greathelm with dome, visor slit and leader crest.
    cyl('helm', .135, .24, (0, -.03, 1.66), m['steel'], 14)
    sphere('helm dome', .135, (0, -.03, 1.78), m['steel'], scale=(1.0, 1.0, .75))
    box('visor slit', (.17, .05, .035), (0, -.175, 1.70), m['leather'], .006)
    box('visor plate', (.13, .03, .06), (0, -.165, 1.63), m['steel_dark'], .006)
    if leader:
        box('crest fin A', (.02, .22, .12), (0, -.05, 1.86), m['cloth'], .008)
        box('crest fin B', (.02, .14, .09), (0, .09, 1.90), m['cloth'], .008, rot=(-.35, 0, 0))
    # Sword held low on the +X side.
    blade = box('blade', (.035, .018, .52), (.30, -.24, .92), m['steel'], .006)
    blade.rotation_euler = (-.12, 0, 0)
    box('crossguard', (.15, .04, .03), (.30, -.24, .66), m['gold'], .008)
    cyl('grip', .022, .12, (.30, -.24, .58), m['leather'], 8)
    sphere('pommel', .035, (.30, -.24, .50), m['gold'])
    # Heater shield on the -X side, facing the camera.
    heater_shield('knight shield', (-.31, -.19, .86), .52, m['cloth'], m['gold'])


# ---------------------------------------------------------------------------
# Environment flora and stones (shared by every battlefield)
# ---------------------------------------------------------------------------

def tree_birch(m, make_material):
    contact_disc(make_material, .55, .30)
    cyl('birch trunk', .10, 2.55, (0, 0, 1.28), m['birch_bark'], 10, r2=.055)
    for z in (.45, .95, 1.50, 1.95):
        cyl('birch band', .102 - .012 * (z / 2.55), .035, (0, 0, z), m['bark_band'], 10)
    cyl('birch branch L', .05, .75, (-.16, -.10, 2.42), m['birch_bark'], 8, r2=.02,
        rot=(.45, 0, .65))
    cyl('birch branch R', .05, .75, (.17, .10, 2.30), m['birch_bark'], 8, r2=.02,
        rot=(.50, 0, -.60))
    canopy = (
        ((.02, .02, 3.10), .74, (1.15, 1.0, .95), 'leaf_dark'),
        ((.55, .35, 2.72), .55, (1.0, 1.0, .9), 'leaf'),
        ((-.55, -.30, 2.82), .55, (1.05, .95, .9), 'leaf'),
        ((.18, -.48, 2.62), .45, (1.0, 1.0, .85), 'leaf'),
        ((-.32, .44, 2.72), .50, (1.0, 1.0, .9), 'leaf_dark'),
        ((.05, .10, 3.55), .38, (1.0, .9, .95), 'leaf'),
    )
    for pos, r, scale, mat in canopy:
        ico('birch leaf', r, pos, m[mat], scale=scale)


def tree_apple(m, make_material):
    contact_disc(make_material, .62, .30)
    cyl('apple trunk', .15, 1.45, (0, 0, .73), m['apple_bark'], 10, r2=.09)
    cyl('apple fork', .07, .85, (.13, .06, 1.55), m['apple_bark'], 8, r2=.04,
        rot=(.40, 0, -.35))
    canopy = (
        ((0, 0, 2.28), .78, (1.12, 1.0, .92), 'leaf_dark'),
        ((.48, .28, 1.92), .54, (1.0, 1.0, .9), 'leaf'),
        ((-.48, -.24, 1.98), .50, (1.0, .95, .9), 'leaf'),
        ((.10, -.46, 2.10), .48, (1.0, 1.0, .9), 'leaf'),
        ((-.18, .46, 2.02), .44, (1.0, 1.0, .9), 'leaf_dark'),
    )
    for pos, r, scale, mat in canopy:
        ico('apple leaf', r, pos, m[mat], scale=scale)
    apples = ((.02, .62, 2.25), (.52, .42, 1.80), (.42, .50, 2.05), (-.50, .18, 1.95),
              (-.34, -.42, 2.15), (.28, -.50, 2.30), (-.12, .58, 1.80), (.20, .12, 2.95))
    for pos in apples:
        sphere('apple fruit', .07, pos, m['apple'])


def tree_pine(m, make_material):
    contact_disc(make_material, .55, .30)
    cyl('pine trunk', .13, 1.10, (0, 0, .55), m['apple_bark'], 8, r2=.08)
    layers = ((.82, .95, 1.55, 'leaf_dark'), (.66, .85, 2.15, 'leaf'),
              (.48, .75, 2.70, 'leaf_dark'), (.30, .62, 3.20, 'leaf'))
    for i, (r, h, z, mat) in enumerate(layers):
        cyl('pine layer', r, h, (0, 0, z), m[mat], 10, r2=.01, rot=(0, 0, .4 * i))


def bush(m, make_material):
    contact_disc(make_material, .55, .30)
    clumps = (
        ((0, 0, .42), .48, (1.15, 1.0, .85), 'leaf_dark'),
        ((.42, .18, .30), .36, (1.0, 1.0, .9), 'leaf'),
        ((-.40, -.14, .32), .34, (1.0, 1.0, .9), 'leaf'),
        ((.05, -.38, .36), .30, (1.0, 1.0, .9), 'leaf_dark'),
    )
    for pos, r, scale, mat in clumps:
        ico('bush leaf', r, pos, m[mat], scale=scale)


def grass_tuft(m, make_material):
    for i in range(7):
        a = i * math.tau / 7 + .3
        depth = .55 + (i % 3) * .09
        cyl('blade', .05, depth, (.09 * math.cos(a), .09 * math.sin(a), .32),
            m['leaf_dark'] if i % 2 else m['leaf'], 6, r2=.006, rot=(0, .22, a))


def rock(m, make_material):
    contact_disc(make_material, .55, .28)
    big = ico('rock big', .50, (0, 0, .30), m['stone'], scale=(1.28, .92, .66))
    _jitter(big, random.Random(11))
    small = ico('rock small', .28, (.44, .18, .18), m['stone'], scale=(1.2, .9, .7))
    _jitter(small, random.Random(23))


def _jitter(ob, rng):
    """Deterministic per-vertex displacement: faceted natural stone."""
    mesh = ob.data
    for vertex in mesh.vertices:
        factor = .82 + rng.random() * .38
        vertex.co.x *= factor
        vertex.co.y *= factor
        vertex.co.z *= .92 + rng.random() * .16
    mesh.update()
    for poly in mesh.polygons:
        poly.use_smooth = False
