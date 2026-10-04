"""Crown Cross stylized miniature model kit (Blender).

Chunky medieval silhouettes with broad bevels, readable heraldry, layered team
roofs, warm stone and sculpted foliage. The troop model retains its established
materials and geometry. Consumed by
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


def cyl(name, r, depth, loc, mat, vertices=16, rot=None, r2=None, smooth=False, batch=None):
    if batch is not None:
        # Thousands of sub-pixel ground blades share one mesh. Avoid one bpy
        # operator, bevel and dependency-graph update for every tiny cone.
        start = len(batch['vertices'])
        rx, ry, rz = rot or (0.0, 0.0, 0.0)
        sx, cx = math.sin(rx), math.cos(rx)
        sy, cy = math.sin(ry), math.cos(ry)
        sz, cz = math.sin(rz), math.cos(rz)
        for radius, z in ((r, -depth / 2), (r if r2 is None else r2, depth / 2)):
            for i in range(vertices):
                a = i * math.tau / vertices
                x, y = radius * math.cos(a), radius * math.sin(a)
                y, zz = y * cx - z * sx, y * sx + z * cx
                x, zz = x * cy + zz * sy, -x * sy + zz * cy
                x, y = x * cz - y * sz, x * sz + y * cz
                batch['vertices'].append((x + loc[0], y + loc[1], zz + loc[2]))
        faces = [tuple(start + i for i in reversed(range(vertices))),
                 tuple(start + vertices + i for i in range(vertices))]
        faces.extend((start + i, start + (i + 1) % vertices,
                      start + vertices + (i + 1) % vertices, start + vertices + i)
                     for i in range(vertices))
        if mat not in batch['materials']:
            batch['materials'].append(mat)
        material_index = batch['materials'].index(mat)
        batch['faces'].extend(faces)
        batch['material_indices'].extend([material_index] * len(faces))
        return None
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
    """Feathered contact shadow, kept inside the existing sprite footprint."""
    bpy.ops.mesh.primitive_circle_add(vertices=64, radius=radius, fill_type='NGON',
                                      location=(0, 0, .008))
    ob = bpy.context.object
    ob.name = name
    mat = make_material('ccx_shadow', (0.0, 0.0, 0.0), 1.0, use_gradient=False)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    coordinates = nodes.new('ShaderNodeTexCoord')
    distance = nodes.new('ShaderNodeVectorMath')
    distance.operation = 'LENGTH'
    links.new(coordinates.outputs['Object'], distance.inputs[0])
    falloff = nodes.new('ShaderNodeMapRange')
    falloff.interpolation_type = 'SMOOTHERSTEP'
    falloff.clamp = True
    falloff.inputs['From Min'].default_value = radius * .20
    falloff.inputs['From Max'].default_value = radius
    falloff.inputs['To Min'].default_value = alpha
    falloff.inputs['To Max'].default_value = 0.0
    links.new(distance.outputs['Value'], falloff.inputs['Value'])
    links.new(falloff.outputs['Result'], bsdf.inputs['Alpha'])
    mat.blend_method = 'BLEND'
    ob.data.materials.append(mat)
    return ob


# ---------------------------------------------------------------------------
# Material sets (all use the rig's vertical gradient for depth shading)
# ---------------------------------------------------------------------------

# Per-map building themes: the same stylized architecture family built
# from each battlefield's local materials, so every map's fortresses read as
# belonging to their own meadow. Values: (rgb, roughness).
_BUILDING_THEMES = {
    # Crown Cross: slate stone, pale trim, classic royal slate.
    'crown_cross': {
        'wall': ((.48, .55, .59), .76), 'trim': ((.73, .76, .72), .65),
        'dark': ((.14, .22, .26), .86), 'wood': ((.32, .19, .08), .68),
        'plaster': ((.70, .59, .39), .76), 'hay': ((.80, .56, .13), .80),
        'iron': ((.20, .27, .31), .43), 'gold': ((.92, .58, .08), .30),
    },
    # Twin Passes: rough highland granite, pale schist, heavy oak.
    'twin_passes': {
        'wall': ((.42, .49, .47), .82), 'trim': ((.69, .71, .59), .72),
        'dark': ((.13, .20, .18), .90), 'wood': ((.41, .25, .10), .72),
        'plaster': ((.67, .58, .40), .80), 'hay': ((.74, .55, .13), .84),
        'iron': ((.18, .24, .25), .48), 'gold': ((.85, .54, .10), .35),
    },
    # Royal Ring: cream limestone, pale marble, rich gold, polished iron.
    'royal_ring': {
        'wall': ((.72, .62, .43), .68), 'trim': ((.95, .86, .65), .54),
        'dark': ((.26, .23, .18), .78), 'wood': ((.45, .29, .12), .65),
        'plaster': ((.82, .72, .49), .68), 'hay': ((.82, .62, .18), .80),
        'iron': ((.23, .28, .31), .35), 'gold': ((1.0, .68, .10), .25),
    },
    # Quad Citadel: dark war-camp timber, aged wood, canvas, matte iron.
    'quad_citadel': {
        'wall': ((.50, .29, .12), .80), 'trim': ((.75, .52, .24), .70),
        'dark': ((.20, .13, .07), .88), 'wood': ((.37, .20, .08), .75),
        'plaster': ((.76, .65, .44), .80), 'hay': ((.86, .58, .14), .82),
        'iron': ((.18, .22, .23), .55), 'gold': ((.86, .53, .08), .35),
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
        metallic = .60 if key == 'iron' else .55 if key == 'gold' else 0.0
        mats[key] = make_material(f'rtb_{short}_{key}', color, roughness, metallic=metallic)
    building_team = tuple(min(channel * 1.30 + .025, 1.0) for channel in team)
    mats['roof'] = make_material(f'rtb_{short}_roof', building_team, .48)
    mats['roof_light'] = make_material(f'rtb_{short}_roof_light',
                                      tuple(min(channel * 1.20 + .035, 1.0) for channel in building_team), .50)
    mats['banner'] = make_material(f'rtb_{short}_banner', building_team, .76)
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
        'birch_bark': make_material('rtx_bark', (.81, .77, .61), .8),
        'bark_band': make_material('rtx_band', (.16, .15, .13), .85),
        'apple_bark': make_material('rtx_abark', (.35, .19, .07), .8),
        'leaf_dark': make_material('rtx_leafd', (.12, .28, .07), .85),
        'leaf': make_material('rtx_leaf', (.29, .48, .09), .85),
        'leaf_light': make_material('rtx_leafl', (.47, .65, .16), .82),
        'apple': make_material('rtx_apple', (.85, .16, .035), .45),
        'stone': make_material('rtx_stone', (.45, .53, .54), .88),
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

def _chunky_box(name, size, loc, mat, rot=None):
    """Broad bevels on building forms only; troop primitive defaults stay fixed."""
    return box(name, size, loc, mat, min(.09, min(size) * .24),
               rot=rot, bevel_segments=3)


def _chunky_cyl(name, radius, depth, loc, mat, vertices=16, r2=None):
    ob = cyl(name, radius, depth, loc, mat, vertices, r2=r2, smooth=True)
    bevel = ob.modifiers.get('edge light')
    bevel.width = min(.075, depth * .22, radius * .18)
    bevel.segments = 3
    return ob


def _roof_layers(m, name, width, length, z, rise, x=0, y=0):
    """Thick overhanging roof with two large stepped courses, legible at 64px."""
    _chunky_box(name + ' shadow lip', (width * .94, length * .94, .13),
                (x, y, z - .05), m['dark'])
    lower = roof(name + ' lower course', width, length, z, rise, m['roof'], x=x, y=y)
    lower.modifiers['roof edges'].width = .065
    lower.modifiers['roof edges'].segments = 3
    upper = roof(name + ' upper course', width * .70, length * .96,
                 z + rise * .33, rise * .70, m['roof_light'], x=x, y=y)
    upper.modifiers['roof edges'].width = .055
    upper.modifiers['roof edges'].segments = 3
    _chunky_box(name + ' ridge', (.15, length * 1.01, .13),
                (x, y, z + rise + .025), m['roof_light'])


def _toy_gate(m, x, y, bottom, width=.68, height=.88):
    """One bold arched opening and chunky stone surround."""
    _chunky_box('gate shadow', (width, .12, height),
                (x, y, bottom + height / 2), m['dark'])
    _chunky_box('gate oak door', (width * .76, .09, height * .72),
                (x, y - .075, bottom + height * .38), m['wood'])
    for sx in (-1, 1):
        _chunky_box('gate jamb', (.18, .18, height * .75),
                    (x + sx * (width / 2 + .055), y - .045, bottom + height * .40),
                    m['trim'])
    arc_r = width / 2 + .075
    for i in range(5):
        angle = math.pi * (i + .5) / 5
        _chunky_box('arch block', (.22, .20, .18),
                    (x + arc_r * math.cos(angle), y - .07,
                     bottom + height * .73 + arc_r * math.sin(angle)),
                    m['trim'], rot=(0, -angle, 0))
    _chunky_box('gate iron strap', (width * .72, .065, .08),
                (x, y - .14, bottom + height * .48), m['iron'])
    sphere('gate latch', .055, (x + width * .18, y - .18, bottom + height * .43),
           m['gold'], scale=(1, .55, 1))


def _toy_banner(m, x, y, z, width=.38, height=.63):
    _chunky_box('heraldic banner', (width, .08, height), (x, y, z), m['banner'])
    _chunky_box('banner cross vertical', (width * .18, .065, height * .44),
                (x, y - .07, z + height * .07), m['gold'])
    _chunky_box('banner cross horizontal', (width * .58, .065, height * .14),
                (x, y - .075, z + height * .12), m['gold'])
    _chunky_box('banner rail', (width * 1.20, .13, .10),
                (x, y, z + height / 2 + .02), m['trim'])


def _toy_window(m, x, y, z, width=.20, height=.33):
    _chunky_box('window surround', (width + .12, .09, height + .12),
                (x, y, z), m['trim'])
    _chunky_box('window deep opening', (width, .10, height),
                (x, y - .05, z), m['dark'])


def _theme_signature(m, theme, radius, z=.18):
    """Local material signatures fit within the established building crop."""
    if theme == 'twin_passes':
        _crag_ring(m['trim'], (radius, radius * .78), 7, rock_r=.20, z=z)
    elif theme == 'royal_ring':
        for sx in (-1, 1):
            _chunky_box('royal foundation cap', (.26, .28, .12),
                        (sx * radius * .72, -.65, z + .10), m['gold'])
    elif theme == 'quad_citadel':
        for sx in (-1, 1):
            for y in (-.40, .15, .65):
                _chunky_cyl('oak defence stake', .075, .50,
                            (sx * radius * .88, y, z + .10), m['wood'], 8, r2=.025)


def citadel(m, make_material, theme='crown_cross'):
    """Four bold roofed towers and a high central keep: unmistakable HQ."""
    contact_disc(make_material, 1.45, .22)
    _chunky_box('citadel foundation', (3.00, 2.60, .22), (0, 0, .11), m['dark'])
    _chunky_box('citadel stone step', (2.77, 2.36, .18), (0, 0, .28), m['trim'])
    for x in (-1.05, 1.05):
        _chunky_box('citadel side wall', (.35, 1.86, 1.18), (x, 0, .92), m['wall'])
    _chunky_box('citadel front wall', (2.18, .38, 1.16), (0, -.89, .92), m['wall'])
    _chunky_box('citadel rear wall', (2.18, .35, 1.16), (0, .89, .92), m['wall'])
    _chunky_box('front wall cornice', (2.23, .47, .17), (0, -.89, 1.56), m['trim'])
    for x in (-.84, -.42, 0, .42, .84):
        _chunky_box('broad front battlement', (.27, .42, .31),
                    (x, -.89, 1.75), m['trim'])
    for tx, ty in ((-1.04, -.83), (1.04, -.83), (-1.04, .83), (1.04, .83)):
        top = 2.02 if ty < 0 else 2.17
        _chunky_cyl('tower stone foot', .49, .20, (tx, ty, .39), m['trim'])
        _chunky_cyl('tower shaft', .43, top - .40, (tx, ty, (top + .40) / 2), m['wall'])
        _chunky_cyl('tower broad collar', .50, .22, (tx, ty, top), m['trim'])
        _chunky_cyl('tower roof eave', .61, .14, (tx, ty, top + .16), m['roof_light'])
        _chunky_cyl('tower roof', .61, .72, (tx, ty, top + .52),
                    m['roof'], 20, r2=.035)
        _chunky_cyl('roof upper highlight course', .38, .43,
                    (tx, ty, top + .67), m['roof_light'], 20, r2=.025)
        sphere('tower gold finial', .07, (tx, ty, top + .91), m['gold'])
        if ty < 0:
            _toy_window(m, tx, ty - .43, 1.22, width=.14, height=.29)
    _chunky_box('central keep', (1.38, 1.16, 1.66), (0, .10, 1.67), m['wall'])
    _chunky_box('central keep cornice', (1.56, 1.34, .19), (0, .10, 2.54), m['trim'])
    _roof_layers(m, 'main keep roof', 1.80, 1.48, 2.64, .64, y=.10)
    _toy_gate(m, 0, -1.105, .36, width=.68, height=.83)
    _toy_banner(m, 0, -.535, 2.08, width=.44, height=.63)
    _theme_signature(m, theme, 1.48)


def keep(m, make_material, theme='crown_cross'):
    """Octagonal stronghold topped by a large gold crown silhouette."""
    contact_disc(make_material, 1.30, .22)
    _chunky_cyl('keep foundation', 1.40, .22, (0, 0, .11), m['dark'], 8)
    _chunky_cyl('keep stone step', 1.31, .18, (0, 0, .28), m['trim'], 8)
    _chunky_cyl('keep drum', 1.10, 1.16, (0, 0, .94), m['wall'], 8)
    _chunky_cyl('keep cornice', 1.22, .21, (0, 0, 1.57), m['trim'], 8)
    for i in range(8):
        angle = i * math.tau / 8
        _chunky_box('keep broad battlement', (.32, .31, .36),
                    (1.08 * math.cos(angle), 1.08 * math.sin(angle), 1.81),
                    m['trim'], rot=(0, 0, angle))
    _chunky_cyl('crown tower', .57, .76, (0, .04, 1.85), m['wall'], 12)
    _chunky_cyl('crown team collar', .63, .16, (0, .04, 2.17), m['roof_light'], 12)
    _chunky_cyl('crown gold band', .65, .22, (0, .04, 2.36), m['gold'], 12)
    for i in range(5):
        angle = i * math.tau / 5 + .3
        _chunky_cyl('crown triangular point', .16, .48,
                    (.56 * math.cos(angle), .04 + .56 * math.sin(angle), 2.62),
                    m['gold'], 6, r2=.025)
        sphere('crown point jewel', .065,
               (.56 * math.cos(angle), .04 + .56 * math.sin(angle), 2.87),
               m['roof_light'])
    _toy_gate(m, 0, -1.065, .37, width=.53, height=.75)
    for x in (-.65, .65):
        _toy_banner(m, x, -.89, 1.11, width=.28, height=.52)
    _theme_signature(m, theme, 1.30)


def outpost(m, make_material, theme='crown_cross'):
    """A single stout watchtower with a tall team roof."""
    contact_disc(make_material, .95, .22)
    _chunky_cyl('outpost foundation', .97, .20, (0, 0, .10), m['dark'], 8)
    _chunky_cyl('outpost stone step', .88, .18, (0, 0, .27), m['trim'], 8)
    _chunky_cyl('outpost shaft', .67, 1.78, (0, 0, 1.25), m['wall'], 12)
    _chunky_cyl('outpost belt', .72, .15, (0, 0, 1.03), m['trim'], 12)
    _chunky_cyl('watch gallery shadow', .73, .12, (0, 0, 2.14), m['dark'], 12)
    _chunky_cyl('watch gallery', .85, .24, (0, 0, 2.28), m['trim'], 12)
    for x in (-.51, 0, .51):
        _chunky_box('watch parapet', (.23, .27, .25), (x, -.67, 2.49), m['trim'])
    _chunky_cyl('watch team roof rim', .87, .15, (0, 0, 2.55), m['roof_light'], 16)
    _chunky_cyl('watch team roof', .86, .76, (0, 0, 2.97), m['roof'], 16, r2=.035)
    _chunky_cyl('watch upper roof course', .51, .46, (0, 0, 3.13), m['roof_light'], 16, r2=.025)
    sphere('watch gold tip', .075, (0, 0, 3.39), m['gold'])
    _toy_gate(m, 0, -.66, .36, width=.40, height=.66)
    _toy_banner(m, 0, -.72, 1.64, width=.33, height=.48)
    _theme_signature(m, theme, .96)


def barracks(m, make_material, theme='crown_cross'):
    """A fortified gabled garrison with a large shield above its gate."""
    contact_disc(make_material, 1.35, .22)
    _chunky_box('barracks foundation', (2.50, 1.86, .21), (0, 0, .105), m['dark'])
    _chunky_box('barracks stone step', (2.38, 1.73, .17), (0, 0, .29), m['trim'])
    _chunky_box('garrison hall', (2.24, 1.56, 1.12), (0, 0, .91), m['wall'])
    _chunky_box('garrison cornice', (2.37, 1.72, .16), (0, 0, 1.48), m['trim'])
    _roof_layers(m, 'garrison roof', 2.61, 1.98, 1.57, .76)
    for sx in (-1, 1):
        _chunky_box('garrison buttress', (.27, .30, 1.23),
                    (sx * 1.05, -.70, .98), m['trim'])
        _chunky_box('garrison battlement', (.31, .38, .33),
                    (sx * 1.05, -.70, 1.69), m['trim'])
    _chunky_box('garrison chimney', (.36, .37, .52), (.81, .45, 2.08), m['wall'])
    _chunky_box('garrison chimney cap', (.46, .47, .14), (.81, .45, 2.39), m['trim'])
    _toy_gate(m, 0, -.84, .37, width=.57, height=.72)
    heater_shield('large garrison shield', (.70, -.91, 1.07), .48, m['banner'], m['gold'])
    _toy_window(m, -.68, -.84, 1.03, width=.18, height=.28)
    _theme_signature(m, theme, 1.24)


def stable(m, make_material, theme='crown_cross'):
    """A low timber stable with open bays, a deep canopy and golden horseshoe."""
    contact_disc(make_material, 1.35, .22)
    _chunky_box('stable foundation', (2.50, 1.94, .20), (0, 0, .10), m['dark'])
    _chunky_box('stable stone step', (2.37, 1.79, .15), (0, 0, .265), m['trim'])
    _chunky_box('stable cream hall', (2.22, 1.50, .98), (0, .04, .82), m['plaster'])
    _roof_layers(m, 'stable roof', 2.62, 2.06, 1.36, .62, y=.04)
    # Open stalls and a projecting oak-supported shelter make a unique low silhouette.
    for sx in (-.72, .72):
        _chunky_box('stall deep opening', (.63, .10, .70), (sx, -.755, .71), m['dark'])
        _chunky_box('oak trough', (.58, .27, .23), (sx, -1.00, .45), m['wood'])
        _chunky_box('bright hay', (.47, .20, .12), (sx, -1.01, .60), m['hay'])
    _chunky_box('stable oak canopy', (2.36, .67, .15), (0, -.99, 1.24), m['wood'])
    canopy = roof('stable canopy team roof', 2.49, .76, 1.34, .23,
                  m['roof_light'], y=-1.02)
    canopy.modifiers['roof edges'].width = .065
    for x in (-1.04, 0, 1.04):
        _chunky_box('stable oak post', (.17, .18, .99), (x, -1.14, .79), m['wood'])
    # Thick U-shaped heraldic horseshoe on the front gable; no tiny lettering.
    curve = bpy.data.curves.new('gold horseshoe', 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = .065
    curve.bevel_resolution = 3
    spline = curve.splines.new('POLY')
    spline.points.add(16)
    for i in range(17):
        angle = math.pi * (.15 + 1.70 * i / 16)
        spline.points[i].co = (.16 * math.sin(angle), -1.035,
                              1.82 + .16 * math.cos(angle), 1)
    emblem = bpy.data.objects.new('gold horseshoe', curve)
    bpy.context.collection.objects.link(emblem)
    curve.materials.append(m['gold'])
    bpy.context.view_layer.objects.active = emblem
    emblem.select_set(True)
    bpy.ops.object.convert(target='MESH')
    emblem.select_set(False)
    _theme_signature(m, theme, 1.26)


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

def _leaf_cluster(name, radius, loc, scale, m, seed):
    """Asymmetric leaf mass with broad lit planes instead of smooth primitive balls."""
    ob = ico(name, radius, loc, m['leaf'], scale=scale, subdivisions=2)
    rng = random.Random(seed)
    for v in ob.data.vertices:
        direction = v.co.normalized()
        lobe = 1.0 + .08 * math.sin(math.atan2(direction.y, direction.x) * 5 + seed)
        v.co *= lobe * (.93 + rng.random() * .14)
    ob.data.materials.append(m['leaf_dark'])
    ob.data.materials.append(m['leaf_light'])
    ob.data.update()
    for poly in ob.data.polygons:
        poly.use_smooth = False
        # Broad upper highlights survive the runtime downscale; darker lower faces ground the mass.
        poly.material_index = 2 if poly.normal.z > .48 and poly.center.x < radius * .35 else 1 if poly.normal.z < -.15 else 0
    return ob


def tree_birch(m, make_material):
    contact_disc(make_material, .55, .20)
    cyl('birch trunk', .13, 2.50, (0, 0, 1.25), m['birch_bark'], 12, r2=.07, smooth=True)
    for z in (.43, 1.00, 1.52):
        box('birch dark bark notch', (.13, .02, .075), (.035, -.125 + z * .018, z), m['bark_band'], .01)
    for sx in (-1, 1):
        cyl('birch rising bough', .065, .84, (sx * .21, .02, 2.19), m['birch_bark'],
            10, rot=(0, sx * .52, 0), r2=.025, smooth=True)
    clusters = (
        ((-.53, -.04, 2.58), .64, (1.05, .98, .85)),
        ((.53, .07, 2.68), .65, (1.10, .97, .88)),
        ((-.12, .32, 3.02), .72, (1.08, .95, .85)),
        ((.16, -.27, 2.99), .67, (1.11, 1.03, .83)),
        ((-.21, .03, 3.52), .55, (1.06, .96, .82)),
    )
    for i, (loc, radius, scale) in enumerate(clusters):
        _leaf_cluster('birch sculpted canopy', radius, loc, scale, m, 21 + i)


def tree_apple(m, make_material):
    contact_disc(make_material, .62, .20)
    cyl('apple trunk', .19, 1.52, (0, 0, .76), m['apple_bark'], 12, r2=.10, smooth=True)
    for sx in (-1, 1):
        cyl('apple fork', .09, .75, (sx * .20, .03, 1.46), m['apple_bark'], 10,
            rot=(0, sx * .57, 0), r2=.035, smooth=True)
    clusters = (
        ((-.58, .02, 1.95), .65, (1.05, 1.01, .85)),
        ((.58, .11, 2.03), .65, (1.10, .98, .89)),
        ((-.07, .39, 2.44), .72, (1.13, .98, .91)),
        ((.15, -.30, 2.38), .77, (1.09, 1.06, .88)),
        ((-.30, -.08, 2.84), .51, (1.12, .98, .83)),
    )
    for i, (loc, radius, scale) in enumerate(clusters):
        _leaf_cluster('apple sculpted canopy', radius, loc, scale, m, 51 + i)
    for x, y, z in ((-.73, -.28, 2.13), (.60, -.42, 2.21), (.14, -.91, 2.41),
                    (-.37, -.77, 2.59), (.60, -.55, 2.74)):
        sphere('bright apple', .095, (x, y, z), m['apple'], scale=(1.0, 1.0, .92))


def _pine_leaf_tier(m, radius, height, z, phase):
    """Scalloped conifer boughs: irregular rounded skirts rather than stacked cones."""
    count = 14
    rings = ((0.0, .68), (.14, 1.0), (.52, .73), (.95, .13))
    verts, faces = [], []
    for level, factor in rings:
        for i in range(count):
            angle = i * math.tau / count
            r = radius * factor * (1.0 + .075 * math.sin(angle * 5 + phase))
            verts.append((r * math.cos(angle), r * math.sin(angle),
                          z + level * height + .04 * math.sin(angle * 3 + phase)))
    for row in range(len(rings) - 1):
        for i in range(count):
            nxt = (i + 1) % count
            faces.append((row * count + i, row * count + nxt,
                          (row + 1) * count + nxt, (row + 1) * count + i))
    faces.extend((tuple(reversed(range(count))), tuple(range((len(rings) - 1) * count, len(rings) * count))))
    mesh = bpy.data.meshes.new('sculpted pine boughs')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    ob = bpy.data.objects.new('sculpted pine boughs', mesh)
    bpy.context.collection.objects.link(ob)
    for key in ('leaf', 'leaf_dark', 'leaf_light'):
        mesh.materials.append(m[key])
    for poly in mesh.polygons:
        poly.material_index = 1 if poly.normal.z < .15 else 2 if poly.normal.z > .45 and poly.center.x < 0 else 0
    bevel = ob.modifiers.new('soft foliage edges', 'BEVEL')
    bevel.width = .04
    bevel.segments = 2
    ob.modifiers.new('foliage normals', 'WEIGHTED_NORMAL')
    return ob


def tree_pine(m, make_material):
    contact_disc(make_material, .55, .20)
    cyl('pine trunk', .17, 1.18, (0, 0, .59), m['apple_bark'], 10, r2=.09, smooth=True)
    for i, (radius, height, z) in enumerate(((.87, .98, .78), (.72, .88, 1.46),
                                            (.54, .80, 2.08), (.34, .72, 2.63))):
        _pine_leaf_tier(m, radius, height, z, i * .72)


def bush(m, make_material):
    contact_disc(make_material, .55, .18)
    for i, (loc, radius, scale) in enumerate((
        ((-.38, .00, .28), .38, (1.04, 1.0, .84)),
        ((.39, .09, .29), .38, (1.05, 1.0, .85)),
        ((-.02, .08, .50), .49, (1.15, 1.0, .87)),
        ((.08, -.29, .31), .37, (1.11, 1.0, .85)),
    )):
        _leaf_cluster('sculpted shrub', radius, loc, scale, m, 91 + i)


def grass_tuft(m, make_material):
    # A single deliberate fan silhouette avoids thin cylindrical blade noise.
    for i in range(7):
        a = i * math.tau / 7 + .3
        depth = .50 + (i % 3) * .10
        cyl('broad grass blade', .065, depth,
            (.09 * math.cos(a), .09 * math.sin(a), .29),
            m['leaf_dark'] if i % 2 else m['leaf'], 5, r2=.005, rot=(0, .30, a))


def rock(m, make_material):
    contact_disc(make_material, .55, .18)
    big = ico('rock broad face', .50, (0, 0, .28), m['stone'], scale=(1.24, .94, .65), subdivisions=1)
    _jitter(big, random.Random(11))
    for poly in big.data.polygons:
        poly.use_smooth = False
    small = ico('rock small', .27, (.41, .17, .16), m['stone'],
                scale=(1.20, .90, .62), subdivisions=1)
    _jitter(small, random.Random(23))
    for poly in small.data.polygons:
        poly.use_smooth = False


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
import json
from pathlib import Path
_ARENA_LAYOUT = json.loads((Path(__file__).resolve().parents[1] / 'arena-layout.json').read_text())
GROUND_VERTICAL_SPACING = _ARENA_LAYOUT['verticalSpacing']
if (_ARENA_LAYOUT['version'] != 1 or not math.isfinite(GROUND_VERTICAL_SPACING)
        or not 1.0 <= GROUND_VERTICAL_SPACING <= 1.3):
    raise ValueError('Invalid arena-layout vertical spacing')
# Meadow fringe on the original plate extent (plane units): the plate still
# extends past the expanded playfield so tall viewports fill with board
# instead of empty backdrop. The client centers the plate image on the
# projected world-rect center; shorter viewports simply crop the fringe.
# Must stay in lockstep with GROUND_DIORAMA_ORTHO_SCALE in
# build_battlefield_scene.py (sensor = plate + lip/skirt margins).
MEADOW_FRINGE = 250.0
# Plate edges in plane units: the legacy plate stopped at the world rect's
# north edge and 24 units short of its south edge (the slab skirt takes over
# there); the fringe extends both edges by MEADOW_FRINGE.
_PLATE_NORTH_EDGE = 320.0 + MEADOW_FRINGE
_PLATE_SOUTH_EDGE = -296.0 - MEADOW_FRINGE


def _hex_rgb(value):
    """battlefields.json packed int colour -> linear-ish rgb triple."""
    return ((value >> 16 & 255) / 255.0, (value >> 8 & 255) / 255.0, (value & 255) / 255.0)


def _to_plane(logical_x, logical_y):
    """Authoritative coords -> spaced art positions; camera remains 45 degrees."""
    return (logical_x - GROUND_LOGICAL_CENTER[0],
            -(logical_y - GROUND_LOGICAL_CENTER[1]) * GROUND_VERTICAL_SPACING)


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

    # Explicit object-space coordinates keep the pattern at a useful world
    # scale. Generated 0..1 coordinates made the old .017-scale meadow
    # virtually flat, leaving the mower stripes as its only visible detail.
    coordinates = nodes.new('ShaderNodeTexCoord')

    mottle = nodes.new('ShaderNodeTexNoise')
    mottle.inputs['Scale'].default_value = scale
    mottle.inputs['Detail'].default_value = detail
    mottle.inputs['Roughness'].default_value = .42
    links.new(coordinates.outputs['Object'], mottle.inputs['Vector'])
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
    links.new(coordinates.outputs['Object'], speckle_noise.inputs['Vector'])
    speckle_ramp = nodes.new('ShaderNodeValToRGB')
    speckle_ramp.color_ramp.elements[0].position = .3
    speckle_ramp.color_ramp.elements[0].color = (1.0, 1.0, 1.0, 1.0)
    speckle_ramp.color_ramp.elements[1].position = .8
    speckle_ramp.color_ramp.elements[1].color = (.84, .84, .84, 1.0)
    links.new(speckle_noise.outputs['Fac'], speckle_ramp.inputs['Fac'])

    speckle_mix = nodes.new('ShaderNodeMix')
    speckle_mix.data_type = 'RGBA'
    speckle_mix.blend_type = 'MULTIPLY'
    speckle_mix.inputs['Factor'].default_value = .10
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
            max(0.0, (_PLATE_NORTH_EDGE - y) / 14.0),
            max(0.0, (y - _PLATE_SOUTH_EDGE + 6.0) / 14.0),
        )
        for (ax, ay), (bx, by) in roads:
            result = min(result, max(0.0, (_distance_to_segment(x, y, ax, ay, bx, by) - 13.0) / 24.0))
        for (tx, ty), radius in territories:
            result = min(result, max(0.0, (math.hypot(x - tx, y - ty) - radius - 6.0) / 18.0))
        for zone in flats:
            result = min(result, _zone_factor(zone, x, y / GROUND_VERTICAL_SPACING))
        return result

    def terrain_z(x, y):
        return undulation(x, y) * factor(x, y)

    return terrain_z, roads


def _rounded_plate(mat, terrain_z):
    """380x1116 subdivided plate: 18px rounded corners, real micro-relief.

    The plate spans the 640-unit world rect plus a 250-unit meadow fringe
    beyond each edge (see MEADOW_FRINGE), so tall viewports fill with board
    while shorter ones crop the fringe through the client's centered
    image rect.
    """
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=76, y_subdivisions=224, size=1,
                                    location=(0.0, 12.0, 0.0))
    ob = bpy.context.object
    ob.name = 'ground plate'
    ob.scale = (GROUND_W, _PLATE_NORTH_EDGE - _PLATE_SOUTH_EDGE, 1.0)
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
    """Warm, worn paths with quiet shoulders on authoritative centerlines."""
    rng = random.Random(90210)
    dry = _flat_alpha('rgx_dry', make_material, (.24, .28, .07), .12)
    for road_index, (id_a, id_b) in enumerate(bf['roads']):
        a = _territory(bf, id_a)
        b = _territory(bf, id_b)
        ax, ay = _to_plane(a['x'], a['y'])
        bx, by = _to_plane(b['x'], b['y'])
        length = math.hypot(bx - ax, by - ay) + 10.0
        angle = math.atan2(by - ay, bx - ax)
        cx, cy = (ax + bx) / 2.0, (ay + by) / 2.0
        # Quad's short corner links overlap adjacent road beds. Coplanar
        # meshes block their own Cycles shadow rays and leave black squares;
        # tiny distinct heights avoid that without a visible gameplay lift.
        lift = road_index * .0005 if bf['id'] == 'quad_citadel' else 0
        _road_strip('dry grass band', length + 12.0, 35.0, .035 + lift, angle, cx, cy, dry, 2.6, rng)
        _road_strip('road shoulder', length + 6.0, 27.0, .05 + lift, angle, cx, cy, mats['shoulder'], 2.0, rng)
        _road_strip('road bed', length, 19.0, .07 + lift, angle, cx, cy, mats['road'], 1.2, rng)
        # Broken paving is readable at phone size without two continuous
        # black wheel tracks or extra apparent routes. All stones are baked.
        if bf['id'] in ('crown_cross', 'royal_ring'):
            for step in range(15, int(length) - 10, 23):
                t = step / length
                px = ax + (bx - ax) * t
                py = ay + (by - ay) * t
                box('worn path stone', (8.5, 13.0, .12), (px, py, .13),
                    mats['paving'], .7, rot=(0, 0, angle + (rng.random() - .5) * .12))


def _ground_sockets(bf, ao_mat, plinth_top_z=0.04, diorama=False):
    """Soft contact darkening under every territory platform.

    Diorama boards pass the plinth top height so the shade grounds each
    building on its raised platform instead of floating at meadow level;
    the disc stays inside the plinth rim so nothing floats over the edge."""
    for territory in bf['territories']:
        x, y = _to_plane(territory['x'], territory['y'])
        radius = (_socket_radius(bf, territory) - 4.0) if diorama else (territory['radius'] + 6.0)
        cyl('socket shade', radius, .02, (x, y, plinth_top_z), ao_mat, 32)


def _organic_patch(name, x, y, rx, ry, z, mat, seed=0):
    """A quiet hand-shaped ground mass, rather than a translucent rectangle."""
    rng = random.Random(seed)
    vertices = [(x, y, z)]
    count = 48
    phase = rng.random() * math.tau
    for i in range(count):
        a = i * math.tau / count
        radius = 1.0 + .035 * math.sin(a * 5 + phase) + .025 * math.cos(a * 9 - phase)
        vertices.append((x + rx * radius * math.cos(a), y + ry * radius * math.sin(a), z))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], [(0, i + 1, (i + 1) % count + 1) for i in range(count)])
    mesh.update()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def _river_ribbon(name, width, z, mat):
    """Tapered, winding stream contained inside the shared dressing exclusion.

    Stops before the north/south citadel sockets. The bridge stays on the
    existing east-west road at logical y=360; no gameplay elevation changes.
    """
    vertices, faces = [], []
    for i in range(65):
        t = i / 64.0
        y = -160.0 + t * 385.0
        center = 4.0 * math.sin(y * .024) + 3.0 * math.sin(y * .012 + .4)
        half = width * .5 * math.sin(math.pi * t) ** .22
        half *= 1.0 + .06 * math.sin(y * .12)
        vertices.extend(((center - half, y, z), (center + half, y, z)))
        if i:
            k = i * 2
            faces.append((k - 2, k, k + 1, k - 1))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def _ground_identity(battlefield_id, make_material, terrain_z):
    """Authored miniature landscapes; identity art never creates new routes."""
    if battlefield_id == 'crown_cross':
        worn = _flat_alpha('rgx_court', make_material, (.28, .37, .085), .12)
        _organic_patch('central worn lawn', 0, 38, 80, 94, .014, worn, 31)
    elif battlefield_id == 'twin_passes':
        bank = make_material('rgx_bank', (.15, .20, .12), .92, use_gradient=False)
        shallows = make_material('rgx_shallows', (.08, .32, .31), .5, use_gradient=False)
        water = _noise_material('rgx_water', make_material, (.035, .23, .27), (.075, .37, .38),
                                .022, roughness=.3, detail=2.0)
        _river_ribbon('organic brook bank', 49.0, .012, bank)
        _river_ribbon('brook shallows', 43.0, .025, shallows)
        _river_ribbon('brook water', 37.0, .04, water)
        stone = make_material('rgx_bridge', (.43, .39, .28), .8, use_gradient=False)
        # Ground-level decking keeps marching sprites registered to the
        # canonical route; small stone parapets supply the diorama volume.
        for i in range(9):
            box('bridge deck stone', (7.6, 19.0, .24), (-32 + i * 8.0, 38.0, .16), stone, .65)
        for side in (-1, 1):
            box('bridge parapet', (72.0, 2.2, 2.5), (0, 38 + side * 11, 1.27), stone, .7)
            for x in (-34, 34):
                box('bridge end pier', (5, 5, 4), (x, 38 + side * 11, 2), stone, .8)
        crag = make_material('rgx_crag', (.22, .29, .26), .9, use_gradient=False)
        for i, (x, y) in enumerate(((-154, 292), (153, 289), (-153, -270), (156, -265))):
            for j in range(3):
                blob = ico('highland edge crag', 14.0 - j * 2, (x + (j - 1) * 10, y + j * 7, 3 + j),
                           crag, scale=(1.2, .9, .55), subdivisions=1)
                _jitter(blob, random.Random(i * 19 + j))
    elif battlefield_id == 'royal_ring':
        gravel = _noise_material('rgx_gravel', make_material, (.26, .25, .16), (.38, .35, .23),
                                 .035, detail=2)
        _organic_patch('palace garden court', 0, 38, 93, 93, .014, gravel, 20)
        hedge = make_material('rgx_hedge', (.065, .21, .04), .9, use_gradient=False)
        hedge_top = make_material('rgx_hedge_top', (.12, .29, .055), .85, use_gradient=False)
        # Segments, gaps, trimmed tops and flower borders replace the torus.
        for i in range(16):
            a = i * math.tau / 16
            x, y = 80 * math.cos(a), 38 + 80 * math.sin(a)
            box('garden hedge segment', (23, 9, 5), (x, y, 2.6), hedge, 2.1, rot=(0, 0, a + math.pi / 2), bevel_segments=3)
            box('garden hedge new growth', (21, 7.5, 1.7), (x, y, 5.4), hedge_top, 1.6, rot=(0, 0, a + math.pi / 2), bevel_segments=3)
        paver = make_material('rgx_garden_paver', (.47, .42, .3), .9, use_gradient=False)
        # A low tiled garden motif is decorative, with no tower-like centre.
        for x in (-24, -8, 8, 24):
            for y in (14, 30, 46, 62):
                box('courtyard inlaid stone', (14, 14, .16), (x, y, .11), paver, .8)
    elif battlefield_id == 'quad_citadel':
        camp = _flat_alpha('rgx_camp', make_material, (.34, .27, .13), .30)
        for i, (x, y) in enumerate(((-88, 174), (88, 174), (-88, -102), (88, -102))):
            _organic_patch('trampled camp clearing', x, y, 81, 94, .018, camp, i + 16)
        for i, (x, y) in enumerate(((-152, 38), (152, 38))):
            _organic_patch('camp verge', x, y, 27, 18, .014, camp, i + 44)


def _ground_scatter(battlefield_id, bf, mats, terrain_z, roads):
    """Deterministic meadow dressing: clustered and rooted in the relief."""
    rng = random.Random(104729)
    for ch in battlefield_id:
        rng.seed(rng.random() * 1048576.0 + ord(ch))
    grass_batch = {'vertices': [], 'faces': [], 'materials': [], 'material_indices': []}

    # Client sprites and baked ground foliage share one art-only exclusion
    # source, so a regeneration cannot plant bushes on the river or court.
    import json
    from pathlib import Path
    dressing = json.loads((Path(__file__).resolve().parents[1] / 'arena-dressing-zones.json').read_text())
    zones = dressing['battlefields'][battlefield_id]

    def in_identity_zone(x, y):
        lx, ly = x + 200, 398 - y / GROUND_VERTICAL_SPACING
        for zone in zones:
            if zone['shape'] == 'rectangle':
                if zone['minX'] <= lx <= zone['maxX'] and zone['minY'] <= ly <= zone['maxY']:
                    return True
            elif math.hypot(lx - zone['x'], ly - zone['y']) <= zone['radius']:
                return True
        return False

    def blocked(x, y):
        if abs(x) > 170.0 or abs(y - 12.0) > 530.0:
            return True
        if in_identity_zone(x, y):
            return True
        for territory in bf['territories']:
            tx, ty = _to_plane(territory['x'], territory['y'])
            if math.hypot(x - tx, y - ty) < territory['radius'] + 16.0:
                return True
        for (ax, ay), (bx, by) in roads:
            if _distance_to_segment(x, y, ax, ay, bx, by) < 20.0:
                return True
        feature_y = y / GROUND_VERTICAL_SPACING
        if battlefield_id == 'crown_cross':
            return math.hypot(x, feature_y - 38.0) < 40.0
        if battlefield_id == 'twin_passes':
            return abs(x) < 34.0
        if battlefield_id == 'royal_ring':
            return math.hypot(x, feature_y - 38.0) < 108.0
        if battlefield_id == 'quad_citadel':
            if abs(x) < 28.0 and abs(feature_y - 38.0) < 250.0:
                return True
            # Keep the camp cores trampled, with grass reclaiming their
            # outer verges instead of leaving large rectangular empty lawns.
            return any(math.hypot((x - cx) / 66.0, (feature_y - cy) / 76.0) < 1.0
                       for cx, cy in ((-88.0, 174.0), (88.0, 174.0), (-88.0, -102.0), (88.0, -102.0)))
        return False

    def spot(edge_only=False):
        for _ in range(90):
            x = (rng.random() * 2.0 - 1.0) * 170.0
            y = (rng.random() * 2.0 - 1.0) * 530.0 + 12.0
            if blocked(x, y):
                continue
            if edge_only and abs(x) < 90.0 and abs(y - 12.0) < 400.0:
                continue
            return x, y
        return None

    placed = []

    def reserve(x, y):
        for px, py in placed:
            if math.hypot(x - px, y - py) < 9.0:
                return False
        placed.append((x, y))
        return True

    def tuft(x, y, tall=False):
        blades = (12 if tall else 7) + int(rng.random() * 4)
        for i in range(blades):
            a = rng.random() * math.tau
            r = .8 + rng.random() * (6.0 if tall else 3.0)
            depth = (6.5 + rng.random() * 4.0) if tall else (3.5 + rng.random() * 3.0)
            blade_x = x + r * math.cos(a)
            blade_y = y + r * math.sin(a)
            if blocked(blade_x, blade_y):
                continue
            mat = (mats['leaf_tall'] if tall else mats['leaf']) if i % 2 else mats['leaf_dark']
            cyl('ground blade', .8 if tall else .65, depth,
                (blade_x, blade_y, terrain_z(blade_x, blade_y) + depth / 2.0 - .6),
                mat, 5, r2=.10,
                rot=(rng.random() * .35, rng.random() * .35, a), batch=grass_batch)

    def flower_cluster(x, y):
        count = 3 + int(rng.random() * 6)
        for _ in range(count):
            a = rng.random() * math.tau
            r = 1.2 + rng.random() * 2.4
            fx, fy = x + r * math.cos(a), y + r * math.sin(a)
            if in_identity_zone(fx, fy):
                continue
            white = rng.random() < .55
            ico('meadow flower', .9, (fx, fy, terrain_z(fx, fy) + .8),
                mats['flower_light'] if white else mats['flower_dark'], scale=(1.0, 1.0, .5))

    def clover_patch(x, y):
        # Low, overlapping leaf rosettes read as living ground cover after
        # mobile downsampling, instead of almost invisible transparent discs.
        for _ in range(4):
            a = rng.random() * math.tau
            r = rng.random() * 5.5
            cx, cy = x + r * math.cos(a), y + r * math.sin(a)
            for leaf in range(3):
                angle = a + leaf * math.tau / 3.0
                lx, ly = cx + 1.6 * math.cos(angle), cy + 1.6 * math.sin(angle)
                if blocked(lx, ly):
                    continue
                ico('clover patch', 1.8 + rng.random() * .7,
                    (lx, ly, terrain_z(lx, ly) + .45),
                    mats['clover'] if leaf % 2 else mats['leaf'], scale=(1.1, 1.0, .24))

    def pebble(x, y):
        ico('ground pebble', 1.4 + rng.random() * 1.2, (x, y, terrain_z(x, y) + 1.2),
            mats['stone'], scale=(1.3, 1.0, .45))

    # Dense meadow carpet between the tactical lanes, with taller growth
    # concentrated in the fringe. All detail is baked into the one plate.
    for kind, count in (('clover', 64), ('tuft', 190), ('patch', 70), ('flower', 18), ('pebble', 16)):
        made = misses = 0
        while made < count and misses < 500:
            misses += 1
            position = spot(edge_only=(kind in ('patch', 'flower')))
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

    # Roadside pebbles: worn stone collecting along the dirt road edges, with
    # sparse grass sprouting through the same worn shoulders.
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
                if abs(x) < 170.0 and abs(y) < 292.0 and not in_identity_zone(x, y):
                    ico('roadside pebble', .9 + rng.random() * .9, (x, y, terrain_z(x, y) + .5),
                        mats['stone'], scale=(1.2, .95, .55))
                    # Sparse shoulder grass: the meadow reclaiming the lane.
                    if rng.random() < .22:
                        tx = x + (rng.random() - .5) * 6.0
                        ty = y + (rng.random() - .5) * 6.0
                        if not in_identity_zone(tx, ty):
                            tuft(tx, ty)

    if grass_batch['vertices']:
        mesh = bpy.data.meshes.new('baked meadow blades')
        mesh.from_pydata(grass_batch['vertices'], [], grass_batch['faces'])
        for material in grass_batch['materials']:
            mesh.materials.append(material)
        for polygon, material_index in zip(mesh.polygons, grass_batch['material_indices']):
            polygon.material_index = material_index
        mesh.update()
        meadow = bpy.data.objects.new('baked meadow blades', mesh)
        bpy.context.collection.objects.link(meadow)


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


# Authored source colours under the canonical rig. Warm royal lawns,
# cooler highland sage, palace greens and olive camp grass give each map
# an identity without changing the authoritative palette/fallback data.
GROUND_GRASS_PALETTES = {
    'crown_cross': ((.105, .235, .035), (.17, .35, .065)),
    'twin_passes': ((.055, .18, .10), (.105, .28, .15)),
    'royal_ring': ((.07, .23, .045), (.14, .34, .075)),
    'quad_citadel': ((.12, .21, .045), (.21, .32, .085)),
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

DIORAMA_GROUND_BATTLEFIELDS = {'crown_cross', 'twin_passes', 'royal_ring', 'quad_citadel'}
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


def _socket_radius(bf, territory):
    """Platform radius mirrored EXACTLY from the client's territoryArtFootprint.

    The client traces its ownership ring on the baked plinth's lip, so any
    drift here shows up as a ring floating inside (or outside) its stone
    platform. Quad Citadel tunes bespoke sockets because its base/corner
    centers are only sqrt(3400) px apart; every other battlefield uses the
    compact radius+5 socket (top citadels get 32)."""
    battlefield_id = bf['id']
    tier = territory.get('tier')
    top_citadel = (
        territory.get('type') == 'fortress'
        and tier == 3
        and territory.get('y', 999) <= 150
    )
    if battlefield_id == 'quad_citadel':
        return 29.0 if tier == 3 else 36.0 if tier == 2 else 23.0
    if top_citadel:
        return 32.0
    return territory['radius'] + 5.0


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
    box('slab upper course', (374.0, 610.0 + MEADOW_FRINGE * 2.0, 7.0), (0.0, 12.0, top_z - 3.5), course, .04)
    # Lower earth mass: the visible skirt.
    box('slab mass', (366.0, 602.0 + MEADOW_FRINGE * 2.0, DIORAMA_SLAB_DEPTH), (0.0, 12.0, top_z - 7.0 - DIORAMA_SLAB_DEPTH / 2.0), base, .03)


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
    mat = make_material('rgx_plinth', (.20, .225, .19), .92, use_gradient=False)
    rim_mat = make_material('rgx_plinth_rim', (.34, .355, .27), .88, use_gradient=False)
    seam_mat = make_material('rgx_plinth_joint', (.15, .17, .14), .95, use_gradient=False)
    for territory in bf['territories']:
        x, y = _to_plane(territory['x'], territory['y'])
        r = _socket_radius(bf, territory)
        # Base sinks DIORAMA_PLINTH_SINK into the meadow so no gap shows.
        body = cyl('socket plinth', r, DIORAMA_PLINTH_HEIGHT, (x, y, DIORAMA_PLINTH_HEIGHT / 2.0 - DIORAMA_PLINTH_SINK), mat, 48)
        body.modifiers['edge light'].width = .65
        # Thin lighter rim course standing PROUD of the plinth top: reads as
        # a worn raised lip without competing with the client's ownership
        # ring traced on the same rim. Never flush with the plinth top:
        # coincident faces block their own shadow rays in Cycles and the
        # whole platform top renders unlit black.
        lip = cyl('socket plinth lip', r - 3.0, 2.2, (x, y, _diorama_plinth_top_z() - 1.1), rim_mat, 48)
        lip.modifiers['edge light'].width = .45
        # Broad masonry courses read as carved stone, not mint plastic
        # discs. Joints stay on the outer shelf below the 6.2 anchor plane.
        for i in range(12):
            a = i * math.tau / 12
            rr = r - 1.6
            box('platform stone joint', (2.7, .48, .04),
                (x + rr * math.cos(a), y + rr * math.sin(a), 5.525), seam_mat, .04,
                rot=(0, 0, a))


def _ground_edge_gardens(battlefield_id, bf, make_material, terrain_z, roads):
    """Static edge clusters fill the fringe with a composed miniature world.

    Uses the same tree/bush models as runtime props, baked into the existing
    plate: no added runtime textures, objects, draw calls or touch targets.
    """
    def flat_material(name, color, roughness, **kwargs):
        kwargs['use_gradient'] = False
        return make_material('ground_' + name, color, roughness, **kwargs)

    materials = tmats(flat_material)
    tree_builder = tree_pine if battlefield_id in ('twin_passes', 'quad_citadel') else tree_apple
    positions = (
        (-153, 472, 15), (148, 452, 14), (-122, 357, 11), (156, 338, 12),
        (-157, -448, 15), (147, -470, 14), (-128, -332, 11), (157, -347, 12),
        (-169, 103, 8), (168, -49, 8),
    )
    for index, (x, y, scale) in enumerate(positions):
        if any(math.hypot(x - _to_plane(t['x'], t['y'])[0], y - _to_plane(t['x'], t['y'])[1])
               < _socket_radius(bf, t) + scale * 2.1 for t in bf['territories']):
            continue
        if any(_distance_to_segment(x, y, a[0], a[1], b[0], b[1]) < 24 + scale for a, b in roads):
            continue
        existing = set(bpy.data.objects)
        tree_builder(materials, flat_material)
        # Scale the entire miniature, including its feathered contact shade,
        # around the root. Only newly created objects belong to this cluster.
        for ob in set(bpy.data.objects) - existing:
            ob.location = (ob.location.x * scale + x,
                           ob.location.y * scale + y,
                           ob.location.z * scale + terrain_z(x, y))
            ob.scale *= scale
            ob.name = f'edge grove {index} {ob.name}'
        for j in range(2):
            bx, by = x + (j * 2 - 1) * 15, y - 16 - j * 4
            existing = set(bpy.data.objects)
            bush(materials, flat_material)
            for ob in set(bpy.data.objects) - existing:
                ob.location = (ob.location.x * 8 + bx, ob.location.y * 8 + by,
                               ob.location.z * 8 + terrain_z(bx, by))
                ob.scale *= 8
                ob.name = f'edge undergrowth {index} {ob.name}'


def ground_plate(battlefield_id, make_material):
    """Full-field rendered ground plate for one battlefield."""
    bf = _battlefield_data(battlefield_id)
    field = _hex_rgb(bf['visual']['field'])
    terrain_z, roads = _make_terrain(bf, battlefield_id)
    diorama = _is_diorama_ground(battlefield_id)

    low, high = GROUND_GRASS_PALETTES[battlefield_id]
    grass = _noise_material('rgx_grass', make_material, low, high, .008, detail=2.0)
    plate = _rounded_plate(grass, terrain_z)

    mats = {
        'road': _noise_material('rgx_road', make_material,
                                (.29, .235, .135), (.40, .33, .20), .032, roughness=.9, detail=2),
        'shoulder': _flat_alpha('rgx_shoulder', make_material,
                                (.21, .21, .10), .20),
        'paving': make_material('rgx_paving', (.40, .37, .25), .9, use_gradient=False),
        'ao': _flat_alpha('rgx_ao', make_material, (.03, .045, .025), .07),
        'leaf': make_material('rgx_leaf', (.24, .43, .065), .85, use_gradient=False),
        'leaf_dark': make_material('rgx_leafd', (.12, .29, .04), .85, use_gradient=False),
        'leaf_tall': make_material('rgx_leaft', (.20, .37, .05), .85, use_gradient=False),
        'clover': make_material('rgx_clover', (.16, .34, .075), .9, use_gradient=False),
        'stone': make_material('rgx_stone', (.36, .35, .31), .9, use_gradient=False),
        'flower_light': make_material('rgx_flowerl', (.92, .90, .80), .8, use_gradient=False),
        'flower_dark': make_material('rgx_flowerd', (.95, .82, .35), .8, use_gradient=False),
    }
    if diorama:
        # Extruded slab skirt + raised stone plinths: the playfield itself
        # carries depth through the dimetric rig.
        _diorama_slab(make_material)
        _diorama_plinths(bf, make_material)
    identity_before = set(bpy.data.objects)
    _ground_identity(battlefield_id, make_material, terrain_z)
    # Keep river/bridge, garden court and camp clearings registered to the
    # expanded positions. This is authored ground geometry, not image stretching;
    # socket radii, building sprites and the canonical camera retain their shapes.
    for ob in set(bpy.data.objects) - identity_before:
        ob.location.y *= GROUND_VERTICAL_SPACING
        if ob.type == 'MESH':
            for vertex in ob.data.vertices:
                vertex.co.y *= GROUND_VERTICAL_SPACING
            ob.data.update()
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
    _ground_edge_gardens(battlefield_id, bf, make_material, terrain_z, roads)
    if not diorama:
        _ground_bottom_fade(field, make_material)
    return plate
