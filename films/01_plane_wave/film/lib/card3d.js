// The invitation card rebuilt in 3D: same mesh, camera, 120 antennas, focus path, surface law and look
// (public/field.js of the invitation, look "jet", 10 GHz). Every quantity is a function of the card clock tc.
import * as THREE from 'three';
import { CARD } from './cam.js';

export const N = 120;
export const ADD = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };
const GHZ = 10, LAMBDA = 0.299792458 / GHZ, K = 2 * Math.PI / LAMBDA, T0 = 0.4888280250859348;
const P = { gain: 1.6, pulse: 0.12, fill: 0.1, back: 0.34, edge: 0.05, interval: 6, bead: 1.6, beads: 0.7, tail: 0.035,
  reach: 0.8, far: 0.7, width: 1.5, twinkle: 0.55, flash: 1, dim: 0.07, range: 30, form: 4.2, fade0: 0.6, fade1: 0.76, mirror: 0.4, lights: 1 };
export const CARD_AIR = [0.0016, 0.0016, 0.0018], CARD_HAZE = [0.0034, 0.0034, 0.0038];
export const FILM_AIR = [0.00036, 0.00063, 0.0014], FILM_HAZE = [0.0012, 0.0019, 0.0032];
const fract = (x) => x - Math.floor(x);
const SPOT = { sigma: +(new URLSearchParams(globalThis.location?.search || '').get('spotsig') || 0.016), on: +(new URLSearchParams(globalThis.location?.search || '').get('spot') ?? 1) };
if (Number.isNaN(SPOT.on)) SPOT.on = 1;

let cache = null;
export async function loadCardData() {
  if (cache) return cache;
  const [meta, buf, st] = await Promise.all([
    fetch('assets/child.json').then((r) => r.json()),
    fetch('assets/child.bin').then((r) => r.arrayBuffer()),
    fetch('assets/card_state.json').then((r) => r.json()),
  ]);
  const V = meta.V, F = meta.F;
  let o = 0;
  const pos = new Float32Array(buf, o, V * 3); o += V * 12;
  const nrm = new Float32Array(buf, o, V * 3); o += V * 12;
  const ao = new Uint8Array(buf, o, V); o += V;
  const vis = new Uint8Array(buf, o, V * N); o += V * N;
  const idx = new Uint32Array(buf.slice(o, o + F * 12));
  const ants = meta.antennas;
  // Transfer per vertex and antenna: sqrt(T0 cos / r) * vis / r * exp(-j k r).
  const Tr = new Float32Array(V * N), Ti = new Float32Array(V * N);
  for (let v = 0; v < V; v++) {
    const px = pos[3 * v], py = pos[3 * v + 1], pz = pos[3 * v + 2], nx = nrm[3 * v], ny = nrm[3 * v + 1], nz = nrm[3 * v + 2];
    for (let n = 0; n < N; n++) {
      const s = vis[v * N + n];
      if (!s) continue;
      const a = ants[n], dx = a[0] - px, dy = a[1] - py, dz = a[2] - pz;
      const inc = nx * dx + ny * dy + nz * dz;
      if (inc <= 0) continue;
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const g = Math.sqrt(T0 * inc / r) * (s / 255) / r, ph = -K * r;
      Tr[v * N + n] = g * Math.cos(ph); Ti[v * N + n] = g * Math.sin(ph);
    }
  }
  // Twinkle table, same LCG as the card.
  const tw = []; let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < N; i++) { const a = 3 + Math.floor(rnd() * 5), b = rnd() * 6.283, c = 8 + Math.floor(rnd() * 8), d = rnd() * 6.283; tw.push([a, b, c, d]); }
  cache = { V, F, pos, nrm, ao, idx, ants, Tr, Ti, st, tw };
  return cache;
}

