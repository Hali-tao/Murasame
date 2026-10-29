"""Reference-led static sculpt, authored as a native Blender scene.

Use a fresh background process and a new NAILONG_VERSION for each attempt.
The 2026-10-29 v3 study was rejected for likeness; it is kept unchanged.
This script does not modify production assets or create a rig.
"""
import bpy
import bmesh
import hashlib
import json
import math
import os
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts' / 'nailong-3d-refined-2026-10-29'
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'renders').mkdir(exist_ok=True)
VERSION = os.environ.get('NAILONG_VERSION', 'r1')
if not VERSION or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-_' for c in VERSION):
    raise ValueError('Use a simple lowercase version label')
BLEND = OUT / f'nailong-reference-{VERSION}.blend'
if BLEND.exists():
    raise FileExistsError(f'Preserved existing study: {BLEND}')

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name, color, roughness=.5, specular=.25, subsurface=0):
    mat = bpy.data.materials.new(name); mat.use_nodes = True
    mat.diffuse_color = (*color, 1)
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    for key, value in {'Base Color': (*color, 1), 'Roughness': roughness,
                       'Specular IOR Level': specular, 'Subsurface Weight': subsurface}.items():
        bsdf.inputs[key].default_value = value
    return mat

skin = material('Warm soft yellow skin', (1, .64, .01), .57, .22, .055)
skin.node_tree.nodes.get('Principled BSDF').inputs['Subsurface Scale'].default_value = .09
mouth_mat = material('Dark warm mouth interior', (.022, .0025, .0035), .8, .08)
tongue_mat = material('Subtle tongue', (.31, .045, .047), .65, .12)
ivory = material('Warm ivory smile edge', (1, .95, .75), .5, .2)
black = material('Deep black pupil', (.0007, .0018, .0005), .18, .055)
iris = material('Fine green iris', (.08, .25, .015), .32, .18)
eyelid = material('Fine warm eyelid boundary', (.39, .28, .028), .65, .1)
claw = material('Small warm brown claws', (.23, .115, .045), .62, .15)
catchlight = material('Small eye highlight', (1, 1, .95), .3, .2)

def smooth(obj):
    for p in obj.data.polygons: p.use_smooth = True

def mesh_object(name, verts, faces, mat=None):
    mesh = bpy.data.meshes.new(name + ' mesh'); mesh.from_pydata(verts, [], faces); mesh.update()
    # Explicit consistent normals make the authored lofts closed volumes.
    bm = bmesh.new(); bm.from_mesh(mesh); bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(mesh); bm.free()
    obj = bpy.data.objects.new(name, mesh); bpy.context.collection.objects.link(obj)
    if mat: mesh.materials.append(mat)
    smooth(obj)
    return obj

def sphere(name, pos, scale, mat=None, rotation=None, segments=48, rings=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=pos)
    obj = bpy.context.object; obj.name = name; obj.scale = scale
    if rotation is not None: obj.rotation_euler = rotation
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat: obj.data.materials.append(mat)
    smooth(obj)
    return obj

def segment(name, a, b, rx, ry):
    a, b = Vector(a), Vector(b)
    return sphere(name, (a + b) / 2, (rx, ry, (b - a).length / 2 + .7 * rx),
                  rotation=(b - a).to_track_quat('Z', 'Y').to_euler())

def interpolate(profile, z, column):
    """Monotone cubic interpolation avoids ridges between measured cross-sections."""
    zs, values = [p[0] for p in profile], [p[column] for p in profile]
    if z <= zs[0]: return values[0]
    if z >= zs[-1]: return values[-1]
    slopes = [(values[i + 1] - values[i]) / (zs[i + 1] - zs[i]) for i in range(len(zs) - 1)]
    tangents = [slopes[0]]
    for i in range(1, len(zs) - 1):
        left, right = slopes[i - 1], slopes[i]
        tangents.append(0 if left * right <= 0 else 2 * left * right / (left + right))
    tangents.append(slopes[-1])
    i = next(i for i in range(len(zs) - 1) if zs[i] <= z <= zs[i + 1])
    h = zs[i + 1] - zs[i]; t = (z - zs[i]) / h
    return ((2*t**3 - 3*t*t + 1) * values[i] + (t**3 - 2*t*t + t) * h * tangents[i]
            + (-2*t**3 + 3*t*t) * values[i + 1] + (t**3 - t*t) * h * tangents[i + 1])

