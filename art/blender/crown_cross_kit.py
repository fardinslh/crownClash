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

def box(name, size, loc, mat, bevel=.025, rot=None, bevel_segments=2):
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
    mod.segments = bevel_segments
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

# Per-map building themes: the same semi-realistic architecture family built
# from each battlefield's local materials, so every map's fortresses read as
# belonging to their own meadow. Values: (rgb, roughness).
_BUILDING_THEMES = {
    # Crown Cross: slate stone, pale trim, classic royal slate.
    'crown_cross': {
        'wall': ((.23, .27, .33), .88), 'trim': ((.36, .40, .46), .78),
        'dark': ((.11, .14, .19), .92), 'wood': ((.21, .13, .08), .72),
        'plaster': ((.34, .30, .25), .82), 'hay': ((.50, .38, .13), .90),
        'iron': ((.15, .16, .18), .45), 'gold': ((.62, .44, .15), .35),
    },
    # Twin Passes: rough highland granite, pale schist, heavy oak.
    'twin_passes': {
        'wall': ((.27, .25, .22), .96), 'trim': ((.37, .35, .31), .86),
        'dark': ((.12, .11, .09), .96), 'wood': ((.26, .16, .09), .76),
        'plaster': ((.30, .27, .22), .88), 'hay': ((.48, .37, .13), .92),
        'iron': ((.13, .14, .15), .55), 'gold': ((.55, .40, .14), .45),
    },
    # Royal Ring: cream limestone, pale marble, rich gold, polished iron.
    'royal_ring': {
        'wall': ((.55, .51, .44), .68), 'trim': ((.76, .73, .68), .45),
        'dark': ((.24, .21, .19), .70), 'wood': ((.34, .23, .14), .65),
        'plaster': ((.60, .56, .48), .60), 'hay': ((.55, .44, .18), .88),
        'iron': ((.22, .24, .27), .35), 'gold': ((.80, .62, .26), .25),
    },
    # Quad Citadel: dark war-camp timber, aged wood, canvas, matte iron.
    'quad_citadel': {
        'wall': ((.30, .22, .15), .90), 'trim': ((.47, .35, .20), .78),
        'dark': ((.12, .09, .07), .95), 'wood': ((.25, .16, .10), .80),
        'plaster': ((.42, .36, .28), .95), 'hay': ((.55, .42, .14), .92),
        'iron': ((.12, .13, .14), .60), 'gold': ((.50, .38, .12), .45),
    },
}


def bmats(owner, make_material, theme='crown_cross'):
    """Building materials in the battlefield's local theme.

    Team colour always lives on roofs and banners (ownership readability);
    the local theme carries stone, timber, trim and ornament."""
    team = TEAM_COLORS[owner]
    palette = _BUILDING_THEMES.get(theme, _BUILDING_THEMES['crown_cross'])
    short = theme[:4]
    mats = {}
    for key, (color, roughness) in palette.items():
        metallic = .85 if key == 'iron' else .9 if key == 'gold' else 0.0
        mats[key] = make_material(f'rtb_{short}_{key}', color, roughness, metallic=metallic)
    mats['roof'] = make_material(f'rtb_{short}_roof', team, .62)
    mats['banner'] = make_material(f'rtb_{short}_banner', team, .85)
    return mats


def _crag_ring(mat, radii, count, rock_r=.26, z=.05):
    """Jittered mountain stones ringing a base: the highland signature."""
    rng = random.Random(77)
    for i in range(count):
        angle = i * math.tau / count + .3
        stone = ico('crag stone', rock_r,
                    (radii[0] * math.cos(angle), radii[1] * math.sin(angle), z),
                    mat, scale=(1.25, .95, .55))
        _jitter(stone, rng)


def _palisade_ring(m, rx, ry, count, z=.30, height=.62, log_r=.07):
    """Pointed log palisade ringing a base: the war-camp signature."""
    for i in range(count):
        angle = i * math.tau / count
        cyl('palisade log', log_r, height,
            (rx * math.cos(angle), ry * math.sin(angle), z),
            m['wood'], 7, r2=.045)


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


def portcullis(m, x, y, z, width=.52, height=.78):
    """Iron grille hung in the gate: the war-read on every fortress door."""
    for i in range(5):
        gx = x - width / 2 + width * (i + .5) / 5
        box('portcullis bar', (.035, .05, height), (gx, y, z), m['iron'], .006)
    for z_off in (-.26, 0, .26):
        box('portcullis rail', (width + .05, .05, .04), (x, y, z + z_off), m['iron'], .006)


def hoarding(m, span, y, z, count=6, out=.24, post_h=.36):
    """Timber fighting gallery projecting from a wall face: posts, an
    overhanging plank floor and rail, plus a baked shadow seam where the
    gallery meets the wall. The classic war-castle silhouette."""
    for i in range(count):
        hx = -span / 2 + span * (i + .5) / count
        box('hoarding post', (.07, .09, post_h), (hx, y - out / 2, z), m['wood'], .008)
    box('hoarding floor', (span + .06, out + .08, .05), (0, y - out / 2 + .02, z + post_h / 2), m['wood'], .01)
    box('hoarding rail', (span + .06, .05, .05), (0, y - out + .02, z + post_h / 2 - .14), m['wood'], .008)
    box('hoarding shade', (span + .02, .05, post_h - .06), (0, y + .015, z - .02), m['dark'], .006)


def ring_hoarding(m, radius, z, count=8, out=.22, post_h=.36, vertices=12):
    """Timber fighting gallery ringing a round tower wall: curved posts,
    a plank floor ring and a shadow seam under the floor."""
    for i in range(count):
        angle = i * math.tau / count
        box('hoarding post', (.09, .09, post_h),
            ((radius + out / 2) * math.cos(angle), (radius + out / 2) * math.sin(angle), z),
            m['wood'], .008, rot=(0, 0, angle))
    cyl('hoarding floor', radius + out / 2 + .03, .05, (0, 0, z + post_h / 2), m['wood'], vertices)
    cyl('hoarding shade', radius + .015, post_h - .08, (0, 0, z - .03), m['dark'], vertices)


def gable_steps(m, y, half_width, rise, z_eave, steps=4, depth=.18):
    """Stepped stone gable parapet (corbie steps) at one roof end: each step
    climbs the roof slope, capped at the ridge."""
    for s in range(steps):
        frac = (s + 1) / (steps + 1)
        x_off = half_width * (1 - frac)
        for sx in (-1, 1):
            box('gable step', (.24, depth, .12), (sx * x_off, y, z_eave + rise * frac), m['trim'], .01)
    box('gable cap', (.26, depth, .14), (0, y, z_eave + rise + .05), m['trim'], .01)


def eave_shade(m, width, length, z, face_y, side_x):
    """Baked shadow seams under the roof eaves on the two camera-facing
    faces (front -Y and side +X): a thin dark strip just below the eave
    line reads as the roof's cast shadow and grounds the silhouette."""
    box('eave shade F', (width * .90, .045, .10), (0, face_y, z - .055), m['dark'], .006)
    box('eave shade S', (.045, length * .78, .10), (side_x, 0, z - .055), m['dark'], .006)


def pennant_pole(m, x, y, z_base, pole_h=.40, flag_w=.24, flag_h=.14):
    """Team pennant on an iron pole: ownership marks on towers and gables."""
    cyl('pennant pole', .018, pole_h, (x, y, z_base + pole_h / 2), m['iron'], 6)
    box('pennant flag', (.02, flag_w, flag_h), (x + .025, y, z_base + pole_h - flag_h / 2), m['banner'], .006)


