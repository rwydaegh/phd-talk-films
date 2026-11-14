// Film 24: the race. Split screen, one camera for both halves.
// Left: FDTD. The voxel phantom inside its grid box; the plane wave enters the box and the simulation
//   crawls through it, slice by slice, while the clock spins. The map fills in only at the end.
// Right: the surface law on the smooth mesh of the same body. The same wave gives the same map at
//   once, then the law runs through illumination after illumination.
// Every map shown is the law on the real mesh: per pixel on the right (vertex normals, cosine, shadow-map
// visibility), per voxel on the left (nearest mesh vertex, ray-cast visibility, tools/prep_voxels.py).
import * as THREE from 'three';
import { loadBust, Shadow, Fronts, VIS, JET } from '../lib/law.js';
import { clamp, lerp, ease, smooth, smoother, add3, sub3, mul3, dot3, len3, norm3, cross3, mix3, dirAE } from '../lib/anim.js';

const BG = new THREE.Color(0.0021, 0.0027, 0.0040);
const q = new URLSearchParams(location.search);
export const DUR = 15;
const S0 = [40, 20];                                   // first source: az, el (deg); the left side's wave
const MAPS = 746496, HOURS = 2.2;                      // the campaign: maps and wall-clock hours on one GPU
const T = { arrive: 0.4, run0: 4.6, run1: 11.6, end: DUR };
const SPEED = 0.9, LAMBDA_V = 0.09;                    // drawn front speed (m/s) and spacing (m) outside the box
// discrete illuminations after the first: [az, el, t at which the lead front reaches the centre]
// all on the side the camera sees (camera azimuth about -27 deg), so each new map is visible
const DISC = [[S0[0], S0[1], 1.2], [-70, 14, 2.4], [-15, 58, 3.05], [-105, 24, 3.55], [55, 2, 3.95], [-40, 30, 4.3]];

// clock progress 0..1 over the run, slow start, soft landing
function prog(t) {
  const u = clamp((t - T.run0) / (T.run1 - T.run0));
  const a = u * u * u * (u * (u * 6 - 15) + 10);           // smootherstep
  return clamp(0.5 * a + 0.5 * a * a * (3 - 2 * a));
}
// the right side's source direction at time t, as [az, el]
function srcAt(t) {
  let i = 0; while (i + 1 < DISC.length && t >= DISC[i + 1][2] - 0.3) i++;
  if (t < T.run0) return { cur: DISC[i], prev: i > 0 ? DISC[i - 1] : null, idx: i };
  // continuous: the source swings back and forth over the visible side, faster and faster, and lands on S0
  const last = DISC[DISC.length - 1];
  const u = clamp((t - T.run0) / (T.run1 - T.run0));
  const ph = 2 * Math.PI * 5 * (u * u * (3 - 2 * u));
  const osc = dirAE(-27 + 78 * Math.sin(ph), 24 + 26 * Math.sin(0.63 * ph + 0.5));
  let dir = norm3(mix3(dirAE(last[0], last[1]), osc, ease(t, T.run0, T.run0 + 0.5)));
  dir = norm3(mix3(dir, dirAE(S0[0], S0[1]), ease(t, T.run1 - 1.8, T.run1 - 0.3)));
  const az = 0, el = 0;
  return { cur: [az, el, t], dir, prev: null, idx: DISC.length, cont: true };
}

