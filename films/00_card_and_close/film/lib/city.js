// The Korenmarkt (Google 3D tiles, cached for the AEGIS film) at dusk, with a 5G panel on roof_2 and its beam.
// Panel frame: P (centre of the element grid), n (boresight, horizontal towards the square), r (row direction), z up.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ADD, jetGLSL } from './card3d.js';

export const F35 = 3.5, LAM35 = 0.299792458 / F35, KW35 = 2 * Math.PI / LAM35, DX = LAM35 / 2, NE = 8;
const ROOF = [-55.0, 58.25, 67.943258];
export const AIM = [1.0, -10.0, 51.0];
export const PANEL = (() => {
  const P = [ROOF[0], ROOF[1], ROOF[2] + 4.2];
  let n = [AIM[0] - P[0], AIM[1] - P[1], 0]; const l = Math.hypot(n[0], n[1]); n = [n[0] / l, n[1] / l, 0];
  const r = [n[1], -n[0], 0];       // n x z ... right when looking along n
  const el = Math.atan2(AIM[2] - P[2], l);
  return { P, n, r, up: [0, 0, 1], el: Math.sin(el), dist: Math.hypot(l, AIM[2] - P[2]) };
})();
export const elemPos = (m, l) => PANEL.P.map((c, i) => c + PANEL.r[i] * (m - 3.5) * DX + PANEL.up[i] * (l - 3.5) * DX);

// GLSL: |AF|^2 / 64^2 of the 8x8 array steered to (sx, sy) = (sin az, sin el) in panel coordinates, at a world point.
const AF = `
uniform vec3 uPP, uPN, uPR; uniform vec2 uSteer; uniform float uKd;
float afx(float psi){ float s = sin(psi * 0.5); return abs(s) < 1e-4 ? 8.0 : sin(4.0 * psi) / s; }
float arrayGain(vec3 w){
  vec3 d = w - uPP; float r = length(d); d /= r;
  float ur = dot(d, uPR), uu = d.z, un = dot(d, uPN);
  float a = afx(uKd * (ur - uSteer.x)) * afx(uKd * (uu - uSteer.y)) / 64.0;
  float el = max(un, 0.0);           // element pattern: forward hemisphere, cos
  return a * a * el;
}`;