# ---------------------------------------------------------------------------
# Tier 3 citadel (framing 5.15 / aim 1.10 — same crop as the shipped sprite)
# ---------------------------------------------------------------------------

def citadel(m, make_material, theme='crown_cross'):
    contact_disc(make_material, 1.45, .25)
    # Stepped three-course plinth (the recessed base course adds footprint
    # weight without raising the stack).
    box('plinth base', (3.00, 2.60, .13), (0, 0, .065), m['dark'], .03, bevel_segments=3)
    box('plinth step', (2.72, 2.32, .16), (0, 0, .08), m['dark'], .03, bevel_segments=3)
    box('plinth top', (2.55, 2.15, .10), (0, 0, .21), m['wall'], .03, bevel_segments=3)
    # Curtain walls on all four sides, front face at y = -0.88.
    wall_h = 1.32
    wall_z = .26 + wall_h / 2
    box('wall front', (2.10, .26, wall_h), (0, -.88, wall_z), m['wall'], .03, bevel_segments=3)
    box('wall rear', (2.10, .26, wall_h), (0, .88, wall_z), m['wall'], .03, bevel_segments=3)
    box('wall left', (.26, 1.76, wall_h), (-1.02, 0, wall_z), m['wall'], .03, bevel_segments=3)
    box('wall right', (.26, 1.76, wall_h), (1.02, 0, wall_z), m['wall'], .03, bevel_segments=3)
    box('wall walk front', (2.16, .34, .07), (0, -.88, .26 + wall_h + .035), m['trim'], .01)
    merlons(m, 2.02, -.88, .26 + wall_h + .16, 7, depth=.30, width=.21, height=.26)
    # Timber fighting galleries project from the camera-facing curtain walls:
    # the war silhouette with baked shadow seams under the gallery floors.
    hoarding(m, 1.80, -1.02, 1.22, count=6)
    for i in range(4):
        hy = -.65 + 1.30 * (i + .5) / 4
        box('hoarding post', (.09, .07, .34), (1.26, hy, 1.22), m['wood'], .008)
    box('hoarding floor side', (.30, 1.36, .05), (1.26, 0, 1.39), m['wood'], .01)
    box('hoarding rail side', (.05, 1.36, .05), (1.37, 0, 1.15), m['wood'], .008)
    box('hoarding shade side', (.05, 1.28, .28), (1.16, 0, 1.20), m['dark'], .006)
    # Corner towers with string courses, machicolations and conical roofs.
    for tx, ty, tall in ((-1.02, -.88, 0), (1.02, -.88, 0), (-1.02, .88, .18), (1.02, .88, .18)):
        cyl('tower shaft', .38, 2.05 + tall, (tx, ty, .26 + (2.05 + tall) / 2), m['wall'], 12)
        cyl('tower string', .45, .07, (tx, ty, 1.35), m['trim'], 12)
        cyl('tower collar', .50, .17, (tx, ty, .26 + 2.05 + tall - .02), m['trim'], 12)
        arrow_slit(m, tx, ty - .40, 1.05)
        cyl('tower roof', .60, .88, (tx, ty, .26 + 2.05 + tall + .34), m['roof'], 12, r2=.03)
        sphere('tower finial', .05, (tx, ty, .26 + 2.05 + tall + .82), m['gold'])
    # Team pennants fly from the two front towers.
    pennant_pole(m, -1.02, -.88, 2.34, pole_h=.40)
    pennant_pole(m, 1.02, -.88, 2.34, pole_h=.40)
    # Gatehouse flanking piers with a crenellated top and an iron grille.
    for px in (-.48, .48):
        box('gate pier', (.44, .46, 1.78), (px, -.88, .26 + .89), m['wall'], .028, bevel_segments=3)
        box('pier quoin', (.48, .10, .30), (px, -.88, 1.30), m['trim'], .012)
    arched_gate(m, 0, -.86, .26 + .48, width=.62, height=.95)
    portcullis(m, 0, -.99, .74, width=.56, height=.84)
    box('gate head', (1.72, .50, .30), (0, -.88, 2.18), m['wall'], .025, bevel_segments=3)
    merlons(m, 1.6, -.88, 2.42, 5, depth=.32, width=.22, height=.24)
    # Central keep with quoins on both camera faces, windows and a pitched
    # team roof with eave shadow seams.
    box('keep body', (1.30, 1.05, 2.05), (0, .12, .26 + 1.025), m['wall'], .03, bevel_segments=3)
    box('keep parapet', (1.42, 1.17, .13), (0, .12, 2.42), m['trim'], .012)
    for qx, qy, qz in ((-.70, -.44, .80), (-.70, -.44, 1.45), (.70, -.44, .80), (.70, -.44, 1.45)):
        box('keep quoin', (.16, .16, .42), (qx, qy, qz), m['trim'], .012)
    for qz in (.80, 1.45):
        box('keep quoin side', (.16, .16, .42), (.66, -.33, qz), m['trim'], .012)
        box('keep quoin side', (.16, .16, .42), (.66, .57, qz), m['trim'], .012)
    window_with_frame(m, -.30, -.42, 1.55)
    window_with_frame(m, .30, -.42, 1.55)
    roof('keep roof', 1.50, 1.24, 2.49, .72, m['roof'], y=.12)
    eave_shade(m, 1.50, 1.24, 2.49, face_y=-.40, side_x=.66)
    box('ridge cap', (.10, 1.26, .09), (0, .12, 3.24), m['trim'], .01)
    sphere('ridge finial', .05, (0, .12, 3.30), m['gold'])
    cyl('pennant pole', .02, .42, (0, -.45, 3.28), m['iron'], 6)
    box('pennant', (.02, .26, .15), (.045, -.45, 3.42), m['banner'], .008)
    # Heraldic banner on the keep's front face and a war standard on the side.
    box('banner cloth', (.46, .05, .82), (0, -.365, 1.92), m['banner'], .012)
    box('banner cross V', (.09, .06, .40), (0, -.375, 1.98), m['gold'], .008)
    box('banner cross H', (.30, .06, .09), (0, -.375, 2.06), m['gold'], .008)
    box('banner rod', (.56, .04, .05), (0, -.365, 2.36), m['gold'], .008)
    box('side standard', (.05, .40, .55), (.655, .12, 1.70), m['banner'], .012)
    box('side standard bar', (.05, .18, .06), (.665, .12, 1.94), m['gold'], .008)
    # War posture: arrow slits along both camera-facing curtain walls.
    arrow_slit(m, 1.16, -.30, 1.05)
    arrow_slit(m, -1.16, .30, 1.05)
    arrow_slit(m, -.55, -1.01, .85)
    arrow_slit(m, .55, -1.01, .85)
    arrow_slit(m, 1.16, .45, .85)
    # Map signatures.
    if theme == 'twin_passes':
        _crag_ring(m['trim'], (2.35, 2.0), 12)
        box('gate lintel', (1.10, .16, .18), (0, -.86, 1.78), m['wood'], .02)
    if theme == 'royal_ring':
        box('gate keystone', (.16, .12, .22), (0, -.86, 1.95), m['gold'], .01)
        for cx in (-.55, .55):
            box('parapet cap', (.18, .18, .10), (cx, .12, 2.52), m['gold'], .01)
    if theme == 'quad_citadel':
        _palisade_ring(m, 2.45, 2.10, 22)
        box('gate iron band', (.72, .10, .10), (0, -.84, 1.10), m['iron'], .01)


# ---------------------------------------------------------------------------
# Tier 2 crown keep (framing 4.35 / aim 0.85)
# ---------------------------------------------------------------------------

