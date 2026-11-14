"""Tissue labels at 1.5 mm for smooth cut outlines: a Gaussian vote of the filled 3 mm labels, upsampled 2x.
Reads film/assets/ph/<ph>_lab.bin (z, y, x order), writes <ph>_lab2.bin (fine voxel j <-> coarse index j / 2 - 0.25)."""
import json, sys
from pathlib import Path
import numpy as np
from scipy import ndimage as ndi
D = Path(__file__).resolve().parents[1] / "film/assets/ph"
meta = json.loads((D / "phantoms.json").read_text())
for ph, m in meta.items():
    if len(sys.argv) > 1 and ph not in sys.argv[1:]: continue
    nx, ny, nz = m["dims"]
    lab = np.frombuffer((D / f"{ph}_lab.bin").read_bytes(), np.uint8).reshape(nz, ny, nx)
    shape = tuple(2 * s for s in lab.shape)
    best = np.full(shape, -1.0, np.float32); vote = np.zeros(shape, np.uint8)
    names = m["names"]
    for i in np.unique(lab):
        boost = 1.6 if names[i] in ("Skin", "Ear_skin") else 1.0     # keep the thin skin line through the smoothing
        g = ndi.gaussian_filter((lab == i).astype(np.float32), 0.95) * boost
        g = ndi.zoom(g, 2, order=1, grid_mode=True, mode="nearest")
        k = g > best; best[k] = g[k]; vote[k] = i
        del g, k
    (D / f"{ph}_lab2.bin").write_bytes(vote.tobytes())
    print(ph, shape, flush=True)
