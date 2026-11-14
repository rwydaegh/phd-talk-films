// A slab of body (skin, fat, muscle) in cross-section under an obliquely incident plane wave.
// Physics: one interface, air -> wet-skin permittivity at f (stylised single medium; the layers are shown for identity).
// Tissue side: transmitted T e^{-j(kx x + kz d)} with kx = k0 sin(theta_i) (Snell), heat ~ |E|^2 ~ e^{-2 alpha d}.
import * as THREE from 'three';
import { ADD, jetGLSL } from './card3d.js';
import { PATCH, height, normal, surfaceGeometry, cutGeometry, sideGeometry, setSide } from './skinpatch.js';
export { PATCH, height, normal };

// wet skin, roughly after Gabriel: [GHz, eps', sigma S/m]
const SKIN = [[3.5, 37.0, 2.0], [10, 32.0, 8.0], [28, 17.0, 24.0], [60, 8.0, 36.0], [100, 5.6, 42.0]];
export function skinIndex(ghz) {
  const lf = Math.log(ghz); let i = 0; while (i < SKIN.length - 2 && Math.log(SKIN[i + 1][0]) < lf) i++;
  const a = SKIN[i], b = SKIN[i + 1], u = Math.min(1, Math.max(0, (lf - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0]))));
  const ep = a[1] + (b[1] - a[1]) * u, sg = a[2] + (b[2] - a[2]) * u;
  const epp = sg / (2 * Math.PI * ghz * 1e9 * 8.854e-12);
  // n = sqrt(ep - j epp), principal root with Re > 0, Im < 0
  const mod = Math.hypot(ep, epp), re = Math.sqrt((mod + ep) / 2), im = -Math.sqrt((mod - ep) / 2);
  const k0 = 2 * Math.PI * ghz * 1e9 / 299792458;
  // Gamma = (1 - n) / (1 + n), T = 2 / (1 + n)
  const dr = 1 + re, di = im, d2 = dr * dr + di * di;
  const g = [((1 - re) * dr + (-im) * di) / d2, ((-im) * dr - (1 - re) * di) / d2];
  const T = [2 * dr / d2, -2 * di / d2];
  return { n: [re, im], k0, alpha: -im * k0, beta: re * k0, G: g, T };
}

const VS = `in vec3 position; in vec3 normal; in float aTop; uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vW; out vec3 vN; out float vD;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
  vD = KIND == 0 ? 0.0 : aTop - position.z; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FS = `precision highp float; in vec3 vW; in vec3 vN; in float vD; out vec4 frag;