def keep(m, make_material, theme='crown_cross'):
    contact_disc(make_material, 1.30, .26)
    # Stepped two-course plinth (recessed base course adds footprint weight).
    cyl('plinth base', 1.42, .13, (0, 0, .065), m['dark'], 8)
    cyl('plinth', 1.30, .18, (0, 0, .09), m['dark'], 8)
    cyl('wall', 1.12, 1.30, (0, 0, .83), m['wall'], 8)
    cyl('wall string', 1.18, .07, (0, 0, 1.30), m['trim'], 8)
    cyl('wall parapet', 1.22, .16, (0, 0, 1.51), m['wall'], 8)
    ring_merlons(m, 1.16, 1.68, 8, size=(.18, .34, .24))
    # Timber fighting gallery rings the outer wall: the war silhouette with
    # a baked shadow seam under the gallery floor.
    ring_hoarding(m, 1.12, 1.02, count=8, out=.24, post_h=.34, vertices=8)
    # Inner watch tower with the gilded crown ring.
    cyl('tower', .48, 1.0, (0, 0, 1.70), m['wall'], 8)
    cyl('tower parapet', .56, .12, (0, 0, 2.26), m['trim'], 8)
    window_with_frame(m, 0, -.46, 1.75, w=.14, h=.26)
    cyl('crown band', .53, .09, (0, 0, 2.33), m['gold'], 8)
    for i in range(5):
        a = i * math.tau / 5
        cyl('crown point', .05, .16, (.36 * math.cos(a), .36 * math.sin(a), 2.45), m['gold'], 6)
    cyl('tower roof', .62, .55, (0, 0, 2.55), m['roof'], 8, r2=.02)
    box('eave shade TF', (.48, .05, .08), (0, -.575, 2.35), m['dark'], .006)
    box('eave shade TS', (.05, .48, .08), (.575, 0, 2.35), m['dark'], .006)
    sphere('finial', .05, (0, 0, 2.87), m['gold'])
    # Gate with an iron grille; draped standards on both camera faces.
    arched_gate(m, 0, -1.0, .57, width=.52, height=.80)
    portcullis(m, 0, -1.12, .57, width=.48, height=.70)
    for sx, rot in ((-.42, .10), (.42, -.10)):
        box('wall banner', (.34, .05, .72), (sx, -1.02, 1.05), m['banner'], .012, rot=(0, 0, rot))
        box('banner bar', (.18, .06, .07), (sx, -1.055, 1.28), m['gold'], .008, rot=(0, 0, rot))
    box('side standard', (.05, .34, .60), (1.09, .30, 1.05), m['banner'], .012)
    box('side standard bar', (.05, .16, .06), (1.10, .30, 1.28), m['gold'], .008)
    arrow_slit(m, 1.06, .30, 1.15, rot=(0, math.pi / 2, 0))
    arrow_slit(m, 1.06, -.30, .85, rot=(0, math.pi / 2, 0))
    # Map signatures.
    if theme == 'twin_passes':
        _crag_ring(m['trim'], (1.45, 1.45), 9)
    if theme == 'royal_ring':
        for i in range(5):
            a = i * math.tau / 5
            cyl('crown point tall', .05, .26, (.36 * math.cos(a), .36 * math.sin(a), 2.50), m['gold'], 6)
    if theme == 'quad_citadel':
        _palisade_ring(m, 1.55, 1.55, 16, z=.24, height=.55)


# ---------------------------------------------------------------------------
# Tier 1 outpost watchtower (framing 4.6 / aim 1.30)
# ---------------------------------------------------------------------------

def outpost(m, make_material, theme='crown_cross'):
    contact_disc(make_material, .95, .26)
    # Stepped plinth: recessed base course under the stone step.
    cyl('plinth base', .98, .12, (0, 0, .06), m['dark'], 8)
    cyl('plinth', .85, .16, (0, 0, .08), m['dark'], 8)
    cyl('shaft', .58, 1.90, (0, 0, 1.11), m['wall'], 8)
    cyl('string', .63, .06, (0, 0, 1.20), m['trim'], 8)
    cyl('string low', .63, .06, (0, 0, .70), m['trim'], 8)
    # Timber bretèche gallery on the shaft: war depth against the tower.
    ring_hoarding(m, .58, 1.55, count=6, out=.24, post_h=.30, vertices=8)
    cyl('machicolation', .80, .18, (0, 0, 2.12), m['trim'], 8)
    ring_merlons(m, .66, 2.30, 8, size=(.16, .32, .22))
    cyl('watch room', .42, .32, (0, 0, 2.37), m['wood'], 8)
    cyl('watch roof', .60, .68, (0, 0, 2.87), m['roof'], 8, r2=.02)
    box('eave shade WF', (.44, .05, .08), (0, -.45, 2.58), m['dark'], .006)
    box('eave shade WS', (.05, .44, .08), (.45, 0, 2.58), m['dark'], .006)
    sphere('finial', .045, (0, 0, 3.24), m['gold'])
    # Gate with an iron grille; slits and banners on both camera faces.
    arched_gate(m, 0, -.52, .49, width=.38, height=.66)
    portcullis(m, 0, -.63, .49, width=.34, height=.58)
    arrow_slit(m, 0, -.58, 1.50)
    arrow_slit(m, .585, .30, 1.50, rot=(0, math.pi / 2, 0))
    arrow_slit(m, .585, -.30, 1.00, rot=(0, math.pi / 2, 0))
    cyl('pennant pole', .015, .30, (0, 0, 3.34), m['iron'], 6)
    box('pennant', (.015, .20, .12), (.03, 0, 3.40), m['banner'], .006)
    box('wall banner', (.26, .04, .44), (0, -.60, 1.35), m['banner'], .01)
    box('banner emblem', (.05, .05, .16), (0, -.635, 1.35), m['gold'], .008)
    box('side banner', (.04, .22, .38), (.55, 0, 1.35), m['banner'], .01)
    box('side banner emblem', (.05, .05, .14), (.565, 0, 1.35), m['gold'], .008)
    # Map signatures.
    if theme == 'twin_passes':
        _crag_ring(m['trim'], (1.0, 1.0), 7, rock_r=.22)
    if theme == 'royal_ring':
        cyl('gold collar', .65, .06, (0, 0, 2.10), m['gold'], 8)
    if theme == 'quad_citadel':
        _palisade_ring(m, 1.05, 1.05, 12, z=.26, height=.50)
        for z in (1.0, 1.7):
            cyl('iron band', .60, .05, (0, 0, z), m['iron'], 8)


# ---------------------------------------------------------------------------
# Tier 1 barracks: stone garrison hall (framing 4.25 / aim 0.70)
# ---------------------------------------------------------------------------

