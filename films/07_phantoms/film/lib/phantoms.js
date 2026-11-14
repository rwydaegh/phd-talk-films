// The four ViP phantoms: a glass shell per body and a cut face that samples the real 3 mm tissue labels.
// Body frame (prep/build.py): x lateral (+x = patient's right), y anterior, z up, feet at z = 0, final cut at y = 0.
// The scene places body i at x = slot[i]. Everything is drawn in linear HDR for post.js.
import * as THREE from 'three';

export const ADD = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };
const PREMUL = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor };
export const ORDER = ['duke', 'ella', 'eartha', 'thelonious'];
export const WHO = { duke: ['Duke', 34], ella: ['Ella', 26], eartha: ['Eartha', 8], thelonious: ['Thelonious', 6] };
// Identity colours of the deck (css/deck.css); Duke's black reads as white on black.
export const IDENT = { duke: [1, 1, 1], ella: [0.15, 0.32, 1.0], eartha: [0.62, 0.2, 0.85], thelonious: [1.0, 0.16, 0.12] };

// Shared plane-wave uniforms: crests at s = anchor + (phase + 2 pi m) / kw along k = -y, present where s < head.
const waveGLSL = `
uniform float uKw, uAnchor, uPhase, uHead, uWave;
float crestLine(vec3 w, out float lit){
  float s = -w.y;
  lit = uWave * smoothstep(uHead + 0.02, uHead - 0.12, s);
  float ph = (uKw * (s - uAnchor) - uPhase) / 6.2831853;
  float d = abs(fract(ph + 0.5) - 0.5) * 6.2831853 / uKw;      // metres to the nearest crest along k
  float px = max(fwidth(s), 1e-6);
  float lam = 6.2831853 / uKw;
  float fine = smoothstep(2.5, 6.0, lam / px) * smoothstep(0.025, 0.07, lam);   // crests finer than a few px, or than a few cm, fade to their mean
  float line = exp(-d / (px * 1.1)) * 0.9 + exp(-d / (0.04 * lam)) * 0.35;
  return lit * mix(0.07, line, fine);
}`;

const SHELL_VS = `in vec3 position; in vec3 normal; uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vW; out vec3 vN;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = mat3(modelMatrix) * normal; gl_Position = projectionMatrix * viewMatrix * w; }`;
const SHELL_FS = `precision highp float;
in vec3 vW; in vec3 vN; out vec4 frag;
uniform vec3 uEye, uRim, uCrest; uniform float uCut, uGhost, uGain, uFill, uBack;
${waveGLSL}
void main(){
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(uEye - vW);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float edgeT = pow(1.0 - ndv, 3.0), fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  vec3 r = reflect(-v, n);
  // a studio dome (bright above, dark floor) seen in the glass, plus one broad soft box high on the left
  vec3 dome = mix(vec3(0.01), vec3(0.85, 0.9, 1.0), smoothstep(-0.15, 0.85, r.z));
  float key = pow(max(dot(r, normalize(vec3(0.5, 0.75, 0.6))), 0.0), 10.0);
  float kick = pow(max(dot(r, normalize(vec3(-0.7, -0.4, 0.3))), 0.0), 6.0);
  float edge2 = pow(1.0 - ndv, 2.0);
  vec3 c = uRim * (edgeT * 0.9 + edge2 * 0.12) + dome * 0.55 * fres + vec3(1.0, 0.97, 0.94) * key * (0.015 + 0.55 * fres) + vec3(0.7, 0.82, 1.0) * kick * 0.3 * edgeT;
  c += uRim * uFill;
  float lit; float cl = crestLine(vW, lit);
  c += uCrest * cl * (0.55 + 0.45 * ndv) * 1.6 + uCrest * lit * 0.05;
  float front = smoothstep(uCut - 0.002, uCut + 0.002, vW.y);
  float a = mix(1.0, uGhost, front) * (gl_FrontFacing ? 1.0 : uBack) * uGain;
  frag = vec4(max(c, 0.0) * a, 0.0);
}`;

