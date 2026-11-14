// The textbook plane wave (view A): E and H arrow trains at right angles on the propagation axis,
// lit like a product shot. Units: metres. Geometry of a wave: origin o (the packet's head), axis k, E direction e.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function studioEnv(renderer) {
  // Black room with three softboxes (key, rim, kicker) for reflections on the arrows.
  const s = new THREE.Scene();
  s.background = new THREE.Color(0, 0, 0);
  const box = (w, h, pos, col, I) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col[0] * I, col[1] * I, col[2] * I), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); s.add(m);
  };
  box(3.2, 2.0, [-3, 4, 2.5], [1, 0.95, 0.88], 7);     // key, warm, high
  box(0.6, 5.0, [4, -1, 0.5], [0.75, 0.88, 1], 9);     // rim strip, cool
  box(0.5, 4.0, [-1, -4, -1], [0.7, 0.85, 1], 4);      // kicker
  box(6, 0.4, [0, 0, -5], [0.2, 0.25, 0.35], 2);       // faint floor bounce
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(s, 0.02).texture;
  pm.dispose();
  return env;
}

export const jet = (v) => [1.5 - Math.abs(4 * v - 3), 1.5 - Math.abs(4 * v - 2), 1.5 - Math.abs(4 * v - 1)].map((c) => Math.min(1, Math.max(0, c)));
const lin = (c) => c.map((x) => Math.pow(x, 2.2));

function arrowGeometry() {
  // Unit arrow along +Y from 0 to 1: shaft radius r, head length h (in units of the final length, scaled per instance).
  const shaft = new THREE.CylinderGeometry(1, 1, 1, 18, 1, false); shaft.translate(0, 0.5, 0);
  const head = new THREE.ConeGeometry(1, 1, 24, 1); head.translate(0, 0.5, 0);
  return { shaft, head };
}

