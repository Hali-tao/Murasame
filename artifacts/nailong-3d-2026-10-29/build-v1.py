"""Editable, continuous-surface Nailong shape study. Run with Blender --background --python.

This is a static shape study, not an approved likeness or animation-ready character.
All output paths stay in the dedicated artifact folder; production pet assets are untouched.
"""
import bpy
import math
import json
import os
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts' / 'nailong-3d-2026-10-29'
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'renders').mkdir(exist_ok=True)
VERSION = os.environ.get('NAILONG_VERSION', 'v1')

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for collection in list(bpy.data.collections):
    if collection.name != 'Collection' and collection.users == 0:
        bpy.data.collections.remove(collection)

def material(name, color, roughness=.4, subsurface=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Subsurface Weight'].default_value = subsurface
    return mat

skin = material('Warm yellow continuous skin', (1.0, .66, .015), .38, .06)
cream = material('Belly warm cream', (1, .91, .49), .48, .05)
black = material('Deep brown glossy eyes', (.006, .012, .003), .18)
iris = material('Olive green iris', (.18, .38, .035), .33)
rim = material('Warm eyelid rim', (.48, .36, .045), .55)
mouth_dark = material('Mouth interior', (.048, .009, .012), .65)
tongue_mat = material('Tongue', (.34, .074, .08), .5)
tooth = material('Ivory lip edge', (1, .95, .75), .34)
claw = material('Soft brown claws', (.29, .17, .058), .5)
pad = material('Pink palm pad', (1.0, .39, .2), .65, .08)
white = material('Eye catchlight', (1, 1, .91), .17)

def smooth(obj):
    for polygon in obj.data.polygons:
        polygon.use_smooth = True

def ellipsoid(name, location, scale, mat=None, rotation=None, segments=48, rings=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    if rotation:
        obj.rotation_euler = rotation
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    smooth(obj)
    if mat:
        obj.data.materials.append(mat)
    return obj

def between(name, a, b, radius_x, radius_y):
    start, end = Vector(a), Vector(b)
    obj = ellipsoid(name, (start + end) / 2, (radius_x, radius_y, (end - start).length / 2 + radius_x * .7))
    obj.rotation_euler = (end - start).to_track_quat('Z', 'Y').to_euler()
    return obj

parts = [
    ellipsoid('body sculpt volume', (0, .055, 1.38), (.70, .49, 1.03)),
    ellipsoid('head sculpt volume', (0, -.015, 2.66), (.83, .565, .88)),
    ellipsoid('neck transition volume', (0, .075, 2.02), (.55, .43, .48)),
]
for side in (-1, 1):
    parts.append(ellipsoid('leg sculpt volume', (side * .43, .06, .60), (.26, .32, .53)))
    parts.append(ellipsoid('foot sculpt volume', (side * .46, -.09, .245), (.31, .405, .25)))
parts.extend([
    between('raised arm transition', (-.53, .035, 1.78), (-.84, -.005, 2.02), .235, .225),
    ellipsoid('raised palm volume', (-.93, -.12, 2.13), (.235, .205, .34), rotation=(0, -.3, -.15)),
    between('lowered arm transition', (.55, .04, 1.91), (.83, -.005, 1.56), .205, .2),
    ellipsoid('lowered palm volume', (.94, -.085, 1.48), (.205, .19, .285), rotation=(0, -.28, .05)),
])
# Tail volumes are fused into the same skin as the torso.
for i in range(9):
    t = i / 8
    x = -.38 - .7 * t
    y = .30 + .05 * t
    z = .58 + .22 * t + .16 * t * t
    r = .24 * (1 - t) + .075 * t
    parts.append(ellipsoid('tail sculpt volume', (x, y, z), (r * 1.4, r, r), segments=24, rings=16))

bpy.ops.object.select_all(action='DESELECT')
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
body = bpy.context.object
body.name = 'Nailong_ContinuousSkin'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
remesh = body.modifiers.new('Fuse sculpt volumes into continuous skin', 'REMESH')
remesh.mode = 'VOXEL'
remesh.voxel_size = .022
remesh.use_smooth_shade = True
bpy.ops.object.modifier_apply(modifier=remesh.name)
polish = body.modifiers.new('Polish shoulder hip and neck transitions', 'SMOOTH')
polish.factor = 1.2
polish.iterations = 18
bpy.ops.object.modifier_apply(modifier=polish.name)
sub = body.modifiers.new('Final surface resolution', 'SUBSURF')
sub.levels = 1
bpy.ops.object.modifier_apply(modifier=sub.name)

# Real mouth recess, cut into the head rather than painted on a flat disc.
cutter = ellipsoid('temporary mouth recess', (0, -.515, 2.25), (.35, .23, .155))
bpy.context.view_layer.objects.active = body
boolean = body.modifiers.new('Smile cavity', 'BOOLEAN')
boolean.operation = 'DIFFERENCE'
boolean.solver = 'EXACT'
boolean.object = cutter
bpy.ops.object.modifier_apply(modifier=boolean.name)
bpy.data.objects.remove(cutter, do_unlink=True)
smooth(body)

# One material over the connected skin. The belly is a color region, not a separate torso slab.
body.data.materials.clear()
body.data.materials.append(skin)
colors = body.data.color_attributes.new(name='BellyBlend', type='FLOAT_COLOR', domain='POINT')
for v in body.data.vertices:
    x, y, z = v.co
    ellipse = (x / .50) ** 2 + ((z - 1.35) / .77) ** 2
    edge = max(0, min(1, (1.02 - ellipse) / .18))
    front = max(0, min(1, (-y - .14) / .16))
    mix = edge * edge * (3 - 2 * edge) * front
    colors.data[v.index].color = (mix, mix, mix, 1)
nodes = skin.node_tree.nodes
attr = nodes.new('ShaderNodeVertexColor'); attr.layer_name = 'BellyBlend'
mixnode = nodes.new('ShaderNodeMixRGB')
mixnode.inputs[1].default_value = (1, .63, .006, 1)
mixnode.inputs[2].default_value = (1, .93, .49, 1)
skin.node_tree.links.new(attr.outputs['Color'], mixnode.inputs[0])
skin.node_tree.links.new(mixnode.outputs['Color'], nodes.get('Principled BSDF').inputs['Base Color'])

ellipsoid('Recessed mouth lining', (0, -.388, 2.25), (.325, .12, .137), mouth_dark)
ellipsoid('Small tongue in recess', (0, -.476, 2.17), (.19, .055, .038), tongue_mat)
ellipsoid('Upper ivory smile edge', (0, -.567, 2.343), (.318, .024, .017), tooth)

# The face lies on the curved head surface. Eye layers are embedded into it.
for side in (-1, 1):
    x, z = side * .355, 2.77
    y = -.015 - .565 * math.sqrt(max(.1, 1 - (x / .83) ** 2 - ((z - 2.66) / .88) ** 2))
    ellipsoid('L eyelid' if side < 0 else 'R eyelid', (x, y - .016, z), (.156, .049, .166), rim)
    ellipsoid('Olive iris ring', (x, y - .05, z), (.139, .051, .149), iris)
    ellipsoid('Glossy black pupil', (x, y - .085, z), (.109, .054, .125), black)
    ellipsoid('Main eye catchlight', (x - .035, y - .137, z + .051), (.031, .012, .035), white, segments=24, rings=16)
    ellipsoid('Small eye catchlight', (x + .038, y - .137, z - .048), (.012, .007, .014), white, segments=16, rings=12)

for side in (-1, 1):
    for j in range(3):
        x = side * .46 + (j - 1) * .16
        ellipsoid('Embedded rounded toe claw', (x, -.438 + abs(j - 1) * .018, .135), (.062, .068, .063), claw, segments=24, rings=16)
ellipsoid('Raised palm blush pad', (-.965, -.307, 2.075), (.11, .025, .15), pad)
for j, (x, z) in enumerate([(-1.08, 2.27), (-.96, 2.36), (-.84, 2.32)]):
    ellipsoid('Raised hand claw', (x, -.258, z), (.06, .042, .055), claw, segments=24, rings=16)
for x, z in [(1.045, 1.58), (1.06, 1.43), (.995, 1.30)]:
    ellipsoid('Lowered hand claw', (x, -.248, z), (.055, .04, .052), claw, segments=24, rings=16)

ground_mat = material('Warm studio floor', (.88, .865, .83), .8)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.012))
ground = bpy.context.object; ground.name = 'Studio_floor'; ground.data.materials.append(ground_mat)

