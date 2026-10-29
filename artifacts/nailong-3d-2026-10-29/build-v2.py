"""Editable, continuous-surface Nailong shape study. Run with Blender --background --python.

This is a static shape study, not an approved likeness or animation-ready character.
All output paths stay in the dedicated artifact folder; production pet assets are untouched.
"""
import bpy
import math
import json
import os
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts' / 'nailong-3d-2026-10-29'
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'renders').mkdir(exist_ok=True)
VERSION = os.environ.get('NAILONG_VERSION', 'v2')
if not VERSION or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-_' for c in VERSION):
    raise ValueError('NAILONG_VERSION must be a simple lowercase version label')
if (OUT / f'nailong-shape-{VERSION}.blend').exists():
    raise FileExistsError('Use a new NAILONG_VERSION; existing character studies are preserved')

HEAD = Vector((.075, -.015, 2.66))
HEAD_ROTATION = Matrix.Rotation(math.radians(8), 3, 'Y')
HEAD_RADIUS = (.80, .60, .82)

def head_point(x, y, z):
    return HEAD + HEAD_ROTATION @ Vector((x, y, z))

def head_front(x, z):
    # Same cheek widening as the head sculpt below; all facial surfaces follow it.
    width = HEAD_RADIUS[0] * (1 - .08 * z / HEAD_RADIUS[2])
    return -HEAD_RADIUS[1] * math.sqrt(max(.01, 1 - (x / width) ** 2 - (z / HEAD_RADIUS[2]) ** 2))

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

skin = material('Warm yellow continuous skin', (1.0, .66, .015), .56, .045)
skin.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value = .27
cream = material('Belly warm cream', (1, .91, .49), .48, .05)
black = material('Deep brown glossy eyes', (.0015, .004, .001), .13)
iris = material('Olive green iris', (.12, .34, .025), .4)
rim = material('Warm eyelid rim', (.57, .43, .035), .55)
mouth_dark = material('Mouth interior', (.048, .009, .012), .65)
tongue_mat = material('Tongue', (.34, .074, .08), .5)
tooth = material('Ivory lip edge', (1, .95, .75), .34)
claw = material('Soft brown claws', (.22, .12, .043), .6)
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

head = ellipsoid('head sculpt volume', HEAD, HEAD_RADIUS)
for v in head.data.vertices:
    v.co.x *= 1 - .08 * v.co.z / HEAD_RADIUS[2]
head.rotation_euler = HEAD_ROTATION.to_euler()
torso = ellipsoid('body sculpt volume', (0, .05, 1.27), (.76, .53, 1.01))
for v in torso.data.vertices:
    v.co.x *= 1 - .15 * v.co.z
    v.co.y -= .055 * max(0, 1 - v.co.z * v.co.z)
parts = [torso, head, ellipsoid('neck transition volume', (0, .10, 1.99), (.52, .43, .40))]
for side in (-1, 1):
    parts.append(ellipsoid('leg sculpt volume', (side * .46, .06, .46), (.285, .33, .44)))
    parts.append(ellipsoid('foot sculpt volume', (side * .47, -.05, .225), (.32, .35, .245)))
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
polish.iterations = 26
bpy.ops.object.modifier_apply(modifier=polish.name)
sub = body.modifiers.new('Final surface resolution', 'SUBSURF')
sub.levels = 1
bpy.ops.object.modifier_apply(modifier=sub.name)
for v in body.data.vertices:
    if v.co.z < .12:
        v.co.z = .035 + .085 * max(0, v.co.z / .12) ** 2

# D-shaped smile cut into the face. The boolean's inner walls carry the mouth
# material, so there is no dark sphere or lip disc floating in front of the face.
mouth_top = -.18
mouth_width = .325
mouth_depth = .245
outline = [(mouth_width * math.cos(t * math.pi / 48),
            mouth_top - mouth_depth * math.sin(t * math.pi / 48)) for t in range(49)]
outline += [(-mouth_width + 2 * mouth_width * t / 16,
             mouth_top + .012 * math.sin(t * math.pi / 16)) for t in range(1, 16)]
count = len(outline)
verts = [head_point(x, y, z) for y in (-.95, -.30) for x, z in outline]
faces = [tuple(reversed(range(count))), tuple(range(count, 2 * count))]
faces += [(i, (i + 1) % count, (i + 1) % count + count, i + count) for i in range(count)]
mesh = bpy.data.meshes.new('Smile cavity mesh'); mesh.from_pydata(verts, [], faces); mesh.update()
cutter = bpy.data.objects.new('temporary mouth recess', mesh); bpy.context.collection.objects.link(cutter)
body.data.materials.append(skin); body.data.materials.append(mouth_dark)
cutter.data.materials.append(skin); cutter.data.materials.append(mouth_dark)
for polygon in cutter.data.polygons: polygon.material_index = 1
bpy.context.view_layer.objects.active = body
boolean = body.modifiers.new('Smile cavity', 'BOOLEAN')
boolean.operation = 'DIFFERENCE'
boolean.solver = 'EXACT'
boolean.object = cutter
bpy.ops.object.modifier_apply(modifier=boolean.name)
bpy.data.objects.remove(cutter, do_unlink=True)
smooth(body)

# One material over the connected skin. The belly is a color region, not a separate torso slab.
colors = body.data.color_attributes.new(name='BellyBlend', type='FLOAT_COLOR', domain='POINT')
for v in body.data.vertices:
    x, y, z = v.co
    ellipse = ((x - .08) / .52) ** 2 + ((z - 1.27) / .72) ** 2
    edge = max(0, min(1, (1.02 - ellipse) / .18))
    front = max(0, min(1, (-y - .14) / .16))
    mix = edge * edge * (3 - 2 * edge) * front
    colors.data[v.index].color = (mix, mix, mix, 1)
