// Crisp anti-aliased line segments with a travelling head (rays), and screen-space dots.
// Every segment i: A -> B, its head leaves A at t0 and reaches B at t1 (film seconds of the shot clock),
// then the whole segment holds; it fades between f0 and f1. A trail length (m) > 0 draws only the last `trail` metres
// behind the head (a pulse). dash > 0 draws a dashed line with that period in metres.
import * as THREE from 'three';

const VS = `in vec2 corner; in vec3 aA; in vec3 aB; in vec4 aT; in vec4 aC; in vec4 aW;
uniform mat4 viewMatrix, projectionMatrix; uniform float uTime, uNear; uniform vec2 uRes; uniform float uGain, uScale;
out vec2 vQ; out float vAlong; out vec4 vC; out float vLen; out float vDash; out float vHead; out float vPx; out float vFull; out float vEnd;
void main(){
  float uRaw = (uTime - aT.x) / max(aT.y - aT.x, 1e-4);
  float u = clamp(uRaw, 0.0, 1.0);
  float fade = 1.0 - clamp((uTime - aT.z) / max(aT.w - aT.z, 1e-4), 0.0, 1.0);
  float len = length(aB - aA);
  float u0 = aW.z > 0.0 ? clamp(uRaw - aW.z / max(len, 1e-4), 0.0, 1.0) : 0.0;
  if (uTime < aT.x || u <= u0 || fade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 P0 = mix(aA, aB, u0), P1 = mix(aA, aB, u);
  vec4 v0 = viewMatrix * vec4(P0, 1.0), v1 = viewMatrix * vec4(P1, 1.0);
  float n = -uNear * 1.02;
  if (v0.z > n && v1.z > n) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float a0 = 0.0, a1 = 1.0;
  if (v0.z > n) { float s = (n - v0.z) / (v1.z - v0.z); v0 = mix(v0, v1, s); a0 = s; }
  if (v1.z > n) { float s = (n - v0.z) / (v1.z - v0.z); v1 = mix(v0, v1, s); a1 = s; }
  vec4 c0 = projectionMatrix * v0, c1 = projectionMatrix * v1;
  vec2 s0 = c0.xy / c0.w * 0.5 * uRes, s1 = c1.xy / c1.w * 0.5 * uRes;
  vec2 d = s1 - s0; float L = max(length(d), 1e-3); d /= L;
  vec2 nn = vec2(-d.y, d.x);
  float wpx = aW.x * uScale; float w = wpx * 0.5 + 1.0;                      // half width + 1 px feather
  vec4 c = corner.x < 0.5 ? c0 : c1;
  vec2 sp = (corner.x < 0.5 ? s0 - d * w : s1 + d * w) + nn * (corner.y * 2.0 - 1.0) * w;
  gl_Position = vec4(sp / (0.5 * uRes) * c.w, c.z, c.w);
  vQ = vec2((corner.x < 0.5 ? -w : L + w), (corner.y * 2.0 - 1.0) * w);
  vPx = L;
  float along = mix(a0, a1, corner.x);
  vAlong = mix(u0, u, along) * len;              // metres from A
  vLen = u * len; vHead = (u < 1.0 || aW.z > 0.0) ? 1.0 : 0.0;
  vC = vec4(aC.rgb * aC.a * fade * uGain, wpx); vDash = aW.y; vFull = len; vEnd = aW.w;
}`;
const FS = `precision highp float; in vec2 vQ; in float vAlong; in vec4 vC; in float vLen; in float vDash; in float vHead; in float vPx; in float vFull; in float vEnd; out vec4 frag;
void main(){
  float hw = vC.a * 0.5;
  float e = max(abs(vQ.y) - hw, 0.0) + max(-vQ.x, 0.0) + max(vQ.x - vPx, 0.0);
  float a = clamp(1.0 - e, 0.0, 1.0);
  if (hw < 0.5) a *= hw * 2.0;                     // sub-pixel lines get dimmer instead of thinner
  if (vDash > 0.0) { float f = fract(vAlong / vDash); a *= smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.5, 0.58, f)); }
  if (vEnd > 0.0) a *= smoothstep(0.0, vEnd, vAlong); else if (vEnd < 0.0) a *= smoothstep(0.0, -vEnd, vFull - vAlong);
  // the head: brighter over its last metres while travelling
  float h = vHead * exp(-max(vLen - vAlong, 0.0) / 3.0);
  frag = vec4(vC.rgb * a * (1.0 + 2.5 * h), 0.0);
}`;

const ADD = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };

// segs: [{A, B, t0, t1, f0?, f1?, col:[r,g,b], a?, w?(px at 1080), dash?, trail?, soft? (m; >0 fades in from A, <0 fades out towards B)}]
export function makeBeams(segs, { depthTest = true } = {}) {
  const n = segs.length;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const A = new Float32Array(n * 3), B = new Float32Array(n * 3), T = new Float32Array(n * 4), C = new Float32Array(n * 4), Wd = new Float32Array(n * 4);
  segs.forEach((s, i) => {
    A.set(s.A, i * 3); B.set(s.B, i * 3);
    T.set([s.t0, s.t1, s.f0 ?? 1e9, s.f1 ?? 1e9 + 1], i * 4);
    C.set([...s.col, s.a ?? 1], i * 4);
    Wd.set([s.w ?? 1.5, s.dash ?? 0, s.trail ?? 0, s.soft ?? 0], i * 4);
  });
  g.setAttribute('aA', new THREE.InstancedBufferAttribute(A, 3)); g.setAttribute('aB', new THREE.InstancedBufferAttribute(B, 3));
  g.setAttribute('aT', new THREE.InstancedBufferAttribute(T, 4)); g.setAttribute('aC', new THREE.InstancedBufferAttribute(C, 4));
  g.setAttribute('aW', new THREE.InstancedBufferAttribute(Wd, 4));
  g.instanceCount = n;
  const U = { uTime: { value: 0 }, uNear: { value: 0.1 }, uRes: { value: new THREE.Vector2(1920, 1080) }, uGain: { value: 1 }, uScale: { value: 1 } };
  const m = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, uniforms: U,
    transparent: true, depthWrite: false, depthTest, side: THREE.DoubleSide, ...ADD });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 10;
  return { mesh, U, T, C, g,
    // width in px is given at 1080 lines; scale to the render height
    update(t, cam, W, H) { U.uTime.value = t; U.uNear.value = cam.near; U.uRes.value.set(W, H); U.uScale.value = H / 1080; } };
}

// Dots: [{P, t0, f0?, f1?, col, a?, r (px at 1080)}] screen-space discs with a soft glow.
const DVS = `in vec2 corner; in vec3 aP; in vec4 aT; in vec4 aC; in float aR;
uniform mat4 viewMatrix, projectionMatrix; uniform float uTime, uScale; uniform vec2 uRes; uniform float uGain;
out vec2 vQ; out vec4 vC; out float vR;
void main(){
  float a = clamp((uTime - aT.x) / max(aT.y, 1e-3), 0.0, 1.0) * (1.0 - clamp((uTime - aT.z) / max(aT.w - aT.z, 1e-3), 0.0, 1.0));
  vec4 c = projectionMatrix * viewMatrix * vec4(aP, 1.0);
  if (a <= 0.0 || c.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float r = aR * uScale; float R = r * 3.0 + 1.0;
  vec2 o = (corner * 2.0 - 1.0) * R;
  gl_Position = vec4(c.xy + o / (0.5 * uRes) * c.w, c.z, c.w);
  vQ = o; vR = r; vC = vec4(aC.rgb * a * uGain, aC.a);
}`;
const DFS = `precision highp float; in vec2 vQ; in vec4 vC; in float vR; out vec4 frag;
void main(){ float d = length(vQ);
  float core = clamp(vR + 0.5 - d, 0.0, 1.0);
  float glow = exp(-d * d / (vR * vR * 2.2)) * 0.35;
  frag = vec4(vC.rgb * (core + glow) * vC.a, 0.0); }`;

export function makeDots(dots, { depthTest = true } = {}) {
  const n = dots.length;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const P = new Float32Array(n * 3), T = new Float32Array(n * 4), C = new Float32Array(n * 4), R = new Float32Array(n);
  dots.forEach((d, i) => { P.set(d.P, i * 3); T.set([d.t0, d.rise ?? 0.15, d.f0 ?? 1e9, d.f1 ?? 1e9 + 1], i * 4); C.set([...d.col, d.a ?? 1], i * 4); R[i] = d.r ?? 3; });
  g.setAttribute('aP', new THREE.InstancedBufferAttribute(P, 3)); g.setAttribute('aT', new THREE.InstancedBufferAttribute(T, 4));
  g.setAttribute('aC', new THREE.InstancedBufferAttribute(C, 4)); g.setAttribute('aR', new THREE.InstancedBufferAttribute(R, 1));
  g.instanceCount = n;
  const U = { uTime: { value: 0 }, uScale: { value: 1 }, uRes: { value: new THREE.Vector2(1920, 1080) }, uGain: { value: 1 } };
  const m = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: DVS, fragmentShader: DFS, uniforms: U,
    transparent: true, depthWrite: false, depthTest, ...ADD });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 11;
  return { mesh, U, T, C, P, g, update(t, W, H) { U.uTime.value = t; U.uRes.value.set(W, H); U.uScale.value = H / 1080; } };
}
