"""Crop Duke's head and neck (the FDTD domain of chapter 3 is a head-and-neck model) from the labelled voxel
phantom in design/phantom_slices/cache/duke.npz, remap the tissues to a few display classes, and write
film/data/head_vox.bin (uint8, x fastest) + head_vox.json.

Duke: x = his left->right (+x is his right), y = back->front (faces +y), z = up, metres, 2.97 mm voxels.
  python tools/prep_head.py
"""
import os
import json
from pathlib import Path

import numpy as np

SRC = Path(os.path.join(os.environ.get("PHANTOM_CACHE", "phantom_cache"), "duke.npz"))
OUT = Path(__file__).resolve().parent.parent / 'film' / 'data'

CLASSES = [  # name, colour, member tissues
    ('Air', '#000000', ['Background', 'Air_internal', 'Trachea_lumen', 'Esophagus_lumen', 'Bronchi_lumen']),
    ('Skin', '#e9b394', ['Skin', 'Ear_skin']),
    ('Fat', '#e8c873', ['Fat', 'SAT']),
    ('Muscle', '#b2352e', ['Muscle', 'Tongue', 'Pharynx', 'Larynx', 'Esophagus', 'Mucosa', 'Connective_tissue',
                           'Tendon_Ligament', 'Trachea', 'Diaphragm']),
    ('Bone', '#efe6cf', ['Skull', 'Bone', 'Mandible', 'Vertebrae', 'Teeth', 'Marrow_red', 'Cartilage',
                         'Ear_cartilage', 'Intervertebral_disc']),
    ('Grey', '#d98e98', ['Brain_grey_matter', 'Thalamus', 'Hippocampus', 'Hypothalamus', 'Cerebellum']),
    ('White', '#f1d2d0', ['Brain_white_matter', 'Commissura_posterior', 'Commissura_anterior', 'Midbrain', 'Pons',
                          'Medulla_oblongata']),
    ('CSF', '#7fb0d0', ['Cerebrospinal_fluid']),
    ('Eye', '#d6e6ee', ['Eye_vitreous_humor', 'Eye_Sclera', 'Cornea', 'Eye_lens']),
    ('Vessel', '#a3202f', ['Blood_vessel', 'Artery', 'Vein']),
    ('Nerve', '#e2be4a', ['Spinal_cord', 'Nerve', 'Hypophysis', 'Pinealbody', 'Thyroid_gland']),
]


def main():
    d = np.load(SRC)
    L, names, ax, ay, az = d['labels'], [str(s) for s in d['names']], d['ax'], d['ay'], d['az']
    pitch = float(ax[1] - ax[0])
    lut = np.full(len(names), 3, np.uint8)          # unlisted soft tissue reads as muscle
    for ci, (_, _, members) in enumerate(CLASSES):
        for m in members:
            if m in names: lut[names.index(m)] = ci
    occ = L > 0
    ztop = np.where(occ.any((0, 1)))[0][-1]
    top = az[ztop + 1]
    # head and neck: 26 cm down from the crown, where the shoulders start
    box = dict(x=(-0.12, 0.12), y=(-0.135, 0.145), z=(top - 0.262, top + 0.006))
    sl = []
    for a, (lo, hi) in zip((ax, ay, az), (box['x'], box['y'], box['z'])):
        c = 0.5 * (a[:-1] + a[1:])
        idx = np.where((c >= lo) & (c < hi))[0]
        sl.append(slice(idx[0], idx[-1] + 1))
    sub = lut[L[sl[0], sl[1], sl[2]]]
    origin = [float(ax[sl[0].start]), float(ay[sl[1].start]), float(az[sl[2].start])]
    nx, ny, nz = sub.shape
    # landmarks in Duke metres
    def centroid(tissues):
        ids = [names.index(t) for t in tissues]
        w = np.argwhere(np.isin(L[sl[0], sl[1], sl[2]], ids)).astype(float)
        return (w * pitch + np.array(origin) + pitch / 2)
    ear = centroid(['Ear_skin'])
    earR = ear[ear[:, 0] > 0].mean(0).tolist(); earL = ear[ear[:, 0] < 0].mean(0).tolist()
    eye = centroid(['Eye_vitreous_humor']).mean(0).tolist()
    occ2 = sub > 0
    zs = np.where(occ2.any((0, 1)))[0]
    head_rows = [k for k in range(nz) if k * pitch + origin[2] > top - 0.17]
    hx = np.where(occ2[:, :, head_rows].any((1, 2)))[0]; hy = np.where(occ2[:, :, head_rows].any((0, 2)))[0]
    head_bbox = [[origin[0] + hx[0] * pitch, origin[1] + hy[0] * pitch, origin[2] + head_rows[0] * pitch],
                 [origin[0] + (hx[-1] + 1) * pitch, origin[1] + (hy[-1] + 1) * pitch, float(top)]]
    OUT.mkdir(parents=True, exist_ok=True)
    np.ascontiguousarray(sub.transpose(2, 1, 0)).tofile(OUT / 'head_vox.bin')   # z slowest, x fastest
    meta = dict(n=[nx, ny, nz], pitch=pitch, origin=origin, top=float(top), earR=earR, earL=earL, eye=eye,
                headBBox=head_bbox, classes=[{'name': n, 'col': c} for n, c, _ in CLASSES],
                counts=np.bincount(sub.ravel(), minlength=len(CLASSES)).tolist(),
                note='Duke (IT\'IS ViP), head and neck crop; x = his right, y = front, z = up; bin is uint8 [z][y][x]')
    (OUT / 'head_vox.json').write_text(json.dumps(meta, indent=1))
    print(json.dumps({k: meta[k] for k in ('n', 'pitch', 'top', 'earR', 'earL', 'eye', 'headBBox', 'counts')}))


if __name__ == '__main__':
    main()
