"""Cut Thelonious (smooth mesh, metres, z up, +y front) into a bust at z = ZC and write film assets.
usage: prep_bust.py NAME ZC
Writes film/assets/NAME.bin and NAME.json: body (positions, area-weighted vertex normals, indices) and a flat cap."""
import os
import json, sys
from pathlib import Path
import numpy as np, trimesh

NAME, ZC = sys.argv[1], float(sys.argv[2])
OUT = Path(__file__).resolve().parents[1] / "film" / "assets"
d = np.load(os.path.join(os.environ.get("PHANTOM_CACHE", "phantom_cache"), "body_full.npz"))
m = trimesh.Trimesh(d["V"].astype(np.float64), d["F"], process=True)
print("full", m.vertices.shape, m.is_watertight)
cut = trimesh.intersections.slice_mesh_plane(m, plane_normal=[0, 0, 1], plane_origin=[0, 0, ZC], cap=True)
fz = cut.vertices[cut.faces][:, :, 2]
is_cap = np.all(np.abs(fz - ZC) < 1e-6, axis=1) & (cut.face_normals[:, 2] < -0.99)
body = trimesh.Trimesh(cut.vertices, cut.faces[~is_cap], process=False); body.remove_unreferenced_vertices()
cap = trimesh.Trimesh(cut.vertices, cut.faces[is_cap], process=False); cap.remove_unreferenced_vertices()
# area-weighted vertex normals of the body alone
fn = np.cross(body.vertices[body.faces[:, 1]] - body.vertices[body.faces[:, 0]], body.vertices[body.faces[:, 2]] - body.vertices[body.faces[:, 0]])
vn = np.zeros_like(body.vertices)
for k in range(3): np.add.at(vn, body.faces[:, k], fn)
vn /= np.linalg.norm(vn, axis=1, keepdims=True)
print("body", body.vertices.shape, body.faces.shape, "cap", cap.faces.shape, "watertight cut", cut.is_watertight)
parts, meta, off = [], {}, 0
def put(key, arr, dt):
    global off
    b = np.ascontiguousarray(arr, dtype=dt).tobytes(); parts.append(b)
    meta[key] = {"offset": off, "count": int(arr.size), "dtype": np.dtype(dt).name}; off += len(b)
    pad = (-off) % 4; parts.append(b"\0" * pad); off += pad
put("pos", body.vertices, np.float32); put("nrm", vn, np.float32); put("idx", body.faces, np.uint32)
put("cap_pos", cap.vertices, np.float32); put("cap_idx", cap.faces, np.uint32)
lo, hi = body.vertices.min(0), body.vertices.max(0)
meta.update(zc=ZC, bbox=[lo.tolist(), hi.tolist()])
OUT.mkdir(parents=True, exist_ok=True)
(OUT / f"{NAME}.bin").write_bytes(b"".join(parts)); (OUT / f"{NAME}.json").write_text(json.dumps(meta, indent=1))
print("bbox", lo, hi)
