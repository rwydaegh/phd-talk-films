"""Thelonious as a classical bust on a turned stone socle (metres, z up, +y front).
usage: prep_statue.py NAME
The bust keeps the body above the curved cut z = Z0 + A (x - cx)^2, which rises through the upper arms.
The socle's top is trimmed by the same surface, so bust and socle share one contact face: no gap, no overlap.
Writes film/assets/NAME.bin and NAME.json: body, cap (with normals) and socle (smooth-shaded)."""
import os
import json, sys
from pathlib import Path
import numpy as np, trimesh, manifold3d as m3

NAME = sys.argv[1]
OUT = Path(__file__).resolve().parents[1] / "film" / "assets"
Z0, A = -0.12, 3.0

d = np.load(os.path.join(os.environ.get("PHANTOM_CACHE", "phantom_cache"), "body_full.npz"))
src = trimesh.Trimesh(d["V"].astype(np.float64), d["F"], process=True)
sec = src.section(plane_origin=[0, 0, Z0 + 0.004], plane_normal=[0, 0, 1])
loops = sorted(sec.discrete, key=lambda c: -np.ptp(c[:, 0]) * np.ptp(c[:, 1]))
torso = loops[0]
CX, CY = float((torso[:, 0].min() + torso[:, 0].max()) / 2), float((torso[:, 1].min() + torso[:, 1].max()) / 2)
f = lambda x: Z0 + A * (x - CX) ** 2
print("socle centre", CX, CY)

def to_m(t):
    return m3.Manifold(m3.Mesh(vert_properties=np.asarray(t.vertices, np.float32), tri_verts=np.asarray(t.faces, np.uint32)))
def to_t(m):
    me = m.to_mesh(); return trimesh.Trimesh(np.asarray(me.vert_properties)[:, :3].astype(np.float64), np.asarray(me.tri_verts), process=False), me

# the envelope: everything above z = f(x)
N = 220
env = m3.Manifold.cube([1, 1, 1]).refine(N)
def warp(v):
    v = np.array(v, dtype=np.float64)
    x = -0.45 + 0.9 * v[:, 0]; y = -0.3 + 0.65 * v[:, 1]
    zb = f(x); z = zb + v[:, 2] * (0.6 - zb)
    return np.stack([x, y, z], 1)
env = env.warp_batch(warp)
body_m = to_m(src).as_original(); bid = body_m.original_id()
env = env.as_original(); eid = env.original_id()
bust_m = body_m ^ env

# the socle: a turned profile (r, dz from Z0) with filleted corners, on a square plinth with rounded edges
def fillet(pts):
    out = [pts[0][:2]]
    for i in range(1, len(pts) - 1):
        p, dd = np.array(pts[i][:2]), pts[i][2]
        if dd <= 0: out.append(tuple(p)); continue
        a, b = np.array(pts[i - 1][:2]), np.array(pts[i + 1][:2])
        ua, ub = (a - p) / np.linalg.norm(a - p), (b - p) / np.linalg.norm(b - p)
        q0, q1 = p + ua * dd, p + ub * dd
        for s in np.linspace(0, 1, 14):
            out.append(tuple((1 - s) ** 2 * q0 + 2 * s * (1 - s) * p + s * s * q1))
    out.append(pts[-1][:2])
    return out
P = [(0, 0.05, 0), (0.049, 0.05, 0), (0.049, -0.007, 0.0018), (0.0445, -0.0085, 0.0009), (0.0445, -0.0125, 0.002),
     (0.0315, -0.015, 0.011), (0.0300, -0.050, 0.018), (0.0325, -0.084, 0.022), (0.0615, -0.0875, 0.002),
     (0.0685, -0.0885, 0.0035), (0.0685, -0.0975, 0.0035), (0.0640, -0.0995, 0.0008), (0.0640, -0.1015, 0.0008),
     (0.0740, -0.1015, 0.0012), (0.0740, -0.1130, 0.0012), (0, -0.1130, 0)]
