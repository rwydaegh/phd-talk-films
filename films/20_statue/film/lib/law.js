// The surface law on the real Thelonious mesh, evaluated per pixel:
//   S_ab / (S_inc T0) = [n . (-k)]_+ V
// n: interpolated area-weighted vertex normals; V: visibility toward the source from a distance shadow map.
// The same light drives the plaster shading (a lamp at a finite distance, cos/r^2) and, once the lamp
// is far away, the jet map. Everything is linear: plaster = albedo * irradiance, jet = jet(law).
import * as THREE from 'three';

export const JET = `vec3 jetc(float x){ x = clamp(x, 0.0, 1.0); return clamp(vec3(1.5 - abs(4.0*x - 3.0), 1.5 - abs(4.0*x - 2.0), 1.5 - abs(4.0*x - 1.0)), 0.0, 1.0); }
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }`;
export function jet(x) {
  x = Math.min(1, Math.max(0, x)); const c = (v) => Math.min(1, Math.max(0, v));
  return [c(1.5 - Math.abs(4 * x - 3)), c(1.5 - Math.abs(4 * x - 2)), c(1.5 - Math.abs(4 * x - 1))];
}

// ---- assets ------------------------------------------------------------------------------
export async function loadBust(name) {
  const meta = await (await fetch(`assets/${name}.json`)).json();
  const buf = await (await fetch(`assets/${name}.bin`)).arrayBuffer();
  const arr = (k, T) => new T(buf, meta[k].offset, meta[k].count);
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.BufferAttribute(arr('pos', Float32Array), 3));
  body.setAttribute('normal', new THREE.BufferAttribute(arr('nrm', Float32Array), 3));
  body.setIndex(new THREE.BufferAttribute(arr('idx', Uint32Array), 1));
  const cap = new THREE.BufferGeometry();
  const cp = arr('cap_pos', Float32Array);
  cap.setAttribute('position', new THREE.BufferAttribute(cp, 3));
  let cn = meta.cap_nrm ? arr('cap_nrm', Float32Array) : null;
  if (!cn) { cn = new Float32Array(cp.length); for (let i = 2; i < cn.length; i += 3) cn[i] = -1; }
  cap.setAttribute('normal', new THREE.BufferAttribute(cn, 3));
  cap.setIndex(new THREE.BufferAttribute(arr('cap_idx', Uint32Array), 1));
  let socle = null;
  if (meta.soc_pos) {
    socle = new THREE.BufferGeometry();
    socle.setAttribute('position', new THREE.BufferAttribute(arr('soc_pos', Float32Array), 3));
    socle.setAttribute('normal', new THREE.BufferAttribute(arr('soc_nrm', Float32Array), 3));
    socle.setIndex(new THREE.BufferAttribute(arr('soc_idx', Uint32Array), 1));
  }
  // a non-indexed copy with barycentric coordinates, so the shader can draw the triangle edges
  const tri = body.toNonIndexed();
  const nv = tri.attributes.position.count, bc = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) bc[3 * i + (i % 3)] = 1;
  tri.setAttribute('bary', new THREE.BufferAttribute(bc, 3));
  return { body, tri, cap, socle, meta };
}

