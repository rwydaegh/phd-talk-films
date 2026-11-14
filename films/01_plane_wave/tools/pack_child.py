import os
import numpy as np, json, scipy.sparse as sp, sys
B = sys.argv[1]
co, no, fa = np.load(f'{B}/co.npy'), np.load(f'{B}/no.npy'), np.load(f'{B}/fa.npy')
V = len(co); vis = np.zeros((V, 120), np.float32); ao = np.zeros(V, np.float32)
for s in range(4):
    vis[s::4] = np.load(f'{B}/vis_{s}.npy'); ao[s::4] = np.load(f'{B}/ao_{s}.npy')
# adjacency smoothing ~ gaussian, sigma ≈ 8 mm
i, j = np.concatenate([fa[:, [0, 1, 2]].ravel(), fa[:, [1, 2, 0]].ravel()]), np.concatenate([fa[:, [1, 2, 0]].ravel(), fa[:, [0, 1, 2]].ravel()])
A = sp.csr_matrix((np.ones(len(i), np.float32), (i, j)), shape=(V, V)); A.data[:] = 1
deg = np.asarray(A.sum(1)).ravel(); P = sp.diags(1 / np.maximum(deg, 1)) @ A
e = np.linalg.norm(co[fa[:, 0]] - co[fa[:, 1]], axis=1).mean(); its = int(round((0.008 / e) ** 2 * 2))
print('mean edge mm', e * 1e3, 'iterations', its)
sv = vis.copy()
for _ in range(its): sv = 0.5 * sv + 0.5 * (P @ sv)
a2 = ao.copy()
for _ in range(6): a2 = 0.5 * a2 + 0.5 * (P @ a2)
nn = no.copy()
for _ in range(4): nn = 0.5 * nn + 0.5 * (P @ nn)
nn /= np.linalg.norm(nn, axis=1, keepdims=True)
keep = co[:, 2] > 0.50
fk = fa[keep[fa].all(1)]
used = np.unique(fk); remap = -np.ones(V, np.int64); remap[used] = np.arange(len(used))
fk = remap[fk].astype(np.uint32)
co2, no2, ao2, vis2 = co[used], nn[used], a2[used], sv[used]
print('kept verts', len(used), 'faces', len(fk), 'z range', co2[:, 2].min(), co2[:, 2].max(), 'mean vis', vis2.mean(), 'ao', ao2.mean())
with open('film/assets/child.bin', 'wb') as f:
    f.write(co2.astype(np.float32).tobytes()); f.write(no2.astype(np.float32).tobytes())
    f.write(np.clip(ao2 * 255, 0, 255).astype(np.uint8).tobytes()); f.write(np.clip(vis2 * 255 + 0.5, 0, 255).astype(np.uint8).tobytes())
    f.write(fk.tobytes())
meta = json.load(open(os.environ.get("CHILD_BAKE_JSON", "bake.json")))
json.dump({'V': int(len(used)), 'F': int(len(fk)), 'antennas': meta['antennas'], 'camera': meta['camera']}, open('film/assets/child.json', 'w'))