// ---- right: the law under two sources (the old map ahead of the front, the new one behind it) ----
const sfx = (s, x) => s.replace(/\b(uShadow|uShadowVP|uLightPos|uD0|uShTexel|uShBias|uShSoft|visAt)\b/g, '$1' + x);
const R_VS = `in vec3 position; in vec3 normal; uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vW; out vec3 vN; void main(){ vW = position; vN = normal; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const R_FS = `precision highp float; in vec3 vW; in vec3 vN; out vec4 frag;
${sfx(VIS, 'A')}
${sfx(VIS, 'B')}
${JET}
uniform vec3 uC, uKB; uniform float uFront, uPlasterA, uAlbedo, uNOff, uW;
float law(vec3 n, vec3 l, float V){ return max(dot(n, l), 0.0) * V; }
void main(){
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  vec3 lA = normalize(uLightPosA - uC), lB = normalize(uLightPosB - uC);
  float cA = max(dot(n, lA), 0.0), cB = max(dot(n, lB), 0.0);
  float sA = cA * (cA > 0.0 ? visAtA(vW + n * uNOff) : 0.0);
  float sB = cB * (cB > 0.0 ? visAtB(vW + n * uNOff) : 0.0);
  vec3 plaster = vec3(uAlbedo) * (0.85 * sB + 0.03);
  vec3 colA = mix(lin(jetc(sA)), plaster, uPlasterA);
  vec3 colB = lin(jetc(sB));
  float s = dot(vW - uC, uKB);
  float w = 1.0 - smoothstep(uFront - uW, uFront + uW, s);
  frag = vec4(mix(colA, colB, w), 1.0);
}`;

// ---- left: instanced voxels. Plaster under a soft key light, the FDTD map fills in with progress ----
const V_VS = `in vec3 position; in vec3 normal; in vec4 aP; uniform mat4 viewMatrix, projectionMatrix; uniform float uPitch;
out vec3 vN; out vec3 vB; out vec3 vW; out float vLaw;
void main(){ vec3 w = aP.xyz + position * uPitch; vW = w; vB = position; vN = normal; vLaw = aP.w; gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`;
const V_FS = `precision highp float; in vec3 vN; in vec3 vB; in vec3 vW; in float vLaw; out vec4 frag;
${JET}
uniform vec3 uKey, uC, uK0; uniform float uFill, uSpan, uSweepZ, uSweepA, uAlbedo, uCrawl, uT, uField;
void main(){
  vec3 n = normalize(vN);
  float lam = max(dot(n, uKey), 0.0) * 0.72 + 0.26 + 0.05 * n.z;
  vec3 plaster = vec3(uAlbedo) * lam;
  // the map converges from the side the wave enters, as the FDTD run advances
  float s = dot(vW - uC, uK0);                            // -span .. +span through the body
  float m = clamp((uFill * (2.0 * uSpan + 0.12) - (s + uSpan)) / 0.12, 0.0, 1.0);
  m *= m * (3.0 - 2.0 * m);
  // the simulated field behind the crawling front: a cool ripple, not yet a map
  float behind = 1.0 - smoothstep(uCrawl - 0.01, uCrawl + 0.01, s);
  float rip = 0.5 + 0.5 * cos(6.2832 * (s / 0.07 - uT * 0.8));
  plaster = mix(plaster, plaster * vec3(0.3, 0.38, 0.55) + vec3(0.28, 0.45, 0.8) * rip * rip, uField * behind);
  vec3 col = mix(plaster, lin(jetc(vLaw)), m);
  // voxel edges, so the lattice reads at any distance
  vec3 a = 0.5 - abs(vB); vec3 fw = max(fwidth(vB), vec3(1e-6)); vec3 wv = max(vec3(0.03), 0.6 * fw);
  vec3 e = smoothstep(wv, wv + fw, a); vec3 tang = step(abs(n), vec3(0.5));
  float k = min(mix(1.0, e.x, tang.x), min(mix(1.0, e.y, tang.y), mix(1.0, e.z, tang.z)));
  col *= mix(0.55, 1.0, k);
  // the update sweep: one slice of the grid at a time
  float sw = exp(-pow((vW.z - uSweepZ) / 0.006, 2.0)) * uSweepA;
  col += vec3(0.55, 0.75, 1.0) * sw * 0.35;
  frag = vec4(col, 1.0);
}`;

let bust, shA, shB, rScene, lScene, cam, rMat, vMat, voxMeta, rFronts, lFronts, boxLines, sweepPlane, C, BOX, K0, L0;
let Tlast = -1;

function boxMaskFronts(fr, mode) {
  // mode 1: draw only outside the box, 2: only inside
  fr.mat.onBeforeCompile = () => {};
  fr.u.uBoxMin = { value: new THREE.Vector3(...BOX[0]) }; fr.u.uBoxMax = { value: new THREE.Vector3(...BOX[1]) }; fr.u.uBoxMode = { value: mode };
  fr.mat.fragmentShader = fr.mat.fragmentShader
    .replace('uniform vec3 uCol,', 'uniform vec3 uBoxMin, uBoxMax; uniform float uBoxMode;\nuniform vec3 uCol,')
    .replace('float e = vA * win * v * uGain;', `float e = vA * win * v * uGain;
  vec3 dlo = vW - uBoxMin, dhi = uBoxMax - vW; float din = min(min(min(dlo.x, dlo.y), dlo.z), min(min(dhi.x, dhi.y), dhi.z));
  float inside = smoothstep(-0.004, 0.004, din);
  e *= uBoxMode > 1.5 ? inside : (uBoxMode > 0.5 ? 1.0 - inside : 1.0);`);
  fr.mat.uniforms = fr.u; fr.mat.needsUpdate = true;
}

export default {
  async init(ctx) {
    const { renderer } = ctx;
    bust = await loadBust('bust_lo');
    const [lo, hi] = bust.meta.bbox;
    C = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    BOX = [[lo[0] - 0.035, lo[1] - 0.035, lo[2] - 0.0], [hi[0] + 0.035, hi[1] + 0.035, hi[2] + 0.035]];
    L0 = dirAE(...S0); K0 = mul3(L0, -1);
    const sz = +(q.get('sh') || 4096);
    shA = new Shadow(renderer, sz); shB = new Shadow(renderer, sz);
    cam = new THREE.PerspectiveCamera(17, (ctx.W / 2) / ctx.H, 0.05, 4000);

    // right
    rScene = new THREE.Scene();
    const u = {};
    for (const [sh, x] of [[shA, 'A'], [shB, 'B']]) for (const [k, v] of Object.entries(sh.u)) u[k.replace(/^(uShadow|uShadowVP|uLightPos|uD0|uShTexel|uShBias|uShSoft)$/, '$1' + x)] = v;
    Object.assign(u, { uC: { value: new THREE.Vector3(...C) }, uKB: { value: new THREE.Vector3() }, uFront: { value: -10 }, uPlasterA: { value: 1 },
      uAlbedo: { value: 0.82 }, uNOff: { value: 0.0012 }, uW: { value: 0.006 } });
    rMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: R_VS, fragmentShader: R_FS, uniforms: u, side: THREE.DoubleSide });
    const rBody = new THREE.Mesh(bust.body, rMat), rCap = new THREE.Mesh(bust.cap, rMat);
    rScene.add(rBody, rCap);
    this.casters = [rBody, rCap];
    {
      const P = bust.body.attributes.position.array, Nn = bust.body.attributes.normal.array;
      const view = dirAE(-27, 9), right = norm3(cross3([-view[0], -view[1], -view[2]], [0, 0, 1])), want = norm3(add3(mul3(right, 0.45), [0, 0, 1]));
      let best = -Infinity;
      for (let i = 0; i < P.length; i += 3) {
        if (Nn[i] * view[0] + Nn[i + 1] * view[1] + Nn[i + 2] * view[2] < 0.6) continue;
        const sc = P[i] * want[0] + P[i + 1] * want[1] + P[i + 2] * want[2];
        if (sc > best) { best = sc; this.skinPt = [P[i], P[i + 1], P[i + 2]]; }
      }
    }
    rFronts = new Fronts(shB, 24, 48); rFronts.u.uShell.value = 0.04;
    rScene.add(rFronts.mesh);

    // left
    lScene = new THREE.Scene();
    voxMeta = await (await fetch('assets/vox_lo.json')).json();
    const vb = new Float32Array(await (await fetch('assets/vox_lo.bin')).arrayBuffer());
    const cube = new THREE.BoxGeometry(1, 1, 1);
    const ig = new THREE.InstancedBufferGeometry();
    ig.index = cube.index; ig.setAttribute('position', cube.getAttribute('position')); ig.setAttribute('normal', cube.getAttribute('normal'));
    ig.setAttribute('aP', new THREE.InstancedBufferAttribute(vb, 4)); ig.instanceCount = voxMeta.count;
    vMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: V_VS, fragmentShader: V_FS, uniforms: {
      uPitch: { value: voxMeta.pitch }, uKey: { value: new THREE.Vector3(...L0) }, uC: { value: new THREE.Vector3(...C) }, uK0: { value: new THREE.Vector3(...K0) },
      uFill: { value: 0 }, uSpan: { value: 0.2 }, uSweepZ: { value: -10 }, uSweepA: { value: 0 }, uAlbedo: { value: 0.82 }, uCrawl: { value: -1 }, uT: { value: 0 }, uField: { value: 0 } } });
    const vox = new THREE.Mesh(ig, vMat); vox.frustumCulled = false;
    lScene.add(vox);
    // the span of the body along k0, for the fill
    let smin = Infinity, smax = -Infinity;
    for (let i = 0; i < voxMeta.count; i++) { const s = (vb[4 * i] - C[0]) * K0[0] + (vb[4 * i + 1] - C[1]) * K0[1] + (vb[4 * i + 2] - C[2]) * K0[2]; smin = Math.min(smin, s); smax = Math.max(smax, s); }
    vMat.uniforms.uSpan.value = Math.max(-smin, smax);
    // the FDTD box
    const c8 = []; for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) c8.push([BOX[x][0], BOX[y][1], BOX[z][2]]);
    const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const bp = []; for (const [a, b] of E) bp.push(...c8[a], ...c8[b]);
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    boxLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: new THREE.Color(0.75, 0.8, 0.88), transparent: true, opacity: 0.9 }));
    lScene.add(boxLines);
    // the sweep slice: a faint plane with the grid on it
    const sp = new THREE.PlaneGeometry(BOX[1][0] - BOX[0][0], BOX[1][1] - BOX[0][1]);
    const sm = new THREE.ShaderMaterial({ uniforms: { uA: { value: 0 }, uPitch: { value: voxMeta.pitch * 3 } },
      vertexShader: `varying vec3 vP; void main(){ vP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0); }`,
      fragmentShader: `varying vec3 vP; uniform float uA, uPitch; void main(){ vec2 g = abs(fract(vP.xy / uPitch - 0.5) - 0.5) / fwidth(vP.xy / uPitch); float l = 1.0 - min(min(g.x, g.y), 1.0);
        gl_FragColor = vec4(vec3(0.55, 0.75, 1.0) * (0.05 + 0.25 * l) * uA, 0.0); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    sweepPlane = new THREE.Mesh(sp, sm); sweepPlane.position.set((BOX[0][0] + BOX[1][0]) / 2, (BOX[0][1] + BOX[1][1]) / 2, 0);
    lFronts = new Fronts(shA, 24, 48); lFronts.u.uShadowCut.value = 0; lFronts.u.uShell.value = 0.04; boxMaskFronts(lFronts, 1);
    const lIn = new Fronts(shA, 4, 48); lIn.u.uShadowCut.value = 0; boxMaskFronts(lIn, 2);
    this.lIn = lIn;
    lScene.add(lFronts.mesh, lIn.mesh);
  },

  grade() { return { bloom: 0.35, threshold: 1.0, vignette: 0.15, grain: 0.005 }; },

  draw(tl, t, target, ctx) {
    const { renderer, W, H } = ctx;
    // ---- right: sources
    const s = srcAt(t);
    const LB = s.dir || dirAE(s.cur[0], s.cur[1]), KB = mul3(LB, -1);
    const far = 60;
    shB.update(add3(C, LB, far), C, 0.36, this.casters);
    const prev = s.prev ? dirAE(s.prev[0], s.prev[1]) : LB;
    shA.update(add3(C, prev, far), C, 0.36, this.casters);   // shA also lights the left (S0 there) only through lFronts' uniforms below
    const u = rMat.uniforms;
    u.uKB.value.set(...KB);
    u.uPlasterA.value = s.idx === 0 ? 1 : 0;
    // the lead front of the current illumination crosses the centre at s.cur[2]
    const lead = s.cont ? 10 : SPEED * (t - s.cur[2]);
    u.uFront.value = lead; u.uW.value = 0.008;

    // right fronts: a short train arriving along k
    const list = [];
    if (!s.cont) {
      for (let n = 0; n < 5; n++) { const sn = lead - n * LAMBDA_V; if (sn > 0.5 || sn < -1.4) continue; list.push({ R: far + sn, a: ease(sn, -1.4, -1.0) * (1 - ease(sn, 0.1, 0.45)) * (n === 0 ? 1.5 : 1) }); }
    } else {
      const ph = ((t * SPEED) % LAMBDA_V + LAMBDA_V) % LAMBDA_V;
      for (let n = 0; n < 8; n++) { const sn = -0.6 + ph + n * LAMBDA_V - LAMBDA_V; list.push({ R: far + sn, a: ease(sn, -0.6, -0.35) * (1 - ease(sn, -0.05, 0.25)) * (1 - ease(t, T.run0 - 0.3, T.run0 + 0.9)) }); }
    }
    rFronts.u.uEye.value.copy(cam.position);
    rFronts.set(add3(C, LB, far), KB, list, { half: 0.34, gain: 0.15, col: [0.8, 0.9, 1.1], edge: 0.35 });

    // ---- left: the same first wave, then the simulation
    const p = prog(t);
    // the incident wave on the left: the S0 train at real speed, until it reaches the box
    const leadL = SPEED * (t - DISC[0][2]);
    const ll = [];
    for (let n = 0; n < 24; n++) { const sn = leadL - n * LAMBDA_V; if (sn > 0.5 || sn < -1.4) continue; ll.push({ R: far + sn, a: ease(sn, -1.4, -1.0) }); }
    lFronts.u.uEye.value.copy(cam.position);
    lFronts.set(add3(C, L0, far), K0, ll, { half: 0.34, gain: 0.15 * (1 - ease(t, 2.4, 3.8)), col: [0.8, 0.9, 1.1], edge: 0.35 });
    // inside the box the simulated wave crawls: from where the incident front entered, across the box over the run
    const span = vMat.uniforms.uSpan.value;
    const sIn = lerp(-span - 0.05, span + 0.05, ease(t, T.run0 - 3.0, T.run0 + 2.6));   // the wave crosses the grid, then rings on
    const entering = Math.min(leadL, -span - 0.05 + 0.02 * ease(t, 1.4, T.run0));
    const si = Math.max(entering, sIn);
    this.lIn.u.uEye.value.copy(cam.position);
    this.lIn.set(add3(C, L0, far), K0, [], { half: 0.4, gain: 0.35, col: [0.8, 0.9, 1.1], edge: 0.35 });
    vMat.uniforms.uFill.value = ease(p, 0.86, 1.0, smooth);          // the time-averaged map exists only once the run converges
    vMat.uniforms.uCrawl.value = si; vMat.uniforms.uT.value = t; vMat.uniforms.uField.value = ease(t, 1.4, 2.2) * (1 - ease(p, 0.86, 1.0));
    // the grinding: one update slice sweeps the box again and again
    const z0 = BOX[0][2], z1 = BOX[1][2];
    const per = 0.5, ph = ((t - 1.4) / per) % 1;
    const run = ease(t, 1.4, 2.0) * (1 - ease(t, T.run1 - 0.3, T.run1 + 0.4));
    const zs = lerp(z0, z1, ph);
    vMat.uniforms.uSweepZ.value = zs; vMat.uniforms.uSweepA.value = 0;
    sweepPlane.position.z = zs; sweepPlane.material.uniforms.uA.value = run * Math.sin(Math.PI * ph);

    // ---- camera, the same for both halves
    const az = lerp(-30, -24, smooth(t / DUR)), el = 9, d = 2.55;
    const tgt = [C[0], C[1], C[2] + 0.01];
    cam.position.set(...add3(tgt, dirAE(az, el), d)); cam.up.set(0, 0, 1); cam.lookAt(...tgt);
    cam.aspect = (W / 2) / H; cam.updateProjectionMatrix(); cam.updateMatrixWorld();

    renderer.setRenderTarget(target);
    renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.setClearColor(BG, 1); renderer.clear();
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, W / 2, H); renderer.setScissor(0, 0, W / 2, H); renderer.render(lScene, cam);
    renderer.setViewport(W / 2, 0, W / 2, H); renderer.setScissor(W / 2, 0, W / 2, H); renderer.render(rScene, cam);
    renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H);
    this._p = p; this._s = s;
    return {};
  },

  labels(tl, t, ctx) {
    const { W, H } = ctx;
    const p = this._p ?? 0;
    const v = new THREE.Vector3();
    // project into one half, return 2560x1440 reference px
    const pr = (P, half) => { v.set(...P).project(cam); return [(half + (v.x * 0.5 + 0.5)) * 1280, (0.5 - v.y * 0.5) * 1440]; };
    const items = [{ kind: 'vline', x: 1280, y0: 345, a: 1 }];
    const a0 = ease(t, 0.3, 1.0);
    const hours = HOURS * p;
    items.push({ kind: 'clock', at: [1280, 150], r: 78, hours, a: a0 });
    // counters: maps made so far
    const nR = t < DISC[0][2] ? 0 : (t < T.run0 ? DISC.filter((x) => t >= x[2] + 0.35).length : Math.max(DISC.length, Math.floor(MAPS * p)));
    const nL = p >= 1 ? 1 : 0;
    const fmt = (n) => n.toLocaleString('en-US');
    items.push({ kind: 'text', at: [640, 1330], text: [[fmt(nL), 'main']], size: 64, align: 'center', a: a0 });
    items.push({ kind: 'text', at: [1920, 1330], text: [[fmt(nR), 'main']], size: 64, align: 'center', a: a0 });
    items.push({ kind: 'text', at: [1280, 290], text: [[hours.toFixed(1) + ' h', 'main']], size: 44, align: 'center', a: a0 });
    // names, tied to their objects
    const boxTop = [BOX[0][0], BOX[1][1], BOX[1][2]];
    items.push({ kind: 'label', at: pr(boxTop, 0), off: [-90, -70], text: 'FDTD', size: 48, a: ease(t, 0.8, 1.6), p: ease(t, 0.8, 2.0) });
    items.push({ kind: 'label', at: pr(this.skinPt, 1), off: [110, -80], text: 'Surface law', size: 48, a: ease(t, 0.8, 1.6), p: ease(t, 0.8, 2.0) });
    return { cam, items, screen: true };
  },
};
