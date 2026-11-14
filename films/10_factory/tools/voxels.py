"""Voxelise the posed worker inside the Huygens box (film 10) at several pitches, keeping only the head, neck and
shoulders (voxels whose nearest skin vertex belongs to the right arm are dropped: the arm stays a mesh).
Writes film/data/vox10.json + vox10_L{k}.bin (uint16 i,j,k triplets of the surface voxels, i.e. those with an
outside neighbour; the interior is never seen). Grid origin = box min corner."""
import json
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

D = Path(__file__).resolve().parent.parent / 'film' / 'data'
meta = json.loads((D / 'pose10.json').read_text())
raw = (D / 'pose10.bin').read_bytes(); nv = meta['n']
P = np.frombuffer(raw[:nv * 12], np.float32).reshape(-1, 3).astype(float)
I = np.frombuffer(raw[nv * 12:], np.uint32).reshape(-1, 3)
arm = np.frombuffer((D / 'pose10_arm.bin').read_bytes(), np.uint8).astype(bool)
pa = json.loads((D / 'paths10.json').read_text())
c, h = np.array(pa['hbox'][0]), np.array(pa['hbox'][1])
lo = c - h
tree = cKDTree(P)
V = P[I]
tmin, tmax = V.min(1), V.max(1)
sel = (tmax[:, 2] > lo[2] - 0.05) & np.all(tmin[:, :2] < (c + h)[:2] + 0.01, 1) & np.all(tmax[:, :2] > lo[:2] - 0.01, 1)
V = V[sel]
print('triangles near the box', len(V))

out = {'origin': lo.tolist(), 'size': (2 * h).tolist(), 'levels': []}
for k, pitch in enumerate([0.016, 0.008, 0.004]):
    n = np.ceil(2 * h / pitch).astype(int)
    xs = lo[0] + (np.arange(n[0]) + 0.5) * pitch; ys = lo[1] + (np.arange(n[1]) + 0.5) * pitch; zs = lo[2] + (np.arange(n[2]) + 0.5) * pitch
    inside = np.zeros(n, bool)
    # vertical rays: crossings of x = xs[i], y = ys[j] with each triangle (barycentric in xy)
    a, b, cc = V[:, 0], V[:, 1], V[:, 2]
    det = (b[:, 1] - cc[:, 1]) * (a[:, 0] - cc[:, 0]) + (cc[:, 0] - b[:, 0]) * (a[:, 1] - cc[:, 1])
    ok = np.abs(det) > 1e-14
    a, b, cc, det = a[ok], b[ok], cc[ok], det[ok]
    bbmin = np.minimum(np.minimum(a, b), cc); bbmax = np.maximum(np.maximum(a, b), cc)
    for i, x in enumerate(xs):
        mx = (bbmin[:, 0] <= x) & (bbmax[:, 0] >= x)
        A, B, C, Dt, bmn, bmx = a[mx], b[mx], cc[mx], det[mx], bbmin[mx], bbmax[mx]
        for j, y in enumerate(ys):
            my = (bmn[:, 1] <= y) & (bmx[:, 1] >= y)
            if not my.any(): continue
            A2, B2, C2, D2 = A[my], B[my], C[my], Dt[my]
            l1 = ((B2[:, 1] - C2[:, 1]) * (x - C2[:, 0]) + (C2[:, 0] - B2[:, 0]) * (y - C2[:, 1])) / D2
            l2 = ((C2[:, 1] - A2[:, 1]) * (x - C2[:, 0]) + (A2[:, 0] - C2[:, 0]) * (y - C2[:, 1])) / D2
            l3 = 1 - l1 - l2
            m = (l1 >= 0) & (l2 >= 0) & (l3 >= 0)
            if not m.any(): continue
            zc = np.sort(l1[m] * A2[m, 2] + l2[m] * B2[m, 2] + l3[m] * C2[m, 2])
            above = len(zc) - np.searchsorted(zc, zs)          # crossings above each cell centre
            inside[i, j] = (above % 2) == 1
    # drop arm voxels
    idx = np.argwhere(inside)
    pts = lo + (idx + 0.5) * pitch
    _, nn = tree.query(pts)
    keep = ~arm[nn]
    inside[tuple(idx[~keep].T)] = False
    # surface voxels
    pad = np.pad(inside, 1)
    nb = np.zeros_like(inside)
    for ax in range(3):
        for s in (-1, 1):
            nb |= ~np.roll(pad, s, ax)[1:-1, 1:-1, 1:-1]
    surf = inside & nb
    ijk = np.argwhere(surf).astype(np.uint16)
    (D / f'vox10_L{k}.bin').write_bytes(ijk.tobytes())
    out['levels'].append({'pitch': pitch, 'n': n.tolist(), 'count': int(len(ijk)), 'inside': int(inside.sum())})
    print(pitch, n, 'inside', inside.sum(), 'surface', len(ijk))
(D / 'vox10.json').write_text(json.dumps(out))