// Cut face: a quad on the plane y = uCut. Tissue colour by a trilinear vote of the 8 nearest voxel labels,
// 4 sub-samples per pixel; outline from the smoothed occupancy (the same field the shell was meshed from).
const CUT_VS = `in vec3 position; uniform mat4 modelMatrix, viewMatrix, projectionMatrix; out vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const CUT_FS = `precision highp float; precision highp usampler3D; precision highp sampler3D;
in vec3 vW; out vec4 frag;
uniform usampler3D uLab; uniform sampler3D uOcc; uniform sampler2D uLut;
uniform mat4 uW2G; uniform vec3 uDims, uDimsL; uniform float uExposure, uEdge, uAlpha, uSat, uDim;
uniform vec3 uEdgeCol;
vec3 tissue(vec3 g){
  vec3 b = floor(g), f = g - b;
  uint id[8]; float w[8];
  for (int i = 0; i < 8; i++) {
    vec3 o = vec3(float(i & 1), float((i >> 1) & 1), float((i >> 2) & 1));
    ivec3 q = ivec3(clamp(b + o, vec3(0.0), uDimsL - 1.0));
    id[i] = texelFetch(uLab, q, 0).r;
    vec3 ww = mix(1.0 - f, f, o); w[i] = ww.x * ww.y * ww.z;
  }
  float best = -1.0; uint bi = id[0];
  for (int i = 0; i < 8; i++) { float s = 0.0; for (int j = 0; j < 8; j++) s += id[j] == id[i] ? w[j] : 0.0; if (s > best) { best = s; bi = id[i]; } }
  return texelFetch(uLut, ivec2(int(bi), 0), 0).rgb;
}
void main(){
  vec3 g = (uW2G * vec4(vW, 1.0)).xyz;
  float occ = texture(uOcc, (g + 0.5) / uDims).r;
  float fw = max(fwidth(occ), 1e-4);
  float a = smoothstep(0.5 - fw * 0.75, 0.5 + fw * 0.75, occ) * uAlpha;
  float edge = exp(-abs(occ - 0.5) / (fw * 1.3)) * uEdge;
  if (a < 0.003 && edge < 0.003) discard;
  vec3 gf = 2.0 * g + 0.5, dx = dFdx(gf), dy = dFdy(gf);
  vec3 d = (tissue(gf + 0.25 * dx + 0.25 * dy) + tissue(gf - 0.25 * dx + 0.25 * dy) + tissue(gf + 0.25 * dx - 0.25 * dy) + tissue(gf - 0.25 * dx - 0.25 * dy)) * 0.25;
  float l = dot(d, vec3(0.299, 0.587, 0.114)); d = mix(vec3(l), d, uSat) * uDim;
  vec3 c = -log(1.0 - pow(clamp(d, 0.0, 0.95), vec3(2.2))) / uExposure;   // inverse of post.js's tone curve
  frag = vec4(c * a + uEdgeCol * edge, a);
}`;

async function bin(url) { const r = await fetch(url); if (!r.ok) throw new Error(url); return r.arrayBuffer(); }

export class Phantoms {
  async init() {
    const meta = await (await fetch('assets/ph/phantoms.json')).json();
    this.meta = meta; this.group = new THREE.Group(); this.list = [];
    for (const ph of ORDER) {
      const m = meta[ph];
      const [nx, ny, nz] = m.dims;
      const [labB, occB, shB] = await Promise.all([bin(`assets/ph/${ph}_lab2.bin`), bin(`assets/ph/${ph}_occ.bin`), bin(`assets/ph/${ph}_shell.bin`)]);
      const lab = new THREE.Data3DTexture(new Uint8Array(labB), 2 * nx, 2 * ny, 2 * nz);
      lab.format = THREE.RedIntegerFormat; lab.type = THREE.UnsignedByteType; lab.internalFormat = 'R8UI';
      lab.minFilter = lab.magFilter = THREE.NearestFilter; lab.unpackAlignment = 1; lab.needsUpdate = true;
      const occ = new THREE.Data3DTexture(new Uint8Array(occB), nx, ny, nz);
      occ.format = THREE.RedFormat; occ.type = THREE.UnsignedByteType; occ.minFilter = occ.magFilter = THREE.LinearFilter; occ.unpackAlignment = 1; occ.needsUpdate = true;
      const lutA = new Uint8Array(256 * 4);
      m.colors.forEach((c, i) => { lutA.set([c[0] * 255, c[1] * 255, c[2] * 255, 255].map(Math.round), i * 4); });
      const lut = new THREE.DataTexture(lutA, 256, 1); lut.needsUpdate = true;
      // shell
      const nv = m.nv, nf = m.nf;
      const pos = new Float32Array(shB, 0, nv * 3), nrm = new Float32Array(shB, nv * 12, nv * 3), idx = new Uint32Array(shB, nv * 24, nf * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      const su = {
        uEye: { value: new THREE.Vector3() }, uRim: { value: new THREE.Vector3(0.8, 0.9, 1.1) }, uCrest: { value: new THREE.Vector3(0.7, 0.88, 1.25) },
        uCut: { value: 10 }, uGhost: { value: 0.3 }, uGain: { value: 1 }, uFill: { value: 0.0 }, uBack: { value: 0.3 },
        uKw: { value: 10 }, uAnchor: { value: 0 }, uPhase: { value: 0 }, uHead: { value: -10 }, uWave: { value: 0 },
      };
      const shellMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SHELL_VS, fragmentShader: SHELL_FS, uniforms: su,
        side: THREE.DoubleSide, transparent: true, depthWrite: false, depthTest: true, ...ADD });
      const shell = new THREE.Mesh(geo, shellMat); shell.renderOrder = 3; shell.frustumCulled = false;
      // cut quad over the body's x-z extent (unit quad in x-z, scaled per frame)
      const qg = new THREE.PlaneGeometry(1, 1); qg.rotateX(Math.PI / 2);   // now spans x and z, normal along y
      const cu = {
        uLab: { value: lab }, uOcc: { value: occ }, uLut: { value: lut }, uW2G: { value: new THREE.Matrix4() }, uDims: { value: new THREE.Vector3(nx, ny, nz) }, uDimsL: { value: new THREE.Vector3(2 * nx, 2 * ny, 2 * nz) },
        uExposure: { value: 1 }, uEdge: { value: 0 }, uAlpha: { value: 1 }, uSat: { value: 1 }, uDim: { value: 1 }, uEdgeCol: { value: new THREE.Vector3(0.8, 0.9, 1.1) },
      };
      const cutMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: CUT_VS, fragmentShader: CUT_FS, uniforms: cu,
        side: THREE.DoubleSide, transparent: true, depthWrite: true, depthTest: true, ...PREMUL });
      const cut = new THREE.Mesh(qg, cutMat); cut.renderOrder = 1; cut.frustumCulled = false;
      // body frame -> voxel index space: g = (Minv * p_body - origin) / pitch
      const M = new THREE.Matrix4(); M.set(...m.M.flat());
      const toG = new THREE.Matrix4().makeScale(1 / m.pitch[0], 1 / m.pitch[1], 1 / m.pitch[2])
        .multiply(new THREE.Matrix4().makeTranslation(-m.origin[0], -m.origin[1], -m.origin[2])).multiply(M.clone().invert());
      this.group.add(cut, shell);
      this.list.push({ ph, m, shell, cut, su, cu, toG, x: 0 });
    }
    // slots: same gap between bounding boxes, centred on x = 0; Duke on the viewer's left (= +x seen from the front)
    const gap = 0.26, w = this.list.map((p) => p.m.bbox[1][0] - p.m.bbox[0][0]);
    const total = w.reduce((a, b) => a + b, 0) + gap * (w.length - 1);
    let x = total / 2;
    this.list.forEach((p, i) => { p.x = x - w[i] / 2; x -= w[i] + gap; });
    return this;
  }
  // world position of a body-frame point of phantom i
  at(i, p) { const q = this.list[i]; return [p[0] + q.x, p[1], p[2]]; }
  // o: { cam, cut (y of the plane), ghost, cutAlpha, edge, wave: {kw, anchor, phase, head, on}, rim (0..1 identity tint), gain }
  update(o) {
    this.list.forEach((p, i) => {
      const dim = o.dim ? o.dim[i] : 1;
      const mtx = new THREE.Matrix4().makeTranslation(p.x, 0, 0);
      p.shell.matrixAutoUpdate = false; p.shell.matrix.copy(mtx); p.shell.matrixWorld.copy(mtx);
      const su = p.su.uEye ? p.su : null;
      su.uEye.value.copy(o.cam.position); su.uCut.value = o.cut; su.uGhost.value = o.ghost ?? 0.3; su.uGain.value = (o.gain ?? 1) * dim;
      const id = IDENT[p.ph], k = o.rim ?? 0;
      su.uRim.value.set(0.8 + (id[0] - 0.8) * k, 0.9 + (id[1] - 0.9) * k, 1.1 + (id[2] - 1.1) * k);
      const w = o.wave || {};
      su.uWave.value = w.on ?? 0; su.uKw.value = w.kw ?? 10; su.uAnchor.value = w.anchor ?? 0; su.uPhase.value = w.phase ?? 0; su.uHead.value = w.head ?? -10;
      // cut quad
      const bb = p.m.bbox, cx = p.x + (bb[0][0] + bb[1][0]) / 2, cz = (bb[0][2] + bb[1][2]) / 2;
      const inBody = o.cut > bb[0][1] - 0.01 && o.cut < bb[1][1] + 0.01;
      p.cut.visible = inBody && (o.cutAlpha ?? 1) * dim > 0.001;
      const q = new THREE.Matrix4().makeTranslation(cx, o.cut, cz).multiply(new THREE.Matrix4().makeScale(bb[1][0] - bb[0][0] + 0.04, 1, bb[1][2] - bb[0][2] + 0.04));
      p.cut.matrixAutoUpdate = false; p.cut.matrix.copy(q); p.cut.matrixWorld.copy(q);
      p.cu.uW2G.value.copy(p.toG).multiply(new THREE.Matrix4().makeTranslation(-p.x, 0, 0));
      p.cu.uExposure.value = o.exposure ?? 1; p.cu.uEdge.value = o.edge ?? 0; p.cu.uAlpha.value = (o.cutAlpha ?? 1) * dim; p.cu.uDim.value = dim; p.cu.uSat.value = o.sat ?? 1;
    });
  }
}
