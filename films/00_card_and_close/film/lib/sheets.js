// View B: wavefront sheets of a plane wave as an emissive volume (a box along k), ray-marched.
// Crests are band-limited: when they get finer than a march step they fade into their mean glow,
// so a frequency sweep shimmers and then becomes continuous light, as it should.
import * as THREE from 'three';
import { ADD, jetGLSL } from './card3d.js';

const VS = `in vec3 position; uniform mat4 modelMatrix, viewMatrix, projectionMatrix; out vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FS = `precision highp float;
in vec3 vW; out vec4 frag;
uniform vec3 uEye, uO, uK, uE, uH;      // origin (s=0 at the source end), axes
uniform vec3 uHalf;                     // half sizes along k (length/2), e, h
uniform float uAnchor, uKw, uPhase, uSharp, uGain, uJet, uRadius, uHead, uTail, uFront, uSpectral;
uniform vec3 uCol, uSpec;
uniform vec2 uRes; uniform float uSteps;
${jetGLSL}
vec2 boxHit(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax){
  vec3 inv = 1.0 / rd; vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv;
  vec3 a = min(t0, t1), b = max(t0, t1);
  return vec2(max(max(a.x, a.y), a.z), min(min(b.x, b.y), b.z));
}
void main(){
  vec3 rdW = normalize(vW - uEye);
  // to local: x along k (0..2*half.x), y along e, z along h
  vec3 ro = vec3(dot(uEye - uO, uK), dot(uEye - uO, uE), dot(uEye - uO, uH));
  vec3 rd = vec3(dot(rdW, uK), dot(rdW, uE), dot(rdW, uH));
  vec2 hit = boxHit(ro, rd, vec3(0.0, -uHalf.y, -uHalf.z), vec3(2.0 * uHalf.x, uHalf.y, uHalf.z));
  float t0 = max(hit.x, 0.0), t1 = hit.y;
  if (t1 <= t0) discard;
  float n = uSteps, dt = (t1 - t0) / n;
  float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float dphi = abs(rd.x) * dt * uKw;                       // phase advance per step
  float m = uSharp;
  float mean = inversesqrt(3.14159 * m);
  float keep = exp(-dphi * dphi * m * 0.12);              // band limit
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 160; i++) {
    if (float(i) >= n) break;
    vec3 p = ro + rd * (t0 + (float(i) + jit) * dt);
    float r2 = (p.y * p.y + p.z * p.z) / (uRadius * uRadius);
    float win = exp(-r2 * 2.2);
    // the packet exists between the tail and the head (travelling)
    float along = smoothstep(uTail - 0.05, uTail + 0.15, p.x) * (1.0 - smoothstep(uHead - uFront, uHead, p.x));
    float phi = uKw * (p.x - uAnchor) - uPhase;
    float c = cos(phi);
    float crest = pow(0.5 + 0.5 * c, m), trough = pow(0.5 - 0.5 * c, m);
    crest = mean + (crest - mean) * keep; trough = mean + (trough - mean) * keep;
    vec3 col = mix(uCol * crest, lin3(jet(0.92)) * crest + lin3(jet(0.1)) * trough * 0.9, uJet);
    col = mix(col, uSpec * (0.5 + 0.5 * crest / max(mean, 1e-3) * keep + (1.0 - keep) * 0.5), uSpectral);
    acc += col * win * along;
  }
  frag = vec4(acc * dt * uGain, 0.0);
}`;

export class Sheets {
  constructor() {
    this.uniforms = {
      uEye: { value: new THREE.Vector3() }, uO: { value: new THREE.Vector3() }, uK: { value: new THREE.Vector3(1, 0, 0) },
      uE: { value: new THREE.Vector3(0, 1, 0) }, uH: { value: new THREE.Vector3(0, 0, 1) }, uHalf: { value: new THREE.Vector3(1, 0.5, 0.5) },
      uKw: { value: 100 }, uAnchor: { value: 0 }, uPhase: { value: 0 }, uSharp: { value: 24 }, uGain: { value: 4 }, uJet: { value: 0 }, uRadius: { value: 0.4 },
      uHead: { value: 10 }, uTail: { value: -10 }, uFront: { value: 0.1 }, uSpectral: { value: 0 },
      uCol: { value: new THREE.Vector3(0.75, 0.9, 1.2) }, uSpec: { value: new THREE.Vector3(1, 1, 1) }, uRes: { value: new THREE.Vector2() }, uSteps: { value: 96 },
    };
    const fs = FS.replace(jetGLSL, jetGLSL + '\nvec3 lin3(vec3 c){ return pow(c, vec3(2.2)); }');
    this.mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: fs, uniforms: this.uniforms,
      side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false, ...ADD });
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.mat); this.mesh.frustumCulled = false;
  }
  // p: { o, k, e, length, half (transverse), lambda, phase, sharp, gain, jet, radius, head, tail, spectral, spec:[3], cam }
  update(p) {
    const u = this.uniforms;
    const k = new THREE.Vector3(...p.k).normalize(), e = new THREE.Vector3(...p.e); e.addScaledVector(k, -e.dot(k)).normalize();
    const h = new THREE.Vector3().crossVectors(k, e);
    u.uO.value.set(...p.o); u.uK.value.copy(k); u.uE.value.copy(e); u.uH.value.copy(h);
    const hl = p.length / 2, ht = p.half ?? 0.6;
    u.uHalf.value.set(hl, ht, ht);
    u.uKw.value = 2 * Math.PI / p.lambda; u.uAnchor.value = p.anchor ?? 0; u.uPhase.value = p.phase ?? 0;
    u.uSharp.value = p.sharp ?? 24; u.uGain.value = p.gain ?? 4; u.uJet.value = p.jet ?? 0; u.uRadius.value = p.radius ?? ht * 0.6;
    u.uHead.value = p.head ?? p.length + 1; u.uTail.value = p.tail ?? -1; u.uFront.value = p.front ?? 0.05;
    u.uSpectral.value = p.spectral ?? 0; if (p.spec) u.uSpec.value.set(...p.spec); if (p.col) u.uCol.value.set(...p.col);
    u.uSteps.value = p.steps ?? 96;
    u.uEye.value.copy(p.cam.position);
    // box transform
    const m = new THREE.Matrix4().makeBasis(k, e, h);
    const c = new THREE.Vector3(...p.o).addScaledVector(k, hl);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrix.copy(m).scale(new THREE.Vector3(p.length, 2 * ht, 2 * ht)).setPosition(c);
    this.mesh.matrixWorld.copy(this.mesh.matrix);
    this.mesh.visible = (p.gain ?? 4) > 0;
  }
}

// Wavelength (nm) to linear RGB, a smooth approximation of the visible spectrum.
export function spectrum(nm) {
  const g = (x, mu, s1, s2) => { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); };
  const X = 1.056 * g(nm, 599.8, 37.9, 31.0) + 0.362 * g(nm, 442.0, 16.0, 26.7) - 0.065 * g(nm, 501.1, 20.4, 26.2);
  const Y = 0.821 * g(nm, 568.8, 46.9, 40.5) + 0.286 * g(nm, 530.9, 16.3, 31.1);
  const Z = 1.217 * g(nm, 437.0, 11.8, 36.0) + 0.681 * g(nm, 459.0, 26.0, 13.8);
  const r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, gg = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, b = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  return [Math.max(0, r), Math.max(0, gg), Math.max(0, b)];
}
