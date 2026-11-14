// Plane sections of frozen meshes: the head and the phone cut at ear height.
import * as THREE from 'three';

// World-space triangles of a mesh (skinned or not), as a flat Float32Array of 9 numbers per triangle; keep(a,b,c) filters.
export function worldTris(mesh, keep = () => true) {
  mesh.updateMatrixWorld(true);
  const g = mesh.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count;
  const P = new Array(pos.count), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    if (mesh.isSkinnedMesh) mesh.getVertexPosition(i, v); else v.fromBufferAttribute(pos, i);
    v.applyMatrix4(mesh.matrixWorld); P[i] = [v.x, v.y, v.z];
  }
  const out = [];
  for (let k = 0; k < n; k += 3) {
    const ia = idx ? idx.getX(k) : k, ib = idx ? idx.getX(k + 1) : k + 1, ic = idx ? idx.getX(k + 2) : k + 2;
    if (keep(P[ia], P[ib], P[ic], ia, ib, ic)) out.push(...P[ia], ...P[ib], ...P[ic]);
  }
  return new Float32Array(out);
}

const key = (p) => `${Math.round(p[0] * 2e5)},${Math.round(p[1] * 2e5)},${Math.round(p[2] * 2e5)}`;
// Closed loops [[x, y], ...] where the triangles cross the plane z = z0. Each crossing is keyed by its mesh edge,
// so neighbouring triangles produce the same point and the segments chain.
export function sectionLoops(T, z0) {
  const next = new Map(), pts = new Map();
  const cross = (p, q) => {
    const [a, b] = key(p) < key(q) ? [p, q] : [q, p];
    const u = (z0 - a[2]) / (b[2] - a[2]), k = key(a) + '|' + key(b);
    if (!pts.has(k)) pts.set(k, [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    return k;
  };
  for (let i = 0; i < T.length; i += 9) {
    const v = [[T[i], T[i + 1], T[i + 2]], [T[i + 3], T[i + 4], T[i + 5]], [T[i + 6], T[i + 7], T[i + 8]]];
    const ks = [];
    for (let e = 0; e < 3; e++) { const p = v[e], q = v[(e + 1) % 3]; if ((p[2] > z0) !== (q[2] > z0)) ks.push(cross(p, q)); }
    if (ks.length === 2) {
      if (!next.has(ks[0])) next.set(ks[0], []); if (!next.has(ks[1])) next.set(ks[1], []);
      next.get(ks[0]).push(ks[1]); next.get(ks[1]).push(ks[0]);
    }
  }
  const seen = new Set(), loops = [];
  for (const s of next.keys()) {
    if (seen.has(s)) continue;
    const loop = []; let prev = null, cur = s;
    while (cur && !seen.has(cur)) {
      seen.add(cur); loop.push(pts.get(cur));
      const nb = next.get(cur).filter((k) => k !== prev && !seen.has(k));
      prev = cur; cur = nb[0];
    }
    if (loop.length > 5) loops.push(loop);
  }
  return loops;
}

const area = (L) => L.reduce((s, p, i) => { const q = L[(i + 1) % L.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
function inside(p, L) {
  let c = false;
  for (let i = 0, j = L.length - 1; i < L.length; j = i++) {
    const a = L[i], b = L[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
// Filled cross-section at height z (even-odd: a loop inside an odd number of others is a hole).
export function capGeometry(loops, z) {
  const V = [], I = [];
  const outer = [], holes = [];
  loops.forEach((L) => { const depth = loops.filter((M) => M !== L && Math.abs(area(M)) > Math.abs(area(L)) && inside(L[0], M)).length; (depth % 2 ? holes : outer).push(L); });
  for (const L of outer) {
    const contour = (area(L) < 0 ? L.slice().reverse() : L).map((p) => new THREE.Vector2(p[0], p[1]));
    const hs = holes.filter((H) => inside(H[0], L)).map((H) => (area(H) > 0 ? H.slice().reverse() : H).map((p) => new THREE.Vector2(p[0], p[1])));
    const tri = THREE.ShapeUtils.triangulateShape(contour, hs), all = contour.concat(...hs), o = V.length / 3;
    all.forEach((p) => V.push(p.x, p.y, z));
    tri.forEach((t) => I.push(o + t[0], o + t[1], o + t[2]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(V, 3)); g.setIndex(I);
  return g;
}
export function outlineGeometry(loops, z) {
  const V = [];
  for (const L of loops) L.forEach((p, i) => { const q = L[(i + 1) % L.length]; V.push(p[0], p[1], z, q[0], q[1], z); });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
  return g;
}