uniform float uWt, uKx, uBz, uAlpha, uArgT, uHeat, uWave, uRange, uVis, uXc, uY0, uDepth;
uniform vec3 uKey, uBG;
${jetGLSL}
vec3 lin3(vec3 c){ return pow(c, vec3(2.2)); }
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
// layer boundaries (m below the surface), gently wavy
float tSkin(float x){ return 0.0016 + 0.00022 * sin(x * 830.0 + 1.0) + 0.00012 * sin(x * 2300.0 + 2.0); }
float tFat(float x){ return 0.0085 + 0.0011 * sin(x * 140.0 + 0.5) + 0.0005 * sin(x * 410.0 + 1.3); }
void main(){
  // section sweep: the slab in front of the cut plane is gone where x > uXc
  if (KIND == 0 && vW.y < uY0 && vW.x > uXc) discard;
  if (KIND == 1 && vW.x < uXc) discard;
  vec3 skin = lin3(vec3(0.80, 0.50, 0.43)), epi = lin3(vec3(0.86, 0.62, 0.53)), fat = lin3(vec3(0.93, 0.80, 0.46)), mus = lin3(vec3(0.56, 0.13, 0.12));
  float d = max(vD, 0.0), u = KIND == 2 ? vW.y * 1.7 : vW.x;
  vec3 col;
  if (KIND == 0) {
    float lam = 0.35 + 0.75 * max(dot(vN, uKey), 0.0);
    float m = fbm(vW.xy * 700.0), c = abs(fbm(vW.xy * vec2(260.0, 2100.0)) - 0.5);
    col = epi * (0.84 + 0.24 * m) * (1.0 - 0.16 * smoothstep(0.035, 0.0, c)) * lam;
    float rim = pow(1.0 - abs(vN.z), 2.0);
    col *= 1.0 - 0.5 * rim;
  } else {
    float ts = tSkin(u), tf = tFat(u), aw = fwidth(d) * 1.2 + 1e-6;
    float fs = smoothstep(ts - aw, ts + aw, d), ff = smoothstep(tf - aw, tf + aw, d);
    vec3 sk = mix(epi, skin, smoothstep(0.00008, 0.00025, d)) * (0.9 + 0.15 * fbm(vec2(u, d) * 4000.0));
    vec2 q = vec2(u, d) * 900.0; float cell = vnoise(q) * 0.6 + vnoise(q * 2.1) * 0.4;
    vec3 ft = fat * (0.8 + 0.25 * smoothstep(0.25, 0.7, cell));
    float fib = 0.5 + 0.5 * sin(d * 5200.0 + 3.0 * fbm(vec2(u * 180.0, d * 600.0)));
    vec3 ms = mus * (0.72 + 0.35 * fib);
    col = mix(mix(sk, ft, fs), ms, ff) * 0.82;
    float sar = exp(-2.0 * uAlpha * d);
    float v = clamp(1.0 + 10.0 * log(max(sar, 1e-12)) / log(10.0) / uRange, 0.0, 1.0);
    float hm = smoothstep(0.0, 1.0, v) * uHeat;
    col = mix(col, lin3(jet(0.35 + 0.65 * v)) * (0.45 + 0.75 * v), hm * 0.88);
    if (KIND == 1) {
      float ph = uWt - uKx * vW.x - uBz * d + uArgT;
      float w = fwidth(ph) + 1e-5, q = abs(mod(ph + 3.14159265, 6.2831853) - 3.14159265);
      float ln = 1.0 - smoothstep(0.4 * w, 1.6 * w, q) + 0.22 * (1.0 - smoothstep(0.0, 7.0 * w, q));
      col += vec3(0.75, 0.88, 1.2) * ln * exp(-uAlpha * d) * uWave * 0.9;
    }
    col = mix(col, uBG, smoothstep(uDepth * 0.45, uDepth, d));
  }
  // soft edges along the patch so it reads as part of a body, not a block
  float ex = smoothstep(${PATCH.x0.toFixed(3)}, ${(PATCH.x0 + 0.08).toFixed(3)}, vW.x) * smoothstep(${PATCH.x1.toFixed(3)}, ${(PATCH.x1 - 0.08).toFixed(3)}, vW.x);
  float ey = smoothstep(${PATCH.y1.toFixed(3)}, ${(PATCH.y1 - 0.1).toFixed(3)}, vW.y) * smoothstep(${PATCH.yF.toFixed(3)}, ${(PATCH.yF + 0.06).toFixed(3)}, vW.y);
  frag = vec4(mix(uBG, col, ex * ey) * uVis, 1.0);
}`;

const FS_AIR = `precision highp float; in vec3 vW; in vec3 vN; in float vD; out vec4 frag;
uniform float uWt, uK0, uTh, uFront, uRefFront, uGabs, uGarg, uAir, uXc, uX0, uX1;
uniform vec3 uP; uniform sampler2D uHt;
float lines(float ph){ float w = fwidth(ph) + 1e-5, q = abs(mod(ph + 3.14159265, 6.2831853) - 3.14159265); return 1.0 - smoothstep(0.4 * w, 1.6 * w, q) + 0.22 * (1.0 - smoothstep(0.0, 7.0 * w, q)); }
void main(){
  if (vW.x < uXc) discard;
  float h = texture(uHt, vec2((vW.x - uX0) / (uX1 - uX0), 0.5)).r;
  float above = vW.z - h;
  if (above < 0.0) discard;
  vec2 r = vec2(vW.x - uP.x, vW.z - uP.z);
  float si = r.x * sin(uTh) - r.y * cos(uTh), sr = r.x * sin(uTh) + r.y * cos(uTh);
  float inc = lines(uWt - uK0 * si) * (1.0 - smoothstep(uFront - 0.002, uFront, si));
  float ref = lines(uWt + uGarg - uK0 * sr) * uGabs * (1.0 - smoothstep(uRefFront - 0.002, uRefFront, sr));
  float fade = smoothstep(uX0, uX0 + 0.08, vW.x) * smoothstep(uX1, uX1 - 0.08, vW.x) * smoothstep(0.0, 0.00015, above);
  vec3 col = (vec3(0.78, 0.9, 1.25) * inc + vec3(1.2, 0.82, 0.52) * ref * 0.85) * fade * uAir;
  frag = vec4(col, 0.0);
}`;

export class SkinPatch {
  constructor() {
    this.u = {
      uWt: { value: 0 }, uKx: { value: 0 }, uBz: { value: 1 }, uAlpha: { value: 1 }, uArgT: { value: 0 }, uHeat: { value: 0 }, uWave: { value: 0 },
      uRange: { value: 20 }, uVis: { value: 1 }, uXc: { value: 10 }, uY0: { value: PATCH.y0 }, uDepth: { value: PATCH.depth },
      uKey: { value: new THREE.Vector3(-0.35, -0.55, 0.76).normalize() }, uBG: { value: new THREE.Vector3(0.00036, 0.00063, 0.0014) },
    };
    const mat = (kind) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, uniforms: this.u,
      defines: { KIND: kind }, side: THREE.DoubleSide });
    const { geometry, front } = surfaceGeometry();
    geometry.setAttribute('aTop', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));
    const cut = cutGeometry(front);
    cut.computeVertexNormals();
    this.sideGeo = sideGeometry(); this.sideGeo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(this.sideGeo.attributes.position.count * 3), 3));
    this.surf = new THREE.Mesh(geometry, mat(0)); this.cut = new THREE.Mesh(cut, mat(1)); this.side = new THREE.Mesh(this.sideGeo, mat(2));
    this.side.frustumCulled = false;
    // air in the cut plane: incident and reflected wavefronts as lines
    const NH = 512, ht = new Float32Array(NH);
    for (let i = 0; i < NH; i++) ht[i] = height(PATCH.x0 + (PATCH.x1 - PATCH.x0) * i / (NH - 1), PATCH.y0);
    const htex = new THREE.DataTexture(ht, NH, 1, THREE.RedFormat, THREE.FloatType); htex.minFilter = htex.magFilter = THREE.LinearFilter; htex.needsUpdate = true;
    Object.assign(this.u, { uK0: { value: 1 }, uTh: { value: 0 }, uFront: { value: -1 }, uRefFront: { value: -1 }, uGabs: { value: 0 }, uGarg: { value: 0 },
      uAir: { value: 0 }, uX0: { value: PATCH.x0 }, uX1: { value: PATCH.x1 }, uP: { value: new THREE.Vector3() }, uHt: { value: htex } });
    const air = new THREE.PlaneGeometry(PATCH.x1 - PATCH.x0, 0.14); air.rotateX(Math.PI / 2); air.translate((PATCH.x0 + PATCH.x1) / 2, PATCH.y0 - 2e-5, 0.05);
    air.setAttribute('aTop', new THREE.Float32BufferAttribute(new Float32Array(air.attributes.position.count), 1));
    this.air = new THREE.Mesh(air, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS_AIR, uniforms: this.u,
      defines: { KIND: 3 }, side: THREE.DoubleSide, transparent: true, depthWrite: false, ...ADD }));
    this.air.renderOrder = 5;
    this.group = new THREE.Group(); this.group.add(this.surf, this.cut, this.side, this.air);
  }
  // xc: section sweep position (cut visible for x > xc). theta: incidence angle in the x-z plane.
  // P: arrival point; front / refFront: wavefront positions along k_i and k_r measured from P; air: line gain
  update({ ghz, wt, theta, heat, wave, xc, vis = 1, P = [0, 0, 0], front = -1, refFront = -1, air = 0 }) {
    const s = skinIndex(ghz), u = this.u, kx = s.k0 * Math.sin(theta);
    u.uWt.value = wt; u.uKx.value = kx; u.uBz.value = Math.sqrt(Math.max(1, s.beta * s.beta - kx * kx)); u.uAlpha.value = s.alpha;
    u.uArgT.value = Math.atan2(s.T[1], s.T[0]); u.uHeat.value = heat; u.uWave.value = wave; u.uVis.value = vis; u.uXc.value = xc;
    u.uK0.value = s.k0; u.uTh.value = theta; u.uFront.value = front; u.uRefFront.value = refFront; u.uAir.value = air; u.uP.value.set(...P);
    u.uGabs.value = Math.hypot(...s.G); u.uGarg.value = Math.atan2(s.G[1], s.G[0]);
    this.side.visible = xc < PATCH.x1 && xc > PATCH.x0;
    if (this.side.visible) setSide(this.sideGeo, xc);
    return { ...s, thetaT: Math.asin(Math.sin(theta) / s.n[0]), delta: 1 / s.alpha };
  }
}
