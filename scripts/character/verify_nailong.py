"""Reopen a saved native study and verify geometry, evidence and one real render.

Run in a separate factory-startup Blender process after build_nailong.py.
These checks prove artifact integrity, not character likeness or animation quality.
"""
import bpy
import bmesh
import hashlib
import json
import math
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts' / 'nailong-3d-2026-10-29'
VERSION = os.environ.get('NAILONG_VERSION', 'v3')
if not VERSION or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-_' for c in VERSION):
    raise ValueError('Invalid version label')
path = OUT / f'nailong-shape-{VERSION}.blend'
bpy.ops.wm.open_mainfile(filepath=str(path))
scene = bpy.context.scene
body = bpy.data.objects['Nailong_ContinuousSkin']
assert body.type == 'MESH'
assert scene.get('authoring_version') == VERSION
assert all(math.isfinite(c) for v in body.data.vertices for c in v.co)
assert len(bpy.data.armatures) == 0 and len(bpy.data.actions) == 0
assert {c.name for c in bpy.data.cameras} == {'Camera_Front', 'Camera_ReferenceAngle', 'Camera_Side'}
assert body.data.color_attributes.get('BellyBlend') is not None

bm = bmesh.new(); bm.from_mesh(body.data)
non_manifold = sum(not edge.is_manifold for edge in bm.edges)
volume = bm.calc_volume(signed=True)
bm.free()
assert non_manifold == 0, f'{non_manifold} non-manifold body edges'
assert volume > 0, f'Body volume must be positive: {volume}'

adjacency = [[] for _ in body.data.vertices]
for e in body.data.edges:
    a, b = e.vertices; adjacency[a].append(b); adjacency[b].append(a)
seen = {0}; queue = [0]
while queue:
    for neighbor in adjacency[queue.pop()]:
        if neighbor not in seen:
            seen.add(neighbor); queue.append(neighbor)
assert len(seen) == len(body.data.vertices), 'Disconnected body geometry'

dimensions = {}
for name in ('front', 'reference-angle', 'side'):
    png = OUT / 'renders' / f'{VERSION}-{name}.png'
    img = bpy.data.images.load(str(png), check_existing=False)
    dimensions[name] = list(img.size)
    assert dimensions[name] == [1000, 1100], dimensions
    bpy.data.images.remove(img)

# Rendering after a fresh open checks that no transient builder state is needed.
scene.camera = bpy.data.objects['Camera_ReferenceAngle']
scene.render.filepath = str(OUT / 'renders' / f'{VERSION}-reopened.png')
bpy.ops.render.render(write_still=True)
report = {
    'version': VERSION,
    'blend_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
    'reopened_with': bpy.app.version_string,
    'connected_body_vertices': len(seen),
    'body_faces': len(body.data.polygons),
    'non_manifold_body_edges': non_manifold,
    'signed_body_volume': volume,
    'finite_coordinates': True,
    'body_materials': [m.name for m in body.data.materials],
    'camera_count': len(bpy.data.cameras),
    'armatures': len(bpy.data.armatures),
    'actions': len(bpy.data.actions),
    'render_dimensions': dimensions,
    'reopened_render': f'renders/{VERSION}-reopened.png',
    'visual_approval': 'pending user review; technical checks are not likeness approval',
}
(OUT / f'reopen-report-{VERSION}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('NAILONG_REOPEN_VERIFIED', json.dumps(report, ensure_ascii=False))
