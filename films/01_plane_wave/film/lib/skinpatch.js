// Skin patch geometry, ported from the AEGIS film (~/phd/VIDEO/film/lib/s4/patch.js) so both films share the form:
// a curved shoulder-like skin surface whose front face (y = y0) is a cutaway section. Metres; x right, y back, z up.
import * as THREE from 'three';
import { mulberry32, seedFrom } from './prng.js';

export const PATCH = {
  x0: -0.19, x1: 0.20,     // block extent along the cut face
  y0: -0.15, y1: 0.15,     // y0 = the cut plane (front face)
  yF: -0.33,               // front end of the slab that the section sweep removes
  cell: 0.0145,            // triangle size ~1.5 cm
  depth: 0.05,             // drawn depth of the section below the surface (true scale here)
};

// Shoulder-like bulge: stronger curvature across x, gentle along y, plus a soft seeded undulation.
const CX = -0.035, CY = -0.125, RX = 0.29, RY = 0.30;
const rnd = mulberry32(seedFrom('S4.patch'));
const WAVES = Array.from({ length: 5 }, () => ({
  kx: (rnd() - 0.5) * 60, ky: (rnd() - 0.5) * 60, ph: rnd() * 6.283, a: 0.0006 + rnd() * 0.0008,
}));
const ROWS = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 10, 12.5].map((r) => r / 12.5);
export function height(x, y) {
  let z = -((x - CX) ** 2) / (2 * RX) - ((y - CY) ** 2) / (2 * RY);
  for (const w of WAVES) z += w.a * Math.sin(w.kx * x + w.ky * y + w.ph);
  return z;
}
export function normal(x, y) {
  const e = 1e-5;
  const hx = (height(x + e, y) - height(x - e, y)) / (2 * e);
  const hy = (height(x, y + e) - height(x, y - e)) / (2 * e);
  const l = Math.hypot(hx, hy, 1);
  return [-hx / l, -hy / l, 1 / l];
}

/**
 * Jittered-grid triangulation from yF to y1 with an unjittered row at the cut plane y0, so the cut edge is
 * an exact mesh polyline. Border and cut-row vertices only slide along their line.
 */
function grid() {
  const { x0, x1, y0, y1, yF, cell } = PATCH;
  const nx = Math.round((x1 - x0) / cell);
  const nF = Math.round((y0 - yF) / cell), nB = Math.round((y1 - y0) / cell);
  const ny = nF + nB, j0 = nF;
  const dx = (x1 - x0) / nx;
  const rowY = (j) => (j <= j0 ? yF + (y0 - yF) * j / nF : y0 + (y1 - y0) * (j - j0) / nB);
  const r = mulberry32(seedFrom('S4.mesh'));
  const V = [];
  for (let j = 0; j <= ny; j++) {
    const dy = j < j0 ? (y0 - yF) / nF : (y1 - y0) / nB;
    for (let i = 0; i <= nx; i++) {
      let x = x0 + i * dx, y = rowY(j);
      const jx = (r() - 0.5) * 0.62 * dx, jy = (r() - 0.5) * 0.62 * dy;
      if (i > 0 && i < nx) x += jx;
      if (j > 0 && j < ny && j !== j0) y += jy;
      V.push([x, y]);
    }
  }
  const T = [];
  const id = (i, j) => j * (nx + 1) + i;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
      // Shorter diagonal, so the triangles stay well shaped like a remeshed scan.
      const dac = Math.hypot(V[a][0] - V[c][0], V[a][1] - V[c][1]);
      const dbd = Math.hypot(V[b][0] - V[d][0], V[b][1] - V[d][1]);
      if (dac < dbd) T.push([a, b, c], [a, c, d]); else T.push([a, b, d], [b, c, d]);
    }
  }
  return { V, T, nx, ny, j0 };
}

/** Non-indexed surface with smooth (analytic) normals. */
export function surfaceGeometry() {
  const { V, T, nx, j0 } = grid();
  const pos = [], nor = [];
  for (const tri of T) for (const vi of tri) { const [x, y] = V[vi]; pos.push(x, y, height(x, y)); nor.push(...normal(x, y)); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  // Cut-row polyline (j = j0): the cut face follows it exactly.
  const front = [];
  for (let i = 0; i <= nx; i++) { const [x, y] = V[j0 * (nx + 1) + i]; front.push([x, y, height(x, y)]); }
  return { geometry: g, front };
}

/**
 * Cut face below the front-edge polyline. Columns at the polyline vertices (subdivided), rows down to
 * PATCH.depth. Attribute aTop: the surface z above.
 */
export function cutGeometry(front) {
  const cols = [];
  for (let i = 0; i < front.length - 1; i++) {
    const a = front[i], b = front[i + 1];
    for (let s = 0; s < 4; s++) {
      const u = s / 4;
      cols.push([a[0] + (b[0] - a[0]) * u, a[1], a[2] + (b[2] - a[2]) * u]);
    }
  }
  cols.push(front[front.length - 1]);
  const rows = ROWS;
  const pos = [], top = [], idx = [];
  for (const c of cols) {
    for (const r of rows) {
      pos.push(c[0], c[1], c[2] - r * PATCH.depth);
      top.push(c[2]);
    }
  }
  const R = rows.length;
  for (let i = 0; i < cols.length - 1; i++) {
    for (let j = 0; j < R - 1; j++) {
      const a = i * R + j, b = (i + 1) * R + j, c = (i + 1) * R + j + 1, d = i * R + j + 1;
      idx.push(a, d, b, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
  g.setIndex(idx);
  return g;
}

/**
 * Moving section face of the front slab, in the plane x = xc from yF to y0 (rebuilt each frame by setSide).
 */
export function sideGeometry() {
  const NY = 48, rows = ROWS, R = rows.length;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((NY + 1) * R * 3), 3));
  g.setAttribute('aTop', new THREE.BufferAttribute(new Float32Array((NY + 1) * R), 1));
  const idx = [];
  for (let i = 0; i < NY; i++) for (let j = 0; j < R - 1; j++) {
    const a = i * R + j, b = (i + 1) * R + j, c = (i + 1) * R + j + 1, d = i * R + j + 1;
    idx.push(a, b, d, b, c, d);
  }
  g.setIndex(idx);
  g.userData = { NY, rows };
  return g;
}
export function setSide(g, xc) {
  const { NY, rows } = g.userData, R = rows.length;
  const P = g.attributes.position.array, Tp = g.attributes.aTop.array;
  for (let i = 0; i <= NY; i++) {
    const y = PATCH.yF + (PATCH.y0 - PATCH.yF) * i / NY, top = height(xc, y);
    for (let j = 0; j < R; j++) {
      const k = i * R + j;
      P[k * 3] = xc; P[k * 3 + 1] = y; P[k * 3 + 2] = top - rows[j] * PATCH.depth;
      Tp[k] = top;
    }
  }
  g.attributes.position.needsUpdate = true; g.attributes.aTop.needsUpdate = true;
  g.computeBoundingSphere();
}