# Each row is height, half-width, front depth, back depth. These define a
# cheek/jaw and pear-shaped abdomen instead of using two scaled spheres.
HEAD_PROFILE = [
    (1.86, .012, -.27, -.24), (1.90, .27, -.48, .07),
    (1.98, .49, -.64, .28), (2.12, .67, -.76, .43),
    (2.29, .755, -.83, .50), (2.48, .79, -.85, .53),
    (2.69, .795, -.83, .54), (2.90, .78, -.79, .53),
    (3.09, .73, -.73, .48), (3.25, .63, -.63, .38),
    (3.37, .48, -.49, .25), (3.44, .31, -.35, .13),
    (3.485, .12, -.20, .035), (3.495, .004, -.085, -.08),
]
TORSO_PROFILE = [
    (.28, .015, -.01, .02), (.34, .43, -.32, .22),
    (.48, .67, -.50, .33), (.70, .76, -.62, .40),
    (.96, .79, -.68, .45), (1.22, .77, -.65, .47),
    (1.47, .72, -.55, .47), (1.70, .63, -.43, .46),
    (1.91, .54, -.34, .43), (2.09, .39, -.28, .35),
    (2.20, .16, -.12, .23), (2.23, .008, .04, .07),
]
HEAD_CENTER = Vector((.07, -.03, 2.66))
HEAD_ROT = Matrix.Rotation(math.radians(7), 3, 'Y')

def head_point(x, y, z):
    return HEAD_CENTER + HEAD_ROT @ Vector((x, y, z - 2.66))

def loft(name, profile, transform=None, power=.88, steps=128, slices=96, cx=0):
    verts = []; faces = []
    low, high = profile[0][0], profile[-1][0]
    for row in range(steps + 1):
        z = low + (high - low) * row / steps
        rx = max(.001, interpolate(profile, z, 1))
        front, back = interpolate(profile, z, 2), interpolate(profile, z, 3)
        middle = (front + back) / 2
        for j in range(slices):
            angle = 2 * math.pi * j / slices
            s, c = math.sin(angle), math.cos(angle)
            x = cx + rx * math.copysign(abs(s) ** power, s)
            y = middle - (middle - front) * math.copysign(abs(c) ** power, c)
            p = (x, y, z)
            verts.append(transform(*p) if transform else p)
    for row in range(steps):
        for j in range(slices):
            a = row * slices + j; b = row * slices + (j + 1) % slices
            faces.append((a, b, b + slices, a + slices))
    faces += [tuple(reversed(range(slices))), tuple(steps * slices + j for j in range(slices))]
    return mesh_object(name, verts, faces)

parts = [loft('Cheek and jaw sculpt', HEAD_PROFILE, head_point), loft('Pear abdomen sculpt', TORSO_PROFILE, power=1)]
parts.append(sphere('Hidden neck transition', (0, .10, 2.04), (.45, .36, .40)))
for side in (-1, 1):
    foot_profile = [(.025, .25, -.30, .18), (.05, .285, -.35, .20),
                    (.13, .30, -.38, .22), (.28, .28, -.36, .24),
                    (.48, .25, -.29, .25), (.68, .19, -.18, .22), (.78, .015, .02, .07)]
    parts.append(loft('Short grounded leg', foot_profile, power=.9, steps=64, slices=64, cx=side * .47))

