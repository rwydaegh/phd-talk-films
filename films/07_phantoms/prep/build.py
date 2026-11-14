"""Film 07 assets: per phantom a smoothed tissue-label volume, a smoothed body-occupancy volume and a glass-shell mesh.

Source: the Windows GOLIAT voxel exports (3 mm, IT'IS ViP 3.1) via design/phantom_slices (load.py, palette.py, planes.py).
Body frame: x lateral (+x = patient's right), y anterior, z up; feet at z = 0, x centred, and the design's slice plane
(through the heart and the shins) rotated to be vertical at y = 0.
Outputs in film/assets/ph/: <ph>_lab.bin, <ph>_occ.bin (uint8, x fastest), <ph>_shell.bin, and phantoms.json.
"""
import os
import json, sys
from pathlib import Path
import numpy as np
from scipy import ndimage as ndi
from skimage import measure
import trimesh, fast_simplification

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../tools/phantoms"))
from load import load                      # noqa: E402  (read-only use of the design cache)
from palette import lut                    # noqa: E402
from planes import plane                   # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "film/assets/ph"
OUT.mkdir(parents=True, exist_ok=True)
PHS = ["duke", "ella", "eartha", "thelonious"]
FACES = int(sys.argv[1]) if len(sys.argv) > 1 else 160_000
GENITAL = {"Penis", "Testis", "Epididymis"}
GROUPS = {  # label anchors, picked on the final cut
    "Brain": ["Brain_grey_matter", "Brain_white_matter"],
    "Heart": ["Heart_muscle", "Heart_lumen"],
    "Lung": ["Lung"],
    "Liver": ["Liver"],
    "Bone": ["Bone"],
    "Muscle": ["Muscle"],
    "Fat": ["Fat", "SAT"],
    "Skin": ["Skin"],
}


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


