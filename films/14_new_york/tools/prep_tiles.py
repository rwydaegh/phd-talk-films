"""Merge the cached WTC tiles into one ENU mesh (z up, metres) for placement work.
Writes tools/cache/wtc_enu.npz (V, F) and film/data/frame.json (ecef_to_enu 3x4).
Run: python tools/prep_tiles.py"""
import json, sys
from pathlib import Path
import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[1]
TILES = ROOT / 'film/assets/tiles/wtc'
LAT, LON = 40.7113, -74.0132

def llh_to_ecef(lat, lon, h):
    a, f = 6378137.0, 1 / 298.257223563; e2 = f * (2 - f)
    la, lo = np.radians(lat), np.radians(lon); N = a / np.sqrt(1 - e2 * np.sin(la) ** 2)
    return np.array([(N + h) * np.cos(la) * np.cos(lo), (N + h) * np.cos(la) * np.sin(lo), (N * (1 - e2) + h) * np.sin(la)])

la, lo = np.radians(LAT), np.radians(LON)
E = np.array([-np.sin(lo), np.cos(lo), 0]); Nn = np.array([-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)])
U = np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])
R = np.vstack([E, Nn, U]); c = llh_to_ecef(LAT, LON, 0.0)
M = np.hstack([R, (-R @ c)[:, None]])
Y2Z = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)

man = json.loads((TILES / 'manifest.json').read_text())
Vs, Fs, off = [], [], 0
for t in man['tiles']:
    sc = trimesh.load(TILES / t['file'], force='scene', process=False)
    for name, g in sc.graph.to_flattened().items():
        if g.get('geometry') is None: continue
        geo = sc.geometry[g['geometry']]
        T = np.array(g['transform'])
        v = (T[:3, :3] @ geo.vertices.T).T + T[:3, 3]
        v = (Y2Z @ v.T).T
        v = (M[:, :3] @ v.T).T + M[:, 3]
        Vs.append(v.astype(np.float32)); Fs.append(geo.faces + off); off += len(v)
V = np.concatenate(Vs); F = np.concatenate(Fs).astype(np.int32)
(ROOT / 'tools/cache').mkdir(exist_ok=True)
np.savez_compressed(ROOT / 'tools/cache/wtc_enu.npz', V=V, F=F)
(ROOT / 'film/data').mkdir(exist_ok=True)
(ROOT / 'film/data/frame.json').write_text(json.dumps({'lat': LAT, 'lon': LON, 'ecef_to_enu_matrix': M.tolist()}))
print(len(V), 'verts', len(F), 'faces', 'bounds', V.min(0), V.max(0))
