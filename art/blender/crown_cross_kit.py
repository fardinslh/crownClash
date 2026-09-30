"""Crown Cross structure and troop kit (Blender).

Shared model definitions for the approved Crown Cross direction: slate stone,
pitched team-colored roofs, crenellated keeps and compact toy knights.
Consumed by art/blender/build_battlefield_scene.py (structure sprites) and
tools/blender/generate_units.py (shared troop sprites) so both render through
the same camera, lighting and world rig. Requires Blender's bpy; import lazily.
"""
import math

import bpy


def box(name, size, loc, mat, bevel=.055):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ob.data.materials.append(mat)
    mod = ob.modifiers.new('soft carved edges', 'BEVEL'); mod.width=bevel; mod.segments=3
    ob.modifiers.new('weighted normals', 'WEIGHTED_NORMAL')
    return ob


def cylinder(name, r, depth, loc, mat, vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=r, depth=depth, location=loc)
    ob=bpy.context.object; ob.name=name; ob.data.materials.append(mat)
    mod=ob.modifiers.new('edge light', 'BEVEL'); mod.width=.045; mod.segments=3
    ob.modifiers.new('weighted normals', 'WEIGHTED_NORMAL')
    return ob


def roof(name, width, length, z, height, mat, x=0, y=0):
    # A true pitched roof, thick eaves, continuous ridge; no floating plates.
    verts=[(-width/2,-length/2,0),(width/2,-length/2,0),(width/2,length/2,0),(-width/2,length/2,0),(0,-length/2,height),(0,length/2,height)]
    faces=[(0,3,2,1),(0,1,4),(3,5,2),(0,4,5,3),(1,2,5,4)]
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(verts,[],faces); mesh.update()
    ob=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(ob); ob.location=(x,y,z); ob.data.materials.append(mat)
    mod=ob.modifiers.new('rounded roof edges','BEVEL'); mod.width=.04; mod.segments=3
    ob.modifiers.new('weighted normals','WEIGHTED_NORMAL')


def shield(name, loc, size, mat, trim):
    x,y,z=loc
    verts=[(-.5,0,.55),(.5,0,.55),(.48,0,-.1),(0,0,-.62),(-.48,0,-.1)]
    mesh=bpy.data.meshes.new(name); mesh.from_pydata([(a*size,b,c*size) for a,b,c in verts],[],[(0,1,2,3,4)]); mesh.update()
    ob=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(ob); ob.location=loc; ob.data.materials.append(mat)
    mod=ob.modifiers.new('shield thickness','SOLIDIFY'); mod.thickness=.075
    box(name+' emblem',(.09,.055,.33),(x,y-.06,z+.02),trim,.012)
    box(name+' emblem bar',(.25,.055,.08),(x,y-.065,z+.08),trim,.012)



OWNERS = ('player', 'enemy', 'neutral')
ROOF_COLORS = {'player': (.025, .19, .56), 'enemy': (.48, .045, .06), 'neutral': (.105, .18, .26)}
BASE_COLORS = {
    'stone': (.20, .26, .34), 'edge': (.32, .39, .46), 'dark': (.07, .10, .15),
    'wood': (.23, .14, .09), 'gold': (.58, .35, .10), 'steel': (.42, .50, .59),
}


def mats(owner, make_material):
    """Material set for one owner. make_material is the rig's factory, so the
    kit never imports the scene builder (which must stay importable without bpy)."""
    colors = dict(BASE_COLORS, roof=ROOF_COLORS[owner])
    return {k: make_material('cross_' + k, v, .72, use_gradient=False) for k, v in colors.items()}

def gate(m,x,y,z,width=.6,height=.8):
    box('gate recess',(width,.10,height),(x,y,z),m['dark'])
    for dx in [-width/2-.07,width/2+.07]: box('gate pier',(.14,.2,height+.18),(x+dx,y-.025,z),m['edge'])
    box('gate lintel',(width+.32,.21,.17),(x,y-.03,z+height/2+.04),m['edge'])


def tower(m,x,y,height=2,cap=True):
    cylinder('octagonal bastion',.40,height,(x,y,height/2),m['stone'],8)
    cylinder('footing',.46,.19,(x,y,.16),m['edge'],8)
    cylinder('parapet collar',.47,.20,(x,y,height-.03),m['edge'],8)
    box('arrow slit',(.09,.05,.32),(x,y-.405,height-.45),m['dark'],.015)
    if cap:
        bpy.ops.mesh.primitive_cone_add(vertices=8,radius1=.57,radius2=.045,depth=.76,location=(x,y,height+.45))
        bpy.context.object.data.materials.append(m['roof'])
        cylinder('roof finial',.065,.17,(x,y,height+.91),m['gold'],8)