def barracks(m, make_material, theme='crown_cross'):
    contact_disc(make_material, 1.35, .25)
    box('foundation', (2.50, 1.85, .16), (0, 0, .08), m['dark'], .03, bevel_segments=3)
    box('body', (2.30, 1.60, 1.25), (0, 0, .785), m['wall'], .03, bevel_segments=3)
    for qx, qy in ((-1.15, -.80), (1.15, -.80), (-1.15, .80), (1.15, .80)):
        for z in (.50, 1.10):
            box('quoin', (.14, .14, .34), (qx, qy, z), m['trim'], .012)
    roof('hall roof', 2.52, 1.90, 1.41, .75, m['roof'])
    eave_shade(m, 2.52, 1.90, 1.41, face_y=-.80, side_x=1.15)
    # Corbie-step gables on both roof ends: the war-garrison silhouette.
    gable_steps(m, .86, 1.26, .75, 1.41, steps=4)
    gable_steps(m, -.86, 1.26, .75, 1.41, steps=4)
    box('ridge cap', (.10, 1.92, .08), (0, 0, 2.19), m['trim'], .01)
    box('chimney', (.26, .26, .55), (.78, .42, 1.95), m['wall'], .015)
    box('chimney cap', (.32, .32, .08), (.78, .42, 2.25), m['trim'], .01)
    arched_gate(m, 0, -.81, .56, width=.50, height=.80)
    portcullis(m, 0, -.92, .56, width=.44, height=.70)
    window_with_frame(m, -.72, -.83, 1.02, w=.15, h=.30)
    window_with_frame(m, .72, -.83, 1.02, w=.15, h=.30)
    # Buttresses on both camera faces and the visible corners.
    for x in (-1.12, 1.12):
        box('buttress', (.16, .14, .85), (x, -.72, .585), m['trim'], .012)
    for y in (-.35, .35):
        box('buttress side', (.14, .16, .85), (1.14, y, .585), m['trim'], .012)
    # Team pennants at the front gable corners.
    pennant_pole(m, -1.02, -.78, 1.52, pole_h=.38)
    pennant_pole(m, 1.02, -.78, 1.52, pole_h=.38)
    box('banner', (.34, .05, .62), (0, -.83, 1.12), m['banner'], .012)
    box('banner cross V', (.06, .06, .30), (0, -.855, 1.12), m['gold'], .008)
    box('banner cross H', (.20, .06, .06), (0, -.855, 1.16), m['gold'], .008)
    heater_shield('garrison shield', (.62, -.82, .62), .40, m['banner'], m['gold'])
    window_with_frame(m, 1.16, .15, .95, w=.13, h=.24, rot=(0, 0, math.pi / 2))
    arrow_slit(m, 1.16, -.55, .95, rot=(0, 0, math.pi / 2))
    # Map signatures.
    if theme == 'twin_passes':
        box('gate lintel', (1.0, .14, .16), (0, -.81, 1.42), m['wood'], .02)
    if theme == 'royal_ring':
        box('gold ridge', (.12, 1.94, .10), (0, 0, 2.24), m['gold'], .01)
    if theme == 'quad_citadel':
        box('canvas awning', (1.0, .40, .05), (0, -1.04, 1.06), m['plaster'], .02)
        box('hay bale', (.5, .34, .34), (1.32, -.55, .17), m['hay'], .02)


# ---------------------------------------------------------------------------
# Tier 1 stable: timber-framed hall with open stalls (framing 4.25 / aim 0.70)
# ---------------------------------------------------------------------------

def stable(m, make_material, theme='crown_cross'):
    contact_disc(make_material, 1.35, .25)
    box('foundation', (2.50, 1.95, .14), (0, 0, .07), m['dark'], .03, bevel_segments=3)
    box('body plaster', (2.28, 1.55, 1.05), (0, 0, .665), m['plaster'], .03, bevel_segments=3)
    # Half-timbered front face.
    for x in (-1.08, -.54, 0, .54, 1.08):
        box('timber post', (.10, .05, 1.05), (x, -.775, .665), m['wood'], .012)
    box('timber beam', (2.28, .05, .08), (0, -.775, 1.15), m['wood'], .012)
    # Half-timbered side face (+X, the camera-visible side).
    for y in (-.42, 0, .42):
        box('timber post side', (.05, .10, 1.05), (1.13, y, .665), m['wood'], .012)
    box('timber beam side', (.05, 1.28, .08), (1.13, 0, 1.15), m['wood'], .012)
    roof('stable roof', 2.48, 1.90, 1.19, .70, m['roof'])
    eave_shade(m, 2.48, 1.90, 1.19, face_y=-.775, side_x=1.13)
    # Corbie-step gables on both roof ends.
    gable_steps(m, .83, 1.24, .70, 1.19, steps=3)
    gable_steps(m, -.83, 1.24, .70, 1.19, steps=3)
    box('ridge cap', (.09, 1.92, .07), (0, 0, 1.94), m['trim'], .01)
    sphere('ridge finial', .04, (0, .98, 1.99), m['gold'])
    sphere('ridge finial', .04, (0, -.98, 1.99), m['gold'])
    arched_gate(m, 0, -.78, .45, width=.40, height=.66)
    for sx in (-.75, .75):
        box('stall recess', (.55, .10, .62), (sx, -.78, .48), m['dark'], .012)
        box('trough', (.40, .14, .16), (sx, -.86, .28), m['wood'], .012)
        box('hay', (.30, .06, .10), (sx, -.86, .37), m['hay'], .01)
    # Jettied hay loft overhangs the stalls on timber posts: the medieval
    # depth read, with its own little pitched roof and a baked shadow seam
    # where the loft meets the wall.
    box('loft', (1.55, .80, .34), (0, -1.0, 1.32), m['plaster'], .02, bevel_segments=2)
    roof('loft roof', 1.62, .84, 1.49, .22, m['roof'], y=-1.0)
    box('loft beam', (1.62, .10, .08), (0, -1.18, 1.17), m['wood'], .012)
    box('loft shade', (1.40, .06, .12), (0, -.79, 1.20), m['dark'], .006)
    for x in (-.60, 0, .60):
        box('loft post', (.09, .09, 1.02), (x, -1.28, .66), m['wood'], .01)
    pennant_pole(m, -.78, -1.32, 1.49, pole_h=.32, flag_w=.20, flag_h=.12)
    pennant_pole(m, .78, -1.32, 1.49, pole_h=.32, flag_w=.20, flag_h=.12)
    window_with_frame(m, 1.15, .10, .82, w=.13, h=.22, rot=(0, 0, math.pi / 2))
    # Map signatures.
    if theme == 'twin_passes':
        box('stone band', (2.34, 1.60, .18), (0, 0, .25), m['trim'], .02)
    if theme == 'royal_ring':
        box('gold canopy trim', (1.96, .52, .07), (0, -1.02, 1.06), m['gold'], .01)
    if theme == 'quad_citadel':
        box('canvas wall', (1.0, .05, .60), (0, -1.02, .75), m['plaster'], .012)


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


# ---------------------------------------------------------------------------
# Rendered ground plates (full-field top-down texture, one per battlefield)
#
# 1 Blender unit = 1 logical canvas px. The plate covers the fixed logical
# field rect (10, 78) .. (390, 718) — 380x640 — so it lines up 1:1 with the
# client's socket and road geometry at every viewport. Road corridors, socket
# positions and the per-map palette are read straight from the authoritative
# apps/server-nakama/battlefields.json, so the bake can never drift from the
# gameplay geometry.
#
# Realism stack: subdivided plate with deterministic micro-relief (dunes the
# sun shades, pressed flat under roads/sockets/manicured zones), noise-ramp
# grass with mower stripes, dirt roads with jittered organic edges, and
# clustered scatter (tufts, tall-grass patches, flower/clover clusters,
# roadside pebbles) rooted at the relief height.
# ---------------------------------------------------------------------------

GROUND_W, GROUND_H = 380.0, 640.0
GROUND_LOGICAL_CENTER = (200.0, 398.0)


def _hex_rgb(value):
    """battlefields.json packed int colour -> linear-ish rgb triple."""
    return ((value >> 16 & 255) / 255.0, (value >> 8 & 255) / 255.0, (value & 255) / 255.0)


def _to_plane(logical_x, logical_y):
    """Logical canvas px -> ground-plane units (image top = +Y)."""
    return (logical_x - GROUND_LOGICAL_CENTER[0], -(logical_y - GROUND_LOGICAL_CENTER[1]))


