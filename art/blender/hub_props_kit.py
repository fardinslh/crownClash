"""Crown Clash hub props: the daily crown chest (closed, open) and the crown emblem.

Built from the same primitives, materials and conventions as crown_cross_kit.py
and rendered through the canonical rig by art/blender/build_battlefield_scene.py
(authoring assets hub_chest_closed, hub_chest_open, hub_crown_emblem). Props
stand upright with their front toward the camera (-Y).
"""
import math

import bpy

from crown_cross_kit import box, cyl, sphere, contact_disc

WOOD = (.45, .25, .09)
WOOD_DARK = (.30, .16, .06)
GOLD = (.95, .65, .16)
GOLD_LIGHT = (1.0, .80, .30)
IRON = (.29, .38, .49)


def hub_mats(make_material):
    return {
        'wood': make_material('hub_wood', WOOD, .78),
        'wood_dark': make_material('hub_wood_dark', WOOD_DARK, .82),
        'gold': make_material('hub_gold', GOLD, .45, metallic=.25),
        'gold_light': make_material('hub_gold_light', GOLD_LIGHT, .42, metallic=.2),
        'iron': make_material('hub_iron', IRON, .62, metallic=.25),
        'gem': make_material('hub_gem', (.86, .10, .12), .30),
        'velvet': make_material('hub_velvet', (.55, .06, .10), .9),
        'gem_blue': make_material('hub_gem_blue', (.12, .42, .95), .30),
    }


def _parent_to(empty, objects):
    for ob in objects:
        ob.parent = empty
        ob.matrix_parent_inverse = empty.matrix_world.inverted()


def _chest_base(m):
    box('chest body', (1.0, .72, .46), (0, 0, .23), m['wood'], bevel=.04)
    # Iron-bound corners and a gold rim keep the silhouette readable at sprite size.
    for x in (-.5, .5):
        box('chest strap', (.14, .76, .50), (x, 0, .23), m['gold'], bevel=.03)
    box('chest rim', (1.04, .76, .07), (0, 0, .02), m['wood_dark'], bevel=.03)


def _lid_parts(m, y_offset=0.0, z_offset=0.0):
    """Barrel lid: a half-cylinder along X with two gold bands and the lock."""
    parts = []
    lid = cyl('chest lid', .36, 1.0, (0, y_offset, z_offset), m['wood'], 20, rot=(0, math.pi / 2, 0), smooth=True)
    parts.append(lid)
    for x in (-.5, .5):
        parts.append(cyl('lid band', .375, .14, (x, y_offset, z_offset), m['gold'], 20, rot=(0, math.pi / 2, 0), smooth=True))
    return parts


def chest(m, make_material):
    """Closed daily chest: wooden barrel-lid chest, gold bands, a lock to open."""
    k = hub_mats(make_material)
    contact_disc(make_material, .85, .22)
    _chest_base(k)
    _lid_parts(k, 0, .46)
    # Lid below the rim line is hidden inside the body; trim visually with a gold seam.
    box('lid seam', (1.0, .74, .05), (0, 0, .46), k['gold'], bevel=.02)
    box('lock plate', (.20, .06, .26), (0, -.37, .45), k['gold_light'], bevel=.03)
    sphere('lock keyhole', .045, (0, -.41, .43), k['iron'])


def chest_open(m, make_material):
    """Open chest with the lid hinged back and a heap of gold coins over the rim."""
    k = hub_mats(make_material)
    contact_disc(make_material, .85, .22)
    _chest_base(k)
    # Dark interior so the gold heap reads against the box.
    box('chest hollow', (.86, .58, .04), (0, 0, .46), k['wood_dark'], bevel=.01)
    hinge = bpy.data.objects.new('lid hinge', None)
    hinge.location = (0, .36, .46)
    bpy.context.collection.objects.link(hinge)
    bpy.context.view_layer.update()
    # A slab lid (the barrel lid would show its hollow lower half once opened).
    lid = [box('open lid', (1.0, .74, .13), (0, -.37, 0), k['wood'], bevel=.04)]
    for x in (-.5, .5):
        lid.append(box('open lid band', (.14, .78, .17), (x, -.37, 0), k['gold'], bevel=.03))
    _parent_to(hinge, lid)
    hinge.rotation_euler = (math.radians(-104), 0, 0)
    # Coin heap: stacked discs, wider at the bottom, tilted so they catch the key light.
    layers = (
        (.58, ((-.26, .0), (0, .0), (.26, .0), (-.13, -.16), (.13, -.16), (-.13, .16), (.13, .16))),
        (.72, ((-.14, .02), (.14, .02), (0, -.12), (0, .14))),
        (.86, ((0, .0), (-.08, -.06))),
        (.78, ((.15, -.06), (-.16, -.04))),
    )
    for z, spots in layers:
        for i, (x, y) in enumerate(spots):
            cyl('heap coin', .13, .045, (x, y, z), k['gold_light'] if (i + int(z * 10)) % 2 else k['gold'],
                16, rot=(.45 * (1 if i % 2 else -1), .35 * (1 if i % 3 else -1), 0))
    for i, (x, y) in enumerate(((-.30, -.40), (.12, -.44), (.40, -.38))):
        cyl('spilled coin', .11, .035, (x, y, .045 + .01 * i), k['gold_light'], 14, rot=(.2, 0, .3 * i))
    sphere('chest gem', .10, (.04, -.10, .98), k['gem'])


def crown_emblem(m, make_material):
    """Crown on a small plinth: ring, five points tipped with gems, red-gem centre."""
    k = hub_mats(make_material)
    contact_disc(make_material, .75, .22)
    cyl('crown plinth', .52, .14, (0, 0, .07), k['wood_dark'], 28)
    cyl('crown velvet', .42, .05, (0, 0, .43), k['velvet'], 28)
    cyl('crown band', .46, .30, (0, 0, .29), k['gold'], 28)
    cyl('crown band trim', .485, .06, (0, 0, .17), k['gold_light'], 28)
    cyl('crown band trim top', .485, .06, (0, 0, .41), k['gold_light'], 28)
    for i in range(5):
        a = math.pi / 2 + math.pi + i * math.tau / 5  # one point faces the camera (-Y)
        x, y = .40 * math.cos(a), .40 * math.sin(a)
        cyl('crown point', .13, .42, (x, y, .60), k['gold'], 12, r2=.035, smooth=True)
        sphere('crown pearl', .07, (x, y, .83), k['gold_light'])
    # Centre front gem, a blue pair at the sides.
    sphere('crown gem', .08, (0, -.465, .29), k['gem'], scale=(1, .6, 1.1))
    for x in (-.28, .28):
        sphere('crown gem side', .06, (x, -.37, .29), k['gem_blue'], scale=(1, .6, 1.1))
