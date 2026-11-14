"""Blender: per-vertex visibility of the card's 120 antennas + AO for Thelonious (card coordinates).
blender -b --python tools/bake_child.py -- SLICE NSLICES OUTDIR"""
import os
import bpy, bmesh, sys, json, math, random
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
sl, ns, out = int(argv[0]), int(argv[1]), argv[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.ply_import(filepath=os.environ.get("THELONIOUS_PLY", "thelonious.ply"))
ob = bpy.context.selected_objects[0]
me = ob.data
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table(); bm.normal_update()
tree = BVHTree.FromBMesh(bm)
meta = json.load(open(os.environ.get("CHILD_BAKE_JSON", "bake.json")))
ants = [Vector(a) for a in meta['antennas']]
V = len(bm.verts)
idx = range(sl, V, ns)
rng = random.Random(7)
# cosine-weighted hemisphere directions (fixed set)
dirs = []
for i in range(24):
    u, v = (i + 0.5) / 24, (i * 0.618034) % 1
    r, th = math.sqrt(u), 2 * math.pi * v
    dirs.append((r * math.cos(th), r * math.sin(th), math.sqrt(1 - u)))
vis = np.zeros((V, 120), np.uint8); ao = np.zeros(V, np.float32)
for i in idx:
    v = bm.verts[i]; n = v.normal; p = v.co + n * 0.0015
    for j, a in enumerate(ants):
        d = a - p; L = d.length; d /= L
        if d.dot(n) <= 0: continue
        hit = tree.ray_cast(p, d, L)
        if hit[0] is None: vis[i, j] = 1
    t = n.orthogonal().normalized(); b = n.cross(t)
    occ = 0
    for (x, y, z) in dirs:
        d = t * x + b * y + n * z
        if tree.ray_cast(p, d, 0.25)[0] is not None: occ += 1
    ao[i] = 1 - occ / len(dirs)
np.save(f'{out}/vis_{sl}.npy', vis[sl::ns]); np.save(f'{out}/ao_{sl}.npy', ao[sl::ns])
if sl == 0:
    co = np.array([v.co[:] for v in bm.verts], np.float32); no = np.array([v.normal[:] for v in bm.verts], np.float32)
    fa = np.array([[l.index for l in f.verts] for f in bm.faces], np.uint32)
    np.save(f'{out}/co.npy', co); np.save(f'{out}/no.npy', no); np.save(f'{out}/fa.npy', fa)
print('done', sl, V)