export class TextbookWave {
  constructor(env, { lambda = 0.03, amp = 0.009, perLambda = 14, count = 7, maxN = 240 } = {}) {
    this.lambda = lambda; this.amp = amp; this.n = Math.max(maxN, perLambda * count); this.perLambda = perLambda; this.count = count;
    this.group = new THREE.Group();
    const { shaft, head } = arrowGeometry();
    const eMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.08, envMap: env, envMapIntensity: 1.4, emissive: 0x000000 });
    eMat.onBeforeCompile = (sh) => {   // a little self-glow in the instance colour so it reads on black
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vColor.rgb * 0.35;');
    };
    const hMat = new THREE.MeshPhysicalMaterial({ color: 0xdfe6ee, roughness: 0.16, metalness: 1.0, envMap: env, envMapIntensity: 1.6 });
    this.eS = new THREE.InstancedMesh(shaft, eMat, this.n); this.eH = new THREE.InstancedMesh(head, eMat, this.n);
    this.hS = new THREE.InstancedMesh(shaft, hMat, this.n); this.hH = new THREE.InstancedMesh(head, hMat, this.n);
    for (const m of [this.eS, this.eH, this.hS, this.hH]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(m); }
    this.eS.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.n * 3), 3);
    this.eH.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.n * 3), 3);
    // Axis of light and the two tip envelopes (glowing tubes, rebuilt per frame as line strips with width via TubeGeometry is costly; use thin emissive tubes of fixed sampling).
    this.axisMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.25, 1.4), transparent: true, opacity: 1 });
    this.axis = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), this.axisMat); this.group.add(this.axis);
    const M = 400;
    this.envE = this.makeRibbon(M, [1.0, 0.55, 0.25]); this.envH = this.makeRibbon(M, [0.8, 0.9, 1.0]);
    this.group.add(this.envE.mesh, this.envH.mesh);
    this.light = new THREE.DirectionalLight(0xffffff, 1.2); this.group.add(this.light, this.light.target);
    this.amb = new THREE.AmbientLight(0x223344, 0.4); this.group.add(this.amb);
    this.tmp = new THREE.Object3D();
  }
  makeRibbon(M, col) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(M * 2 * 3); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const idx = []; for (let i = 0; i < M - 1; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); } g.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...col), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false;
    return { g, pos, mat, mesh, M };
  }
  // p: { o:[3], k:[3], e:[3], phase (rad), reveal (0..1 from head backwards), cam (THREE camera), glow, hAlpha, sheetCopies }
  update(p) {
    const o = new THREE.Vector3(...p.o), k = new THREE.Vector3(...p.k).normalize();
    const e = new THREE.Vector3(...p.e); e.addScaledVector(k, -e.dot(k)).normalize();
    const h = new THREE.Vector3().crossVectors(k, e).normalize();
    const lam = p.lambda ?? this.lambda, L = p.L ?? this.lambda * this.count, kw = 2 * Math.PI / lam;
    const n = Math.min(this.n, Math.round(L / lam * this.perLambda));
    for (const m of [this.eS, this.eH, this.hS, this.hH]) m.count = n;
    const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion();
    const rev = p.reveal ?? 1, amp = this.amp * (p.ampScale ?? 1);
    const window = (s) => { const u = s / L; const a = Math.min(1, u / 0.18), b = Math.min(1, (1 - u) / 0.18); return Math.max(0, Math.sin(Math.PI / 2 * Math.min(a, b))) ** 2; };
    const shaftR = 0.00045 * (p.thick ?? 1), headR = 0.0011 * (p.thick ?? 1), headL = 0.0026;
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n * L;             // distance behind the head
      const show = THREE.MathUtils.smoothstep(rev * L * 1.15 - s, 0, 0.012);
      const val = Math.cos(-kw * s - p.phase) * window(s) * show;
      const base = o.clone().addScaledVector(k, -s);
      const setArrow = (S, Hd, dir, len, color) => {
        const l = Math.abs(len), sgn = Math.sign(len) || 1;
        const d = dir.clone().multiplyScalar(sgn);
        q.setFromUnitVectors(up, d);
        const hl = Math.min(headL, l * 0.5), sl = Math.max(1e-6, l - hl);
        this.tmp.position.copy(base); this.tmp.quaternion.copy(q);
        this.tmp.scale.set(l > 1e-5 ? shaftR : 0, sl, l > 1e-5 ? shaftR : 0); this.tmp.updateMatrix(); S.setMatrixAt(i, this.tmp.matrix);
        this.tmp.position.copy(base).addScaledVector(d, sl);
        const hr = l > 1e-5 ? headR * Math.min(1, l / 0.003) : 0;
        this.tmp.scale.set(hr, hl, hr); this.tmp.updateMatrix(); Hd.setMatrixAt(i, this.tmp.matrix);
        if (color) { S.instanceColor.setXYZ(i, ...color); Hd.instanceColor.setXYZ(i, ...color); }
      };
      const c = lin(jet(0.5 + 0.5 * Math.cos(-kw * s - p.phase)));
      setArrow(this.eS, this.eH, e, val * amp, c);
      setArrow(this.hS, this.hH, h, val * amp * (p.hScale ?? 0.82), null);
    }
    for (const m of [this.eS, this.eH, this.hS, this.hH]) m.instanceMatrix.needsUpdate = true;
    this.eS.instanceColor.needsUpdate = this.eH.instanceColor.needsUpdate = true;
    this.hS.visible = this.hH.visible = (p.hAlpha ?? 1) > 0.01;
    // Axis: from tail to head.
    const mid = o.clone().addScaledVector(k, -L * rev * 0.5);
    this.axis.position.copy(mid); this.axis.quaternion.setFromUnitVectors(up, k);
    this.axis.scale.set(0.00022, Math.max(1e-5, L * rev * 1.1), 0.00022); this.axisMat.opacity = p.axisAlpha ?? 1;
    // Envelopes: ribbons through the arrow tips, facing the camera.
    const camPos = p.cam.position;
    for (const [rib, dir, sc] of [[this.envE, e, 1], [this.envH, h, p.hScale ?? 0.82]]) {
      const { pos, M } = rib;
      for (let j = 0; j < M; j++) {
        const s = j / (M - 1) * L, show = THREE.MathUtils.smoothstep(rev * L * 1.15 - s, 0, 0.012);
        const val = Math.cos(-kw * s - p.phase) * window(s) * show;
        const P = o.clone().addScaledVector(k, -s).addScaledVector(dir, val * amp * sc);
        const view = P.clone().sub(camPos).normalize();
        const side = new THREE.Vector3().crossVectors(k, view).normalize().multiplyScalar(0.00028 * (p.thick ?? 1));
        pos.set([P.x - side.x, P.y - side.y, P.z - side.z, P.x + side.x, P.y + side.y, P.z + side.z], j * 6);
      }
      rib.g.attributes.position.needsUpdate = true;
    }
    this.envE.mat.opacity = 0.55 * (p.envAlpha ?? 1); this.envH.mat.opacity = 0.45 * (p.envAlpha ?? 1) * (p.hAlpha ?? 1);
    // Key light from above-left of the camera.
    const cr = new THREE.Vector3().setFromMatrixColumn(p.cam.matrixWorld, 0), cu = new THREE.Vector3().setFromMatrixColumn(p.cam.matrixWorld, 1);
    this.light.position.copy(o).addScaledVector(cr, -0.3).addScaledVector(cu, 0.4).addScaledVector(k, 0.1);
    this.light.target.position.copy(o);
    return { e: e.toArray(), h: h.toArray(), k: k.toArray(), L, kw, amp, win: window };
  }
}
