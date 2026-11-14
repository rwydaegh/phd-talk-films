"""Image-method ray tracer for the two factory halls (specular reflections up to second order, room planes
and cuboid faces, occlusion by the cuboids and by the worker's body), plus the precoders.

  trace.py 10  ->  film/data/paths10.json   distributed array (25 patches, 10 m grid), MRT to the phone
  trace.py 27  ->  film/data/paths27.json   16 x 16 URA, MRT ... ECBF rows, body exposure operator Q

Scalar field model (as chapter 5 without polarisation): each path p from element m arrives at the phone with
  a_pm = sqrt(G(th_tx)) * prod(Gamma_i) * lambda / (4 pi L) * exp(-i k L)     (TE Fresnel, concrete eps_r = 7;
metal Gamma = -1). The body sees each path as a plane wave of direction k_p (chapter 5's far-field form).
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

FILM = Path(__file__).resolve().parent.parent / 'film'
D = FILM / 'data'
C0 = 299792458.0


# ---------------------------------------------------------------- geometry
def box_faces(m):
    """Outward faces of an oriented cuboid: (centre, normal, u, v, half-u, half-v)."""
    c = np.array(m['c'], float); s = np.array(m['s'], float); yw = m['yaw']
    ex = np.array([math.cos(yw), math.sin(yw), 0.0]); ey = np.array([-math.sin(yw), math.cos(yw), 0.0]); ez = np.array([0, 0, 1.0])
    out = []
    for n, a, b, hn, ha, hb in ((ex, ey, ez, s[0] / 2, s[1] / 2, s[2] / 2), (-ex, ey, ez, s[0] / 2, s[1] / 2, s[2] / 2),
                                (ey, ex, ez, s[1] / 2, s[0] / 2, s[2] / 2), (-ey, ex, ez, s[1] / 2, s[0] / 2, s[2] / 2),
                                (ez, ex, ey, s[2] / 2, s[0] / 2, s[1] / 2)):
        out.append((c + n * hn, n, a, b, ha, hb))
    return out


def room_faces(room):
    lo, hi = np.array(room[0], float), np.array(room[1], float)
    c = (lo + hi) / 2; h = (hi - lo) / 2
    X, Y, Z = np.eye(3)
    return [(np.array([c[0], c[1], lo[2]]), Z, X, Y, h[0], h[1], 'floor'),
            (np.array([c[0], c[1], hi[2]]), -Z, X, Y, h[0], h[1], 'ceiling'),
            (np.array([lo[0], c[1], c[2]]), X, Y, Z, h[1], h[2], 'wall'),
            (np.array([hi[0], c[1], c[2]]), -X, Y, Z, h[1], h[2], 'wall'),
            (np.array([c[0], lo[1], c[2]]), Y, X, Z, h[0], h[2], 'wall'),
            (np.array([c[0], hi[1], c[2]]), -Y, X, Z, h[0], h[2], 'wall')]


class Boxes:
    def __init__(self, machines):
        self.c = np.array([m['c'] for m in machines]); self.h = np.array([m['s'] for m in machines]) / 2
        yw = np.array([m['yaw'] for m in machines]); self.cs, self.sn = np.cos(yw), np.sin(yw)

    def blocked(self, a, b, skip=()):
        """Segment a->b hits any box (except indices in skip)? Slab test in each box frame."""
        d = b - a
        rel = a[None, :] - self.c
        lx = rel[:, 0] * self.cs + rel[:, 1] * self.sn; ly = -rel[:, 0] * self.sn + rel[:, 1] * self.cs; lz = rel[:, 2]
        dx = d[0] * self.cs + d[1] * self.sn; dy = -d[0] * self.sn + d[1] * self.cs; dz = np.full_like(lx, d[2])
        t0 = np.full_like(lx, 1e-6); t1 = np.full_like(lx, 1 - 1e-6)
        for o, dd, hh in ((lx, dx, self.h[:, 0]), (ly, dy, self.h[:, 1]), (lz, dz, self.h[:, 2])):
            with np.errstate(divide='ignore', invalid='ignore'):
                ta = (-hh - o) / dd; tb = (hh - o) / dd
            lo = np.where(np.abs(dd) < 1e-12, np.where(np.abs(o) <= hh, -np.inf, np.inf), np.minimum(ta, tb))
            hi = np.where(np.abs(dd) < 1e-12, np.where(np.abs(o) <= hh, np.inf, -np.inf), np.maximum(ta, tb))
            t0 = np.maximum(t0, lo); t1 = np.minimum(t1, hi)
        hit = t0 < t1
        for i in skip: hit[i] = False
        return bool(hit.any())


def seg_tris(a, b, V0, E1, E2):
    """First hit parameter t in (0,1) of segment a->b against triangles (Moller-Trumbore), or None."""
    d = b - a
    p = np.cross(d, E2); det = (E1 * p).sum(1)
    ok = np.abs(det) > 1e-12
    inv = np.where(ok, 1.0 / np.where(ok, det, 1), 0)
    s = a - V0
    u = (s * p).sum(1) * inv
    q = np.cross(s, E1)
    v = (q * d).sum(1) * inv
    t = (q * E2).sum(1) * inv
    m = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-6) & (t < 1)
    return float(t[m].min()) if m.any() else None


def gamma_te(cos_i, eps):
    s2 = 1 - cos_i ** 2
    r = np.sqrt(eps - s2 + 0j)
    return (cos_i - r) / (cos_i + r)


# ---------------------------------------------------------------- tracing
def trace(scene, srcs, rx, body=None, max_order=2, pattern=None):
    lam = scene['lam']; k = 2 * math.pi / lam
    eps = complex(scene['wall']['eps'], -scene['wall']['sigma'] / (2 * math.pi * scene['freq'] * 8.854e-12))
    boxes = Boxes(scene['machines'])
    faces = []
    for f in room_faces(scene['room']): faces.append(dict(c=f[0], n=f[1], u=f[2], v=f[3], hu=f[4], hv=f[5], kind=f[6], box=None))
    for bi, m in enumerate(scene['machines']):
        for f in box_faces(m):
            faces.append(dict(c=f[0], n=f[1], u=f[2], v=f[3], hu=f[4], hv=f[5], kind=scene['machineMat'], box=bi))
    rx = np.asarray(rx, float)
    paths = []

    def mirror(p, f):
        return p - 2 * np.dot(p - f['c'], f['n']) * f['n']

    def on_face(p, f):
        r = p - f['c']
        return abs(np.dot(r, f['u'])) <= f['hu'] + 1e-6 and abs(np.dot(r, f['v'])) <= f['hv'] + 1e-6 and abs(np.dot(r, f['n'])) < 1e-4

    def isect(a, b, f):
        da, db = np.dot(a - f['c'], f['n']), np.dot(b - f['c'], f['n'])
        if da <= 1e-9 or db <= 1e-9: return None        # both ends must be in front of the face
        t = da / (da - db) if (da - db) != 0 else None
        return None if t is None else a + (b - a) * t

    seqs = [()] + [(i,) for i in range(len(faces))]
    if max_order >= 2:
        seqs += [(i, j) for i in range(len(faces)) for j in range(len(faces)) if i != j]
    for si, s in enumerate(srcs):
        s = np.asarray(s, float)
        for seq in seqs:
            # images of the source
            imgs = [s]
            for fi in seq: imgs.append(mirror(imgs[-1], faces[fi]))
            # back-propagate from rx
            pts = [rx]; ok = True; tgt = rx
            for o in range(len(seq) - 1, -1, -1):
                f = faces[seq[o]]
                p = isect(imgs[o + 1], tgt, f) if False else None
                # intersection of segment image(o+1) -> tgt with the face plane
                a, b = imgs[o + 1], tgt
                da, db = np.dot(a - f['c'], f['n']), np.dot(b - f['c'], f['n'])
                if not (da < 0 < db or db < 0 < da): ok = False; break
                p = a + (b - a) * (da / (da - db))
                if not on_face(p, f): ok = False; break
                # the real points must be on the front side of the face
                pts.append(p); tgt = p
            if not ok: continue
            pts.append(s)
            pts = pts[::-1]                                   # s, r1, r2, rx
            # front-side checks
            good = True
            for o, fi in enumerate(seq):
                f = faces[fi]
                if np.dot(pts[o] - f['c'], f['n']) <= 1e-6 or np.dot(pts[o + 2] - f['c'], f['n']) <= 1e-6: good = False; break
            if not good: continue
            # occlusion by boxes (a segment touching its own reflecting box face is not blocked by that box)
            for o in range(len(pts) - 1):
                skip = set()
                if o > 0 and faces[seq[o - 1]]['box'] is not None: skip.add(faces[seq[o - 1]]['box'])
                if o < len(seq) and faces[seq[o]]['box'] is not None: skip.add(faces[seq[o]]['box'])
                if boxes.blocked(pts[o], pts[o + 1], skip): good = False; break
            if not good: continue
            if any(np.linalg.norm(pts[i + 1] - pts[i]) < 0.05 for i in range(len(pts) - 1)): continue   # edge-grazing, degenerate
            L = sum(np.linalg.norm(pts[i + 1] - pts[i]) for i in range(len(pts) - 1))
            kd = (pts[1] - pts[0]) / np.linalg.norm(pts[1] - pts[0])
            g = pattern(si, kd) if pattern else 1.0
            if g <= 1e-6: continue
            amp = math.sqrt(g) * lam / (4 * math.pi * L)
            G = 1.0 + 0j; mats = []
            for o, fi in enumerate(seq):
                f = faces[fi]
                win = (pts[o + 1] - pts[o]); win /= np.linalg.norm(win)
                ci = abs(np.dot(win, f['n']))
                G *= -1.0 if f['kind'] == 'metal' else gamma_te(ci, eps)
                mats.append(f['kind'])
            a = amp * G * np.exp(-1j * k * L)
            karr = (pts[-1] - pts[-2]) / np.linalg.norm(pts[-1] - pts[-2])
            paths.append(dict(src=si, pts=[p.tolist() for p in pts], L=L, a=a, k=karr.tolist(), kd=kd.tolist(), mats=mats, order=len(seq)))
    return paths


def body_tris(n):
    raw = (D / f'pose{n}.bin').read_bytes()
    meta = json.loads((D / f'pose{n}.json').read_text())
    nv = meta['n']
    P = np.frombuffer(raw[:nv * 12], np.float32).reshape(-1, 3).astype(float)
    I = np.frombuffer(raw[nv * 12:], np.uint32).reshape(-1, 3)
    return P, I, meta


def body_cut(paths, P, I, stop_box=None, keep_through=False):
    """End each drawn path where its last segment first meets the body (or the Huygens box)."""
    V0 = P[I[:, 0]]; E1 = P[I[:, 1]] - V0; E2 = P[I[:, 2]] - V0
    # coarse cull: only triangles near the final segments
    out = []
    for p in paths:
        a, b = np.array(p['pts'][-2]), np.array(p['pts'][-1])
        lo = np.minimum(a, b) - 0.05; hi = np.maximum(a, b) + 0.05
        near = np.all((V0 >= lo) & (V0 <= hi), axis=1)
        t = seg_tris(a, b, V0[near], E1[near], E2[near]) if near.any() else None
        q = dict(p)
        if stop_box is not None:
            c, h = np.array(stop_box[0]), np.array(stop_box[1])
            tb = seg_box_entry(a, b, c, h)
            q['tBox'] = tb
            if t is not None and (tb is None or t < tb - 1e-6):
                q['hitBody'] = True        # meets the body (shoulder, arm) before the box: not handed to FDTD
        else:
            q['tBody'] = t
        out.append(q)
    return out


def seg_box_entry(a, b, c, h):
    d = b - a; t0, t1 = 0.0, 1.0
    for i in range(3):
        if abs(d[i]) < 1e-12:
            if abs(a[i] - c[i]) > h[i]: return None
            continue
        ta, tb = (c[i] - h[i] - a[i]) / d[i], (c[i] + h[i] - a[i]) / d[i]
        t0, t1 = max(t0, min(ta, tb)), min(t1, max(ta, tb))
    return t0 if t0 < t1 else None


# ---------------------------------------------------------------- films
def film10():
    sc = json.loads((D / 'scene10.json').read_text())
    P, I, meta = body_tris(10)
    rx = np.array(meta['phone'])
    head = np.array(meta['head']).reshape(4, 4).T          # column-major from three.js
    hc = head[:3, 3]
    # Huygens box around the head and neck: axis aligned (the worker faces -y)
    # Huygens box around the head and neck, axis aligned (the worker faces -y): from the shoulders to above the crown
    P_head = P[(np.abs(P[:, 0] - hc[0]) < 0.11) & (np.abs(P[:, 1] - hc[1]) < 0.14) & (P[:, 2] > hc[2] - 0.05)]
    top = float(P_head[:, 2].max())
    hb = [[float(hc[0]), float(hc[1] - 0.01), (top + 0.04 + 1.46) / 2], [0.16, 0.165, (top + 0.04 - 1.46) / 2]]
    n_el = 1.7
    def pat(si, kd):
        c = -kd[2]                      # patches face the floor
        return 0.0 if c <= 0 else 5.4 * c ** n_el
    paths = trace(sc, sc['dis'], rx, pattern=pat)
    paths = body_cut(paths, P, I, stop_box=hb)
    k = 2 * math.pi / sc['lam']
    # MRT over the 25 distributed elements (single receive antenna at the phone)
    h = np.zeros(25, complex)
    for p in paths:
        if not p.get('hitBody'): h[p['src']] += p['a']
    x = np.conj(h) / np.linalg.norm(h)
    for p in paths: p['A'] = x[p['src']] * p['a']
    keep = [p for p in paths if not p.get('hitBody')]
    pw = np.array([abs(p['A']) ** 2 for p in keep]); pmax = pw.max()
    keep = [p for p, w in zip(keep, pw) if w > pmax * 10 ** (-3.5)]
    keep.sort(key=lambda p: -abs(p['A']))
    blocked = [p for p in paths if p.get('hitBody') and abs(x[p['src']] * p['a']) ** 2 > pmax * 1e-3]
    norm = math.sqrt(sum(abs(p['A']) ** 2 for p in keep))
    out = dict(film=10, lam=sc['lam'], k=k, rx=rx.tolist(), hbox=hb, head=meta['head'],
               paths=[dict(src=p['src'], pts=p['pts'], L=p['L'], k=p['k'], mats=p['mats'], order=p['order'], tBox=p['tBox'],
                           A=[p['A'].real / norm, p['A'].imag / norm], amp=abs(p['A']) / norm) for p in keep],
               blocked=[dict(src=p['src'], pts=p['pts'], k=p['k']) for p in blocked])
    (D / 'paths10.json').write_text(json.dumps(out))
    gain = abs(sum(p['A'] for p in keep)) ** 2 / sum(abs(p['A']) ** 2 for p in keep)
    print(f'film 10: {len(paths)} paths, kept {len(keep)}, blocked by body {len(blocked)}, coherent gain at phone {gain:.1f}')
    from collections import Counter
    print(Counter(p['order'] for p in keep), Counter(p['src'] for p in keep).most_common(6))


def film27():
    sc = json.loads((D / 'scene27.json').read_text())
    P, I, meta = body_tris(27)
    rx = np.array(meta['phone'])
    u = sc['ura']; k = 2 * math.pi / sc['lam']
    paths = trace(sc, [u['centre']], rx, pattern=None)
    paths = body_cut(paths, P, I)
    # element positions: square half-wavelength grid in the panel plane, panel normal tilted down by 10 deg
    tl = math.radians(u['tilt'])
    nrm = np.array([math.cos(tl), 0, -math.sin(tl)]); ev = np.array([math.sin(tl), 0, math.cos(tl)]); eh = np.array([0, 1.0, 0])
    N = u['n']; d = u['d']
    off = np.array([(i - (N - 1) / 2) * d * eh + (j - (N - 1) / 2) * d * ev for j in range(N) for i in range(N)])
    M = len(off)
    kd = np.array([p['kd'] for p in paths]); a0 = np.array([p['a'] for p in paths])
    Apm = a0[:, None] * np.exp(1j * k * (kd @ off.T))          # P x M: path p from element m at the phone
    h = Apm.sum(0)                                              # channel to the phone (phase reference: the phone)
    # exposure operator on the body surface (chapter 5, scalar): S_ab(r) = |sum_p g_p(r) e^{ik k_p.(r-rx)} A_p|^2
    V = P[I]; cen = V.mean(1); nr = np.cross(V[:, 1] - V[:, 0], V[:, 2] - V[:, 0]); ar = 0.5 * np.linalg.norm(nr, axis=1)
    nr = nr / np.maximum(2 * ar[:, None], 1e-12)
    karr = np.array([p['k'] for p in paths])
    Q = np.zeros((M, M), complex)
    for s in range(0, len(cen), 4000):
        c = np.clip(-(nr[s:s + 4000] @ karr.T), 0, None)                    # T x P
        T = 1 - (1 - c) ** 4
        B = np.sqrt(c * T) * np.exp(1j * k * ((cen[s:s + 4000] - rx) @ karr.T))
        G = B @ Apm                                                          # T x M
        Q += (G.conj().T * ar[s:s + 4000]) @ G
    Q = 0.5 * (Q + Q.conj().T)
    x_mrt = h.conj() / np.linalg.norm(h)
    sig = lambda x: abs(h @ x) ** 2
    pab = lambda x: float(np.real(x.conj() @ Q @ x))
    s0, p0 = sig(x_mrt), pab(x_mrt)
    # ECBF (Ying et al.): x = (Q + nu I)^-1 h*, normalised to unit power; sweep nu from large (MRT) to small
    w, U = np.linalg.eigh(Q)
    hb = U.conj().T @ h.conj()
    def ecbf(nu):
        x = U @ (hb / (w + nu)); return x / np.linalg.norm(x)
    nus = np.logspace(math.log10(w.max()) + 4, math.log10(max(w.max() * 1e-9, 1e-30)), 400)
    front = [(nu, sig(ecbf(nu)) / s0, pab(ecbf(nu)) / p0) for nu in nus]
    # the half-signal point
    i = next(j for j, f in enumerate(front) if f[1] <= 0.5)
    lo, hi = front[i - 1][0], front[i][0]
    for _ in range(60):
        mid = math.sqrt(lo * hi)
        if sig(ecbf(mid)) / s0 > 0.5: lo = mid
        else: hi = mid
    nu_h = math.sqrt(lo * hi); x_h = ecbf(nu_h)
    supp = p0 / pab(x_h)
    print(f'film 27: {len(paths)} paths, M={M}, ECBF at half signal: absorbed / {supp:.2f}')
    # precoder rows from MRT to the half-signal ECBF, evenly in log absorbed power
    R = 24
    targets = np.exp(np.linspace(0, -math.log(supp), R))
    rows = []
    lo_nu = nu_h
    for tgt in targets:
        if tgt >= 0.9999: rows.append(x_mrt); continue
        a_, b_ = lo_nu, w.max() * 1e8
        for _ in range(80):
            mid = math.sqrt(a_ * b_)
            if pab(ecbf(mid)) / p0 > tgt: b_ = mid
            else: a_ = mid
        rows.append(ecbf(math.sqrt(a_ * b_)))
    rows_sig = [sig(x) / s0 for x in rows]; rows_pab = [pab(x) / p0 for x in rows]
    Arow = np.array([Apm @ x for x in rows])                    # R x P effective path amplitudes
    norm = math.sqrt((abs(Arow[0]) ** 2).sum())
    Arow /= norm
    order = np.argsort(-abs(Arow).max(0))
    pmax = (abs(Arow) ** 2).max()
    order = [j for j in order if (abs(Arow[:, j]) ** 2).max() > pmax * 10 ** (-3.5)]
    out = dict(film=27, lam=sc['lam'], k=k, rx=rx.tolist(), rows=R, sig=rows_sig, pab=rows_pab, suppression=supp,
               elements=(off + np.array(u['centre'])).tolist(), xrows=[[[float(v.real), float(v.imag)] for v in x] for x in (rows[0], rows[-1])],
               paths=[dict(pts=paths[j]['pts'], L=paths[j]['L'], k=paths[j]['k'], kd=paths[j]['kd'], mats=paths[j]['mats'], order=paths[j]['order'],
                           tBody=paths[j]['tBody'], A=[[float(Arow[r, j].real), float(Arow[r, j].imag)] for r in range(R)]) for j in order])
    (D / 'paths27.json').write_text(json.dumps(out))
    print('rows signal', [round(v, 3) for v in rows_sig[::4]], 'pabs', [round(v, 3) for v in rows_pab[::4]], 'kept paths', len(order))


if __name__ == '__main__':
    {'10': film10, '27': film27}[sys.argv[1]]()