PALM_CENTER = Vector((-.91, -.23, 1.83))
PALM_ROT = Matrix.Rotation(math.radians(-20), 3, 'Y')
parts.extend([
    segment('Raised upper arm transition', (-.53, .045, 1.84), (-.74, -.04, 1.66), .22, .22),
    sphere('Raised cupped palm', PALM_CENTER, (.215, .19, .285), rotation=PALM_ROT.to_euler()),
    segment('Lowered upper arm transition', (.55, .04, 1.78), (.78, -.015, 1.42), .195, .195),
    sphere('Lowered palm', (.91, -.085, 1.34), (.19, .18, .25), rotation=(0, -.23, 0)),
])
for i in range(18):
    t = i / 17; radius = .25 * (1 - t) + .045 * t
    parts.append(sphere('Rear attached curved tail', (-.48*t*t, .29+.90*t, .49+.39*t*t),
                        (radius, radius*1.45, radius), segments=24, rings=16))

bpy.ops.object.select_all(action='DESELECT')
for obj in parts: obj.select_set(True)
bpy.context.view_layer.objects.active = parts[1]
bpy.ops.object.join(); body = bpy.context.object; body.name = 'Nailong_ContinuousSkin'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
remesh = body.modifiers.new('Unified sculpt surface', 'REMESH'); remesh.mode = 'VOXEL'; remesh.voxel_size = .017; remesh.use_smooth_shade = True
bpy.ops.object.modifier_apply(modifier=remesh.name)
polish = body.modifiers.new('Shoulder hip and jaw transition polish', 'SMOOTH'); polish.factor = .9; polish.iterations = 20
bpy.ops.object.modifier_apply(modifier=polish.name)
sub = body.modifiers.new('Smooth sculpt resolution', 'SUBSURF'); sub.levels = 1
bpy.ops.object.modifier_apply(modifier=sub.name)
# Voxel smoothing can collapse a tiny enclosed contact pocket to zero-area
# geometry. Weld only sub-voxel numerical residue, then remove isolated points;
# do not discard disconnected limbs to make the connectivity assertion pass.
bm = bmesh.new(); bm.from_mesh(body.data)
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=.00001)
loose = [v for v in bm.verts if not v.link_faces]
if loose: bmesh.ops.delete(bm, geom=loose, context='VERTS')
bm.to_mesh(body.data); bm.free(); body.data.update()
for v in body.data.vertices:
    if v.co.z < .08: v.co.z = .012 + .068 * max(0, v.co.z/.08) ** 2
body.data.materials.append(skin); body.data.materials.append(mouth_mat)

def face_surface(x, z, offset=0):
    hit, p, normal, _ = body.ray_cast(head_point(x, -3, z), HEAD_ROT @ Vector((0, 1, 0)))
    if not hit: raise ValueError(f'No facial surface at {x}, {z}')
    return p + normal * offset

# Mouth is a cavity in the unified head. No external black mouth sphere.
mouth_z, width, depth = 2.53, .31, .22
outline = [(width*math.cos(t*math.pi/64), mouth_z-depth*math.sin(t*math.pi/64)) for t in range(65)]
outline += [(-width+2*width*t/32, mouth_z+.009*math.sin(t*math.pi/32)) for t in range(1, 32)]
count = len(outline)
verts = [head_point(x, y, z) for y in (-1.2, -.53) for x, z in outline]
faces = [tuple(reversed(range(count))), tuple(range(count, 2*count))]
faces += [(i, (i+1)%count, (i+1)%count+count, i+count) for i in range(count)]
cutter = mesh_object('Temporary smile cutter', verts, faces)
cutter.data.materials.append(skin); cutter.data.materials.append(mouth_mat)
for p in cutter.data.polygons: p.material_index = 1
# Cache the intact upper-lip boundary before cutting its opening.
lip_points = []
for j in range(65):
    x = -.302+.604*j/64
    lip_points.append(face_surface(x, mouth_z+.015, .002))
