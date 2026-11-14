// View B, crisp: every crest (and optionally trough) of the plane wave as a square pane with a glowing edge.
// Panes sit at x_n = anchor + (phase + 2 pi n) / kw along k, between tail and head.
import * as THREE from 'three';
import { ADD, jetGLSL } from './card3d.js';

const VS = `in vec3 position; in float aX; in float aKind;
uniform mat4 viewMatrix, projectionMatrix; uniform vec3 uO, uK, uE, uH, uEye; uniform float uHalf, uBulge;
out vec2 vUv; out float vKind; out float vX; out vec3 vW;
void main(){
  vUv = position.xy; vKind = aKind; vX = aX;
  float r2 = dot(position.xy, position.xy);
  vec3 w = uO + uK * (aX - uBulge * r2) + uE * position.x * uHalf + uH * position.y * uHalf;
  vW = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const FS = `precision highp float;
in vec2 vUv; in float vKind; in float vX; in vec3 vW; out vec4 frag;
uniform vec3 uEye, uK, uCol; uniform vec4 uClip, uClip2; uniform float uEdgeFade, uNear, uGain, uJet, uHead, uTail, uFront, uFill, uGrid, uEdge, uHalf;
${jetGLSL}
void main(){
  if (dot(vec4(vW, 1.0), uClip) < 0.0 || dot(vec4(vW, 1.0), uClip2) < 0.0) discard;
  vec2 a = abs(vUv);
  float d = max(1.0 - max(a.x, a.y), 0.0);        // distance to the border, in half-widths
  float px = fwidth(d);
  float edge = exp(-d / max(px * 1.6, 1e-5)) * 1.0 + exp(-d / 0.035) * 0.35;
  vec2 g = abs(fract(vUv * 4.0 + 0.5) - 0.5) / max(fwidth(vUv * 4.0), 1e-5);
  float grid = (1.0 - min(min(g.x, g.y), 1.0)) * uGrid;
  vec3 v = normalize(vW - uEye);
  float graze = 1.0 / max(abs(dot(v, uK)), 0.3);
  float fill = uFill * graze * (0.6 + 0.4 * (1.0 - max(a.x, a.y)));
  float along = smoothstep(uTail - 0.02, uTail + 0.12, vX) * (1.0 - smoothstep(uHead - uFront, uHead, vX));
  vec3 col = mix(uCol, mix(pow(jet(0.93), vec3(2.2)), pow(jet(0.08), vec3(2.2)), vKind), uJet);
  float k = (edge * uEdge + grid + fill) * along * uGain * (vKind > 0.5 ? 0.85 : 1.0);
  float cv = abs(dot(v, uK));
  k *= mix(1.0, smoothstep(0.05, 0.3, cv), uEdgeFade);
  if (uNear > 0.0) k *= smoothstep(uNear, uNear * 2.5, length(vW - uEye));
  k = (k > 0.0 && k < 1e4) ? k : 0.0;
  frag = vec4(col * k, 0.0);
}`;

export class Panes {
  constructor(max = 600) {
    this.max = max;
    const g = new THREE.InstancedBufferGeometry();
    const seg = 8, pos = [], idx = [];
    for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) pos.push(-1 + 2 * i / seg, -1 + 2 * j / seg, 0);
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i; idx.push(a, a + 1, a + seg + 1, a + 1, a + seg + 2, a + seg + 1); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    this.aX = new Float32Array(max); this.aKind = new Float32Array(max);
    const mk = (arr) => { const a = new THREE.InstancedBufferAttribute(arr, 1); a.setUsage(THREE.DynamicDrawUsage); return a; };
    g.setAttribute('aX', mk(this.aX)); g.setAttribute('aKind', mk(this.aKind)); g.instanceCount = 0;
    this.g = g;
    this.u = {
      uO: { value: new THREE.Vector3() }, uK: { value: new THREE.Vector3() }, uE: { value: new THREE.Vector3() }, uH: { value: new THREE.Vector3() },
      uEye: { value: new THREE.Vector3() }, uHalf: { value: 0.5 }, uBulge: { value: 0 }, uCol: { value: new THREE.Vector3(0.7, 0.88, 1.25) },
      uGain: { value: 1 }, uJet: { value: 0 }, uHead: { value: 1 }, uTail: { value: 0 }, uFront: { value: 0.05 }, uFill: { value: 0.05 }, uGrid: { value: 0.0 }, uEdge: { value: 1 }, uEdgeFade: { value: 0 }, uNear: { value: 0 }, uClip: { value: new THREE.Vector4(0, 0, 0, 1) }, uClip2: { value: new THREE.Vector4(0, 0, 0, 1) },
    };
    this.mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, uniforms: this.u, side: THREE.DoubleSide,
      transparent: true, depthWrite: false, depthTest: true, ...ADD });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 6;
  }
  // p: { o, k, e, half, lambda, phase, anchor, head, tail, front, gain, jet, troughs, fill, grid, edge, cam, col }
  update(p) {
    const u = this.u, k = new THREE.Vector3(...p.k).normalize(), e = new THREE.Vector3(...p.e); e.addScaledVector(k, -e.dot(k)).normalize();
    u.uO.value.set(...p.o); u.uK.value.copy(k); u.uE.value.copy(e); u.uH.value.crossVectors(k, e);
    u.uEye.value.copy(p.cam.position); u.uHalf.value = p.half; u.uBulge.value = p.bulge ?? 0;
    u.uGain.value = p.gain ?? 1; u.uJet.value = p.jet ?? 0; u.uHead.value = p.head; u.uTail.value = p.tail; u.uFront.value = p.front ?? 0.05;
    u.uFill.value = p.fill ?? 0.05; u.uGrid.value = p.grid ?? 0; u.uEdge.value = p.edge ?? 1; u.uEdgeFade.value = p.edgeFade ?? 0; u.uNear.value = p.near ?? 0;
    u.uCol.value.set(...(p.col || [0.7, 0.88, 1.25])); u.uClip.value.set(...(p.clip || [0, 0, 0, 1])); u.uClip2.value.set(...(p.clip2 || [0, 0, 0, 1]));
    const kw = 2 * Math.PI / p.lambda, anchor = p.anchor ?? 0;
    let n = 0;
    const kinds = p.troughs ? [0, 1] : [0];
    const nmin = Math.floor((p.tail - anchor) * kw / (2 * Math.PI) - p.phase / (2 * Math.PI)) - 1;
    const nmax = Math.ceil((p.head - anchor) * kw / (2 * Math.PI) - p.phase / (2 * Math.PI)) + 1;
    for (let m = nmin; m <= nmax && n < this.max; m++) for (const kd of kinds) {
      const x = anchor + (p.phase + 2 * Math.PI * m + kd * Math.PI) / kw;
      if (x < p.tail - 0.02 || x > p.head) continue;
      if (n >= this.max) break;
      this.aX[n] = x; this.aKind[n] = kd; n++;
    }
    u.uGain.value *= Math.pow(Math.min(1, (p.density ?? 14) / Math.max(n, 1)), 1.15);
    this.g.instanceCount = n; this.g.attributes.aX.needsUpdate = true; this.g.attributes.aKind.needsUpdate = true;
    this.mesh.visible = (p.gain ?? 1) > 0.001 && n > 0;
    return n;
  }
}
