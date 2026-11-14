"""Build Thelonious 3D assets for Blender: voxel cube instances, smoothed cut body + capped face, organ meshes."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import *; from palette import *; from slice2d import smooth_labels; from planes import plane, sample
import trimesh
from scipy import ndimage as ndi
from skimage import measure
from PIL import Image
C = CACHE
PH = "thelonious"
lab, names, ax = load(PH)
yb = np.argwhere((lab > 0).any((0, 2))).ravel()
A, S = plane(PH, lab, ax)
cen = [(a[1:] + a[:-1]) / 2 for a in ax]
L = lut(names)
sl, YI = sample(lab, ax, A, S)          # YI[iz]: last kept y-index per z layer
K = np.arange(lab.shape[1])[None, :, None] <= YI[None, None, :]
YC = int(np.median(YI))
print("plane y = %.4f + %.4f z, tilt %.1f deg" % (A, S, np.degrees(np.arctan(S))))

# ---------- voxel cubes: posterior part (y <= YC), visible voxels only ----------
body = lab > 0
pad = np.pad(body, 1)
nb_bg = np.zeros_like(body)
for d in range(3):
    for s in (-1, 1):
        nb_bg |= ~np.roll(pad, s, axis=d)[1:-1, 1:-1, 1:-1]
padk = np.pad(body & K, 1)
nb_out = np.zeros_like(body)
for d in range(3):
    for sgn in (-1, 1):
        nb_out |= ~np.roll(padk, sgn, axis=d)[1:-1, 1:-1, 1:-1]
vis = body & K & nb_out
ii = np.argwhere(vis)
P = np.stack([cen[0][ii[:, 0]], cen[1][ii[:, 1]], cen[2][ii[:, 2]]], 1).astype(np.float32)
col = L[lab[tuple(ii.T)]].astype(np.float32)
np.savez(f"{C}/vox_back.npz", P=P, col=col, pitch=np.float32(np.median(np.diff(ax[0]))))
# front half voxels too (for the ghost / full body voxel shell)
visf = body & nb_bg & ~K
jj = np.argwhere(visf)
Pf = np.stack([cen[0][jj[:, 0]], cen[1][jj[:, 1]], cen[2][jj[:, 2]]], 1).astype(np.float32)
np.savez(f"{C}/vox_front.npz", P=Pf)
print("voxel instances back", len(P), "front", len(Pf))


def mc(mask, sigma, level=0.5, taubin=10):
    m = ndi.gaussian_filter(np.pad(mask, 2).astype(np.float32), sigma) if sigma > 0 else np.pad(mask, 2).astype(np.float32)
    v, f, _, _ = measure.marching_cubes(m, level)
    v -= 2
    # index space -> physical (cell centres, nonuniform-aware)
    out = np.stack([np.interp(v[:, k], np.arange(len(cen[k])), cen[k]) for k in range(3)], 1)
    t = trimesh.Trimesh(out, f[:, ::-1], process=True)
    if taubin:
        trimesh.smoothing.filter_taubin(t, lamb=0.5, nu=-0.53, iterations=taubin)
    return t


def save(name, t, uv=None, extra=None):
    d = dict(V=t.vertices.astype(np.float32), F=t.faces.astype(np.int32))
    if uv is not None: d["UV"] = uv.astype(np.float32)
    if extra: d.update(extra)
    np.savez(f"{C}/{name}.npz", **d)
    print(name, len(t.vertices), len(t.faces), "watertight", t.is_watertight)


# ---------- smoothed body surface ----------
from scipy import sparse


def soften(t, centre, r0=0.035, r1=0.07, iters=80):
    """3D 'blur' for the outer shell: heavy local Laplacian smoothing around a point (genitals),
    leaving a neutral mannequin-like surface. Falloff from r0 (full) to r1 (none)."""
    v = t.vertices.copy()
    d = np.linalg.norm(v - centre, axis=1)
    w = np.clip((r1 - d) / (r1 - r0), 0, 1)[:, None] * 0.6
    e = t.edges_unique
    n = len(v)
    A = sparse.coo_matrix((np.ones(2 * len(e)), (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(n, n)).tocsr()
    deg = np.asarray(A.sum(1)).ravel(); deg[deg == 0] = 1
    for _ in range(iters):
        v = v + w * ((A @ v) / deg[:, None] - v)
    t.vertices = v
    return t


gen = np.argwhere(np.isin(lab, [names.index(n) for n in ["Penis", "Testis", "Epididymis"] if n in names]))
gc = np.array([cen[k][gen[:, k]].mean() for k in range(3)])
skin = mc(body, 1.0, taubin=15)
skin = soften(skin, gc)
nrm = np.array([0, -1.0, S]) / np.hypot(1, S)
back = skin.slice_plane([0, A, 0], nrm, cap=True)
front = skin.slice_plane([0, A, 0], -nrm, cap=False)
yplane = A
save("body_full", skin)
# cap faces: those with all vertices on the plane
onp = np.abs(back.vertices[:, 1] - A - S * back.vertices[:, 2]) < 1e-6
capf = onp[back.faces].all(1)
x0, x1, z0, z1 = ax[0][0], ax[0][-1], ax[2][0], ax[2][-1]
uv = np.stack([(back.vertices[:, 0] - x0) / (x1 - x0), (back.vertices[:, 2] - z0) / (z1 - z0)], 1)
save("body_back", back, uv, {"capf": capf})
save("body_front", front)

# ---------- cut-face textures (x horizontal, z vertical; image row 0 = top = z1) ----------
k = 6  # 0.5 mm texels
up = np.repeat(np.repeat(sl.T[::-1], k, 0), k, 1)
skin_ids = {names.index(n): 1.6 for n in ["Skin", "Ear_skin"] if n in names}
sm = smooth_labels(up, 0.75 * k, skin_ids)
for nm, im in [("cap_voxels", up), ("cap_smooth", sm)]:
    bg = im == 0
    idx = ndi.distance_transform_edt(bg, return_distances=False, return_indices=True)
    filled = im[idx[0], idx[1]]
    Image.fromarray((L[filled] * 255).round().astype(np.uint8)).save(f"{C}/{nm}.png")
    Image.fromarray((L[im] * 255).round().astype(np.uint8)).save(f"{C}/{nm}_raw.png")
np.save(f"{C}/cap_labels_smooth.npy", sm)

# ---------- organ meshes for the glass body ----------
grp = {
    "skeleton": (["Bone", "Skull", "Vertebrae", "Mandible", "Patella", "Teeth", "Marrow_red"], "bone"),
    "discs": (["Intervertebral_disc", "Cartilage", "Meniscus"], "#cfe3ec"),
    "brain": (["Brain_grey_matter", "Brain_white_matter", "Cerebellum", "Thalamus", "Hypothalamus", "Midbrain",
               "Pons", "Medulla_oblongata", "Hippocampus", "Pinealbody", "Hypophysis"], "brain"),
    "cord": (["Spinal_cord"], "nerve"),
    "lungs": (["Lung", "Bronchi", "Bronchi_lumen"], "lung"),
    "heart": (["Heart_muscle", "Heart_lumen"], "heart"),
    "vessels": (["Artery", "Blood_vessel"], "blood"),
    "veins": (["Vein"], "vein"),
    "liver": (["Liver"], "liver"),
    "gallbladder": (["Gallbladder"], "green"),
    "spleen": (["Spleen"], "spleen"),
    "kidneys": (["Kidney_cortex", "Kidney_medulla"], "kidney"),
    "stomach": (["Stomach", "Stomach_lumen", "Esophagus", "Esophagus_lumen", "Mucosa"], "gut"),
    "smallint": (["Small_intestine", "Small_intestine_lumen"], "#f0b48f"),
    "largeint": (["Large_intestine", "Large_intestine_lumen"], "#cf7c66"),
    "bladder": (["Bladder"], "bladder"),
    "glands": (["Pancreas", "Thymus", "Adrenal_gland", "Thyroid_gland"], "gland"),
}
import json
meta = {"A": A, "S": S, "organs": {}}
for g, (tl, cg) in grp.items():
    ids = [names.index(t) for t in tl if t in names]
    m = np.isin(lab, ids)
    if m.sum() < 20: continue
    sig = 0.6 if g in ("vessels", "veins", "cord", "discs") else (0.5 if g == "skeleton" else 0.8)
    lvl = 0.4 if g in ("vessels", "veins") else (0.35 if g == "skeleton" else 0.5)
    t = mc(m, sig, level=lvl, taubin=8)
    save(f"organ_{g}", t)
    meta["organs"][g] = cg if cg.startswith("#") else G[cg][0]
# locations to blur if visible (eyes, genitals) for the full/ghost views
for t in ["Eye_vitreous_humor", "Penis", "Testis"]:
    w = np.argwhere(lab == names.index(t))
    meta.setdefault("blur", {})[t] = [float(cen[k][w[:, k]].mean()) for k in range(3)]
json.dump(meta, open(f"{C}/meta3d.json", "w"), indent=1)