// ---- shadow: distance from the source, stored relative to uD0 for precision ------------------
const SH_VS = `in vec3 position; uniform mat4 modelMatrix, viewMatrix, projectionMatrix; uniform vec3 uLightPos; uniform float uD0;
out vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const SH_FS = `precision highp float; in vec3 vW; uniform vec3 uLightPos; uniform float uD0; out vec4 frag;
void main(){ frag = vec4(length(vW - uLightPos) - uD0, 0.0, 0.0, 1.0); }`;

export class Shadow {
  constructor(renderer, size = 4096) {
    this.r = renderer; this.size = size;
    this.rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType, format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
    this.mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SH_VS, fragmentShader: SH_FS, side: THREE.DoubleSide,
      uniforms: { uLightPos: { value: new THREE.Vector3() }, uD0: { value: 0 } } });
    this.scene = new THREE.Scene(); this.scene.overrideMaterial = this.mat;
    this.vp = new THREE.Matrix4();
    // shared uniforms for every material that tests visibility
    this.u = {
      uShadow: { value: this.rt.texture }, uShadowVP: { value: this.vp }, uLightPos: { value: new THREE.Vector3() },
      uD0: { value: 0 }, uShTexel: { value: 1 / size }, uShBias: { value: 0.0015 }, uShSoft: { value: 1.0 },
    };
  }
  // light at L, looking at C; R bounds everything that may cast a shadow (metres)
  update(L, C, R, meshes) {
    const d = Math.hypot(L[0] - C[0], L[1] - C[1], L[2] - C[2]);
    const c = this.cam;
    c.position.set(...L); c.up.set(0, 0, 1);
    if (Math.abs((C[2] - L[2]) / d) > 0.98) c.up.set(0, 1, 0);
    c.lookAt(...C);
    c.fov = 2 * Math.atan(R / Math.sqrt(Math.max(d * d - R * R, 1e-6))) * 180 / Math.PI;
    c.near = Math.max(0.01, d - R * 1.05); c.far = d + R * 1.05;
    c.updateProjectionMatrix(); c.updateMatrixWorld();
    this.vp.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
    this.mat.uniforms.uLightPos.value.set(...L); this.mat.uniforms.uD0.value = d;
    this.u.uLightPos.value.set(...L); this.u.uD0.value = d;
    const parents = meshes.map((m) => m.parent);
    for (const m of meshes) this.scene.add(m);
    this.r.setRenderTarget(this.rt); this.r.setClearColor(0x000000, 0); this.r.clearColor();
    this.r.setClearColor(new THREE.Color(1e6, 0, 0), 1); this.r.clear(); this.r.render(this.scene, c);
    meshes.forEach((m, i) => { if (parents[i]) parents[i].add(m); else this.scene.remove(m); });
    this.r.setClearColor(0x000000, 1);
  }
}

// GLSL: visibility of world point p from the source (1 lit, 0 shadowed), 12-tap PCF of radius uShSoft texels
export const VIS = `uniform sampler2D uShadow; uniform mat4 uShadowVP; uniform vec3 uLightPos; uniform float uD0, uShTexel, uShBias, uShSoft;
float visAt(vec3 p){
  vec4 c = uShadowVP * vec4(p, 1.0); vec2 uv = c.xy / c.w * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 || c.w <= 0.0) return 1.0;
  float d = length(p - uLightPos) - uD0 - uShBias;
  float s = 0.0;
  const vec2 tap[12] = vec2[12](vec2(-0.326,-0.406), vec2(-0.840,-0.074), vec2(-0.696,0.457), vec2(-0.203,0.621), vec2(0.962,-0.195), vec2(0.473,-0.480),
    vec2(0.519,0.767), vec2(0.185,-0.893), vec2(0.507,0.064), vec2(0.896,0.412), vec2(-0.322,-0.933), vec2(-0.792,-0.598));
  for (int i = 0; i < 12; i++) s += step(d, texture(uShadow, uv + tap[i] * uShSoft * uShTexel).r);
  return s / 12.0;
}`;

// ---- the body: plaster under a lamp, or the law in jet, swept by a wavefront ------------------
const B_VS = `in vec3 position; in vec3 normal;
#ifdef BARY
in vec3 bary; out vec3 vB;
#endif
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vW; out vec3 vN; void main(){
#ifdef BARY
  vB = bary;
#endif
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normal; gl_Position = projectionMatrix * viewMatrix * w; }`;
const B_FS = `precision highp float; in vec3 vW; in vec3 vN; out vec4 frag;
#ifdef BARY
in vec3 vB;
#endif
uniform float uWire, uWirePx;
${VIS}
${JET}
uniform vec3 uC, uK, uLightCol, uAmb;
uniform float uAlbedo, uE, uJetMix, uFront, uFrontW, uNOff, uJetGain, uFade, uGrainAmp, uFlat, uIso;
uniform vec3 uTa, uTb, uTc;          // the isolated facet
uniform vec3 uTint; uniform float uVein, uPow; uniform vec4 uCut, uAO;      // stone: tint, veins; contact occlusion below z = cut.x + cut.y (x - cut.z)^2
float inTri(vec3 p){
  vec3 e0 = uTb - uTa, e1 = uTc - uTa, nn = cross(e0, e1); float A = length(nn); vec3 nh = nn / A;
  float h = abs(dot(p - uTa, nh)); vec3 q = p - uTa - dot(p - uTa, nh) * nh;
  float u = dot(cross(q, e1), nh) / A, v = dot(cross(e0, q), nh) / A;
  float m = min(min(u, v), 1.0 - u - v);
  float px = length(fwidth(p)) / sqrt(A);           // one pixel in barycentric units, roughly
  return smoothstep(-px, px, m) * step(h, 0.0004);
}
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
void main(){
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  if (uFlat > 0.0) { vec3 nf = normalize(cross(dFdx(vW), dFdy(vW))); if (dot(nf, n) < 0.0) nf = -nf; n = normalize(mix(n, nf, uFlat)); }
  vec3 Ld = uLightPos - vW; float r = length(Ld); vec3 l = Ld / r;
  float cosv = max(dot(n, l), 0.0);
  float V = cosv > 0.0 ? visAt(vW + n * uNOff) : 0.0;
  float fall = (uD0 * uD0) / (r * r);                     // 1/r^2, normalised at the statue centre
  float law = cosv * V;                                    // S_ab / (S_inc T0) once the source is far
  float grain = 1.0 + uGrainAmp * (vnoise(vW * 900.0) - 0.5) + uGrainAmp * 0.6 * (vnoise(vW * 2600.0) - 0.5);
  vec3 alb = uAlbedo * grain * uTint;
  if (uVein > 0.0) {
    vec3 q = vW * 38.0; float fb = vnoise(q) * 0.5 + vnoise(q * 2.1) * 0.25 + vnoise(q * 4.3) * 0.125;
    float v = abs(sin((vW.x * 0.8 + vW.z * 1.3 + vW.y * 0.4) * 46.0 + fb * 7.0));
    alb *= 1.0 - uVein * (1.0 - smoothstep(0.0, 0.12, v)) - uVein * 0.35 * (fb - 0.44);
  }
  float occ = 1.0;
  if (uAO.w > 0.0) {
    float h = uCut.x + uCut.y * (vW.x - uCut.z) * (vW.x - uCut.z) - vW.z;   // depth below the contact surface
    occ = 1.0 - uAO.w * exp(-max(h, 0.0) / uAO.x);
  }
  vec3 plaster = alb * occ * (pow(uLightCol * uE * fall * law, vec3(uPow)) + uAmb * (0.55 + 0.45 * n.z));   // uPow 2.2: screen brightness follows the law linearly
  vec3 jetcol = lin(jetc(law)) * uJetGain;
  float s = dot(vW - uC, uK);                              // position along k
  float w = uJetMix * (1.0 - smoothstep(uFront - uFrontW, uFront + uFrontW, s));
  float isoA = uIso > 0.0 ? uIso * (1.0 - inTri(vW)) : 0.0;     // everything but the chosen facet goes dark
  vec3 base = mix(plaster, jetcol, w);
  vec3 col = base * mix(1.0, 0.012, isoA);
#ifdef BARY
  if (uWire > 0.0) {
    vec3 e = vB / max(fwidth(vB), vec3(1e-6));                 // distance to each edge in pixels
    float m = min(min(e.x, e.y), e.z);
    float line = 1.0 - smoothstep(uWirePx * 0.5 - 0.5, uWirePx * 0.5 + 0.5, m);
    col = mix(col, mix(col * 0.18, base * 0.11, isoA), uWire * line);   // dark lines on the lit skin, faint light lines on the dark
  }
#endif
  frag = vec4(col * uFade, 1.0);
}`;

export function bodyMaterial(shadow, extra = {}, bary = false) {
  const u = Object.assign({}, shadow.u, {
    uC: { value: new THREE.Vector3() }, uK: { value: new THREE.Vector3(0, 1, 0) }, uLightCol: { value: new THREE.Vector3(1, 1, 1) },
    uAmb: { value: new THREE.Vector3(0, 0, 0) }, uAlbedo: { value: 0.82 }, uE: { value: 1 }, uJetMix: { value: 0 }, uFront: { value: -10 },
    uFrontW: { value: 0.006 }, uNOff: { value: 0.0012 }, uJetGain: { value: 1 }, uFade: { value: 1 }, uGrainAmp: { value: 0.05 },
    uFlat: { value: 0 }, uIso: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uVein: { value: 0 }, uPow: { value: 1 }, uCut: { value: new THREE.Vector4(0, 0, 0, 0) }, uAO: { value: new THREE.Vector4(0, 0, 0, 0) }, uWire: { value: 0 }, uWirePx: { value: 1.5 }, uTa: { value: new THREE.Vector3() }, uTb: { value: new THREE.Vector3() }, uTc: { value: new THREE.Vector3() },
  }, extra);
  return new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: B_VS, fragmentShader: B_FS, uniforms: u, side: THREE.DoubleSide, defines: bary ? { BARY: 1 } : {} });
}

// ---- wavefronts: caps of spheres around the source, flattening into planes as it recedes ----------
const F_VS = `in vec3 position; in float aR; in float aA; uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 uSrc, uAx, uE1, uE2; uniform float uHalf;
out vec3 vW; out vec2 vXY; out float vA;
void main(){
  vec3 pp = uSrc + aR * uAx + position.x * 2.0 * uHalf * uE1 + position.y * 2.0 * uHalf * uE2;
  vec3 w = uSrc + aR * normalize(pp - uSrc);
  vW = w; vXY = position.xy; vA = aA;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const F_FS = `precision highp float; in vec3 vW; in vec2 vXY; in float vA; out vec4 frag;
${VIS}
uniform vec3 uCol, uSrc, uEye; uniform float uGain, uEdge, uShadowCut, uFill, uRim, uShell;
void main(){
  float r = length(vXY) * 2.0;                           // 0 centre .. 1 edge of the window
  float win = 1.0 - smoothstep(1.0 - uEdge, 1.0, r);
  win *= win;
  // a thin emissive shell: bright where seen edge-on, faint where seen face-on
  float c = abs(dot(normalize(vW - uSrc), normalize(vW - uEye)));
  float g = uShell / max(c, uShell); win *= g * g;
  float v = mix(1.0, visAt(vW), uShadowCut);              // the front is missing where the body shadows it
  float e = vA * win * v * uGain;
  if (e < 1e-4) discard;
  frag = vec4(uCol * e, 0.0);
}`;

export class Fronts {
  constructor(shadow, n = 40, seg = 64) {
    const plane = new THREE.PlaneGeometry(1, 1, seg, seg);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index; g.setAttribute('position', plane.getAttribute('position'));
    this.aR = new THREE.InstancedBufferAttribute(new Float32Array(n), 1); this.aA = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    g.setAttribute('aR', this.aR); g.setAttribute('aA', this.aA); g.instanceCount = 0;
    this.n = n;
    this.u = Object.assign({}, shadow.u, {
      uSrc: { value: new THREE.Vector3() }, uAx: { value: new THREE.Vector3(0, 1, 0) }, uE1: { value: new THREE.Vector3(1, 0, 0) }, uE2: { value: new THREE.Vector3(0, 0, 1) },
      uHalf: { value: 0.4 }, uCol: { value: new THREE.Vector3(0.8, 0.9, 1.1) }, uGain: { value: 0.1 }, uEdge: { value: 0.01 }, uShadowCut: { value: 1 }, uFill: { value: 0.3 }, uRim: { value: 1 }, uEye: { value: new THREE.Vector3() }, uShell: { value: 0.07 },
    });
    this.mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: F_VS, fragmentShader: F_FS, uniforms: this.u,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.geo = g;
  }
  // src: source point; ax: unit axis from the source toward the statue; list: [{R, a}] radii and opacities
  set(src, ax, list, { half, gain, col, edge } = {}) {
    const u = this.u;
    u.uSrc.value.set(...src); u.uAx.value.set(...ax).normalize();
    const up = Math.abs(ax[2]) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    u.uE1.value.crossVectors(u.uAx.value, up).normalize(); u.uE2.value.crossVectors(u.uE1.value, u.uAx.value).normalize();
    if (half !== undefined) u.uHalf.value = half;
    if (gain !== undefined) u.uGain.value = gain;
    if (edge !== undefined) u.uEdge.value = edge;
    if (col) u.uCol.value.set(...col);
    const m = Math.min(this.n, list.length);
    for (let i = 0; i < m; i++) { this.aR.array[i] = list[i].R; this.aA.array[i] = list[i].a; }
    this.aR.needsUpdate = this.aA.needsUpdate = true; this.geo.instanceCount = m;
    this.mesh.visible = m > 0 && (gain ?? u.uGain.value) > 0;
  }
}