def _battlefield_data(battlefield_id):
    import json
    import os
    path = os.path.join(os.path.dirname(__file__), '..', '..',
                        'apps', 'server-nakama', 'battlefields.json')
    with open(path) as handle:
        for battlefield in json.load(handle):
            if battlefield['id'] == battlefield_id:
                return battlefield
    raise KeyError(f'unknown battlefield {battlefield_id!r}')


def _territory(bf, territory_id):
    for territory in bf['territories']:
        if territory['id'] == territory_id:
            return territory
    raise KeyError(f'unknown territory {territory_id!r}')


def _distance_to_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    t = 0.0 if length_sq == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_sq))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _noise_material(name, make_material, low, high, scale, roughness=.95, detail=5.0,
                    speckle=13.0, stripes=0.0, stripe_width=38.0):
    """Flat material whose base colour is a multi-octave noise ramp low->high,
    darkened by a fine speckle noise, with optional mower stripes along the
    object X axis (manicured meadows only; amplitude `stripes`)."""
    mat = make_material(name, low, roughness, use_gradient=False)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes['Principled BSDF']

    mottle = nodes.new('ShaderNodeTexNoise')
    mottle.inputs['Scale'].default_value = scale
    mottle.inputs['Detail'].default_value = detail
    mottle.inputs['Roughness'].default_value = .42
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = .38
    ramp.color_ramp.elements[0].color = (*low, 1.0)
    ramp.color_ramp.elements[1].position = .62
    ramp.color_ramp.elements[1].color = (*high, 1.0)
    links.new(mottle.outputs['Fac'], ramp.inputs['Fac'])

    # Fine speckle: a high-frequency noise that only darkens, so the meadow
    # reads mown rather than flat.
    speckle_noise = nodes.new('ShaderNodeTexNoise')
    speckle_noise.inputs['Scale'].default_value = scale * speckle
    speckle_noise.inputs['Detail'].default_value = 3.0
    speckle_noise.inputs['Roughness'].default_value = .5
    speckle_ramp = nodes.new('ShaderNodeValToRGB')
    speckle_ramp.color_ramp.elements[0].position = .3
    speckle_ramp.color_ramp.elements[0].color = (1.0, 1.0, 1.0, 1.0)
    speckle_ramp.color_ramp.elements[1].position = .8
    speckle_ramp.color_ramp.elements[1].color = (.84, .84, .84, 1.0)
    links.new(speckle_noise.outputs['Fac'], speckle_ramp.inputs['Fac'])

    speckle_mix = nodes.new('ShaderNodeMix')
    speckle_mix.data_type = 'RGBA'
    speckle_mix.blend_type = 'MULTIPLY'
    speckle_mix.inputs['Factor'].default_value = .3
    links.new(ramp.outputs['Color'], speckle_mix.inputs['A'])
    links.new(speckle_ramp.outputs['Color'], speckle_mix.inputs['B'])

    if stripes > 0.0:
        # Mower stripes: object-space X through a sine -> soft ramp -> subtle
        # multiply. Amplitude is tiny so it reads as upkeep, not zebra paint.
        coords = nodes.new('ShaderNodeTexCoord')
        separate = nodes.new('ShaderNodeSeparateXYZ')
        # Socket names differ across Blender versions; link by index.
        links.new(coords.outputs['Object'], separate.inputs[0])
        stripe_scale = nodes.new('ShaderNodeMath')
        stripe_scale.operation = 'MULTIPLY'
        stripe_scale.inputs[1].default_value = math.pi / stripe_width
        links.new(separate.outputs['X'], stripe_scale.inputs[0])
        stripe_sine = nodes.new('ShaderNodeMath')
        stripe_sine.operation = 'SINE'
        links.new(stripe_scale.outputs['Value'], stripe_sine.inputs[0])
        stripe_ramp = nodes.new('ShaderNodeValToRGB')
        stripe_ramp.color_ramp.elements[0].position = .44
        stripe_ramp.color_ramp.elements[0].color = (1.0 - stripes, 1.0 - stripes, 1.0 - stripes, 1.0)
        stripe_ramp.color_ramp.elements[1].position = .56
        stripe_ramp.color_ramp.elements[1].color = (1.0 + stripes, 1.0 + stripes, 1.0 + stripes, 1.0)
        links.new(stripe_sine.outputs['Value'], stripe_ramp.inputs['Fac'])
        stripe_mix = nodes.new('ShaderNodeMix')
        stripe_mix.data_type = 'RGBA'
        stripe_mix.blend_type = 'MULTIPLY'
        stripe_mix.inputs['Factor'].default_value = 1.0
        links.new(speckle_mix.outputs['Result'], stripe_mix.inputs['A'])
        links.new(stripe_ramp.outputs['Color'], stripe_mix.inputs['B'])
        links.new(stripe_mix.outputs['Result'], bsdf.inputs['Base Color'])
    else:
        links.new(speckle_mix.outputs['Result'], bsdf.inputs['Base Color'])
    return mat


def _flat_alpha(name, make_material, color, alpha, roughness=.95):
    """Flat colour material with baked transparency (BLEND + Alpha input)."""
    mat = make_material(name, color, roughness, use_gradient=False)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Alpha'].default_value = alpha
    mat.blend_method = 'BLEND'
    return mat


def _identity_flats(battlefield_id):
    """Per-map flat-terrain zones: the micro-relief is pressed flat under the
    built and manicured places (courts, brook, camps) so their plates and the
    gameplay geometry always sit on solid ground."""
    if battlefield_id == 'crown_cross':
        return [('circle', 0.0, 38.0, 178.0)]
    if battlefield_id == 'twin_passes':
        return [('strip', 46.0)]
    if battlefield_id == 'royal_ring':
        return [('circle', 0.0, 38.0, 100.0)]
    if battlefield_id == 'quad_citadel':
        return [
            ('ellipse', -88.0, 174.0, 92.0, 103.0),
            ('ellipse', 88.0, 174.0, 92.0, 103.0),
            ('ellipse', -88.0, -102.0, 92.0, 103.0),
            ('ellipse', 88.0, -102.0, 92.0, 103.0),
            ('rect', 0.0, 38.0, 50.0, 252.0),
        ]
    return []


def _zone_factor(zone, x, y):
    """0 inside a flat zone, easing to 1 over ~20 units outside."""
    kind = zone[0]
    if kind == 'circle':
        d = math.hypot(x - zone[1], y - zone[2]) - zone[3]
        return max(0.0, min(1.0, (d - 4.0) / 20.0))
    if kind == 'strip':
        return max(0.0, min(1.0, (abs(x) - zone[1] - 4.0) / 20.0))
    if kind == 'ellipse':
        d = math.hypot((x - zone[1]) / zone[3], (y - zone[2]) / zone[4])
        return max(0.0, min(1.0, (d - 1.06) * 12.0))
    if kind == 'rect':
        d = max(abs(x - zone[1]) - zone[3], abs(y - zone[2]) - zone[4])
        return max(0.0, min(1.0, (d - 4.0) / 20.0))
    return 1.0


