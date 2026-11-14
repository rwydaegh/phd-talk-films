// Film 1's crest panes (lib/panes.js there), rectangular, and hidden inside the four bodies:
// the wave is drawn only in air. Panes sit at s_n = anchor + (phase + 2 pi n) / kw along k, between tail and head.
import * as THREE from 'three';
import { ADD } from './phantoms.js';

const VS = `in vec3 position; in float aX;
uniform mat4 viewMatrix, projectionMatrix; uniform vec3 uO, uK, uE, uH; uniform vec2 uHalf, uC;
out vec2 vUv; out float vX; out vec3 vW;
void main(){
  vUv = position.xy; vX = aX;
  vec3 w = uO + uK * aX + uE * (uC.x + position.x * uHalf.x) + uH * (uC.y + position.y * uHalf.y);
  vW = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const FS = `precision highp float; precision highp sampler3D;
in vec2 vUv; in float vX; in vec3 vW; out vec4 frag;
uniform vec3 uEye, uK, uCol; uniform float uGain, uHead, uTail, uFront, uFill, uEdge, uSoft;
uniform vec2 uHalf, uMask; uniform float uTopEdge;
uniform sampler3D uOcc0, uOcc1, uOcc2, uOcc3; uniform mat4 uG0, uG1, uG2, uG3; uniform vec3 uD0, uD1, uD2, uD3;
float occAt(sampler3D t, mat4 m, vec3 d){ vec3 g = (m * vec4(vW, 1.0)).xyz; vec3 u = (g + 0.5) / d;
  if (any(lessThan(u, vec3(0.0))) || any(greaterThan(u, vec3(1.0)))) return 0.0; return texture(t, u).r; }
void main(){
  float o = max(max(occAt(uOcc0, uG0, uD0), occAt(uOcc1, uG1, uD1)), max(occAt(uOcc2, uG2, uD2), occAt(uOcc3, uG3, uD3)));
  float fo = max(fwidth(o), 1e-3);
  float air = 1.0 - smoothstep(0.5 - fo, 0.5 + fo, o);
  if (air < 0.003) discard;
  vec2 a = abs(vUv);
  vec2 dd = (1.0 - a) * uHalf;                       // metres to the border
  float d = min(dd.x, dd.y);
  vec2 px2 = max(fwidth(dd), vec2(1e-5));
  vec2 e2 = exp(-dd / (px2 * 1.6)) + exp(-dd / 0.03) * 0.3;
  float side = uSoft > 0.0 ? smoothstep(0.0, uSoft, dd.x) : 1.0;
  float edge = max(e2.x * uMask.x, e2.y * uMask.y * (vUv.y > 0.0 ? uTopEdge : 1.0)) * side;
  vec3 v = normalize(vW - uEye);
  float graze = 1.0 / max(abs(dot(v, uK)), 0.3);
  float fill = uFill * graze * (0.55 + 0.45 * smoothstep(0.0, 0.5, d)) * side;
  float along = smoothstep(uTail - 0.02, uTail + 0.12, vX) * (1.0 - smoothstep(uHead - uFront, uHead, vX));
  float k = (edge * uEdge + fill) * along * uGain * air;
  k = (k > 0.0 && k < 1e4) ? k : 0.0;
  frag = vec4(uCol * k, 0.0);
}`;

export class Panes {
  constructor(phantoms, max = 400) {
    this.max = max;
    const g = new THREE.InstancedBufferGeometry();
    const seg = 4, pos = [], idx = [];
    for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) pos.push(-1 + 2 * i / seg, -1 + 2 * j / seg, 0);
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i; idx.push(a, a + 1, a + seg + 1, a + 1, a + seg + 2, a + seg + 1); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    this.aX = new Float32Array(max);
    const at = new THREE.InstancedBufferAttribute(this.aX, 1); at.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aX', at); g.instanceCount = 0;
    this.g = g; this.ph = phantoms;
    const u = this.u = {
      uO: { value: new THREE.Vector3() }, uK: { value: new THREE.Vector3() }, uE: { value: new THREE.Vector3() }, uH: { value: new THREE.Vector3() },
      uEye: { value: new THREE.Vector3() }, uHalf: { value: new THREE.Vector2(1, 1) }, uC: { value: new THREE.Vector2() }, uCol: { value: new THREE.Vector3(0.7, 0.88, 1.25) },
      uGain: { value: 1 }, uHead: { value: 1 }, uTail: { value: 0 }, uFront: { value: 0.05 }, uFill: { value: 0.02 }, uEdge: { value: 1 }, uSoft: { value: 0 }, uMask: { value: new THREE.Vector2(1, 1) }, uTopEdge: { value: 1 },
    };
    phantoms.list.forEach((p, i) => { u['uOcc' + i] = { value: p.cu.uOcc.value }; u['uG' + i] = { value: p.cu.uW2G.value }; u['uD' + i] = { value: p.cu.uDims.value }; });
    this.mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, uniforms: u, side: THREE.DoubleSide,
      transparent: true, depthWrite: false, depthTest: true, ...ADD });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 6;
  }
  // p: { o, k, e, halfE, halfH, cE, cH, lambda, phase, anchor, head, tail, front, gain, fill, edge, cam, density }
  update(p) {
    const u = this.u, k = new THREE.Vector3(...p.k).normalize(), e = new THREE.Vector3(...p.e); e.addScaledVector(k, -e.dot(k)).normalize();
    u.uO.value.set(...p.o); u.uK.value.copy(k); u.uE.value.copy(e); u.uH.value.crossVectors(k, e);
    u.uEye.value.copy(p.cam.position); u.uHalf.value.set(p.halfE, p.halfH); u.uC.value.set(p.cE ?? 0, p.cH ?? 0);
    u.uGain.value = p.gain ?? 1; u.uHead.value = p.head; u.uTail.value = p.tail; u.uFront.value = p.front ?? 0.05;
    u.uFill.value = p.fill ?? 0.02; u.uEdge.value = p.edge ?? 1; u.uSoft.value = p.soft ?? 0; u.uMask.value.set(...(p.mask || [1, 1])); u.uTopEdge.value = p.topEdge ?? 1;
    const kw = 2 * Math.PI / p.lambda, anchor = p.anchor ?? 0;
    let n = 0;
    const nmin = Math.floor((p.tail - anchor) * kw / (2 * Math.PI) - p.phase / (2 * Math.PI)) - 1;
    const nmax = Math.ceil((p.head - anchor) * kw / (2 * Math.PI) - p.phase / (2 * Math.PI)) + 1;
    for (let m = nmin; m <= nmax && n < this.max; m++) {
      const x = anchor + (p.phase + 2 * Math.PI * m) / kw;
      if (x < p.tail - 0.02 || x > p.head) continue;
      this.aX[n++] = x;
    }
    u.uGain.value *= Math.min(1, (p.density ?? 12) / Math.max(n, 1));
    this.g.instanceCount = n; this.g.attributes.aX.needsUpdate = true;
    this.mesh.visible = (p.gain ?? 1) > 0.001 && n > 0;
    return n;
  }
}
