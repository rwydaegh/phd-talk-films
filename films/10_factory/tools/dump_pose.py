"""Pose the worker as in a film and save the skinned mesh in world coordinates.
  dump_pose.py 10|27  ->  film/data/pose{N}.bin (float32 xyz per vertex, then uint32 triangle indices) + pose{N}.json"""
import json, sys
from pathlib import Path
import numpy as np
from playwright.sync_api import sync_playwright
FILM = Path(__file__).resolve().parent.parent / 'film'
sys.path.insert(0, str(FILM))
import serve
n = sys.argv[1]
sc = json.loads((FILM / 'data' / f'scene{n}.json').read_text())
w = sc['worker']
at = ','.join(str(v) for v in w['pos'] + [w['face']])
srv, port = serve.start_server()
with sync_playwright() as pw:
    b, pg = serve.open_page(pw, port, 320, 180, f'&film=pose&pose={n}&at={at}&t=0')
    d = pg.evaluate('window.dumpPose()')
    b.close(); srv.shutdown()
pos = np.array(d['pos'], np.float32); idx = np.array(d['idx'], np.uint32)
(FILM / 'data' / f'pose{n}.bin').write_bytes(pos.tobytes() + idx.tobytes())
(FILM / 'data' / f'pose{n}_arm.bin').write_bytes(np.array(d['arm'], np.uint8).tobytes())
meta = {k: d[k] for k in ('n', 'phone', 'phoneMatrix', 'head')}
meta['nIdx'] = len(idx)
(FILM / 'data' / f'pose{n}.json').write_text(json.dumps(meta))
P = pos.reshape(-1, 3)
print(n, 'verts', d['n'], 'tris', len(idx) // 3, 'phone', [round(v, 3) for v in d['phone']], 'z range', P[:, 2].min(), P[:, 2].max())
