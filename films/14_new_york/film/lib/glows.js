// Instanced point glows (the card's star profile), depth-tested, additive. Sizes in px at 2560 wide.
import * as THREE from 'three';
import { ADD } from './common.js';
const VS = `in vec3 position; in vec3 aP; in vec4 aC; in float aS;
uniform mat4 viewMatrix, projectionMatrix; uniform vec2 uRes; uniform float uK;
out vec2 vQ; flat out vec4 vC;
void main(){ vQ = position.xy; vC = aC;
  vec4 c = projectionMatrix * viewMatrix * vec4(aP, 1.0);
  if (c.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 ndc = c.xy / c.w + position.xy * aS * uK * 2.0 / uRes;
  gl_Position = vec4(ndc, c.z / c.w, 1.0); }`;
const FS = `precision highp float; in vec2 vQ; flat in vec4 vC; out vec4 frag;
void main(){ float r = length(vQ); float a = exp(-r * r * 7.0) * 0.30 + exp(-r * r * 120.0) * 1.8; a *= 1.0 - smoothstep(0.85, 1.0, r);
  frag = vec4(vC.rgb * vC.a * a, 0.0); }`;
export class Glows {
  constructor(max, W, H) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3)); g.setIndex([0, 1, 2, 2, 1, 3]);
    this.P = new Float32Array(max * 3); this.C = new Float32Array(max * 4); this.S = new Float32Array(max);
    const ia = (a, n) => { const x = new THREE.InstancedBufferAttribute(a, n); x.setUsage(THREE.DynamicDrawUsage); return x; };
    g.setAttribute('aP', ia(this.P, 3)); g.setAttribute('aC', ia(this.C, 4)); g.setAttribute('aS', ia(this.S, 1)); g.instanceCount = 0;
    this.g = g;
    this.mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS,
      uniforms: { uRes: { value: new THREE.Vector2(W, H) }, uK: { value: W / 2560 } }, transparent: true, depthWrite: false, depthTest: true, ...ADD });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 8;
    this.n = 0;
  }
  begin() { this.n = 0; }
  add(p, size, c) { const i = this.n++; this.P.set(p, i * 3); this.C.set(c, i * 4); this.S[i] = size; }
  end() { this.g.instanceCount = this.n; for (const k of ['aP', 'aC', 'aS']) this.g.attributes[k].needsUpdate = true; }
}
