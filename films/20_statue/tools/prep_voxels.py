"""Surface voxels of Thelonious above z = ZC, with the surface law for one plane wave at each voxel.
usage: prep_voxels.py NAME BUST ZC AZ EL
The law at a voxel is the law at the nearest vertex of the cut mesh BUST: [n.(-k)]_+ V, V by ray casting.
Writes film/assets/NAME.bin (float32 x,y,z,law per voxel) and NAME.json."""
import os
import json, sys
from pathlib import Path
import numpy as np, trimesh
from scipy import ndimage, spatial

NAME, BUST, ZC, AZ, EL = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
B = int(sys.argv[6]) if len(sys.argv) > 6 else 1          # display block size in native voxels (majority vote)
A = Path(__file__).resolve().parents[1] / "film" / "assets"
t = np.load(os.path.join(os.environ.get("PHANTOM_CACHE", "phantom_cache"), "thelonious.npz"))
lab, ax, ay, az = t["labels"], t["ax"], t["ay"], t["az"]
cx, cy, cz = [(a[1:] + a[:-1]) / 2 for a in (ax, ay, az)]
full = ndimage.binary_fill_holes(lab > 0)
if B > 1:
    n = [s_ // B * B for s_ in full.shape]
    f = full[:n[0], :n[1], :n[2]].reshape(n[0] // B, B, n[1] // B, B, n[2] // B, B).sum((1, 3, 5))
    full = f * 2 >= B ** 3
    cx, cy, cz = [c[:m].reshape(-1, B).mean(1) for c, m in zip((cx, cy, cz), n)]
outside = ~full                      # surface of the whole body, then cropped: the cut layer is not a surface
body = full.copy(); body[:, :, cz < ZC] = False
surf = np.zeros_like(body)
for d in range(3):
    for s in (-1, 1):
        nb = np.roll(outside, s, axis=d)
        surf |= body & nb
# the cut plane is not a surface (nothing below is drawn)
kc = np.searchsorted(cz, ZC)
ii = np.argwhere(surf)
P = np.stack([cx[ii[:, 0]], cy[ii[:, 1]], cz[ii[:, 2]]], 1)
print("surface voxels", len(P), "pitch", np.diff(ax).mean())

meta = json.loads((A / f"{BUST}.json").read_text()); buf = (A / f"{BUST}.bin").read_bytes()
g = lambda k, dt: np.frombuffer(buf, dt, meta[k]["count"], meta[k]["offset"])
V = g("pos", np.float32).reshape(-1, 3).astype(np.float64); N = g("nrm", np.float32).reshape(-1, 3).astype(np.float64)
Fi = g("idx", np.uint32).reshape(-1, 3)
CV = g("cap_pos", np.float32).reshape(-1, 3).astype(np.float64); CF = g("cap_idx", np.uint32).reshape(-1, 3)
mesh = trimesh.Trimesh(np.vstack([V, CV]), np.vstack([Fi, CF + len(V)]), process=False)
a, e = np.radians(AZ), np.radians(EL)
L = np.array([np.sin(a) * np.cos(e), np.cos(a) * np.cos(e), np.sin(e)])      # toward the source; k = -L
cos = np.clip(N @ L, 0, None)
lit = cos > 0
org = V[lit] + N[lit] * 2e-4
hit = mesh.ray.intersects_any(org, np.repeat(L[None], len(org), 0))
vis = np.zeros(len(V)); vis[np.where(lit)[0][~hit]] = 1
law = cos * vis
print("vertices lit", lit.mean(), "visible of lit", (~hit).mean(), "law mean", law.mean())
tree = spatial.cKDTree(V)
dist, j = tree.query(P)
print("nearest vertex distance p50 p99", np.percentile(dist, [50, 99]))
out = np.concatenate([P.astype(np.float32), law[j][:, None].astype(np.float32)], 1)
(A / f"{NAME}.bin").write_bytes(out.tobytes())
(A / f"{NAME}.json").write_text(json.dumps({"count": len(P), "pitch": float(np.diff(ax).mean() * B), "zc": ZC, "az": AZ, "el": EL,
                                             "bbox": [P.min(0).tolist(), P.max(0).tolist()]}))
np.save(A.parent.parent / "prep" / f"{NAME}_vertex_law.npy", law.astype(np.float32))