meta = {}
for ph in PHS:
    lab, names, ax = load(ph)
    names = [str(n) for n in names]
    pitch = np.array([np.diff(a).mean() for a in ax])
    cen = [(a[1:] + a[:-1]) / 2 for a in ax]
    A, S = plane(ph, lab, ax)
    nz = np.argwhere(lab > 0)
    lo = np.maximum(nz.min(0) - 6, 0); hi = np.minimum(nz.max(0) + 7, lab.shape)
    lab = lab[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]].copy()
    origin = np.array([cen[k][lo[k]] for k in range(3)])   # centre of voxel (0,0,0)

    # External genitals: removed and the crotch softened into a neutral mannequin form (the 3D blur).
    gid = [i for i, n in enumerate(names) if n in GENITAL]
    gc = None
    if gid:
        g = np.isin(lab, gid)
        gc = np.argwhere(g).mean(0)
        near = ndi.distance_transform_edt(~g) <= 3
        skinlike = np.isin(lab, [i for i, n in enumerate(names) if n in ("Skin", "Fat", "SAT")])
        lab[g | (near & skinlike & (np.indices(lab.shape)[1] > gc[1] - 4))] = 0
    body = ndi.binary_fill_holes(lab > 0)
    occ = ndi.gaussian_filter(body.astype(np.float32), 1.0)
    if gc is not None:
        d = np.sqrt(sum(((np.indices(lab.shape)[k] - gc[k]) * pitch[k]) ** 2 for k in range(3)))
        w = 1 - smoothstep(0.045, 0.085, d)
        occ = occ * (1 - w) + np.minimum(ndi.gaussian_filter(body.astype(np.float32), 4.0) * 1.15, 1) * w

    # Gaussian label vote (removes single-voxel speckle), then fill background with the nearest tissue
    best = np.full(lab.shape, -1.0, np.float32); vote = np.zeros(lab.shape, np.uint8)
    for i in np.unique(lab):
        gi = ndi.gaussian_filter((lab == i).astype(np.float32), 0.6)
        m = gi > best; best[m] = gi[m]; vote[m] = i
    bg = vote == 0
    idx = ndi.distance_transform_edt(bg, return_distances=False, return_indices=True)
    filled = vote[tuple(idx)]

    # Shell mesh from the occupancy field (index space -> local metres)
    occp = np.pad(occ, 1)
    v, f, _, _ = measure.marching_cubes(occp, 0.5)
    v = origin + (v - 1) * pitch
    t = trimesh.Trimesh(v, f[:, ::-1], process=True)
    trimesh.smoothing.filter_taubin(t, lamb=0.5, nu=-0.53, iterations=6)
    vv, ff = fast_simplification.simplify(t.vertices.astype(np.float32), t.faces.astype(np.int32), 1 - FACES / len(t.faces))
    t = trimesh.Trimesh(vv, ff, process=True)
    trimesh.repair.fix_normals(t)

    # Body frame: rotate about x so the design plane y = A + S z becomes vertical, put it at y = 0, feet at z = 0.
    phi = np.arctan(S)                                      # plane tilt (rad); rotating by +phi about x makes it vertical
    c, s = np.cos(phi), np.sin(phi)
    R = np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    p0 = np.array([0.0, A, 0.0])                            # a point on the plane
    Vb = (t.vertices - p0) @ R.T
    shift = np.array([-(Vb[:, 0].max() + Vb[:, 0].min()) / 2, 0.0, -Vb[:, 2].min()])
    Vb += shift
    M = np.eye(4); M[:3, :3] = R; M[:3, 3] = -R @ p0 + shift  # local metres -> body frame
    nrm = trimesh.Trimesh(Vb, t.faces, process=False).vertex_normals

    # Anchors on the final cut (y = 0 in the body frame): the deepest interior point of each group in that slice
    Minv = np.linalg.inv(M)
    xs = np.arange(Vb[:, 0].min(), Vb[:, 0].max(), 0.0015); zs = np.arange(0, Vb[:, 2].max(), 0.0015)
    X, Z = np.meshgrid(xs, zs, indexing="ij")
    P = np.stack([X, np.zeros_like(X), Z, np.ones_like(X)], -1) @ Minv.T
    I = np.rint((P[..., :3] - origin) / pitch).astype(int)
    ok = np.all((I >= 0) & (I < lab.shape), -1)
    I = np.clip(I, 0, np.array(lab.shape) - 1)
    sl = np.where(ok, filled[I[..., 0], I[..., 1], I[..., 2]], 0)
    so = np.where(ok, occ[I[..., 0], I[..., 1], I[..., 2]], 0)
    sl[so < 0.5] = 0
    anchors = {}
    for key, members in GROUPS.items():
        ids = [i for i, n in enumerate(names) if n in members]
        m = np.isin(sl, ids)
        if not m.any(): continue
        lbl, n = ndi.label(m)
        sizes = ndi.sum(m, lbl, range(1, n + 1))
        big = lbl == (1 + int(np.argmax(sizes)))
        dt = ndi.distance_transform_edt(big)
        k = np.unravel_index(np.argmax(dt), dt.shape)
        anchors[key] = [float(xs[k[0]]), 0.0, float(zs[k[1]]), float(dt[k] * 0.0015)]
    top = Vb[np.argmax(Vb[:, 2])]
    # slice preview for QA
    from PIL import Image
    L = lut(names, bg="#07090d")
    Image.fromarray((L[sl.T[::-1]] * 255).astype(np.uint8)).save(OUT / f"{ph}_cut.png")

    def tex(a):  # (x,y,z) -> bytes with x fastest
        return np.ascontiguousarray(np.transpose(a, (2, 1, 0))).tobytes()
    (OUT / f"{ph}_lab.bin").write_bytes(tex(filled.astype(np.uint8)))
    (OUT / f"{ph}_occ.bin").write_bytes(tex(np.clip(occ * 255 + 0.5, 0, 255).astype(np.uint8)))
    buf = np.concatenate([Vb.astype(np.float32).ravel(), nrm.astype(np.float32).ravel()]).tobytes() + t.faces.astype(np.uint32).tobytes()
    (OUT / f"{ph}_shell.bin").write_bytes(buf)
    meta[ph] = dict(dims=[int(x) for x in lab.shape], origin=origin.tolist(), pitch=pitch.tolist(), M=M.tolist(),
                    nv=len(Vb), nf=len(t.faces), colors=[[float(x) for x in c] for c in lut(names, bg="#000000")],
                    names=names, anchors=anchors, top=top.tolist(),
                    bbox=[Vb.min(0).tolist(), Vb.max(0).tolist()], tilt_deg=float(np.degrees(phi)))
    print(ph, lab.shape, "faces", len(t.faces), "tilt %.1f" % np.degrees(phi), "height %.3f" % Vb[:, 2].max(),
          "width %.3f depth %.3f..%.3f" % (np.ptp(Vb[:, 0]), Vb[:, 1].min(), Vb[:, 1].max()), flush=True)
(OUT / "phantoms.json").write_text(json.dumps(meta))