bpy.context.view_layer.objects.active = body
mod = body.modifiers.new('Inset smile', 'BOOLEAN'); mod.operation = 'DIFFERENCE'; mod.solver = 'EXACT'; mod.object = cutter
bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.data.objects.remove(cutter, do_unlink=True)
verts = []
for j, p in enumerate(lip_points):
    taper = max(0, math.sin(math.pi*j/64)) ** .25
    top = p + HEAD_ROT @ Vector((0, .005, -.013))
    verts += [top, top + HEAD_ROT @ Vector((0, .007, -.025*taper))]
mesh_object('Tapered ivory smile edge', verts, [(2*j, 2*j+1, 2*j+3, 2*j+2) for j in range(64)], ivory)
obj = sphere('Subtle tongue inside cavity', head_point(0, -.59, 2.345), (.135, .065, .023), tongue_mat)
obj.rotation_euler = HEAD_ROT.to_euler()

# Paint both abdomen and palm onto the same skin instead of adding flat patches.
colors = body.data.color_attributes.new(name='SkinColor', type='FLOAT_COLOR', domain='POINT')
def smoothstep(v):
    t = max(0, min(1, v)); return t*t*(3-2*t)
for v in body.data.vertices:
    x, y, z = v.co
    head_mix = smoothstep((z - 1.65) / 1.45)
    color = [1.0, .47 + .29 * head_mix, .006 + .01 * head_mix]
    belly = ((x-.055)/.575)**2 + ((z-1.17)/.675)**2
    mix = smoothstep((1.035-belly)/.16) * smoothstep((-y-.18)/.17)
    cream = (1, .94, .42)
    color = [a*(1-mix)+b*mix for a, b in zip(color, cream)]
    local = PALM_ROT.inverted() @ (v.co-PALM_CENTER)
    palm = ((local.x-.005)/.10)**2 + ((local.z+.045)/.125)**2
    mix = smoothstep((1.02-palm)/.18) * smoothstep((-local.y-.11)/.04)
    color = [a*(1-mix)+b*mix for a, b in zip(color, (1, .35, .22))]
    colors.data[v.index].color = (*color, 1)
nodes = skin.node_tree.nodes; attr = nodes.new('ShaderNodeVertexColor'); attr.layer_name = 'SkinColor'
skin.node_tree.links.new(attr.outputs['Color'], nodes.get('Principled BSDF').inputs['Base Color'])

# Small iris openings conform to the actual sculpt, including its cheek profile.
for side in (-1, 1):
    cx, cz = side*.36, 2.90
    radii = [.03, .06, .087, .096, .105, .115, .124, .13]
    n = 128; verts = [face_surface(cx, cz, .017)]
    vertex_colors = [(0.04, .2, .01, 1)]
    for radius in radii:
        for j in range(n):
            angle = 2*math.pi*j/n
            x, z = cx+radius*math.cos(angle), cz+radius*1.06*math.sin(angle)
            verts.append(face_surface(x, z, .001+.016*(1-(radius/.13)**2)))
            shade = .8+.12*math.sin(43*angle)+.08*math.sin(79*angle+radius*130)
            vertex_colors.append((.085*shade, .30*shade, .018*shade, 1))
    faces = [(0, 1+j, 1+(j+1)%n) for j in range(n)]
    for ring in range(len(radii)-1):
        a, b = 1+ring*n, 1+(ring+1)*n
        faces += [(a+j, b+j, b+(j+1)%n, a+(j+1)%n) for j in range(n)]
    eye = mesh_object('L conforming eye' if side<0 else 'R conforming eye', verts, faces)
    for mat in (black, iris, eyelid): eye.data.materials.append(mat)
    attr = eye.data.color_attributes.new(name='IrisShade', type='FLOAT_COLOR', domain='POINT')
    for i, color in enumerate(vertex_colors): attr.data[i].color = color
    for p in eye.data.polygons:
        ring = p.index//n; p.material_index = 0 if ring<=3 else 1 if ring<=6 else 2
    point = face_surface(cx-.031, cz+.047, .020)
    obj = sphere('Tiny eye catchlight', point, (.014, .006, .017), catchlight, rotation=HEAD_ROT.to_euler(), segments=24, rings=16)
