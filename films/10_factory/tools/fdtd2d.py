"""A real FDTD run for the slice of film 10: 2D TMz (Ez, Hx, Hy) on a horizontal cut through the head at the
height of the phone, inside the Huygens box. The tissues are Duke's (IT'IS ViP, head_vox.bin) fitted into the
worker's own cross-section; the excitation is the traced multipath field handed over at the box (each path a
plane wave, its in-plane direction, MRT amplitude and phase), in scattered-field form, so the total field is
  E = E_inc (the rays' sum) + E_s (what the head adds: reflection, shadow, absorption).
Steady state by a running DFT at f. Writes film/data/slice10.bin (float16 Re, Im of Ez, then uint8 classes)
and slice10.json. Dielectric properties at 28 GHz: IT'IS tissue database (Gabriel 4-Cole-Cole), rounded.
"""
import json
import math
from pathlib import Path

import numpy as np

D = Path(__file__).resolve().parent.parent / 'film' / 'data'
EPS0, MU0, C0 = 8.8541878128e-12, 4e-7 * math.pi, 299792458.0
# class: (eps_r, sigma S/m) at ~28 GHz
PROPS = {0: (1.0, 0.0), 1: (16.6, 25.8), 2: (3.7, 1.9), 3: (24.4, 33.6), 4: (5.4, 4.6), 5: (22.9, 33.6),
         6: (16.0, 21.6), 7: (34.6, 50.9), 8: (33.0, 48.0), 9: (27.6, 42.3), 10: (16.3, 21.3)}

pa = json.loads((D / 'paths10.json').read_text())
meta = json.loads((D / 'pose10.json').read_text())
hv = json.loads((D / 'head_vox.json').read_text())
f = 27.9e9; w = 2 * math.pi * f; k0 = w / C0
rx = np.array(pa['rx']); zs = float(rx[2])
bc, bh = np.array(pa['hbox'][0]), np.array(pa['hbox'][1])

# ---- the worker's head cross-section at z = zs (non-arm triangles)
raw = (D / 'pose10.bin').read_bytes(); nv = meta['n']
P = np.frombuffer(raw[:nv * 12], np.float32).reshape(-1, 3).astype(float)
I = np.frombuffer(raw[nv * 12:], np.uint32).reshape(-1, 3)
arm = np.frombuffer((D / 'pose10_arm.bin').read_bytes(), np.uint8).astype(bool)
I = I[~arm[I].any(1)]
V = P[I]
s = V[:, :, 2] - zs
cross = (s.min(1) < 0) & (s.max(1) > 0)
V, s = V[cross], s[cross]
segs = []
for tri, sv in zip(V, s):
    pts = []
    for a, b in ((0, 1), (1, 2), (2, 0)):
        if (sv[a] < 0) != (sv[b] < 0):
            u = sv[a] / (sv[a] - sv[b]); pts.append(tri[a] + (tri[b] - tri[a]) * u)
    if len(pts) == 2: segs.append((pts[0][:2], pts[1][:2]))
segs = np.array(segs)
near = np.all(np.abs(segs - bc[:2]) < bh[:2] + 0.02, axis=(1, 2))
segs = segs[near]
print('section segments', len(segs))

dx = 0.36e-3
pml = 40
lo = bc[:2] - bh[:2]; hi = bc[:2] + bh[:2]
nx, ny = int(round((hi[0] - lo[0]) / dx)), int(round((hi[1] - lo[1]) / dx))
NX, NY = nx + 2 * pml, ny + 2 * pml
xs = lo[0] + (np.arange(NX) - pml + 0.5) * dx; ys = lo[1] + (np.arange(NY) - pml + 0.5) * dx
X, Y = np.meshgrid(xs, ys, indexing='ij')
# even-odd fill by horizontal crossings (rays along +x)
inside = np.zeros((NX, NY), bool)
a, b = segs[:, 0], segs[:, 1]
for j, y in enumerate(ys):
    m = (a[:, 1] <= y) != (b[:, 1] <= y)
    if not m.any(): continue
    xc = np.sort(a[m, 0] + (y - a[m, 1]) / (b[m, 1] - a[m, 1]) * (b[m, 0] - a[m, 0]))
    cnt = np.searchsorted(xc, xs)
    inside[:, j] = (cnt % 2) == 1