def citadel(m):
    box('foundation',(2.75,2.35,.22),(0,0,.12),m['dark'])
    box('main keep',(1.75,1.55,1.9),(0,.13,1.12),m['stone'])
    roof('main steep roof',2.02,1.87,2.08,.90,m['roof'],y=.13)
    for x in [-1.03,1.03]:
        for y in [-.80,.85]: tower(m,x,y,2.05 if y<0 else 2.38)
    box('gate wall',(1.65,.35,1.40),(0,-.83,.92),m['stone'])
    gate(m,0,-1.03,.81,.65,1.02)
    for x in [-.64,-.32,0,.32,.64]: box('crenel',(.22,.37,.30),(x,-.83,1.75),m['edge'])
    shield('royal banner',(0,-.704,2.0),.5,m['roof'],m['gold'])
    for x in [-.66,.66]: box('stone course',(.18,.12,.48),(x,-1.02,.59),m['edge'])


def keep(m):
    cylinder('octagonal foundation',1.33,.22,(0,0,.12),m['dark'],8)
    cylinder('octagonal wall',1.15,1.14,(0,0,.72),m['stone'],8)
    cylinder('wall coping',1.24,.19,(0,0,1.35),m['edge'],8)
    for i in range(8):
        a=i*math.tau/8
        box('outer crenel',(.32,.32,.32),(1.06*math.cos(a),1.06*math.sin(a),1.55),m['stone'])
    tower(m,0,.08,2.38,False)
    cylinder('crown band',.50,.18,(0,.08,2.46),m['gold'],8)
    for i in range(5):
        a=i*math.tau/5
        cylinder('crown point',.09,.33,(.38*math.cos(a),.08+.38*math.sin(a),2.65),m['gold'],6)
    gate(m,0,-1.085,.66,.52,.78)
    for x in [-.70,.70]: shield('keep standard',(x,-.99,.99),.42,m['roof'],m['gold'])


def hall(m,stable=False):
    box('foundation',(2.6,1.95,.18),(0,0,.13),m['dark'])
    box('hall body',(2.22,1.5,1.20),(0,.06,.79),m['wood'] if stable else m['stone'])
    roof('slate gable roof',2.55,1.9,1.41,.78,m['roof'])
    box('ridge cap',(.14,1.98,.14),(0,0,2.22),m['edge'])
    if stable:
        for x in [-.67,.3]:
            box('open stall',(.69,.13,.89),(x,-.75,.75),m['dark'])
        for x in [-1.08,-.18,1.08]: box('timber post',(.16,.23,1.17),(x,-.80,.73),m['wood'])
        box('canopy',(2.42,.85,.15),(0,-.99,1.48),m['roof']).rotation_euler.x=.13
        for x in [-1.05,1.05]: box('canopy support',(.13,.13,1.18),(x,-1.28,.74),m['edge'])
        box('feed box',(.55,.35,.28),(.65,-1.10,.36),m['wood'])
        box('hay',(.46,.29,.10),(.65,-1.10,.53),m['gold'])
    else:
        gate(m,0,-.74,.77,.56,.83)
        for x in [-.92,.92]: box('buttress',(.22,.3,1.24),(x,-.72,.8),m['edge'])
        shield('garrison shield',(0,-.976,1.78),.54,m['roof'],m['gold'])
        box('chimney',(.35,.37,.68),(.80,.38,1.92),m['stone'])
    for y in [-.25,.4]: box('side window',(.06,.25,.38),(1.125,y,.99),m['dark'])


def knight(m,leader):
    for x in [-.18,.18]:
        box('boot',(.24,.43,.23),(x,-.06,.15),m['dark'])
        box('leg',(.20,.22,.29),(x,.03,.37),m['steel'])
    cylinder('tunic',.32,.50,(0,0,.70),m['roof'])
    cylinder('belt',.34,.085,(0,0,.57),m['gold'] if leader else m['dark'])
    cylinder('helmet',.30,.42,(0,-.015,1.15),m['steel'])
    box('dark visor',(.43,.08,.095),(0,-.30,1.16),m['dark'],.018)
    box('visor nose',(.06,.10,.28),(0,-.34,1.12),m['steel'],.018)
    for x in [-.34,.34]: cylinder('pauldron',.18,.20,(x,0,.94),m['steel'])
    shield('team shield',(-.36,-.27,.70),.56,m['roof'],m['gold'] if leader else m['edge'])
    box('sword',(.065,.09,.9),(.42,-.14,.96),m['steel'],.018)
    box('crossguard',(.28,.12,.07),(.42,-.14,.60),m['gold'],.018)
    if leader:
        roof('crest',.14,.40,1.35,.25,m['roof'])
        box('cape',(.60,.10,.64),(0,.25,.68),m['roof']).rotation_euler.x=-.25


def outpost(m):
    cylinder('footing',.88,.20,(0,0,.14),m['edge'],8)
    cylinder('watch body',.66,1.95,(0,0,1.10),m['stone'],8)
    cylinder('parapet collar',.78,.22,(0,0,2.14),m['edge'],8)
    gate(m,0,-.66,.64,.40,.64)
    for x in [-.30,.30]: box('arrow slit',(.09,.05,.34),(x,-.61,1.55),m['dark'],.015)
    bpy.ops.mesh.primitive_cone_add(vertices=8,radius1=.88,radius2=.05,depth=.80,location=(0,0,2.66))
    ob = bpy.context.object
    ob.name = 'team roof'
    ob.data.materials.append(m['roof'])
    cylinder('roof finial',.06,.30,(0,0,3.20),m['gold'],8)