nodes = iris.node_tree.nodes; attr = nodes.new('ShaderNodeVertexColor'); attr.layer_name = 'IrisShade'
iris.node_tree.links.new(attr.outputs['Color'], nodes.get('Principled BSDF').inputs['Base Color'])

def embedded_claw(name, x, z, sx=.045, sz=.048):
    hit, p, normal, _ = body.ray_cast(Vector((x, -3, z)), Vector((0, 1, 0)))
    if not hit: raise ValueError(f'Claw not attached to skin: {x}, {z}')
    obj = sphere(name, p+normal*.003, (sx, .038, sz), claw, segments=32, rings=24)
    for v in obj.data.vertices:
        v.co.x *= .88-.28*v.co.z/sz
    return obj

for side in (-1, 1):
    for x in (-.18, -.015, .15): embedded_claw('Small embedded toe', side*.47+x, .075, .046, .039)
for local in [(-.105, 0, .16), (0, 0, .23), (.105, 0, .19)]:
    p = PALM_CENTER+PALM_ROT@Vector(local)
    embedded_claw('Short raised palm claw', p.x, p.z, .042, .050)
for x, z in [(1.015, 1.44), (1.025, 1.32), (.99, 1.205)]: embedded_claw('Small lowered palm claw', x, z, .042, .045)
for i, (z, radius) in enumerate([(3.22, .066), (3.02, .083), (2.81, .068)]):
    back = interpolate(HEAD_PROFILE, z, 3)
    sphere(f'Rear head detail {i+1}', head_point(0, back+.018, z), (radius, radius*1.3, radius), claw,
           rotation=HEAD_ROT.to_euler(), segments=40, rings=24)

ground_mat = material('White studio ground', (1, 1, 1), .8, .1)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
ground = bpy.context.object; ground.name = 'Studio_floor'; ground.data.materials.append(ground_mat); ground.is_shadow_catcher = True
def area(name, pos, energy, size, color):
    data = bpy.data.lights.new(name, 'AREA'); data.energy = energy; data.shape = 'DISK'; data.size = size; data.color = color
    obj = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(obj); obj.location = pos
    obj.rotation_euler = (Vector((0, 0, 1.7))-obj.location).to_track_quat('-Z', 'Y').to_euler()
area('Large warm key', (-3, -4.5, 6.5), 330, 4, (1, .97, .88))
area('Gentle frontal fill', (3.5, -4, 3.7), 95, 3.5, (.95, .97, 1))
area('Broad upper bounce', (1, 2, 5.5), 160, 3.5, (1, .98, .90))
scene = bpy.context.scene
world = bpy.data.worlds.new('Soft neutral studio'); scene.world = world; world.use_nodes = True
world.node_tree.nodes.get('Background').inputs[0].default_value = (1, 1, 1, 1)
world.node_tree.nodes.get('Background').inputs[1].default_value = .32
def camera(name, pos, scale=4.15):
    data = bpy.data.cameras.new(name); obj = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(obj); obj.location = pos
    obj.rotation_euler = (Vector((0, 0, 1.76))-obj.location).to_track_quat('-Z', 'Y').to_euler()
    data.type = 'ORTHO'; data.ortho_scale = scale
    return obj
