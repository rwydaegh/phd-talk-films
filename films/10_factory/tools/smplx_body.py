"""Export the SMPL-X neutral template as a film asset: one Loop subdivision, top-4 skin weights mapped to Mixamo bones.

  python tools/smplx_body.py   ->  film/assets/human/smplx_neutral.bin + smplx_neutral.json
Coordinates stay SMPL-X (metres, y up, facing +z); lib/human.js poses and scales it onto the Mixamo skeleton.
"""
import os
import json
from pathlib import Path

import numpy as np

SRC = os.environ.get("SMPLX_NPZ", "smplx_neutral_tensors.npz")
OUT = Path(__file__).resolve().parents[1] / "film" / "assets" / "human"

SIDE = ["Left", "Right"]
NAMES = ["Hips", "LeftUpLeg", "RightUpLeg", "Spine", "LeftLeg", "RightLeg", "Spine1", "LeftFoot", "RightFoot",
         "Spine2", "LeftToeBase", "RightToeBase", "Neck", "LeftShoulder", "RightShoulder", "Head",
         "LeftArm", "RightArm", "LeftForeArm", "RightForeArm", "LeftHand", "RightHand", "Head", "Head", "Head"]
for s in SIDE:
    for f in ["Index", "Middle", "Pinky", "Ring", "Thumb"]:
        NAMES += [f"{s}Hand{f}{k}" for k in (1, 2, 3)]
assert len(NAMES) == 55


def loop_subdivide(V, F, W):
    """One Loop step. W (per-vertex attributes) is averaged linearly onto the new edge vertices."""
    nv = len(V)
    E = np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), axis=1)
    opp = np.concatenate([F[:, 2], F[:, 0], F[:, 1]])
    uE, inv, cnt = np.unique(E, axis=0, return_inverse=True, return_counts=True)
    inv = inv.ravel()
    ne = len(uE)
    osum = np.zeros((ne, 3)); np.add.at(osum, inv, V[opp])
    mid = 0.5 * (V[uE[:, 0]] + V[uE[:, 1]])
    interior = cnt == 2
    odd = mid.copy()
    odd[interior] = 0.375 * (V[uE[interior, 0]] + V[uE[interior, 1]]) + 0.125 * osum[interior]

    nsum = np.zeros((nv, 3)); deg = np.zeros(nv)
    np.add.at(nsum, uE[:, 0], V[uE[:, 1]]); np.add.at(nsum, uE[:, 1], V[uE[:, 0]])
    np.add.at(deg, uE[:, 0], 1); np.add.at(deg, uE[:, 1], 1)
    bE = uE[~interior]
    bsum = np.zeros((nv, 3)); bdeg = np.zeros(nv)
    np.add.at(bsum, bE[:, 0], V[bE[:, 1]]); np.add.at(bsum, bE[:, 1], V[bE[:, 0]])
    np.add.at(bdeg, bE[:, 0], 1); np.add.at(bdeg, bE[:, 1], 1)
    beta = np.where(deg > 3, 3.0 / (8.0 * np.maximum(deg, 1)), 3.0 / 16.0)
    even = (1 - deg * beta)[:, None] * V + beta[:, None] * nsum
    bnd = bdeg == 2
    even[bnd] = 0.75 * V[bnd] + 0.125 * bsum[bnd]

    e = inv.reshape(3, -1).T + nv          # edge vertex ids for edges (01, 12, 20) of each face
    a, b, c = F[:, 0], F[:, 1], F[:, 2]
    e01, e12, e20 = e[:, 0], e[:, 1], e[:, 2]
    F2 = np.concatenate([np.stack([a, e01, e20], 1), np.stack([b, e12, e01], 1),
                         np.stack([c, e20, e12], 1), np.stack([e01, e12, e20], 1)])
    W2 = np.concatenate([W, 0.5 * (W[uE[:, 0]] + W[uE[:, 1]])])
    return np.concatenate([even, odd]), F2, W2


def main():
    d = np.load(SRC)
    V = d["v_template"].astype(np.float64)
    F = d["faces"].astype(np.int64)
    W = d["lbs_weights"].astype(np.float64)
    J = d["J_regressor"] @ V
    parents = d["parents"].astype(int)

    V, F, W = loop_subdivide(V, F, W)

    # Merge SMPL-X joints that share a Mixamo bone, then keep the four strongest.
    bones = list(dict.fromkeys(NAMES))
    M = np.zeros((55, len(bones)))
    for j, n in enumerate(NAMES):
        M[j, bones.index(n)] = 1
    Wb = W @ M
    idx = np.argsort(-Wb, axis=1)[:, :4]
    wts = np.take_along_axis(Wb, idx, 1)
    wts /= wts.sum(1, keepdims=True)

    OUT.mkdir(parents=True, exist_ok=True)
    blob = [V.astype("<f4"), F.astype("<u4"), idx.astype("<u2"), wts.astype("<f4")]
    offs, o = [], 0
    for b in blob:
        offs.append(o); o += b.nbytes
    (OUT / "smplx_neutral.bin").write_bytes(b"".join(x.tobytes() for x in blob))
    meta = {
        "source": "SMPL-X neutral template (research licence), one Loop subdivision",
        "nv": len(V), "nf": len(F), "bones": bones,
        "offsets": {"pos": offs[0], "idx": offs[1], "skinIndex": offs[2], "skinWeight": offs[3]},
        "joints": {"names": NAMES, "parents": parents.tolist(), "pos": J.round(6).tolist()},
    }
    (OUT / "smplx_neutral.json").write_text(json.dumps(meta))
    print(f"{len(V)} vertices, {len(F)} faces, {o / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
