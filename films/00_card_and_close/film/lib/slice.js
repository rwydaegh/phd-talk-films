// View C: a planar slice of the field of N point sources, in the card's jet language.
// Instantaneous Re(S e^{jwt}) as stripes, brightness from |S| in dB; stripes fade to the dB map where they alias.
import * as THREE from 'three';
import { ADD, jetGLSL } from './card3d.js';

const VS = `in vec3 position; uniform mat4 modelMatrix, viewMatrix, projectionMatrix; out vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FS = `precision highp float; in vec3 vW; out vec4 frag;
#define MAXN 16
uniform vec4 uSrc[MAXN]; uniform float uPh[MAXN]; uniform int uN;
uniform float uK, uWt, uNorm, uRange, uInst, uGain, uR0, uR1, uFwd, uBack;
uniform vec3 uC, uFwdDir; uniform float uDbg;
${jetGLSL}
void main(){
  vec2 S = vec2(0.0);
  for (int i = 0; i < MAXN; i++) {
    if (i >= uN) break;
    vec3 d = vW - uSrc[i].xyz; float r = max(length(d), 0.004);
    float a = uSrc[i].w / sqrt(r);
    float ph = uPh[i] - uK * r;
    S += a * vec2(cos(ph), sin(ph));
  }
  vec3 dc = vW - uC; float rc = length(dc);
  float fw = dot(dc / max(rc, 1e-4), uFwdDir);
  float el = mix(1.0, smoothstep(-0.25, 0.35, fw), uFwd);
  S *= el;
  float A = length(S);
  float db = 20.0 * log(max(A / uNorm, 1e-6)) / log(10.0);
  float v = clamp(1.0 + db / uRange, 0.0, 1.0);
  float arg = atan(S.y, S.x) + uWt;
  float c = cos(arg);
  float g = fwidth(uK * rc);
  float keep = 1.0 - smoothstep(0.35, 1.1, g);
  vec3 jdb = pow(jet(v), vec3(2.2));
  vec3 jst = pow(jet(0.5 + 0.5 * c), vec3(2.2));
  float bright = smoothstep(0.2, 0.85, v) * v * (0.45 + 0.55 * abs(c));
  float fall = 1.0 / (1.0 + pow(rc / (uR1 * 0.28), 2.0));
  vec3 col = mix(jdb * bright, jst * bright, uInst * keep) * fall;
  float edge = 1.0 - smoothstep(uR0, uR1, rc);
  vec3 o = col * edge * uGain + vec3(0.0004, 0.0007, 0.0014) * uBack * edge;
  if (uDbg > 0.5 && uDbg < 1.5) o = vec3(edge * 0.2);
  if (uDbg > 1.5 && uDbg < 2.5) o = vec3(v * 0.3);
  if (uDbg > 2.5) o = vec3(keep * 0.3, g * 0.1, 0.0);
  frag = vec4(o, 0.0);
}`;

export class Slice {
  constructor(size = 4) {
    const MAXN = 16;
    this.u = {
      uSrc: { value: Array.from({ length: MAXN }, () => new THREE.Vector4()) }, uPh: { value: new Float32Array(MAXN) }, uN: { value: 0 },
      uK: { value: 1 }, uWt: { value: 0 }, uNorm: { value: 1 }, uRange: { value: 30 }, uInst: { value: 1 }, uGain: { value: 1 },
      uR0: { value: 1 }, uR1: { value: 2 }, uFwd: { value: 0 }, uBack: { value: 0 }, uC: { value: new THREE.Vector3() }, uDbg: { value: 0 }, uFwdDir: { value: new THREE.Vector3(1, 0, 0) },
    };
    this.mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, uniforms: this.u, side: THREE.DoubleSide,
      transparent: true, depthWrite: false, depthTest: true, ...ADD });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 24, 24), this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 4;
    this.mesh.matrixAutoUpdate = false;
  }
  // p: { c:[3] centre, n:[3] plane normal, srcs:[{p, a, ph}], k, wt, norm, range, inst, gain, r0, r1, fwd, fwdDir }
  update(p) {
    const u = this.u;
    p.srcs.forEach((s, i) => { u.uSrc.value[i].set(s.p[0], s.p[1], s.p[2], s.a); u.uPh.value[i] = s.ph || 0; });
    u.uN.value = p.srcs.length;
    for (const k of ['k', 'wt', 'norm', 'range', 'inst', 'gain', 'r0', 'r1', 'fwd', 'back']) if (p[k] !== undefined) u['u' + k[0].toUpperCase() + k.slice(1)].value = p[k];
    u.uC.value.set(...p.c); if (p.fwdDir) u.uFwdDir.value.set(...p.fwdDir);
    const n = new THREE.Vector3(...p.n).normalize();
    const a = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const x = new THREE.Vector3().crossVectors(a, n).normalize(), y = new THREE.Vector3().crossVectors(n, x);
    const R = p.r1 * 2.05;
    this.mesh.matrix.makeBasis(x, y, n).scale(new THREE.Vector3(R, R, 1)).setPosition(...p.c);
    this.mesh.matrixWorld.copy(this.mesh.matrix);
    this.mesh.visible = (p.gain ?? 1) > 1e-3;
  }
}
