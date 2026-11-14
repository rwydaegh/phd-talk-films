// A measurement plane in 3D: a jet |E| map revealed sample by sample along the robot's snake path, with the probe
// head as a glow and its recent path as a thin line. All drawing happens in one fragment shader on a quad.
//   corner: world position of texture (u=0, v=0) = left, bottom;  U, V: world vectors spanning the width and height.
//   rows x cols: the measurement grid. order 'rows' = sweep along u, step in v (from the top);
//   'cols' = sweep along v (top to bottom, then back), step in u.
import * as THREE from 'three';
import { GLSL_COMMON, loadTex } from './common.js';

const VS = `in vec3 position; in vec2 uv; uniform mat4 modelViewMatrix, projectionMatrix; out vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FS = `precision highp float; ${GLSL_COMMON}
in vec2 vUv; out vec4 frag;
uniform sampler2D uMap; uniform float uRows, uCols, uProg, uTrail, uFresh, uCols2; uniform int uOrder;
uniform float uOpacity, uGain, uFrame, uGrid, uHead, uAll, uAspect, uDim, uWhite, uCut; uniform vec3 uRad;
float pathIndex(vec2 uv, out float across, out float acrossW){
  // continuous index along the snake for this fragment; 'across' = distance to the line centre in line units
  float lf, cf; float nL, nS;
  if (uOrder == 0) { lf = (1.0 - uv.y) * uRows; cf = uv.x * uCols; nL = uRows; nS = uCols; }
  else { lf = uv.x * uCols; cf = (1.0 - uv.y) * uRows; nL = uCols; nS = uRows; }
  float l = floor(lf);
  across = abs(fract(lf) - 0.5); acrossW = fwidth(lf);
  float along = mod(l, 2.0) < 0.5 ? cf : nS - cf;
  return l * nS + along;
}
void main(){
  if (vUv.y < uCut) discard;
  float across, aw;
  float idx = pathIndex(vUv, across, aw);
  float v = texture(uMap, vUv).r;
  float done = max(step(idx, uProg), uAll);
  float rim = 0.0;
  if (uRad.z > 0.0) {   // radial reveal from (u, v), radius in units of the plane height
    float d = length((vUv - uRad.xy) * vec2(uAspect, 1.0));
    float w = fwidth(d) * 1.5;
    done = 1.0 - smoothstep(uRad.z - w, uRad.z, d);
    rim = exp(-pow((d - uRad.z) / 0.012, 2.0)) * step(uRad.z, 1.6);
  }
  vec3 col = jet(v) * uGain;
  // freshly measured samples flash a little brighter
  float fresh = (1.0 - uAll) * done * exp(-max(uProg - idx, 0.0) / max(uFresh, 1.0));
  vec3 c = invTone(col * uDim) * done;
  c += vec3(0.6, 0.8, 1.0) * fresh * 0.6 * uHead;
  // the path line: the last uTrail samples before the head
  float back = uProg - idx;
  float inTrail = step(0.0, back) * (1.0 - smoothstep(uTrail * 0.6, uTrail, back));
  float lw = 1.0 - smoothstep(0.0, aw * 1.4, across * 1.0 - aw * 0.4);
  c += vec3(1.0) * 1.6 * inTrail * lw * uHead;
  // frame and a faint grid on the unmeasured part
  vec2 px = fwidth(vUv);
  vec2 e = min(vUv - vec2(0.0, uCut), 1.0 - vUv) / px;
  float edge = 1.0 - smoothstep(0.6, 1.8, min(e.x, e.y));
  vec2 g = abs(fract(vUv * vec2(10.0 * uAspect, 10.0) + 0.5) - 0.5) / (px * vec2(10.0 * uAspect, 10.0));
  float grid = (1.0 - smoothstep(0.3, 1.2, min(g.x, g.y))) * (1.0 - done);
  c += vec3(0.55, 0.62, 0.72) * (edge * uFrame * 1.2 + grid * uGrid * 0.13);
  c += vec3(0.02, 0.025, 0.035) * (1.0 - done) * uGrid;  // a hint of glass
  c += vec3(0.8, 0.9, 1.0) * rim * 1.2;
  c = mix(c, invTone(vec3(1.0)) * 0.35, uWhite);
  float a = clamp(max(max(done, rim * 0.6) * uOpacity, max(edge * uFrame, grid * uGrid * 0.35 + 0.07 * uGrid)), 0.0, 1.0);
  frag = vec4(c * uOpacity, a * uOpacity);
}`;

export class ScanMap {
  static async load(url, opts) { const tex = await loadTex(url, { mip: true }); return new ScanMap(tex, opts); }
  constructor(tex, { rows, cols, order = 'rows', corner, U, V }) {
    this.rows = rows; this.cols = cols; this.order = order;
    this.uniforms = {
      uMap: { value: tex }, uRows: { value: rows }, uCols: { value: cols }, uProg: { value: 0 }, uTrail: { value: 0 }, uFresh: { value: 30 },
      uOrder: { value: order === 'rows' ? 0 : 1 }, uOpacity: { value: 1 }, uGain: { value: 1 }, uFrame: { value: 0 }, uGrid: { value: 0 },
      uHead: { value: 1 }, uAll: { value: 0 }, uAspect: { value: 1 }, uDim: { value: 1 }, uWhite: { value: 0 }, uCut: { value: 0 }, uCols2: { value: 0 }, uRad: { value: new THREE.Vector3(0, 0, 0) },
    };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, uniforms: this.uniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false;
    this.place(corner, U, V);
  }
  place(corner, U, V) {
    this.corner = corner; this.U = U; this.V = V;
    const p = this.mesh.geometry.attributes.position.array;
    const P = [corner, [0, 1, 2].map((i) => corner[i] + U[i]), [0, 1, 2].map((i) => corner[i] + U[i] + V[i]), [0, 1, 2].map((i) => corner[i] + V[i])];
    P.forEach((q, k) => p.set(q, k * 3));
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.uniforms.uAspect.value = Math.hypot(...U) / Math.hypot(...V);
  }
  get total() { return this.rows * this.cols; }
  // world position of the probe head at path index i
  head(i) {
    i = Math.max(0, Math.min(this.total - 1e-3, i));
    const nS = this.order === 'rows' ? this.cols : this.rows;
    const l = Math.floor(i / nS), a = i - l * nS;
    const along = (l % 2 === 0 ? a : nS - a) / nS;
    let u, v;
    if (this.order === 'rows') { u = along; v = 1 - (l + 0.5) / this.rows; } else { u = (l + 0.5) / this.cols; v = 1 - along; }
    return this.at(u, v);
  }
  at(u, v) { return [0, 1, 2].map((k) => this.corner[k] + this.U[k] * u + this.V[k] * v); }
  set(o) { for (const [k, v] of Object.entries(o)) { const u = this.uniforms[k]; if (u.value && u.value.isVector3) u.value.set(...v); else u.value = v; } }
}

// Scan progress with a slow, countable start that accelerates: the first `n0` samples take t0 seconds,
// the rest of the grid fills by t1 (geometric acceleration in between).
export function scanProgress(t, total, n0, t0, t1) {
  if (t <= 0) return 0;
  if (t <= t0) return n0 * t / t0;
  if (t >= t1) return total;
  const r0 = n0 / t0, T = t1 - t0, N = total - n0;
  // rate r(t) = r0 * e^{k t}; integral over T equals N  ->  solve k by bisection
  let lo = 1e-6, hi = 20;
  for (let i = 0; i < 60; i++) { const k = (lo + hi) / 2; const I = r0 * (Math.exp(k * T) - 1) / k; if (I > N) hi = k; else lo = k; }
  const k = (lo + hi) / 2, x = t - t0;
  return n0 + r0 * (Math.exp(k * x) - 1) / k;
}