print('head area cm2', inside.sum() * dx * dx * 1e4)

# ---- Duke's slice at his ear height, rotated 180 deg (he faces +y, the worker faces -y) and fitted to the section
n = hv['n']; vox = np.frombuffer((D / 'head_vox.bin').read_bytes(), np.uint8).reshape(n[2], n[1], n[0])
p = hv['pitch']; o = np.array(hv['origin'])
kz = int(round((0.5 * (hv['earR'][2] + hv['earL'][2]) - o[2]) / p))
sl = vox[kz]                                                  # [y][x]
tis = np.argwhere(sl > 0)
dyl, dxl = o[1] + (tis[:, 0] + 0.5) * p, o[0] + (tis[:, 1] + 0.5) * p
# world bbox of the section vs Duke's (rotated) bbox
wi = np.argwhere(inside)
wx0, wx1 = xs[wi[:, 0]].min(), xs[wi[:, 0]].max(); wy0, wy1 = ys[wi[:, 1]].min(), ys[wi[:, 1]].max()
rx_, ry_ = -dxl, -dyl
sx = (wx1 - wx0) / (rx_.max() - rx_.min()); sy = (wy1 - wy0) / (ry_.max() - ry_.min())
print(f'fit scale x {sx:.3f} y {sy:.3f}')
# sample Duke at each inside cell (nearest)
dxq = -((X - wx0) / sx + rx_.min()); dyq = -((Y - wy0) / sy + ry_.min())
ix = np.clip(((dxq - o[0]) / p).astype(int), 0, n[0] - 1); iy = np.clip(((dyq - o[1]) / p).astype(int), 0, n[1] - 1)
cls = sl[iy, ix]
cls = np.where(inside, np.where(cls == 0, 1, cls), 0).astype(np.uint8)
# a skin layer one Duke voxel thick along the worker's outline (the fit may leave other tissue on the edge)
from scipy.ndimage import binary_erosion
core = binary_erosion(inside, iterations=max(1, int(round(1.2e-3 / dx))))
cls = np.where(inside & ~core, 1, cls).astype(np.uint8)

eps = np.ones((NX, NY)); sig = np.zeros((NX, NY))
for c, (e, sg) in PROPS.items():
    m = cls == c; eps[m] = e; sig[m] = sg
eps *= EPS0

# ---- incident field: the traced paths as plane waves (in-plane direction, full k), phases referred to the phone
paths = pa['paths']
A = np.array([complex(*q['A']) for q in paths])
K = np.array([q['k'] for q in paths])[:, :2]
K /= np.linalg.norm(K, axis=1, keepdims=True)
# exact 3D phase at the slice plane is k k.(r - rx); in 2D we keep the in-plane direction at the free-space k
def einc_phasor(xx, yy):
    E = np.zeros(xx.shape, complex)
    for a_, k_ in zip(A, K): E += a_ * np.exp(1j * k0 * (k_[0] * (xx - rx[0]) + k_[1] * (yy - rx[1])))
    return E
Ei = einc_phasor(X, Y)                                         # e^{-i w t} convention: E(t) = Re(Ei e^{-iwt})

dt = 0.99 * dx / (C0 * math.sqrt(2))
nper = 1 / (f * dt)
nsteps = int(60 * nper)
# graded absorbing layer (matched electric/magnetic conductivity)
prof = lambda d: (d / pml) ** 3
smax = 0.8 * 4 / (math.sqrt(MU0 / EPS0) * dx)
sx_ = np.zeros(NX); sy_ = np.zeros(NY)
for i in range(pml):
    sx_[i] = sx_[NX - 1 - i] = smax * prof(pml - i); sy_[i] = sy_[NY - 1 - i] = smax * prof(pml - i)
