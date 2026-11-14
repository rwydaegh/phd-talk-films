// The stairwell digital twin: room (Revit mesh), robot (Velmex CAD), the Tx on its pole, sharp room edges that
// can draw themselves on, and fat-line rays. World = frame B (metres, z up).
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { GLSL_COMMON, fetchBin, fetchJSON } from './common.js';

const VS = `in vec3 position; in vec3 normal; in float cls; uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix;
out vec3 vN; out vec3 vW; flat out float vCls; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vCls = cls;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FS = `precision highp float; ${GLSL_COMMON}
in vec3 vN; in vec3 vW; flat in float vCls; out vec4 frag;
uniform vec3 uCam, uKey; uniform vec3 uCol0, uCol1, uCol2, uCol3; uniform float uOpacity, uBright;
void main(){
  vec3 n = normalize(vN); vec3 v = normalize(uCam - vW);
  if (dot(n, v) < 0.0) n = -n;
  vec3 base = vCls < 0.5 ? uCol0 : vCls < 1.5 ? uCol1 : vCls < 2.5 ? uCol2 : uCol3;
  float key = max(dot(n, normalize(uKey)), 0.0);
  float hemi = 0.55 + 0.45 * n.z;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 lin = base * (0.35 * hemi + 0.75 * key) + base * rim * 0.25;
  frag = vec4(invTone(pow(lin * uBright, vec3(1.0 / 2.2))) * uOpacity, uOpacity);
}`;

function solid(pos, cls, cols) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('cls', new THREE.BufferAttribute(cls, 1));
  g.computeVertexNormals();
  const u = { uCam: { value: new THREE.Vector3() }, uKey: { value: new THREE.Vector3(0.4, -0.6, 0.9) }, uOpacity: { value: 1 }, uBright: { value: 1 },
    uCol0: { value: new THREE.Color(...cols[0]) }, uCol1: { value: new THREE.Color(...(cols[1] || cols[0])) }, uCol2: { value: new THREE.Color(...(cols[2] || cols[0])) }, uCol3: { value: new THREE.Color(...(cols[3] || cols[0])) } };
  // premultiplied blend so a solid can dissolve in; depth is always written (opacity 0 = depth only)
  const m = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, uniforms: u, side: THREE.DoubleSide,
    transparent: true, depthWrite: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.userData.u = u;
  return mesh;
}

export class Twin {
  static async load(W, H) {
    const t = new Twin(); t.W = W; t.H = H;
    t.meta = await fetchJSON('assets/twin/twin.json');
    t.rays = await fetchJSON('assets/twin/rays.json');
    t.group = new THREE.Group();
    // room: walls/stairs concrete (0), steel balustrade (1), door wood (2)
    let b = await fetchBin('assets/twin/room.bin'); let n = t.meta.room_verts;
    t.room = solid(new Float32Array(b, 0, n * 3), new Float32Array(b, n * 12, n), [[0.30, 0.32, 0.35], [0.62, 0.64, 0.66], [0.36, 0.30, 0.24]]);
    // robot: base dark (0), upright dark (1), probe tip yellow (2/3)
    b = await fetchBin('assets/twin/robot.bin').catch(() => null); n = b ? t.meta.robot_verts : 0;   // robot.bin is not in the public repo
    if (!b) b = new ArrayBuffer(0);
    t.robot = solid(new Float32Array(b, 0, n * 3), new Float32Array(b, n * 12, n), [[0.06, 0.065, 0.075], [0.06, 0.065, 0.075], [0.95, 0.72, 0.05], [0.95, 0.72, 0.05]]);
    t.group.add(t.room, t.robot);
    t.tx = t.buildTx(); t.group.add(t.tx);
    // edges
    b = await fetchBin('assets/twin/room_edges.bin');
    t.edges = new Float32Array(b);
    t.nEdges = t.edges.length / 6;
    t.edgeOrder = t.orderEdges();
    t.edgeGeo = new LineSegmentsGeometry(); t.edgeGeo.setPositions(t.edges);
    t.edgeMat = new LineMaterial({ color: 0xffffff, linewidth: 1.4 * H / 1080, transparent: true, opacity: 1, depthTest: true, worldUnits: false });
    t.edgeMat.resolution.set(W, H);
    t.edgeLines = new LineSegments2(t.edgeGeo, t.edgeMat); t.edgeLines.frustumCulled = false;
    t.group.add(t.edgeLines);
    return t;
  }
  buildTx() {
    // The 28 GHz Butler set: a small dark cage aperture (about 14 x 20 cm) on a black pole, tilted 11.5 deg down,
    // its face turned toward the scan volume. Position from the photo triangulation (twin README).
    const g = new THREE.Group();
    const C = this.meta.tx, T = this.meta.target;
    const dark = (x) => solid(x.attributes.position.array, new Float32Array(x.attributes.position.count), [[0.16, 0.16, 0.18]]);
    const box = (sx, sy, sz) => { const b = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed(); return b; };
    const face = dark(box(0.02, 0.14, 0.20));
    const grid = new THREE.Group();
    for (let i = 0; i < 4; i++) { const e = solid(box(0.006, 0.012, 0.17).attributes.position.array, new Float32Array(box(0.006, 0.012, 0.17).attributes.position.count).fill(1), [[0.05, 0.05, 0.06], [0.85, 0.62, 0.22]]); e.position.set(-0.012, -0.045 + i * 0.03, 0); grid.add(e); }
    const head = new THREE.Group(); head.add(face, grid);
    head.position.set(...C);
    // face normal (local -x) toward the target in plan, tilted 11.5 deg down
    const d = new THREE.Vector3(T[0] - C[0], T[1] - C[1], 0).normalize();
    const az = Math.atan2(d.y, d.x);
    head.rotation.set(0, 0, 0); head.rotateZ(az + Math.PI); head.rotateY(-11.5 * Math.PI / 180);
    g.add(head);
    const floor = this.meta.floor_tx;
    const L = C[2] - 0.1 - floor;
    const pole = dark(new THREE.CylinderGeometry(0.012, 0.012, L, 12).toNonIndexed());
    pole.rotation.x = Math.PI / 2; pole.position.set(C[0], C[1], floor + L / 2);
    g.add(pole);
    // tripod legs
    for (let i = 0; i < 3; i++) {
      const a = i * 2 * Math.PI / 3 + 0.4, r = 0.32, h = 0.55;
      const leg = dark(new THREE.CylinderGeometry(0.008, 0.008, Math.hypot(r, h), 8).toNonIndexed());
      const top = new THREE.Vector3(C[0], C[1], floor + h), foot = new THREE.Vector3(C[0] + r * Math.cos(a), C[1] + r * Math.sin(a), floor);
      leg.position.copy(top).add(foot).multiplyScalar(0.5);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), foot.clone().sub(top).normalize());
      g.add(leg);
    }
    this.txHead = head;
    return g;
  }
  orderEdges() {
    // draw-on order: by distance from the robot corner, so the twin grows out of the measurement
    const o = [-0.2, 0, 0.1], d = [];
    for (let i = 0; i < this.nEdges; i++) { const e = this.edges.subarray(i * 6, i * 6 + 6); d.push(Math.hypot((e[0] + e[3]) / 2 - o[0], (e[1] + e[4]) / 2 - o[1], (e[2] + e[5]) / 2 - o[2])); }
    const max = Math.max(...d);
    return d.map((x) => x / max);
  }
  // p in [0,1]: each edge starts at its order value * 0.75 and takes 0.25 to draw from its nearer end
  drawEdges(p, opacity) {
    const out = new Float32Array(this.edges.length);
    for (let i = 0; i < this.nEdges; i++) {
      const s = Math.min(1, Math.max(0, (p - this.edgeOrder[i] * 0.75) / 0.25));
      const e = this.edges.subarray(i * 6, i * 6 + 6);
      for (let k = 0; k < 3; k++) { out[i * 6 + k] = e[k]; out[i * 6 + 3 + k] = e[k] + (e[3 + k] - e[k]) * s; }
    }
    this.edgeGeo.setPositions(out);
    this.edgeMat.opacity = opacity;
    this.edgeLines.visible = opacity > 0.002 && p > 0;
  }
  setCam(cam) { this.group.traverse((m) => { if (m.userData.u) m.userData.u.uCam.value.copy(cam.position); }); }
  setLook({ room = 1, robot = 1, tx = 1, bright = 1 } = {}) {
    this.room.userData.u.uOpacity.value = room; this.room.visible = room > 0.002; this.room.userData.u.uBright.value = bright;
    this.robot.userData.u.uOpacity.value = robot; this.robot.visible = robot > 0.002;
    this.tx.visible = tx > 0.002;
    this.tx.traverse((m) => { if (m.userData.u) { m.userData.u.uOpacity.value = tx; m.userData.u.uBright.value = bright * 1.6; } });
  }
}

// Line geometry keeps the instance count of its first setPositions, so every update carries all n segments
// (the unused ones collapsed onto the last point).
function padSegs(out, n) {
  const last = out.length ? out.slice(-3) : [0, 0, 0];
  while (out.length < n * 6) out.push(...last, ...last);
  return out;
}

// Fat polyline rays that grow from the source: pts (world), progress 0..1 along total length.
export class Rays {
  constructor(paths, W, H) {
    this.paths = paths; this.group = new THREE.Group(); this.lines = [];
    for (const p of paths) {
      const geo = new LineSegmentsGeometry();
      const mat = new LineMaterial({ color: 0xffffff, linewidth: 2.2 * H / 1080, transparent: true, opacity: 1, depthTest: true, worldUnits: false });
      mat.resolution.set(W, H);
      const l = new LineSegments2(geo, mat); l.frustumCulled = false;
      const pg = new LineSegmentsGeometry();
      const pm = new LineMaterial({ color: 0xffffff, linewidth: 4.5 * H / 1080, transparent: true, opacity: 1, depthTest: true, worldUnits: false });
      pm.resolution.set(W, H);
      const pl = new LineSegments2(pg, pm); pl.frustumCulled = false;
      this.group.add(l, pl); this.lines.push({ l, geo, mat, p, pl, pg, pm });
    }
  }
  // polyline of path p between length fractions a..b (0..1)
  sub(p, a, b) {
    const pts = p.pts.map((q) => new THREE.Vector3(...q));
    const seg = []; let L = 0; for (let k = 0; k < pts.length - 1; k++) { const d = pts[k].distanceTo(pts[k + 1]); seg.push(d); L += d; }
    const out = []; let s0 = 0;
    for (let k = 0; k < seg.length; k++) {
      const s1 = s0 + seg[k] / L;
      const lo = Math.max(a, s0), hi = Math.min(b, s1);
      if (hi > lo) { const A = pts[k].clone().lerp(pts[k + 1], (lo - s0) / (s1 - s0)), B = pts[k].clone().lerp(pts[k + 1], (hi - s0) / (s1 - s0)); out.push(...A.toArray(), ...B.toArray()); }
      s0 = s1;
    }
    return out;
  }
  // a short bright pulse travelling along ray i, head at fraction h
  pulse(i, h, len, opacity) {
    const { pl, pg, pm, p } = this.lines[i];
    const out = this.sub(p, Math.max(0, h - len), Math.min(1, h));
    pl.visible = opacity > 0.002 && out.length > 0;
    if (out.length) pg.setPositions(padSegs(out, p.pts.length - 1));
    pm.opacity = opacity;
  }
  set(i, prog, opacity, color) {
    const { geo, mat, p } = this.lines[i];
    const pts = p.pts.map((q) => new THREE.Vector3(...q));
    const seg = []; let L = 0; for (let k = 0; k < pts.length - 1; k++) { const d = pts[k].distanceTo(pts[k + 1]); seg.push(d); L += d; }
    let left = prog * L; const out = [];
    for (let k = 0; k < seg.length && left > 1e-5; k++) {
      const f = Math.min(1, left / seg[k]); const b = pts[k].clone().lerp(pts[k + 1], f);
      out.push(...pts[k].toArray(), ...b.toArray()); left -= seg[k];
    }
    if (!out.length) out.push(...pts[0].toArray(), ...pts[0].toArray());
    geo.setPositions(padSegs(out, pts.length - 1)); mat.opacity = opacity; if (color) mat.color.set(color);
    this.lines[i].l.visible = opacity > 0.002 && prog > 0;
  }
}