def _make_terrain(bf, battlefield_id):
    """Deterministic micro-relief z(x, y) in plate units."""
    roads = []
    for id_a, id_b in bf['roads']:
        a = _territory(bf, id_a)
        b = _territory(bf, id_b)
        roads.append((_to_plane(a['x'], a['y']), _to_plane(b['x'], b['y'])))
    territories = [(_to_plane(t['x'], t['y']), t['radius']) for t in bf['territories']]
    flats = _identity_flats(battlefield_id)

    def undulation(x, y):
        # Three trig octaves with irrational ratios: gentle dunes.
        return (
            0.55 * math.sin(x * .045 + .7) * math.cos(y * .037)
            + 0.38 * math.sin(x * .104 + 2.1) * math.cos(y * .089 + 1.3)
            + 0.22 * math.sin((x + y) * .151 + .4)
        )

    def factor(x, y):
        # Relief dissolves at the plate border, under road corridors,
        # under every socket's platform, and in each map's flat zones.
        result = min(
            1.0,
            max(0.0, (186.0 - abs(x)) / 14.0),
            max(0.0, (320.0 - y) / 14.0),
            max(0.0, (y + 302.0) / 14.0),
        )
        for (ax, ay), (bx, by) in roads:
            result = min(result, max(0.0, (_distance_to_segment(x, y, ax, ay, bx, by) - 13.0) / 24.0))
        for (tx, ty), radius in territories:
            result = min(result, max(0.0, (math.hypot(x - tx, y - ty) - radius - 6.0) / 18.0))
        for zone in flats:
            result = min(result, _zone_factor(zone, x, y))
        return result

    def terrain_z(x, y):
        return undulation(x, y) * factor(x, y)

    return terrain_z, roads


def _rounded_plate(mat, terrain_z):
    """380x616 subdivided plate: 18px rounded corners, real micro-relief."""
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=76, y_subdivisions=124, size=1,
                                    location=(0.0, 12.0, 0.0))
    ob = bpy.context.object
    ob.name = 'ground plate'
    ob.scale = (GROUND_W, GROUND_H - 24.0, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for vertex in ob.data.vertices:
        vertex.co.z = terrain_z(vertex.co.x, vertex.co.y)
    ob.data.update()
    for poly in ob.data.polygons:
        poly.use_smooth = True
    corners = ob.modifiers.new('rounded corners', 'BEVEL')
    corners.width = 18.0
    corners.segments = 6
    try:
        corners.affect = 'VERTICES'          # Blender 4.1+
    except AttributeError:
        corners.vertex_only = True           # Blender 3.x
    ob.data.materials.append(mat)
    return ob


def _road_strip(name, length, width, z, angle, cx, cy, mat, edge_jitter, rng):
    """Flat dirt strip with sine-jittered side edges: organic, not ruler-cut.

    Built at the origin (edge jitter in local space), then rotated to the road
    angle and moved onto the road line."""
    x_steps = max(8, int(length / 7.0))
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=x_steps, y_subdivisions=3, size=1,
                                    location=(0.0, 0.0, 0.0))
    ob = bpy.context.object
    ob.name = name
    ob.scale = (length, width, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    half = width / 2.0
    for vertex in ob.data.vertices:
        if abs(vertex.co.y) > half - .35:
            vertex.co.y += math.sin(vertex.co.x * .22 + rng.random() * .5) * edge_jitter
    ob.data.update()
    ob.rotation_euler = (0.0, 0.0, angle)
    ob.location = (cx, cy, z)
    ob.data.materials.append(mat)
    return ob


def _ground_roads(bf, mats, make_material):
    """Baked dirt roads along every authoritative road segment."""
    rng = random.Random(90210)
    dry = _flat_alpha('rgx_dry', make_material, (.42, .40, .23), .22)
    for id_a, id_b in bf['roads']:
        a = _territory(bf, id_a)
        b = _territory(bf, id_b)
        ax, ay = _to_plane(a['x'], a['y'])
        bx, by = _to_plane(b['x'], b['y'])
        length = math.hypot(bx - ax, by - ay) + 10.0
        angle = math.atan2(by - ay, bx - ax)
        cx, cy = (ax + bx) / 2.0, (ay + by) / 2.0
        _road_strip('dry grass band', length + 16.0, 42.0, .035, angle, cx, cy, dry, 3.2, rng)
        _road_strip('road shoulder', length + 8.0, 30.0, .05, angle, cx, cy, mats['shoulder'], 2.4, rng)
        _road_strip('road bed', length, 19.0, .07, angle, cx, cy, mats['road'], 1.5, rng)
        for side in (-1.0, 1.0):
            off = side * 5.2
            box('road rut', (length, 1.5, .02),
                (cx - math.sin(angle) * off, cy + math.cos(angle) * off, .085),
                mats['rut'], .02, rot=(0, 0, angle))


def _ground_sockets(bf, ao_mat, plinth_top_z=0.04, diorama=False):
    """Soft contact darkening under every territory platform.

    Diorama boards pass the plinth top height so the shade grounds each
    building on its raised platform instead of floating at meadow level;
    the disc stays inside the plinth rim so nothing floats over the edge."""
    for territory in bf['territories']:
        x, y = _to_plane(territory['x'], territory['y'])
        radius = (_socket_radius(territory) - 4.0) if diorama else (territory['radius'] + 6.0)
        cyl('socket shade', radius, .02, (x, y, plinth_top_z), ao_mat, 32)


def _ground_identity(battlefield_id, make_material, terrain_z):
    """Per-map meadow character, replacing the flat vector terrain layers."""
    if battlefield_id == 'crown_cross':
        court = _to_plane(200.0, 360.0)
        light = (.24, .47, .31)
        cyl('worn court', 68.0, .02, (court[0], court[1], .012),
            _flat_alpha('rgx_court', make_material, light, .30), 48)
        for radius in (130.0, 165.0):
            bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=.8,
                                             location=(court[0], court[1], .012))
            ring = bpy.context.object
            ring.name = 'mow ring'
            ring.data.materials.append(
                _flat_alpha(f'rgx_mow_{int(radius)}', make_material, light, .12))
    elif battlefield_id == 'twin_passes':
        water = _noise_material('rgx_water', make_material, (.10, .38, .44), (.17, .54, .60),
                                .05, roughness=.18, detail=2.0)
        box('brook', (44.0, 460.0, .03), (0.0, 22.0, .02), water, .5)
        bank = _flat_alpha('rgx_bank', make_material, (.09, .17, .10), .28)
        for side in (-1.0, 1.0):
            box('brook bank', (58.0, 500.0, .02), (side * 46.0, 22.0, .012), bank, .5)
        crag = _flat_alpha('rgx_crag', make_material, (.11, .19, .13), .32)
        for pos in ((-122.0, 286.0), (122.0, 286.0), (-122.0, -148.0), (122.0, -148.0)):
            z = terrain_z(pos[0], pos[1])
            blob = ico('crag shelf', 24.0, (pos[0], pos[1], z + 1.5), crag, scale=(1.5, 1.1, .14))
            _jitter(blob, random.Random(int(abs(pos[0] * pos[1]))))
    elif battlefield_id == 'royal_ring':
        court = _to_plane(200.0, 360.0)
        cyl('gravel court', 93.0, .02, (court[0], court[1], .012),
            _flat_alpha('rgx_gravel', make_material, (.55, .47, .33), .28), 48)
        hedge = make_material('rgx_hedge', (.11, .20, .09), .85, use_gradient=False)
        bpy.ops.mesh.primitive_torus_add(major_radius=68.0, minor_radius=4.0,
                                         location=(court[0], court[1], .05))
        ring = bpy.context.object
        ring.name = 'hedge ring'
        ring.data.materials.append(hedge)
        bed = _flat_alpha('rgx_bed', make_material, (.62, .43, .33), .45)
        for pos in ((-126.0, 206.0), (126.0, -154.0)):
            z = terrain_z(pos[0], pos[1])
            ico('garden bed', 30.0, (pos[0], pos[1], z + 2.0), bed, scale=(1.1, 1.6, .12))
    elif battlefield_id == 'quad_citadel':
        dirt = (.38, .31, .20)
        camp = _flat_alpha('rgx_camp', make_material, dirt, .45)
        for pos in ((-88.0, 174.0, .012), (88.0, 174.0, .012), (-88.0, -102.0, .012), (88.0, -102.0, .012)):
            box('camp ground', (166.0, 188.0, .02), pos, camp, 26.0, bevel_segments=6)
        box('crossroad strip', (86.0, 506.0, .02), (0.0, 38.0, .014),
            _flat_alpha('rgx_cross', make_material, dirt, .38), 16.0, bevel_segments=6)
        wedge = _flat_alpha('rgx_wedge', make_material, (.50, .39, .31), .40)
        for pos in ((-152.0, 38.0), (152.0, 38.0)):
            z = terrain_z(pos[0], pos[1])
            ico('dirt wedge', 26.0, (pos[0], pos[1], z + 1.6), wedge, scale=(1.2, .7, .12))


