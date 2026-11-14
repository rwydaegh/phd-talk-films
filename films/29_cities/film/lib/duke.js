// Duke (the thesis body model, 56,024 triangles) with its absorbed power density from the thesis runs.
// Per-vertex SAB in dB re the global max, one block per route point (data/sab.bin, cities.json order).
// The body stands on the ground at a route point and faces the direction of travel (compass yaw, as in the runs).
import * as THREE from 'three';
import { jetGLSL } from './city.js';

let BASE = null;
export async function base() {
  if (BASE) return BASE;
  const [meta, buf, sab] = await Promise.all([fetch('data/duke.json').then((r) => r.json()), fetch('data/duke.bin').then((r) => r.arrayBuffer()), fetch('data/sab.bin').then((r) => r.arrayBuffer())]);
  const nv = meta.nv, nf = meta.nf;
  const pos = new Float32Array(buf, 0, nv * 3), nor = new Float32Array(buf, nv * 12, nv * 3), idx = new Uint32Array(buf, nv * 24, nf * 3);
  const h16 = new Uint16Array(sab), all = new Float32Array(h16.length);
  for (let i = 0; i < h16.length; i++) all[i] = f16(h16[i]);
  BASE = { meta, pos, nor, idx, all, nv };
  return BASE;
}
const f16 = (h) => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023; return e === 0 ? s * f * 2 ** -24 : e === 31 ? NaN : s * (1 + f / 1024) * 2 ** (e - 15); };
const sabBlock = (k) => BASE.all.subarray(k * BASE.nv, (k + 1) * BASE.nv);
// max dB over route-point blocks [k0, k1)
// [lo, hi] quantiles of one route-point block, in dB
export function rangeDb(k, lo, hi) { const s = Float32Array.from(sabBlock(k)).sort(), at = (q) => s[Math.floor(q * (s.length - 1))]; return [at(lo), at(hi)]; }
export function maxDb(k0, k1) { let m = -1e9; const a = BASE.all; for (let i = k0 * BASE.nv; i < k1 * BASE.nv; i++) if (a[i] > m) m = a[i]; return m; }

const VS = `in vec3 position; in vec3 normal; in float aS0; in float aS1;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix; uniform float uMix;
out vec3 vN; out vec3 vW; out float vS;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
  vS = mix(aS0, aS1, uMix); gl_Position = projectionMatrix * viewMatrix * w; }`;
const FS = `precision highp float; in vec3 vN; in vec3 vW; in float vS; out vec4 frag;
uniform vec3 uEye; uniform float uLit, uLo, uHi, uGain, uAlpha, uRim;
${jetGLSL}
void main(){
  vec3 n = normalize(vN); vec3 v = normalize(uEye - vW);
  if (dot(n, v) < 0.0) n = -n;
  vec3 key = normalize(vec3(-0.4, -0.5, 0.75));
  float dif = 0.35 + 0.65 * max(dot(n, key), 0.0);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 dark = vec3(0.010, 0.013, 0.020) * dif + vec3(0.05, 0.07, 0.11) * rim * uRim;
  float x = clamp((vS - uLo) / (uHi - uLo), 0.0, 1.0);
  vec3 hot = pow(jet(x), vec3(2.2)) * (0.55 + 0.45 * dif) * uGain + vec3(0.04, 0.05, 0.08) * rim * uRim;
  frag = vec4(mix(dark, hot, uLit), uAlpha);
}`;

export async function makeDuke() {
  const B = await base();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(B.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(B.nor, 3));
  const s0 = new THREE.BufferAttribute(new Float32Array(B.nv), 1), s1 = new THREE.BufferAttribute(new Float32Array(B.nv), 1);
  g.setAttribute('aS0', s0); g.setAttribute('aS1', s1);
  g.setIndex(new THREE.BufferAttribute(B.idx, 1));
  const U = { uEye: { value: new THREE.Vector3() }, uMix: { value: 0 }, uLit: { value: 0 }, uLo: { value: -38 }, uHi: { value: -4 }, uGain: { value: 1 }, uAlpha: { value: 1 }, uRim: { value: 1 } };
  const mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, uniforms: U });
  const mesh = new THREE.Mesh(g, mat); mesh.matrixAutoUpdate = false; mesh.frustumCulled = false;
  const loaded = [-1, -1];
  return {
    mesh, U, meta: B.meta,
    // feet on the ground at (x, y, g), facing compass yaw (deg). Native anterior is -y.
    place(x, y, g, yawDeg) {
      const yaw = yawDeg * Math.PI / 180, tx = Math.sin(yaw), ty = Math.cos(yaw);
      const ang = Math.atan2(0 * ty - (-1) * tx, 0 * tx + (-1) * ty);   // rotation taking (0,-1) to (tx,ty)
      mesh.matrix.makeRotationZ(ang).setPosition(x, y, g - B.meta.zmin);
      mesh.matrixWorld.copy(mesh.matrix);
    },
    // show route-point blocks k0 -> k1 blended by u (global indices into sab.bin)
    setBlocks(k0, k1, u) {
      if (loaded[0] !== k0) { s0.array.set(sabBlock(k0)); s0.needsUpdate = true; loaded[0] = k0; }
      if (loaded[1] !== k1) { s1.array.set(sabBlock(k1)); s1.needsUpdate = true; loaded[1] = k1; }
      U.uMix.value = u;
    },
  };
}