cams = {
    'front': camera('Camera_Front', (0, -10, 1.76)),
    'reference-angle': camera('Camera_ReferenceAngle', (-1.6, -10, 2.55)),
    'side': camera('Camera_Side', (10, 0, 1.76)),
    'back': camera('Camera_Back', (0, 10, 1.76)),
}
scene.render.engine = 'CYCLES'; scene.cycles.samples = 64; scene.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences; prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
    for device in prefs.devices: device.use = device.type == 'OPTIX'
    if any(d.type == 'OPTIX' for d in prefs.devices): scene.cycles.device = 'GPU'
except Exception as error: print('GPU fallback', str(error))
scene.render.resolution_x = 1000; scene.render.resolution_y = 1100; scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGBA'; scene.render.film_transparent = True
scene.view_settings.view_transform = 'Standard'; scene.view_settings.look = 'None'; scene.view_settings.exposure = 0
# White presentation background is part of the native render/compositor.
scene.use_nodes = True; nodes = scene.node_tree.nodes; nodes.clear()
layers = nodes.new('CompositorNodeRLayers'); over = nodes.new('CompositorNodeAlphaOver'); composite = nodes.new('CompositorNodeComposite')
over.inputs[1].default_value = (1, 1, 1, 1); scene.node_tree.links.new(layers.outputs['Image'], over.inputs[2]); scene.node_tree.links.new(over.outputs['Image'], composite.inputs['Image'])
scene.camera = cams['reference-angle']; scene['authoring_version'] = VERSION
scene['stage'] = 'Reference-led static sculpt; likeness pending; no rig or runtime integration'
body['reference'] = 'Original user photo; source-preserved official fullbody and third-party multiview sheets from nailong-3d-2026-10-29'
smooth(body)
bm = bmesh.new(); bm.from_mesh(body.data)
non_manifold = sum(not e.is_manifold for e in bm.edges); volume = bm.calc_volume(signed=True); bm.free()
adjacency = [[] for _ in body.data.vertices]
for e in body.data.edges:
    a, b = e.vertices; adjacency[a].append(b); adjacency[b].append(a)
seen = {0}; queue = [0]
while queue:
    for other in adjacency[queue.pop()]:
        if other not in seen: seen.add(other); queue.append(other)
if len(seen) != len(body.data.vertices):
    remaining = set(range(len(body.data.vertices))) - seen
    islands = []
    while remaining:
        group = {remaining.pop()}; frontier = list(group)
        while frontier:
            for neighbor in adjacency[frontier.pop()]:
                if neighbor in remaining:
                    remaining.remove(neighbor); group.add(neighbor); frontier.append(neighbor)
        islands.append({'vertices': len(group), 'bounds': [(min(body.data.vertices[i].co[a] for i in group), max(body.data.vertices[i].co[a] for i in group)) for a in range(3)]})
    print('DISCONNECTED_SCULPT_COMPONENTS', json.dumps({'first': len(seen), 'other': islands}))
assert len(seen) == len(body.data.vertices), 'Disconnected skin'
assert non_manifold == 0 and volume > 0, (non_manifold, volume)
assert all(math.isfinite(c) for v in body.data.vertices for c in v.co)
report = {'version': VERSION, 'blender': bpy.app.version_string, 'body_vertices': len(seen),
          'body_faces': len(body.data.polygons), 'non_manifold_edges': non_manifold, 'signed_volume': volume,
          'connected_components': 1, 'finite_coordinates': True, 'armatures': len(bpy.data.armatures),
          'actions': len(bpy.data.actions), 'camera_count': len(cams), 'stage': scene['stage'],
          'builder_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
for name, cam in cams.items():
    scene.camera = cam; scene.render.filepath = str(OUT/'renders'/f'{VERSION}-{name}.png')
    bpy.ops.render.render(write_still=True)
report['blend_sha256'] = hashlib.sha256(BLEND.read_bytes()).hexdigest()
report['renders'] = [f'renders/{VERSION}-{name}.png' for name in cams]
(OUT/f'scene-report-{VERSION}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print('NAILONG_REFERENCE_SCULPT', json.dumps(report, ensure_ascii=False))