nodes = skin.node_tree.nodes
attr = nodes.new('ShaderNodeVertexColor'); attr.layer_name = 'BellyBlend'
mixnode = nodes.new('ShaderNodeMixRGB')
mixnode.inputs[1].default_value = (1, .59, .002, 1)
mixnode.inputs[2].default_value = (1, .94, .43, 1)
skin.node_tree.links.new(attr.outputs['Color'], mixnode.inputs[0])
skin.node_tree.links.new(mixnode.outputs['Color'], nodes.get('Principled BSDF').inputs['Base Color'])

obj = ellipsoid('Small tongue inside mouth', head_point(0, -.36, -.382), (.15, .075, .026), tongue_mat)
obj.rotation_euler = HEAD_ROTATION.to_euler()
verts = []
for j in range(49):
    x = -.309 + .618 * j / 48
    z = mouth_top + .008 * (1 - (x / mouth_width) ** 2)
    y = head_front(x, z) + .008
    verts += [head_point(x, y, z), head_point(x, y + .004, z - .025)]
mesh = bpy.data.meshes.new('Curved upper smile edge'); mesh.from_pydata(verts, [], [(j * 2, j * 2 + 1, j * 2 + 3, j * 2 + 2) for j in range(48)]); mesh.update()
obj = bpy.data.objects.new('Ivory edge inside smile', mesh); bpy.context.collection.objects.link(obj); mesh.materials.append(tooth)
smooth(obj)

# Each eye is one shallow curved cap conforming to the head, with material
# regions instead of stacked discs. Its outside rim meets the skin surface.
for side in (-1, 1):
    cx, cz = side * .36, .21
    verts = [head_point(cx, head_front(cx, cz) - .022, cz)]
    radii = [.035, .07, .104, .115, .125, .135, .142]
    n = 96
    for radius in radii:
        for j in range(n):
            angle = 2 * math.pi * j / n
            x, z = cx + radius * math.cos(angle), cz + radius * 1.08 * math.sin(angle)
            y = head_front(x, z) - .003 - .019 * max(0, 1 - (radius / .142) ** 2)
            verts.append(head_point(x, y, z))
    faces = [(0, 1 + j, 1 + (j + 1) % n) for j in range(n)]
    for ring in range(len(radii) - 1):
        a, b = 1 + ring * n, 1 + (ring + 1) * n
        faces += [(a + j, b + j, b + (j + 1) % n, a + (j + 1) % n) for j in range(n)]
    mesh = bpy.data.meshes.new('Conforming eye cap'); mesh.from_pydata(verts, [], faces); mesh.update()
    obj = bpy.data.objects.new('L embedded eye' if side < 0 else 'R embedded eye', mesh); bpy.context.collection.objects.link(obj)
    for mat in (black, iris, rim): mesh.materials.append(mat)
    for polygon in mesh.polygons:
        ring = polygon.index // n
        polygon.material_index = 0 if ring <= 3 else 1 if ring <= 5 else 2
    smooth(obj)
    hx, hz = cx - .035, cz + .055
    obj = ellipsoid('Small eye catchlight', head_point(hx, head_front(hx, hz) - .024, hz), (.017, .006, .021), white, segments=24, rings=16)
    obj.rotation_euler = HEAD_ROTATION.to_euler()

for side in (-1, 1):
    for j in range(3):
        x = side * .46 + (j - 1) * .16
        ellipsoid('Embedded rounded toe claw', (x, -.323 + abs(j - 1) * .018, .095), (.055, .045, .041), claw, segments=24, rings=16)
ellipsoid('Raised palm blush pad', (-.965, -.307, 2.075), (.11, .025, .15), pad)
for j, (x, z) in enumerate([(-1.08, 2.27), (-.96, 2.36), (-.84, 2.32)]):
    ellipsoid('Raised hand claw', (x, -.258, z), (.06, .042, .055), claw, segments=24, rings=16)
for x, z in [(1.045, 1.58), (1.06, 1.43), (.995, 1.30)]:
    ellipsoid('Lowered hand claw', (x, -.248, z), (.055, .04, .052), claw, segments=24, rings=16)

ground_mat = material('White studio floor', (1, 1, 1), .8)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.012))
ground = bpy.context.object; ground.name = 'Studio_floor'; ground.data.materials.append(ground_mat)

def area(name, position, energy, size, color):
    data = bpy.data.lights.new(name, 'AREA'); data.energy = energy; data.shape = 'DISK'; data.size = size; data.color = color
    obj = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(obj); obj.location = position
    obj.rotation_euler = (Vector((0, 0, 1.8)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
area('Large softbox key', (-3.5, -4.5, 7), 420, 4.0, (1, .97, .9))
area('Soft frontal fill', (4, -2.5, 4), 190, 3, (.92, .96, 1))
area('Soft upper rim', (1, 3, 5.5), 260, 3, (1, .97, .9))
world = bpy.data.worlds.new('Soft studio world'); bpy.context.scene.world = world
world.use_nodes = True; world.node_tree.nodes.get('Background').inputs[0].default_value = (1, 1, 1, 1)
world.node_tree.nodes.get('Background').inputs[1].default_value = .7

def camera(name, location, scale=4.4):
    data = bpy.data.cameras.new(name); obj = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(obj)
    obj.location = location; obj.rotation_euler = (Vector((0, 0, 1.78)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    data.type = 'ORTHO'; data.ortho_scale = scale; data.lens = 65
    return obj
cams = {
    'front': camera('Camera_Front', (0, -10, 2.3)),
    'reference-angle': camera('Camera_ReferenceAngle', (1.0, -10, 2.6)),
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
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = -.35
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