const BEAM_VS = `in vec3 position; uniform mat4 modelMatrix, viewMatrix, projectionMatrix; out vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const BEAM_FS = `precision highp float; in vec3 vW; out vec4 frag;
uniform vec3 uEye, uAxis; uniform float uGain, uLen, uJetMix, uWt; uniform vec3 uBmin, uBmax;
${AF}
${jetGLSL}
vec2 boxHit(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax){ vec3 inv = 1.0 / rd; vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv; vec3 a = min(t0, t1), b = max(t0, t1); return vec2(max(max(a.x, a.y), a.z), min(min(b.x, b.y), b.z)); }
void main(){
  vec3 rd = normalize(vW - uEye);
  vec2 h = boxHit(uEye, rd, uBmin, uBmax);
  // march only near the beam axis (closest approach of the ray to the axis line)
  vec3 w0 = uEye - uPP; float b = dot(rd, uAxis), dd = dot(rd, w0), e = dot(uAxis, w0);
  float den = max(1.0 - b * b, 1e-4);
  float tc = (b * e - dd) / den, sc = (e - b * dd) / den;
  float W = 0.22 * max(sc, 0.0) + 2.5;
  float half_ = W / sqrt(den);
  float t0 = max(max(h.x, tc - half_), 0.0), t1 = min(h.y, tc + half_);
  if (t1 <= t0) discard;
  vec3 acc = vec3(0.0);
  const int NS = 64;
  float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  for (int i = 0; i < NS; i++) {
    float u = (float(i) + jit) / float(NS);
    float t = mix(t0, t1, u);
    float dt = (t1 - t0) / float(NS);
    vec3 p = uEye + rd * t;
    float r = length(p - uPP);
    if (r < 0.25) continue;
    float g = arrayGain(p);
    float I = g / (1.0 + r * 0.03) * smoothstep(1.5, 12.0, r) * (1.0 - smoothstep(uLen * 0.8, uLen, r));
    if (p.z < 50.6) I = 0.0;
    float wf = 0.5 + 0.5 * cos(6.2831853 * r / 7.0 - uWt);
    I *= 0.12 + 1.9 * pow(wf, 10.0);
    float v = clamp(1.0 + 10.0 * log(max(I, 1e-9)) / log(10.0) / 28.0, 0.0, 1.0);
    vec3 cj = pow(jet(v), vec3(2.2));
    vec3 c = mix(vec3(0.55, 0.8, 1.2), cj, uJetMix);
    acc += c * I * dt;
  }
  frag = vec4(acc * uGain, 0.0);
}`;

export function beamUniforms() {
  return { uPP: { value: new THREE.Vector3(...PANEL.P) }, uPN: { value: new THREE.Vector3(...PANEL.n) }, uPR: { value: new THREE.Vector3(...PANEL.r) },
    uSteer: { value: new THREE.Vector2(0, -0.25) }, uKd: { value: KW35 * DX } };
}

function enuMatrix(m34) {
  const M = new THREE.Matrix4().set(...m34[0], ...m34[1], ...m34[2], 0, 0, 0, 1);
  const Y2Z = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  return M.multiply(Y2Z);
}

export async function buildCity(renderer, shared) {
  const route = await fetch('data/route.json').then((r) => r.json());
  const scene = new THREE.Scene();
  const uCity = { value: 0 }, uFoot = { value: 0 };
  // Sky: deep dusk, a thin warm horizon in the west.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: { uCity },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `varying vec3 vD; uniform float uCity; void main(){ float e = vD.z;
      vec3 zen = vec3(0.0006, 0.0011, 0.0035), mid = vec3(0.004, 0.009, 0.026), hor = vec3(0.03, 0.04, 0.075), warm = vec3(0.16, 0.07, 0.035);
      vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, e)); c = mix(c, zen, smoothstep(0.15, 0.8, e));
      float az = atan(vD.y, vD.x); c += warm * exp(-pow((az + 2.6) / 0.9, 2.0)) * exp(-max(e, 0.0) * 22.0);
      c = mix(c, vec3(0.0004, 0.0006, 0.001), smoothstep(0.0, -0.05, e));
      gl_FragColor = vec4(mix(vec3(0.00036, 0.00063, 0.0014), c, uCity), 1.0); }`,
  }));
  sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);
  const center = new THREE.Vector3(-5, 10, 50.8);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(4000, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.0006, 0.0008, 0.0014) }));
  ground.position.set(center.x, center.y, 50.4); scene.add(ground);
  const tiles = new THREE.Group(); tiles.matrixAutoUpdate = false; tiles.matrix.copy(enuMatrix(route.ecef_to_enu_matrix)); scene.add(tiles);
  const bu = shared;
  const graded = new Map();
  const grade = (src) => {
    const m = new THREE.MeshBasicMaterial({ map: src.map || null });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, bu, { uCity, uFoot, uC: { value: center } });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nout vec3 vWP;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nin vec3 vWP; uniform float uCity, uFoot; uniform vec3 uC;\n${AF}\n${jetGLSL}`)
        .replace('#include <opaque_fragment>', `
          vec3 tex = outgoingLight;
          tex = pow(tex, vec3(2.2));                                  // texture is display-referred
          float lum = dot(tex, vec3(0.2126, 0.7152, 0.0722));
          vec3 dusk = mix(vec3(lum), tex, 0.35) * vec3(0.30, 0.40, 0.62) * 0.55;
          float rr = length(vWP.xy - uC.xy); if (rr > 190.0) discard;
          float fog = smoothstep(60.0, 185.0, rr);
          dusk = mix(dusk, vec3(0.003, 0.005, 0.012), fog);
          // the beam's footprint on the city
          float g = arrayGain(vWP); float r = length(vWP - uPP);
          float I = g * 0.55 * pow(86.0 / r, 4.0) * smoothstep(62.0, 80.0, r);
          float v = clamp(1.0 + 10.0 * log(max(I, 1e-9)) / log(10.0) / 16.0, 0.0, 1.0);
          vec3 foot = pow(jet(v), vec3(2.2)) * smoothstep(0.15, 0.6, v) * (0.2 + 0.8 * v) * 0.8;
          vec3 col = (dusk + foot * uFoot) * uCity;
          gl_FragColor = vec4(col, 1.0);`);
    };
    return m;
  };
  const man = await fetch('assets/tiles/korenmarkt/manifest.json').then((r) => r.json());
  const loader = new GLTFLoader();
  await Promise.all(man.tiles.map((t) => loader.loadAsync(`assets/tiles/korenmarkt/${t.file}`).then((g) => {
    g.scene.traverse((o) => { if (!o.isMesh) return; let gm = graded.get(o.material); if (!gm) { gm = grade(o.material); graded.set(o.material, gm); } o.material = gm; });
    tiles.add(g.scene);
  }).catch(() => {})));
  tiles.updateMatrixWorld(true);
  // The panel: radome, back box, brackets and pole (night tones, slightly specular).
  const panel = new THREE.Group();
  const P = new THREE.Vector3(...PANEL.P), n = new THREE.Vector3(...PANEL.n), r = new THREE.Vector3(...PANEL.r), up = new THREE.Vector3(0, 0, 1);
  const basis = new THREE.Matrix4().makeBasis(r, up, n);
  const uPanel = { value: 0 };
  const pm = (c) => { const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(...c), roughness: 0.55, metalness: 0.2 });
    m.onBeforeCompile = (sh) => { sh.uniforms.uPanel = uPanel; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uPanel;').replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb *= uPanel;'); };
    return m; };
  const W = NE * DX + 0.06, H = NE * DX + 0.16;
  const radome = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.07), pm([0.035, 0.045, 0.065])); radome.position.set(0, -0.02, -0.04);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 4.6, 16), pm([0.03, 0.035, 0.045])); pole.position.set(0, -2.2, -0.18);
  const brk1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.16), pm([0.03, 0.035, 0.045])); brk1.position.set(0, 0.12, -0.11);
  const brk2 = brk1.clone(); brk2.position.set(0, -0.18, -0.11);
  panel.add(radome, pole, brk1, brk2);
  panel.matrixAutoUpdate = false; panel.matrix.copy(basis).setPosition(P); panel.updateMatrixWorld(true);
  scene.add(panel);
  const hemi = new THREE.HemisphereLight(0x6688cc, 0x101018, 0.6); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffc8a0, 0.6); key.position.set(-200, -80, 120); scene.add(key);
  // Beam volume: a box from the panel towards the square.
  const bmin = new THREE.Vector3(-160, -110, 50.6), bmax = new THREE.Vector3(80, 120, 80);
  const beamU = { ...bu, uEye: { value: new THREE.Vector3() }, uGain: { value: 1 }, uLen: { value: 120 }, uJetMix: { value: 0 }, uWt: { value: 0 }, uAxis: { value: new THREE.Vector3(...PANEL.n) }, uBmin: { value: bmin }, uBmax: { value: bmax } };
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: BEAM_VS, fragmentShader: BEAM_FS, uniforms: beamU,
    side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false, ...ADD }));
  beam.scale.copy(bmax.clone().sub(bmin)); beam.position.copy(bmax.clone().add(bmin).multiplyScalar(0.5)); beam.frustumCulled = false; beam.renderOrder = 20;
  scene.add(beam);
  return { scene, uCity, uFoot, uPanel, beam, beamU, panel, tiles, ground };
}