def area(name, position, energy, size, color):
    data = bpy.data.lights.new(name, 'AREA'); data.energy = energy; data.shape = 'DISK'; data.size = size; data.color = color
    obj = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(obj); obj.location = position
    obj.rotation_euler = (Vector((0, 0, 1.8)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
area('Large softbox key', (-3.5, -4.5, 7), 650, 4.0, (1, .91, .76))
area('Soft frontal fill', (4, -2.5, 4), 320, 3, (.82, .9, 1))
area('Soft upper rim', (1, 3, 5.5), 450, 3, (1, .92, .73))
world = bpy.data.worlds.new('Soft studio world'); bpy.context.scene.world = world
world.use_nodes = True; world.node_tree.nodes.get('Background').inputs[0].default_value = (.78, .82, .9, 1)
world.node_tree.nodes.get('Background').inputs[1].default_value = .35

def camera(name, location, scale=4.4):
    data = bpy.data.cameras.new(name); obj = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(obj)
    obj.location = location; obj.rotation_euler = (Vector((0, 0, 1.78)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    data.type = 'ORTHO'; data.ortho_scale = scale; data.lens = 65
    return obj
cams = {
    'front': camera('Camera_Front', (0, -10, 3.05)),
    'reference-angle': camera('Camera_ReferenceAngle', (2.5, -10, 3.45)),
    'side': camera('Camera_Side', (10, -1.5, 3.05)),
}
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
    for device in prefs.devices: device.use = device.type == 'OPTIX'
    if any(device.type == 'OPTIX' for device in prefs.devices): scene.cycles.device = 'GPU'
except Exception as exc:
    print('GPU selection fallback:', str(exc))
scene.render.resolution_x = 1000; scene.render.resolution_y = 1100; scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.camera = cams['reference-angle']
body['stage'] = 'Static shape study; appearance not yet approved; no rig or animations'
body['reference'] = 'User-provided 2026-10 reference photo; unseen sides are new design'
scene['authoring_version'] = VERSION

# Actual mesh connectivity, not a visual quality score.
adjacency = [set() for _ in body.data.vertices]
for edge in body.data.edges:
    a, b = edge.vertices; adjacency[a].add(b); adjacency[b].add(a)
unseen = set(range(len(adjacency))); components = []
while unseen:
    frontier = [unseen.pop()]; count = 0
    while frontier:
        current = frontier.pop(); count += 1
        neighbors = adjacency[current] & unseen
        unseen.difference_update(neighbors); frontier.extend(neighbors)
    components.append(count)
report = {
    'blender_version': bpy.app.version_string, 'stage': 'static shape study, not user-approved',
    'body_vertices': len(body.data.vertices), 'body_faces': len(body.data.polygons),
    'body_connected_components': sorted(components, reverse=True),
    'finite_coordinates': all(math.isfinite(value) for v in body.data.vertices for value in v.co),
    'armatures': len(bpy.data.armatures), 'actions': len(bpy.data.actions),
    'objects': [{'name': obj.name, 'type': obj.type} for obj in scene.objects],
    'renderer': scene.render.engine, 'device': scene.cycles.device,
}
assert report['finite_coordinates'] and len(components) == 1, report
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / f'nailong-shape-{VERSION}.blend'))
for name, cam in cams.items():
    scene.camera = cam
    scene.render.filepath = str(OUT / 'renders' / f'{VERSION}-{name}.png')
    bpy.ops.render.render(write_still=True)
report['renders'] = [f'renders/{VERSION}-{name}.png' for name in cams]
(OUT / f'scene-report-{VERSION}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('NAILONG_REPORT', json.dumps({key: value for key, value in report.items() if key != 'objects'}, ensure_ascii=False))