prof = fillet(P)
cs = m3.CrossSection([np.array([(max(r, 0.0), z) for r, z in prof][::-1], np.float64)])
turned = cs.revolve(256)
H0, H1, HW, RB = -0.1132, -0.1405, 0.091, 0.0028
corners = []
sph = trimesh.creation.icosphere(subdivisions=3, radius=RB).vertices
for sx in (-1, 1):
    for sy in (-1, 1):
        for zc in (H0 - RB, H1 + RB):
            corners.append(sph + [sx * (HW - RB), sy * (HW - RB), zc])
plinth = m3.Manifold.hull_points(np.concatenate(corners).astype(np.float64))
print("turned", turned.num_tri(), "plinth", plinth.num_tri())
socle_m = (turned + plinth).translate([CX, CY, Z0]) - env

bust, bme = to_t(bust_m)
socle, _ = to_t(socle_m)
# split the bust into skin and cap by the source of each triangle
rid, ridx = np.asarray(bme.run_original_id), np.asarray(bme.run_index)
from_env = np.zeros(len(bust.faces), bool)
for k, oid in enumerate(rid):
    if oid == eid: from_env[ridx[k] // 3: ridx[k + 1] // 3] = True
print("bust", bust.faces.shape, "cap faces", from_env.sum(), "socle", socle.faces.shape, "watertight", bust.is_watertight, socle.is_watertight)
body = trimesh.Trimesh(bust.vertices, bust.faces[~from_env], process=False); body.remove_unreferenced_vertices()
cap = trimesh.Trimesh(bust.vertices, bust.faces[from_env], process=False); cap.remove_unreferenced_vertices()
fn = np.cross(body.vertices[body.faces[:, 1]] - body.vertices[body.faces[:, 0]], body.vertices[body.faces[:, 2]] - body.vertices[body.faces[:, 0]])
vn = np.zeros_like(body.vertices)
for k in range(3): np.add.at(vn, body.faces[:, k], fn)
vn /= np.linalg.norm(vn, axis=1, keepdims=True)
cn = np.stack([2 * A * (cap.vertices[:, 0] - CX), np.zeros(len(cap.vertices)), -np.ones(len(cap.vertices))], 1)
cn /= np.linalg.norm(cn, axis=1, keepdims=True)
# the contact must lie inside the body: every socle vertex on the cut surface is on the cap
top = socle.vertices[np.abs(socle.vertices[:, 2] - f(socle.vertices[:, 0])) < 2e-5]
inside = src.contains(top + [0, 0, 0.0015])
print("socle contact vertices", len(top), "inside the body", inside.mean())
assert inside.all()
soc = trimesh.graph.smooth_shade(socle, angle=np.radians(32))

parts, meta, off = [], {}, 0
def put(key, arr, dt):
    global off
    b = np.ascontiguousarray(arr, dtype=dt).tobytes(); parts.append(b)
    meta[key] = {"offset": off, "count": int(arr.size), "dtype": np.dtype(dt).name}; off += len(b)
    pad = (-off) % 4; parts.append(b"\0" * pad); off += pad
put("pos", body.vertices, np.float32); put("nrm", vn, np.float32); put("idx", body.faces, np.uint32)
put("cap_pos", cap.vertices, np.float32); put("cap_nrm", cn, np.float32); put("cap_idx", cap.faces, np.uint32)
put("soc_pos", soc.vertices, np.float32); put("soc_nrm", soc.vertex_normals, np.float32); put("soc_idx", soc.faces, np.uint32)
lo, hi = body.vertices.min(0), body.vertices.max(0)
meta.update(zc=Z0, cut=[Z0, A, CX, CY], bbox=[lo.tolist(), hi.tolist()])
(OUT / f"{NAME}.bin").write_bytes(b"".join(parts)); (OUT / f"{NAME}.json").write_text(json.dumps(meta, indent=1))
print("bbox", lo, hi)