SX, SY = np.meshgrid(sx_, sy_, indexing='ij')
sigE = sig + SX + SY
ca = (1 - sigE * dt / (2 * eps)) / (1 + sigE * dt / (2 * eps)); cb = (dt / eps) / (1 + sigE * dt / (2 * eps))
# H: Hx couples to dEz/dy (graded in y), Hy to dEz/dx (graded in x)
smy = (SY[:, :-1] + SY[:, 1:]) / 2 * MU0 / EPS0; smx = (SX[:-1, :] + SX[1:, :]) / 2 * MU0 / EPS0
dax = (1 - smy * dt / (2 * MU0)) / (1 + smy * dt / (2 * MU0)); dbx = (dt / MU0) / (1 + smy * dt / (2 * MU0))
day = (1 - smx * dt / (2 * MU0)) / (1 + smx * dt / (2 * MU0)); dby = (dt / MU0) / (1 + smx * dt / (2 * MU0))
deps = eps - EPS0
src = (deps != 0) | (sig != 0)
Ez = np.zeros((NX, NY)); Hx = np.zeros((NX, NY - 1)); Hy = np.zeros((NX - 1, NY))
acc = np.zeros((NX, NY), complex)
ndft = int(round(2 * nper)); t0dft = nsteps - ndft
ramp_T = 8 / f
Eis, dEis = Ei[src], (-1j * w) * Ei[src]
print(f'grid {NX}x{NY}, dt {dt*1e12:.3f} ps, {nsteps} steps')
for n_ in range(nsteps):
    t = (n_ + 0.5) * dt                                       # E update centred at n+1/2
    r = 1.0 if t > ramp_T else 0.5 * (1 - math.cos(math.pi * t / ramp_T))
    dr = 0.0 if t > ramp_T else 0.5 * math.pi / ramp_T * math.sin(math.pi * t / ramp_T)
    ph = np.exp(-1j * w * t)
    einc = (Eis * ph).real * r
    deinc = (dEis * ph).real * r + (Eis * ph).real * dr
    Hx = dax * Hx - dbx * (Ez[:, 1:] - Ez[:, :-1]) / dx
    Hy = day * Hy + dby * (Ez[1:, :] - Ez[:-1, :]) / dx
    curl = np.zeros_like(Ez)
    curl[1:-1, 1:-1] = (Hy[1:, 1:-1] - Hy[:-1, 1:-1]) / dx - (Hx[1:-1, 1:] - Hx[1:-1, :-1]) / dx
    J = np.zeros_like(Ez); J[src] = deps[src] * deinc + sig[src] * einc
    Ez = ca * Ez + cb * (curl - J)
    if n_ >= t0dft:
        tt = (n_ + 1) * dt
        acc += Ez * np.exp(1j * w * tt)
    if n_ % 500 == 0: print(n_, float(np.abs(Ez).max()), flush=True)
Es = acc * 2 / ndft
Etot = Ei + Es
crop = (slice(pml, pml + nx), slice(pml, pml + ny))
E = Etot[crop]; C = cls[crop]
print('|E| max outside', np.abs(E[C == 0]).max(), 'inside', np.abs(E[C > 0]).max(), 'at phone', abs(einc_phasor(np.array([rx[0]]), np.array([rx[1]]))[0]))
out = np.stack([E.real, E.imag], -1).astype(np.float16)
(D / 'slice10.bin').write_bytes(out.tobytes() + C.astype(np.uint8).tobytes())
(D / 'slice10.json').write_text(json.dumps({'nx': nx, 'ny': ny, 'dx': dx, 'lo': lo.tolist(), 'z': zs, 'f': f,
                                            'layout': 'float16 [x][y][re,im] then uint8 classes [x][y]', 'classes': hv['classes']}))