// Card state at card time tc (seconds, loops every 24 s): focus and smoothed visibility, interpolated.
export function cardState(D, tc) {
  const fr = D.st.frames, n = fr.length, x = ((tc * D.st.fps) % n + n) % n, i = Math.floor(x), f = x - i, j = (i + 1) % n;
  const a = fr[i], b = fr[j];
  return { focus: a.f.map((v, k) => v + (b.f[k] - v) * f), vis: a.v.map((v, k) => v + (b.v[k] - v) * f) };
}

const jetGLSL = `vec3 jet(float v){ return clamp(vec3(1.5 - abs(4.0*v - 3.0), 1.5 - abs(4.0*v - 2.0), 1.5 - abs(4.0*v - 1.0)), 0.0, 1.0); }`;
export { jetGLSL };

const BODY_VS = `
in vec3 position; in vec3 normal; in float aAo; in vec2 aSum;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vP; out vec3 vN; out float vAo; out vec2 vSum;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = position; vN = normal; vAo = aAo; vSum = aSum;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const BODY_FS = `precision highp float;
in vec3 vP; in vec3 vN; in float vAo; in vec2 vSum;
uniform vec3 uEye, uRight, uUp, uFwd, uSkin;
uniform vec3 uLight; uniform vec2 uRot, uFade;
uniform float uGain, uPulse, uRange, uForm, uMirror, uField, uLit, uOpacity;
uniform vec3 uLampDir, uLampCol;
uniform float uExtra; uniform vec3 uExtraCol;
// the focal spot drawn as a smooth bump (dB parabola) instead of the array's rectangular main lobe
uniform vec3 uFocus; uniform vec3 uSpot; // sigma (m), blend, peak x
// plane-wave exposure (surface law, instantaneous crests), gated by the arriving front
uniform float uPW, uPWkw, uPWph, uPWhead; uniform vec3 uPWk, uPWo;
out vec4 frag;
${jetGLSL}
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
float form(vec3 n, vec3 view, float ao){
  vec3 key = normalize(-0.80 * uRight + 0.30 * uUp + 0.52 * uFwd);
  vec3 fillDir = normalize(0.45 * uRight + 0.75 * uUp - 0.48 * uFwd);
  float back = pow(max(dot(n, key), 0.0), 1.6);
  float fill = 0.5 + 0.5 * dot(n, fillDir);
  float edge = pow(1.0 - max(dot(n, -view), 0.0), 3.0);
  return (uLight.x * fill * fill + uLight.y * back + uLight.z * edge) * (0.3 + 0.7 * ao);
}
void main(){
  vec3 n = normalize(vN);
  vec3 view = normalize(vP - uEye);
  if (dot(n, view) > 0.0 && uMirror < 0.5) n = n; // keep: matte mesh, back faces are rare
  float c = 1.0;
  if (uFade.y > uFade.x) { float h = smoothstep(uFade.x, uFade.y, vP.z); c = h * h; }
  c *= uOpacity;
  if (c < 0.004) discard;
  float sab = dot(vSum, vSum);
  float inst = vSum.x * uRot.x - vSum.y * uRot.y;
  float cph = inst / max(sqrt(sab), 1e-6);
  float x = uGain * sab * (1.0 - uPulse + uPulse * 2.0 * cph * cph);
  if (uPW > 0.0) {
    float sk = dot(vP - uPWo, uPWk), ph = uPWph - uPWkw * sk, fw = fwidth(ph);
    float crest = mix(0.5 + 0.5 * cos(2.0 * ph), 0.5, smoothstep(0.6, 2.5, fw));
    float xp = max(0.0, -dot(n, uPWk)) * (0.04 + 0.96 * crest) * (1.0 - smoothstep(uPWhead - 0.03, uPWhead, sk));
    x = mix(x, xp, uPW);
  }
  float m = form(n, view, vAo);
  float db = 4.3429448 * log(max(x, 1e-9));
  float v = clamp(1.0 + db / uRange, 0.0, 1.0);
  if (uSpot.y > 0.0) {
    vec3 dq = vP - uFocus; float q = dot(dq, dq) / (uSpot.x * uSpot.x);
    float vg = clamp(1.0 + (4.3429448 * log(max(uSpot.z, 1e-9)) - 2.1714724 * q) / uRange, 0.0, 1.0);
    v = mix(v, vg, uSpot.y * 0.7 * smoothstep(0.05, 0.75, vg));
  }
  vec3 painted = lin(jet(v)) * (uForm * m + 0.55 * pow(v, 5.0) * (0.5 + 0.5 * vAo)) * mix(1.0, smoothstep(0.0, 0.3, v), uPW);
  vec3 matte = uSkin * m * 1.6;
  vec3 col = mix(matte, painted, uField);
  // A lamp (visible light): warm plaster under a key light with soft wrap.
  float lam = max(dot(n, -uLampDir) * 0.8 + 0.2, 0.0);
  col += uLit * uLampCol * (lam * lam * (0.35 + 0.65 * vAo) + 0.04 * vAo);
  col += uExtra * uExtraCol * (0.2 + 0.8 * m);
  if (uMirror > 0.5) { col *= exp(-vP.z * 1.6) * ${P.mirror.toFixed(2)}; frag = vec4(col * c, 0.0); return; }
  frag = vec4(col * c, c);
}`;

// Stars and streaks: instanced screen-space quads between two projected points (as the card's LINE pass).
const LINE_VS = `
in vec3 position; in vec3 aA; in vec3 aB; in vec4 aColor; in vec3 aStyle;
uniform mat4 viewMatrix, projectionMatrix; uniform vec2 uRes;
out vec2 vQ; out float vLen; flat out vec4 vColor; flat out vec3 vStyle; out float vSize;
void main(){
  vColor = aColor; vStyle = aStyle; vQ = position.xy;
  vec4 va = viewMatrix * vec4(aA, 1.0), vb = viewMatrix * vec4(aB, 1.0);
  float nearZ = -0.02;
  vLen = distance(aA, aB);
  float t0 = 0.0, t1 = 1.0;
  if (va.z > nearZ && vb.z > nearZ) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (va.z > nearZ) t0 = (nearZ - va.z) / (vb.z - va.z);
  if (vb.z > nearZ) t1 = (nearZ - va.z) / (vb.z - va.z);
  vec4 ca = projectionMatrix * mix(va, vb, t0), cb = projectionMatrix * mix(va, vb, t1);
  vec2 a = (ca.xy / ca.w * 0.5 + 0.5) * uRes, b = (cb.xy / cb.w * 0.5 + 0.5) * uRes;
  vec2 dir = b - a; float len = length(dir);
  float dot_ = step(len, 1e-3);
  dir = len > 1e-3 ? dir / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float w = aStyle.x;
  vec2 p = mix(a, b, position.x) + nrm * position.y * w + dir * (position.x * 2.0 - 1.0) * w * dot_;
  // keep the along-path parameter in world terms after clipping
  vQ.x = mix(t0, t1, position.x);
  float z = mix(ca.z / ca.w, cb.z / cb.w, position.x);
  gl_Position = vec4(p / uRes * 2.0 - 1.0, z, 1.0);
  vSize = w;
}`;
const LINE_FS = `precision highp float;
in vec2 vQ; in float vLen; flat in vec4 vColor; flat in vec3 vStyle; in float vSize;
uniform float uFrac, uCount, uBead, uTail, uReach, uFar;
out vec4 frag;
void main(){
  float a;
  if (vStyle.y < 1.5) {
    vec2 c = vec2(vQ.x * 2.0 - 1.0, vQ.y);
    float r = length(c);
    a = exp(-r * r * 7.0) * 0.30 + exp(-r * r * 120.0) * 1.8;
    a *= 1.0 - smoothstep(0.85, 1.0, r);
  } else if (vStyle.y > 2.5) {
    float s = (1.0 - vQ.x) * vLen;      // metres behind the head
    float core = exp(-pow(abs(vQ.y) * (1.0 + 2.0 * s / max(vLen, 1e-4)), 2.0) * 3.0);
    a = core * (exp(-s / max(vStyle.z, 1e-4)) * 1.4 + 0.15 * (1.0 - vQ.x));
  } else {
    float s = (1.0 - vQ.x) * vLen;
    float A = s / uBead + uFrac;
    float q = fract(A);
    float slot = mod(floor(A) + uCount, 4.0);
    float on = mod(floor(vStyle.z / exp2(slot)), 2.0);
    float core = 1.0 - smoothstep(0.0, 1.0, abs(vQ.y) * vStyle.x - 0.4);
    float near = smoothstep(0.03, 0.45, s);
    float env = mix(uFar, 1.0, exp(-s / uReach)) * near;
    float head = exp(-q * uBead / uTail) * smoothstep(0.0, 0.012, q);
    a = core * head * on * env;
  }
  frag = vec4(vColor.rgb * vColor.a * a, 0.0);
}`;

const BG_FS = `
uniform mat4 uInvProj, uCamWorld; uniform vec2 uRes; uniform vec3 uAir, uHaze; uniform float uFloor;
void main(){
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec4 v = uInvProj * vec4(ndc, 1.0, 1.0); v /= v.w;
  vec3 d = normalize((uCamWorld * vec4(v.xyz, 0.0)).xyz);
  vec3 col = uAir + uHaze * exp(-abs(d.z) * 9.0);
  if (d.z < 0.0 && uFloor > 0.0) {
    float fres = 0.02 + 0.98 * pow(1.0 - max(-d.z, 0.0), 5.0);
    col = mix(col, (uAir * 0.78 + uHaze * 1.48 * fres * exp(-abs(d.z) * 9.0)), uFloor);
  }
  frag = vec4(col, 1.0);
}`;

export class Card3D {
  constructor(D, W, H) {
    this.D = D; this.W = W; this.H = H;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(D.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(D.nrm, 3));
    g.setAttribute('aAo', new THREE.BufferAttribute(D.ao, 1, true));
    this.sum = new Float32Array(D.V * 2);
    this.sumAttr = new THREE.BufferAttribute(this.sum, 2); this.sumAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aSum', this.sumAttr);
    g.setIndex(new THREE.BufferAttribute(D.idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0.9), 1.0);
    const r = CARD;
    const uni = () => ({
      uEye: { value: new THREE.Vector3() }, uRight: { value: new THREE.Vector3(...r.right) }, uUp: { value: new THREE.Vector3(...r.up) }, uFwd: { value: new THREE.Vector3(...r.fwd) },
      uSkin: { value: new THREE.Vector3(0.56, 0.72, 0.86) }, uLight: { value: new THREE.Vector3(P.fill, P.back, P.edge) },
      uRot: { value: new THREE.Vector2(1, 0) }, uFade: { value: new THREE.Vector2(P.fade0, P.fade1) },
      uGain: { value: 1 }, uPulse: { value: P.pulse }, uRange: { value: P.range }, uForm: { value: P.form }, uMirror: { value: 0 },
      uField: { value: 1 }, uLit: { value: 0 }, uOpacity: { value: 1 },
      uPW: { value: 0 }, uPWkw: { value: 1 }, uPWph: { value: 0 }, uPWhead: { value: -1e9 }, uPWk: { value: new THREE.Vector3(1, 0, 0) }, uPWo: { value: new THREE.Vector3() },
      uLampDir: { value: new THREE.Vector3(0.5, 0.6, -0.6).normalize() }, uLampCol: { value: new THREE.Vector3(1, 0.85, 0.7) },
      uExtra: { value: 0 }, uExtraCol: { value: new THREE.Vector3(1, 1, 1) },
      uFocus: { value: new THREE.Vector3() }, uSpot: { value: new THREE.Vector3(SPOT.sigma, 0, 1) },
    });
    const mk = (mirror) => new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: BODY_VS, fragmentShader: BODY_FS, uniforms: { ...uni(), uMirror: { value: mirror ? 1 : 0 } },
      transparent: true, depthWrite: !mirror, depthTest: true,
      ...(mirror ? ADD : {}),
    });
    this.matBody = mk(false); this.matMirror = mk(true);
    this.matBody.blending = THREE.CustomBlending; this.matBody.blendSrc = THREE.OneFactor; this.matBody.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.body = new THREE.Mesh(g, this.matBody); this.body.frustumCulled = false; this.body.renderOrder = 1;
    this.mirror = new THREE.Mesh(g, this.matMirror); this.mirror.scale.set(1, 1, -1); this.mirror.frustumCulled = false; this.mirror.renderOrder = 0;

    // Lines: stars (N), mirrored stars (N), streaks (N).
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0]), 3));
    quad.setIndex([0, 1, 2, 2, 1, 3]);
    const M = 3 * N + 64;
    this.lA = new Float32Array(M * 3); this.lB = new Float32Array(M * 3); this.lC = new Float32Array(M * 4); this.lS = new Float32Array(M * 3);
    const ia = (arr, n) => { const a = new THREE.InstancedBufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    quad.setAttribute('aA', ia(this.lA, 3)); quad.setAttribute('aB', ia(this.lB, 3)); quad.setAttribute('aColor', ia(this.lC, 4)); quad.setAttribute('aStyle', ia(this.lS, 3));
    quad.instanceCount = 0; this.quad = quad;
    this.matLines = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: LINE_VS, fragmentShader: LINE_FS,
      uniforms: { uRes: { value: new THREE.Vector2(W, H) }, uFrac: { value: 0 }, uCount: { value: 0 }, uBead: { value: P.bead }, uTail: { value: P.tail }, uReach: { value: P.reach }, uFar: { value: P.far } },
      transparent: true, depthWrite: false, depthTest: true, ...ADD,
    });
    this.lines = new THREE.Mesh(quad, this.matLines); this.lines.frustumCulled = false; this.lines.renderOrder = 2;

    this.bgUni = { uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(W, H) },
      uAir: { value: new THREE.Vector3(...CARD_AIR) }, uHaze: { value: new THREE.Vector3(...CARD_HAZE) }, uFloor: { value: 1 } };
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: `in vec3 position; void main(){ gl_Position = vec4(position.xy, 1.0, 1.0); }`,
      fragmentShader: 'precision highp float;\nout vec4 frag;\n' + BG_FS, uniforms: this.bgUni, depthTest: false, depthWrite: false }));
    bg.frustumCulled = false; bg.renderOrder = -10;
    this.group = new THREE.Group();
    this.group.add(bg, this.mirror, this.body, this.lines);
    this.amp = new Float32Array(N); this.dist = new Float32Array(N);
    this.wr = new Float32Array(N); this.wi = new Float32Array(N);
    this.lastSumKey = null;
  }

  // o: { tc, cam, starScale, starGain, streakGain, field, opacity, air, haze, floor, extraStars:[{p,size,color}], streakOnly }
  update(o) {
    const D = this.D, cam = o.cam, tc = o.tc;
    const st = cardState(D, tc);
    const focus = o.focus || st.focus, vis = st.vis;
    // Weights: maximum-ratio transmission to the focus.
    let norm = 0, count = 0;
    for (let i = 0; i < N; i++) {
      const a = D.ants[i], dx = a[0] - focus[0], dy = a[1] - focus[1], dz = a[2] - focus[2];
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      this.dist[i] = r; this.amp[i] = vis[i] / r; norm += this.amp[i] * this.amp[i]; count += vis[i];
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < N; i++) {
      this.amp[i] /= norm; const ph = (K * this.dist[i]) % (2 * Math.PI);
      this.wr[i] = this.amp[i] * Math.cos(ph); this.wi[i] = this.amp[i] * Math.sin(ph);
    }
    count = Math.max(count, 1);
    // The sum on every vertex (skipped when the body is invisible).
    if ((o.opacity ?? 1) > 0 && (o.field ?? 1) > 0) {
      const key = focus.join() + vis.slice(0, 8).join();
      if (key !== this.lastSumKey) {
        const V = D.V, Tr = D.Tr, Ti = D.Ti, wr = this.wr, wi = this.wi, s = this.sum;
        for (let v = 0; v < V; v++) {
          let re = 0, im = 0; const b = v * N;
          for (let n = 0; n < N; n++) { const tr = Tr[b + n]; if (tr === 0 && Ti[b + n] === 0) continue; const ti = Ti[b + n]; re += wr[n] * tr - wi[n] * ti; im += wr[n] * ti + wi[n] * tr; }
          s[2 * v] = re; s[2 * v + 1] = im;
        }
        this.sumAttr.needsUpdate = true; this.lastSumKey = key;
      }
    }
    // peak of the focal spot: the largest x within 1.5 cm of the focus, at this instant
    // and its size: sigma from the mean squared distance of the skin above -6 dB of the peak (smooth in tc, so the loop stays periodic)
    let xpk = 1e-9, sig = SPOT.sigma;
    { const V = D.V, pos = D.pos, s = this.sum, g = P.gain / D.st.norm, c = Math.cos(Math.PI * fract(tc / P.interval / 2) * 2), sn = Math.sin(Math.PI * fract(tc / P.interval / 2) * 2);
      const near = [];
      for (let v = 0; v < V; v++) {
        const dx = pos[3 * v] - focus[0], dy = pos[3 * v + 1] - focus[1], dz = pos[3 * v + 2] - focus[2], r2 = dx * dx + dy * dy + dz * dz;
        if (r2 > 0.0144) continue;
        const re = s[2 * v], im = s[2 * v + 1], sab = re * re + im * im, inst = re * c - im * sn, cph = inst / Math.max(Math.sqrt(sab), 1e-6);
        const x = g * sab * (1 - P.pulse + P.pulse * 2 * cph * cph);
        if (r2 <= 2.25e-4) xpk = Math.max(xpk, x);
        near.push(r2, g * sab);
      }
      let pk = 0; for (let k = 0; k < near.length; k += 2) if (near[k] <= 2.25e-4) pk = Math.max(pk, near[k + 1]);
      let w = 0, m2 = 0;
      for (let k = 0; k < near.length; k += 2) { const t = near[k + 1] / pk; if (t > 0.25) { const a = Math.min(1, (t - 0.25) / 0.1); w += a; m2 += a * near[k]; } }
      if (w > 0) sig = Math.max(SPOT.sigma, 0.69 * Math.sqrt(m2 / w)); }
    const beat = tc / P.interval, wt = Math.PI * fract(beat / 2) * 2, frac = fract(beat), slot0 = Math.floor(beat) % 4;
    for (const m of [this.matBody, this.matMirror]) {
      const u = m.uniforms;
      u.uEye.value.copy(cam.position); u.uRot.value.set(Math.cos(wt), Math.sin(wt));
      u.uGain.value = P.gain / D.st.norm; u.uField.value = o.field ?? 1; u.uOpacity.value = o.opacity ?? 1;
      u.uLit.value = o.lit ?? 0; if (o.lampDir) u.uLampDir.value.set(...o.lampDir); if (o.lampCol) u.uLampCol.value.set(...o.lampCol);
      u.uFocus.value.set(focus[0], focus[1], focus[2]); u.uSpot.value.set(sig, (o.spot ?? 1) * SPOT.on, xpk);
      u.uExtra.value = o.extra ?? 0; if (o.extraCol) u.uExtraCol.value.set(...o.extraCol);
      if (o.fade) u.uFade.value.set(o.fade[0], o.fade[1]);
      const pw = o.pw; u.uPW.value = pw ? pw.mix : 0;
      if (pw) { u.uPWkw.value = pw.kw; u.uPWph.value = pw.ph; u.uPWhead.value = pw.head; u.uPWk.value.set(...pw.k); u.uPWo.value.set(...pw.o); }
    }
    this.body.visible = (o.opacity ?? 1) > 0; this.mirror.visible = this.body.visible && (o.mirror ?? 1) > 0;
    this.matMirror.uniforms.uOpacity.value = (o.opacity ?? 1) * (o.mirror ?? 1);
    // Background.
    this.bgUni.uInvProj.value.copy(cam.projectionMatrixInverse); this.bgUni.uCamWorld.value.copy(cam.matrixWorld);
    if (o.air) this.bgUni.uAir.value.set(...o.air); if (o.haze) this.bgUni.uHaze.value.set(...o.haze);
    this.bgUni.uFloor.value = o.floor ?? 1;
    // Stars and streaks.
    const k = this.W / 2560, starScale = (o.starScale ?? 1) * 1.2 * k, T = 2 * Math.PI * tc / 24;
    const camRef = Math.hypot(...CARD.pos.map((c, i) => c - CARD.target[i]));
    let L = 0;
    const seg = (a, b, w, mode, col, mask) => {
      this.lA.set(a, L * 3); this.lB.set(b, L * 3); this.lC.set(col, L * 4); this.lS.set([w, mode, mask], L * 3); L++;
    };
    const mask = D.st.mask, sg = o.starGain ?? 1, kg = o.streakGain ?? 1, only = o.only;
    for (let i = 0; i < N; i++) {
      const a = D.ants[i], w = this.amp[i] * Math.sqrt(count);
      const A = this.dist[i] / P.bead + frac, q = fract(A), sl = (Math.floor(A) + slot0) % 4;
      const sent = (mask[i] >> sl) & 1, next = (mask[i] >> ((sl + 1) % 4)) & 1;
      const blink = sent * Math.exp(-q * P.interval / 1.1) + next * Math.exp(-(1 - q) * P.interval / 0.45);
      const tw = D.tw[i];
      const shimmer = 1 + P.twinkle * (0.6 * Math.sin(tw[0] * T + tw[1]) + 0.4 * Math.sin(tw[2] * T + tw[3]));
      let Lum = ((P.dim + 0.30 * w) * shimmer + 0.60 * P.flash * w * blink) * P.lights * sg;
      if (o.starBoost) Lum *= 1 + (o.starBoost[i] || 0);
      const cd = Math.hypot(a[0] - cam.position.x, a[1] - cam.position.y, a[2] - cam.position.z);
      const size = 9 * Math.pow(camRef / Math.max(cd, 0.05), 0.8) * starScale * (o.starSize ? (o.starSize[i] ?? 1) : 1);
      if (only && !only.has(i)) continue;
      seg(a, a, size, 1, [1, 1, 1, Lum], 0);
      if ((o.mirror ?? 1) > 0) seg([a[0], a[1], -a[2]], [a[0], a[1], -a[2]], size * 0.78, 1, [1, 1, 1, 0.22 * Lum * (o.mirror ?? 1)], 0);
      if (kg > 0 && w > 0.02) seg(a, focus, P.width * 1.2 * k * (o.streakWidth ?? 1), 2, [1, 1, 1, 0.5 * w * P.beads * kg], mask[i]);
    }
    for (const e of o.extraStars || []) seg(e.p, e.p, e.size * k, 1, e.color, 0);
    for (const e of o.extraLines || []) seg(e.a, e.b, e.width * k, 3, e.color, e.decay);
    this.quad.instanceCount = L;
    for (const n of ['aA', 'aB', 'aColor', 'aStyle']) this.quad.attributes[n].needsUpdate = true;
    this.matLines.uniforms.uFrac.value = frac; this.matLines.uniforms.uCount.value = slot0;
    return { focus, amp: this.amp, dist: this.dist, frac, slot0, count };
  }
}