def _ground_scatter(battlefield_id, bf, mats, terrain_z, roads):
    """Deterministic meadow dressing: clustered and rooted in the relief."""
    rng = random.Random(104729)
    for ch in battlefield_id:
        rng.seed(rng.random() * 1048576.0 + ord(ch))

    def blocked(x, y):
        if abs(x) > 170.0 or abs(y) > 292.0:
            return True
        for territory in bf['territories']:
            tx, ty = _to_plane(territory['x'], territory['y'])
            if math.hypot(x - tx, y - ty) < territory['radius'] + 16.0:
                return True
        for (ax, ay), (bx, by) in roads:
            if _distance_to_segment(x, y, ax, ay, bx, by) < 20.0:
                return True
        if battlefield_id == 'crown_cross':
            return math.hypot(x, y - 38.0) < 40.0
        if battlefield_id == 'twin_passes':
            return abs(x) < 34.0
        if battlefield_id == 'royal_ring':
            return math.hypot(x, y - 38.0) < 108.0
        if battlefield_id == 'quad_citadel':
            if abs(x) < 48.0 and abs(y - 38.0) < 250.0:
                return True
            return any(abs(x - cx) < 92.0 and abs(y - cy) < 103.0
                       for cx, cy in ((-88.0, 174.0), (88.0, 174.0), (-88.0, -102.0), (88.0, -102.0)))
        return False

    def spot(edge_only=False):
        for _ in range(90):
            x = (rng.random() * 2.0 - 1.0) * 170.0
            y = (rng.random() * 2.0 - 1.0) * 292.0
            if blocked(x, y):
                continue
            if edge_only and abs(x) < 90.0 and abs(y) < 150.0:
                continue
            return x, y
        return None

    placed = []

    def reserve(x, y):
        for px, py in placed:
            if math.hypot(x - px, y - py) < 13.0:
                return False
        placed.append((x, y))
        return True

    def tuft(x, y, tall=False):
        z0 = terrain_z(x, y)
        blades = (12 if tall else 4) + int(rng.random() * (7 if tall else 3))
        for i in range(blades):
            a = rng.random() * math.tau
            r = 1.0 + rng.random() * (7.5 if tall else 1.6)
            depth = (7.5 + rng.random() * 5.0) if tall else (5.5 + rng.random() * 4.5)
            blade_x = x + r * math.cos(a)
            blade_y = y + r * math.sin(a)
            mat = (mats['leaf_tall'] if tall else mats['leaf']) if i % 2 else mats['leaf_dark']
            cyl('ground blade', .55, depth,
                (blade_x, blade_y, terrain_z(blade_x, blade_y) + depth / 2.0 - .6),
                mat, 5, r2=.08,
                rot=(rng.random() * .35, rng.random() * .35, a))

    def flower_cluster(x, y):
        count = 3 + int(rng.random() * 4)
        for _ in range(count):
            a = rng.random() * math.tau
            r = 1.2 + rng.random() * 2.4
            fx, fy = x + r * math.cos(a), y + r * math.sin(a)
            white = rng.random() < .55
            ico('meadow flower', .9, (fx, fy, terrain_z(fx, fy) + .8),
                mats['flower_light'] if white else mats['flower_dark'], scale=(1.0, 1.0, .5))

    def clover_patch(x, y):
        ico('clover patch', 5.0 + rng.random() * 4.0, (x, y, terrain_z(x, y) + .05),
            mats['clover'], scale=(1.1, 1.15, .16))

    def pebble(x, y):
        ico('ground pebble', 1.4 + rng.random() * 1.2, (x, y, terrain_z(x, y) + 1.2),
            mats['stone'], scale=(1.3, 1.0, .45))

    for kind, count in (('tuft', 46), ('patch', 7), ('flower', 10), ('clover', 9), ('pebble', 18)):
        made = misses = 0
        while made < count and misses < 500:
            misses += 1
            position = spot(edge_only=(kind == 'patch'))
            if position is None:
                continue
            x, y = position
            if not reserve(x, y):
                continue
            misses = 0
            made += 1
            if kind == 'tuft':
                tuft(x, y)
            elif kind == 'patch':
                tuft(x, y, tall=True)
            elif kind == 'flower':
                flower_cluster(x, y)
            elif kind == 'clover':
                clover_patch(x, y)
            else:
                pebble(x, y)

    # Roadside pebbles: worn stone collecting along the dirt road edges.
    for (ax, ay), (bx, by) in roads:
        length = math.hypot(bx - ax, by - ay)
        angle = math.atan2(by - ay, bx - ax)
        steps = max(2, int(length / 26.0))
        for step in range(1, steps):
            t = step / steps
            if rng.random() < .45:
                continue
            for side in (-1.0, 1.0):
                if rng.random() < .45:
                    continue
                off = side * (12.0 + rng.random() * 9.0)
                x = ax + (bx - ax) * t - math.sin(angle) * off
                y = ay + (by - ay) * t + math.cos(angle) * off
                if abs(x) < 170.0 and abs(y) < 292.0:
                    ico('roadside pebble', .9 + rng.random() * .9, (x, y, terrain_z(x, y) + .5),
                        mats['stone'], scale=(1.2, .95, .55))


def _ground_bottom_fade(field, make_material):
    """Feather the bottom edge into the client's flat fill colour.

    The plate proper stops 24px above the field-rect bottom; these strips
    cover that last band with stepwise decreasing alpha so the client's flat
    fill shows through and the meadow dissolves instead of ending in a seam.
    Width stays clear of the plate's rounded bottom corners."""
    for i, alpha in enumerate((.80, .60, .45, .32, .22, .14, .08, .03)):
        y = -294.0 - i * 3.2
        box('bottom fade', (320.0, 3.6, .01), (0.0, y, .05),
            _flat_alpha(f'rgx_fade_{i}', make_material, field, alpha), 0)


# The rig's key/fill/rim suns plus the AgX view transform brighten a flat
# top-down plane unevenly per channel (red lifts the most), so the noise
# ramp's source colours are pre-compensated to land on the Art Bible field
# palette after rendering.
_GROUND_CHANNEL_GAINS = (0.25, 0.45, 0.33)

# Mower-stripe amplitude per battlefield: manicured lawns read mown, wild
# highlands and war camps barely at all.
_GROUND_STRIPE_AMPLITUDE = {
    'crown_cross': .05,
    'twin_passes': .02,
    'royal_ring': .06,
    'quad_citadel': .03,
}


# ---------------------------------------------------------------------------
# Diorama (true 2.5D) ground plates
#
# The battlefields listed here render through the same straight-on dimetric
# rig as the sprites (see GROUND_DIORAMA_BATTLEFIELDS in
# build_battlefield_scene.py): the meadow becomes an extruded slab with a
# visible earth skirt, and every territory socket gains a raised stone
# plinth, so the playfield itself carries depth. Must stay in lockstep with
# the client board projection (apps/game/src/art/boardProjection.ts):
#  - plinth radius mirrors the client's territoryArtFootprint socketRadius;
#  - the client anchors buildings at the plinth TOP (see PLINTH_TOP_LIFT).
# ---------------------------------------------------------------------------

