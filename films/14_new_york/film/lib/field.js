// The field at the ear: the paths that reach the walker are summed as plane waves, phase-aligned by the
// precoding (MRT) so they all add up at the receiver: E(r, t) = Re{ sum_n a_n exp(j(wt - k u_n . r)) }.
// Used on the Huygens box faces (instantaneous field) and on the slice through the focus (field, then |E|/Emax).
import * as THREE from 'three';
import { jetGLSL } from './common.js';
import { LAM } from './site.js';

export const NW = 48;
export const FU = {
  uW: { value: Array.from({ length: NW }, () => new THREE.Vector4()) }, uN: { value: 0 }, uK: { value: 2 * Math.PI / LAM },
  uWt: { value: 0 }, uC: { value: new THREE.Vector3() }, uNorm: { value: 1 }, uEnv: { value: 0 }, uFace: { value: 0 }, uSlice: { value: 0 },
  uArrive: { value: 1e3 }, uGlow: { value: 1 },
};

export const FIELD_GLSL = `
uniform vec4 uW[${NW}]; uniform int uN; uniform float uK, uWt, uNorm, uArrive; uniform vec3 uC;
${jetGLSL}
vec2 fieldC(vec3 r){
  vec2 s = vec2(0.0);
  for (int i = 0; i < ${NW}; i++) { if (i >= uN) break; float ph = uK * dot(uW[i].xyz, r); s += uW[i].w * vec2(cos(ph), -sin(ph)); }
  return s * uNorm;
}
float fieldI(vec2 c){ return c.x * cos(uWt) - c.y * sin(uWt); }
`;

const VS = `varying vec3 vWP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

// Box faces: the incoming field on the Huygens surface, red/blue crests on dark, additive.
export function boxFaceMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: FU, vertexShader: VS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    fragmentShader: `${FIELD_GLSL} uniform float uFace; varying vec3 vWP;
      void main(){ vec2 c = fieldC(vWP - uC); float v = clamp(fieldI(c), -1.0, 1.0);
        float m = min(1.0, 2.6 * abs(v));
        vec3 col = pow(jet(0.5 + 0.5 * sign(v) * m), vec3(2.2)) * (0.04 + 0.9 * pow(m, 1.2));
        gl_FragColor = vec4(col * uFace, 1.0); }`,
  });
}

// Slice through the focus: instantaneous field (crests) blending into |E|/Emax, the map of the next slide.
export function sliceMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: FU, vertexShader: VS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    fragmentShader: `${FIELD_GLSL} uniform float uSlice, uEnv, uGlow; varying vec3 vWP;
      void main(){ vec3 r = vWP - uC; vec2 c = fieldC(r);
        float v = clamp(fieldI(c), -1.0, 1.0);
        float m = min(1.0, 1.8 * abs(v));
        vec3 inst = pow(jet(0.5 + 0.5 * sign(v) * m), vec3(2.2)) * (0.05 + 0.95 * pow(m, 1.1));
        float e = clamp(length(c), 0.0, 1.0);
        vec3 env = pow(jet(e), vec3(2.2)) * mix(1.0, 1.0 + 1.2 * smoothstep(0.75, 1.0, e), uGlow);
        vec3 col = mix(inst, env, uEnv);
        gl_FragColor = vec4(col, uSlice); }`,
  });
}

// Waves from the paths' last segments. paths: [{ dir: [x,y,z] propagation direction at the receiver, a }]
export function setWaves(waves) {
  const n = Math.min(NW, waves.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const w = waves[i], l = Math.hypot(...w.dir);
    FU.uW.value[i].set(w.dir[0] / l, w.dir[1] / l, w.dir[2] / l, w.a); sum += w.a;
  }
  FU.uN.value = n; FU.uNorm.value = 1 / sum;
}

// CPU copy for checks: |E|/Emax along a direction through the focus; returns the FWHM in wavelengths.
export function fwhm(dir) {
  const k = 2 * Math.PI / LAM, n = FU.uN.value, W = FU.uW.value, nrm = FU.uNorm.value;
  const amp = (s) => { let re = 0, im = 0; for (let i = 0; i < n; i++) { const ph = k * s * (W[i].x * dir[0] + W[i].y * dir[1] + W[i].z * dir[2]); re += W[i].w * Math.cos(ph); im -= W[i].w * Math.sin(ph); } return Math.hypot(re, im) * nrm; };
  let a = 0, b = 0; const ds = LAM / 400;
  while (amp(a) > 0.5) a += ds; while (amp(-b) > 0.5) b += ds;
  return (a + b) / LAM;
}
