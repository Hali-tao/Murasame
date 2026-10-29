"""Independently reopen a refined sculpt; inspect geometry and render it again."""
import bpy
import bmesh
import hashlib
import json
import math
import os
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts' / 'nailong-3d-calibration-2026-10-29'
VERSION = os.environ.get('NAILONG_VERSION', 'r8')
if not VERSION or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-_' for c in VERSION):
    raise ValueError('Invalid version')
path = OUT / f'nailong-reference-{VERSION}.blend'
bpy.ops.wm.open_mainfile(filepath=str(path))
scene = bpy.context.scene; body = bpy.data.objects['Nailong_ContinuousSkin']
assert scene.get('authoring_version') == VERSION
assert len(bpy.data.armatures) == 0 and len(bpy.data.actions) == 0
assert {c.name for c in bpy.data.cameras} == {'Camera_Front', 'Camera_Side', 'Camera_Back', 'Camera_ReferenceAngle'}
assert body.data.color_attributes.get('SkinColor') is not None
assert all(math.isfinite(c) for v in body.data.vertices for c in v.co)
adjacency = [[] for _ in body.data.vertices]
for e in body.data.edges:
    a, b = e.vertices; adjacency[a].append(b); adjacency[b].append(a)
seen = {0}; queue = [0]
while queue:
    for other in adjacency[queue.pop()]:
        if other not in seen: seen.add(other); queue.append(other)
assert len(seen) == len(body.data.vertices), 'Disconnected sculpt'
bm = bmesh.new(); bm.from_mesh(body.data)
non_manifold = sum(not e.is_manifold for e in bm.edges); volume = bm.calc_volume(signed=True); bm.free()
assert non_manifold == 0 and volume > 0, (non_manifold, volume)

scene.camera = bpy.data.objects['Camera_ReferenceAngle']
scene.render.filepath = str(OUT / 'renders' / f'{VERSION}-reopened.png')
bpy.ops.render.render(write_still=True)

def inspect_image(p):
    image = bpy.data.images.load(str(p), check_existing=False)
    w, h = image.size
    pixels = np.empty(w*h*4, dtype=np.float32); image.pixels.foreach_get(pixels)
    pixels = pixels.reshape((h, w, 4))
    r, g, b = (pixels[:, :, i] for i in range(3))
    # This is layout-only color analysis, not a likeness/quality metric.
    # No source or render pixel data is changed or re-saved.
    mask = (r > .5) & (g > .1) & (b < .40) & (r >= .95*g)
    ys, xs = np.nonzero(mask)
    result = {'width': w, 'height': h, 'yellow_body_bounds': [int(xs.min()), int(h-1-ys.max()), int(xs.max()), int(h-1-ys.min())]}
    bpy.data.images.remove(image)
    return result

images = {}
for name in ('front', 'reference-angle', 'side', 'back'):
    images[name] = inspect_image(OUT / 'renders' / f'{VERSION}-{name}.png')
    assert [images[name]['width'], images[name]['height']] == [1000, 1100]
images['original'] = inspect_image(ROOT / 'artifacts/nailong-3d-2026-10-29/reference.png')
images['previous-v3'] = inspect_image(ROOT / 'artifacts/nailong-3d-2026-10-29/renders/v3-reference-angle.png')
report = {'version': VERSION, 'blender': bpy.app.version_string, 'reopened': True,
          'blend_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
          'body_vertices': len(seen), 'body_faces': len(body.data.polygons), 'connected_components': 1,
          'non_manifold_edges': non_manifold, 'signed_volume': volume, 'finite_coordinates': True,
          'armatures': 0, 'actions': 0, 'camera_count': 4, 'images': images,
          'reopened_render': f'renders/{VERSION}-reopened.png',
          'likeness': 'Unapproved; geometry and image-layout checks are not visual acceptance'}
(OUT / f'reopen-report-{VERSION}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print('REFINED_SCULPT_REOPEN', json.dumps(report, ensure_ascii=False))