DIORAMA_GROUND_BATTLEFIELDS = {'crown_cross'}
# Raised platform height under every territory (plane units == logical px).
DIORAMA_PLINTH_HEIGHT = 6.0
# The plinth sinks 0.5 units into the meadow so no gap shows at its foot;
# its TOP therefore sits at (HEIGHT - 0.5) above the plate.
DIORAMA_PLINTH_SINK = 0.5
# The lip rim course PROTRUDES this far above the plinth top. It must never
# end flush with the plinth top: coincident faces block their own shadow
# rays in Cycles and the whole platform top renders unlit black.
DIORAMA_PLINTH_LIP_RISE = 0.7
# Extruded board depth below the meadow (the visible diorama skirt).
DIORAMA_SLAB_DEPTH = 25.5
DIORAMA_SLAB_TOP_DROP = 1.5


def _is_diorama_ground(battlefield_id):
    return battlefield_id in DIORAMA_GROUND_BATTLEFIELDS


def _socket_radius(territory):
    """Platform radius mirrored from the client's territoryArtFootprint."""
    top_citadel = (
        territory.get('type') == 'fortress'
        and territory.get('tier') == 3
        and territory.get('y', 999) <= 150
    )
    if top_citadel:
        return 35.0
    return territory['radius'] + 10.0


def _diorama_slab(make_material):
    """Two-course extruded earth skirt under the meadow plate.

    The upper course is a worn stone lip just under the grass edge; the
    lower mass is the visible diorama skirt the camera sees at the board's
    bottom edge. Both sit below the plate (no z-fighting with the relief,
    which dissolves to z=0 at the plate border)."""
    base = make_material('rgx_slab_mass', (.14, .11, .085), 1.0, use_gradient=False)
    course = make_material('rgx_slab_course', (.185, .15, .11), 1.0, use_gradient=False)
    top_z = -DIORAMA_SLAB_TOP_DROP
    # Upper stone course: slightly inset so the grass overhangs it.
    box('slab upper course', (374.0, 610.0, 7.0), (0.0, 12.0, top_z - 3.5), course, .04)
    # Lower earth mass: the visible skirt.
    box('slab mass', (366.0, 602.0, DIORAMA_SLAB_DEPTH), (0.0, 12.0, top_z - 7.0 - DIORAMA_SLAB_DEPTH / 2.0), base, .03)


def _diorama_plinth_top_z():
    """The highest platform surface: the proud lip rim's top.

    Both the client's building anchor (boardProjection PLINTH_TOP_LIFT) and
    the socket shade disc track the LIP, not the plinth body, so the sprites
    and the shade land on the surface the camera actually sees."""
    return DIORAMA_PLINTH_HEIGHT - DIORAMA_PLINTH_SINK + DIORAMA_PLINTH_LIP_RISE


def _diorama_plinths(bf, make_material):
    """Raised stone platform under every territory socket.

    The client anchors each building sprite at the plinth TOP's projected
    point (boardProjection PLINTH_TOP_LIFT) and traces its ownership ring
    exactly on the plinth rim, so the plinth radius must mirror the client
    socket radius 1:1."""
    socket_rgb = _hex_rgb(bf['visual']['socket'])
    # Lift the very dark client socket colour so the rig's sun reads the
    # stone volume without crushing the plinth to black.
    stone = tuple(min(c * 2.4 + .02, 1.0) for c in socket_rgb)
    rim = tuple(min(c * 3.2 + .05, 1.0) for c in socket_rgb)
    mat = make_material('rgx_plinth', stone, .92, use_gradient=False)
    rim_mat = make_material('rgx_plinth_rim', rim, .8, use_gradient=False)
    for territory in bf['territories']:
        x, y = _to_plane(territory['x'], territory['y'])
        r = _socket_radius(territory)
        # Base sinks DIORAMA_PLINTH_SINK into the meadow so no gap shows.
        cyl('socket plinth', r, DIORAMA_PLINTH_HEIGHT, (x, y, DIORAMA_PLINTH_HEIGHT / 2.0 - DIORAMA_PLINTH_SINK), mat, 40)
        # Thin lighter rim course standing PROUD of the plinth top: reads as
        # a worn raised lip without competing with the client's ownership
        # ring traced on the same rim. Never flush with the plinth top:
        # coincident faces block their own shadow rays in Cycles and the
        # whole platform top renders unlit black.
        cyl('socket plinth lip', r - 3.0, 2.2, (x, y, _diorama_plinth_top_z() - 1.1), rim_mat, 40)


def ground_plate(battlefield_id, make_material):
    """Full-field rendered ground plate for one battlefield."""
    bf = _battlefield_data(battlefield_id)
    field = _hex_rgb(bf['visual']['field'])
    road = _hex_rgb(bf['visual']['road'])
    terrain_z, roads = _make_terrain(bf, battlefield_id)
    diorama = _is_diorama_ground(battlefield_id)

    compensated = tuple(c * g for c, g in zip(field, _GROUND_CHANNEL_GAINS))
    low = tuple(max(c * .72, 0.0) for c in compensated)
    high = tuple(min(c * 1.30, 1.0) for c in compensated)
    grass = _noise_material('rgx_grass', make_material, low, high, .017,
                            stripes=_GROUND_STRIPE_AMPLITUDE.get(battlefield_id, .03))
    plate = _rounded_plate(grass, terrain_z)

    mats = {
        'road': _noise_material('rgx_road', make_material,
                                tuple(c * .80 for c in road),
                                tuple(min(c * 1.25, 1.0) for c in road), .05, roughness=.9),
        'shoulder': _flat_alpha('rgx_shoulder', make_material,
                                tuple(c * .55 for c in road), .35),
        'rut': _flat_alpha('rgx_rut', make_material, (.06, .05, .04), .30),
        'ao': _flat_alpha('rgx_ao', make_material, (.02, .05, .03), .16),
        'leaf': make_material('rgx_leaf', (.13, .24, .10), .85, use_gradient=False),
        'leaf_dark': make_material('rgx_leafd', (.08, .15, .06), .85, use_gradient=False),
        'leaf_tall': make_material('rgx_leaft', (.09, .17, .07), .85, use_gradient=False),
        'clover': _flat_alpha('rgx_clover', make_material, (.07, .14, .05), .16),
        'stone': make_material('rgx_stone', (.36, .35, .31), .9, use_gradient=False),
        'flower_light': make_material('rgx_flowerl', (.92, .90, .80), .8, use_gradient=False),
        'flower_dark': make_material('rgx_flowerd', (.95, .82, .35), .8, use_gradient=False),
    }
    if diorama:
        # Extruded slab skirt + raised stone plinths: the playfield itself
        # carries depth through the dimetric rig.
        _diorama_slab(make_material)
        _diorama_plinths(bf, make_material)
    _ground_identity(battlefield_id, make_material, terrain_z)
    _ground_roads(bf, mats, make_material)
    _ground_sockets(
        bf,
        mats['ao'],
        # Diorama: the shade sits just clear of the plinth lip's top face
        # (no z-fight) and grounds each building on its raised platform.
        plinth_top_z=(_diorama_plinth_top_z() + 0.03) if diorama else 0.04,
        diorama=diorama,
    )
    _ground_scatter(battlefield_id, bf, mats, terrain_z, roads)
    if not diorama:
        _ground_bottom_fade(field, make_material)
    return plate
