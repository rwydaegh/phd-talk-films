// S5b phone: a procedural modern smartphone (71 x 147 x 8 mm) and its antenna pattern.
// Phone frame: x across the width, y along the length (top = +y), z out of the screen. Origin at the centre.
// Pure geometry plus per-frame uniforms set from t: no state carries between frames.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const PHONE = { w: 0.0715, h: 0.147, d: 0.0080, r: 0.0095, bezel: 0.0014 };

function rrect(w, h, r, cx = 0, cy = 0) {
  const s = new THREE.Shape(), x0 = cx - w / 2, y0 = cy - h / 2, x1 = cx + w / 2, y1 = cy + h / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

// Screen: dark glass over a dim wallpaper glow (two soft colour fields), a punch-hole camera, a home bar,
// and a view-dependent sheen. No text, no icons. uOn wakes the screen a little when the link arrives.
const SCR_VS = `
varying vec2 vXY; varying vec3 vWN; varying vec3 vWP;
void main(){
  vXY = position.xy;
  vWN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SCR_FS = `
uniform vec2 uSize; uniform float uOn, uR; uniform vec3 uKey;
varying vec2 vXY; varying vec3 vWN; varying vec3 vWP;
float sdRR(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main(){
  vec2 uv = vXY / uSize + 0.5;
  vec3 c = vec3(0.006, 0.009, 0.016);
  // wallpaper: a deep blue field low on the screen and a teal one high, very soft
  vec2 a = (uv - vec2(0.28, 0.22)) * vec2(1.0, 0.75); vec2 b = (uv - vec2(0.78, 0.74)) * vec2(1.0, 0.8);
  c += vec3(0.020, 0.150, 0.260) * exp(-dot(a, a) / 0.10);
  c += vec3(0.060, 0.230, 0.270) * exp(-dot(b, b) / 0.07);
  c += vec3(0.020, 0.040, 0.090) * (1.0 - uv.y);
  c *= 0.55 + 0.75 * uOn;
  // home bar and punch-hole camera
  vec2 hp = vXY - vec2(0.0, -uSize.y * 0.5 + 0.0042);
  float hb = 1.0 - smoothstep(-0.00012, 0.00012, sdRR(hp, vec2(0.0115, 0.00045), 0.00045));
  c = mix(c, vec3(0.55, 0.62, 0.70), hb * (0.35 + 0.35 * uOn));
  float ph = length(vXY - vec2(0.0, uSize.y * 0.5 - 0.0060));
  c = mix(c, vec3(0.0), 1.0 - smoothstep(0.00135, 0.00165, ph));
  // glass: Fresnel sheen of the night sky plus a soft highlight of the key light
  vec3 n = normalize(vWN), v = normalize(cameraPosition - vWP);
  float f = pow(1.0 - abs(dot(n, v)), 5.0);
  c += vec3(0.30, 0.38, 0.52) * (0.03 + 0.55 * f);
  vec3 h = normalize(v + uKey);
  c += vec3(0.85, 0.88, 0.95) * 0.35 * pow(max(dot(n, h), 0.0), 180.0);
  // rounded screen edge
  float e = sdRR(vXY, uSize * 0.5, uR);
  gl_FragColor = vec4(c, 1.0 - smoothstep(-0.00015, 0.00005, e));
  #include <colorspace_fragment>
}`;

let ENV = null;
function envMap(renderer) {
  if (ENV) return ENV;
  const pm = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  ENV = pm.fromScene(room, 0.03).texture;
  room.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  pm.dispose();
  return ENV;
}

/** Build the phone. Returns { group, screen (uniforms), dispose }. Units: metres. */
export function makePhone(ctx, { scale = 1 } = {}) {
  const { w, h, d, r, bezel } = PHONE;
  const env = envMap(ctx.renderer);
  const geos = [], mats = [];
  const G = (g) => { geos.push(g); return g; }, M = (m) => { mats.push(m); return m; };
  const group = new THREE.Group();
  const body = new THREE.Group(); body.scale.setScalar(scale); group.add(body);

  // Frame: brushed titanium, slightly cool. The extrusion's caps sit under the glass and stay dark.
  const bev = 0.0011;
  const frameG = G(new THREE.ExtrudeGeometry(rrect(w - 2 * bev, h - 2 * bev, r - bev), {
    depth: d - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 4, curveSegments: 10,
  }));
  frameG.translate(0, 0, -(d - 2 * bev) / 2);
  const frameM = M(new THREE.MeshStandardMaterial({ color: 0xaeb8c4, metalness: 1.0, roughness: 0.32, envMap: env, envMapIntensity: 1.1 }));
  const capM = M(new THREE.MeshStandardMaterial({ color: 0x0c0f14, metalness: 0.2, roughness: 0.4, envMap: env, envMapIntensity: 0.4 }));
  body.add(new THREE.Mesh(frameG, [capM, frameM]));

  // Front glass with the screen.
  const sw = w - 2 * bezel - 0.0012, sh = h - 2 * bezel - 0.0012;
  const scrG = G(new THREE.PlaneGeometry(sw, sh));
  const screen = {
    uSize: { value: new THREE.Vector2(sw, sh) }, uR: { value: r - bezel - 0.0006 }, uOn: { value: 0 },
    uKey: { value: new THREE.Vector3(-0.4, -0.6, 0.7).normalize() },
  };
  const scrM = M(new THREE.ShaderMaterial({ vertexShader: SCR_VS, fragmentShader: SCR_FS, uniforms: screen, transparent: true }));
  const scr = new THREE.Mesh(scrG, scrM); scr.position.z = d / 2 + 0.0004; body.add(scr);
  const bezG = G(new THREE.ShapeGeometry(rrect(w - 0.0012, h - 0.0012, r - 0.0006), 10));
  const bezM = M(new THREE.MeshStandardMaterial({ color: 0x020304, metalness: 0.0, roughness: 0.08, envMap: env, envMapIntensity: 0.9 }));
  const bz = new THREE.Mesh(bezG, bezM); bz.position.z = d / 2 + 0.0002; body.add(bz);

  // Back glass: frosted graphite, with a camera plateau (three lenses and a flash) top left seen from the back.
  const backM = M(new THREE.MeshStandardMaterial({ color: 0x1d242d, metalness: 0.15, roughness: 0.38, envMap: env, envMapIntensity: 0.9 }));
  const bk = new THREE.Mesh(bezG, backM); bk.position.z = -d / 2 - 0.0002; bk.rotation.y = Math.PI; body.add(bk);
  const cw = 0.0335, cr = 0.0085, ct = 0.0016;
  // Seen from the back, the viewer's left is +x of the phone frame: the plateau sits at +x, +y.
  const cx = w / 2 - 0.0045 - cw / 2, cy = h / 2 - 0.0045 - cw / 2;
  const plG = G(new THREE.ExtrudeGeometry(rrect(cw, cw, cr), { depth: ct * 0.5, bevelEnabled: true, bevelThickness: ct * 0.25, bevelSize: 0.0006, bevelSegments: 3, curveSegments: 10 }));
  const plM = M(new THREE.MeshStandardMaterial({ color: 0x2a323c, metalness: 0.5, roughness: 0.22, envMap: env, envMapIntensity: 1.0 }));
  const pl = new THREE.Mesh(plG, plM); pl.rotation.y = Math.PI; pl.position.set(cx, cy, -d / 2 - ct * 0.25); body.add(pl);
  const ringG = G(new THREE.CylinderGeometry(0.0062, 0.0062, 0.0014, 32)); ringG.rotateX(Math.PI / 2);
  const lensG = G(new THREE.CircleGeometry(0.0046, 32));
  const ringM = M(new THREE.MeshStandardMaterial({ color: 0xb8c2cc, metalness: 1.0, roughness: 0.18, envMap: env, envMapIntensity: 1.2 }));
  const lensM = M(new THREE.MeshStandardMaterial({ color: 0x03050a, metalness: 0.3, roughness: 0.05, envMap: env, envMapIntensity: 1.4 }));
  const zl = -d / 2 - ct - 0.0005;
  for (const [ox, oy] of [[0.0082, 0.0082], [0.0082, -0.0082], [-0.0082, 0.0]]) {
    const ring = new THREE.Mesh(ringG, ringM); ring.position.set(cx + ox, cy + oy, zl); body.add(ring);
    const lens = new THREE.Mesh(lensG, lensM); lens.position.set(cx + ox, cy + oy, zl - 0.00072); lens.rotation.y = Math.PI; body.add(lens);
  }
  const flG = G(new THREE.CircleGeometry(0.0019, 20));
  const flM = M(new THREE.MeshBasicMaterial({ color: 0xd8d2c0 }));
  const fl = new THREE.Mesh(flG, flM); fl.position.set(cx - 0.0082, cy + 0.0100, -d / 2 - ct - 0.00003); fl.rotation.y = Math.PI; body.add(fl);

  // Side buttons: power on +x, volume pair on -x.
  const btnG = G(new THREE.BoxGeometry(0.0012, 1, 0.0030));
  for (const [x, y, L] of [[w / 2, 0.022, 0.019], [-w / 2, 0.036, 0.011], [-w / 2, 0.021, 0.011]]) {
    const b = new THREE.Mesh(btnG, frameM); b.scale.y = L; b.position.set(x + Math.sign(x) * 0.0002, y, 0); body.add(b);
  }
  return {
    group, body, screen,
    dispose() { geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); },
  };
}

// ---- antenna pattern ---------------------------------------------------------
// A radiation-pattern balloon r(direction) = L * g, drawn as an additive rim-lit shell with faint meridians
// and parallels, plus inner copies that travel outward (wavefronts). g is the field pattern of a small
// steered array: a main lobe toward uDir, two weak side-lobe rings and a small back lobe. During ECBF a
// second lobe toward the reflection point grows (uDir2, uW2).
const PAT_VS = `
attribute vec2 tp;
uniform vec3 uO, uDir, uE1, uE2, uDir2; uniform float uL, uK, uW1, uW2, uN, uU, uPow;
varying float vR;
varying vec3 vWP; varying vec3 vN; varying vec2 vTP; varying float vG;
// Power pattern of a 6-element steered array (|AF|^2): main lobe ~30 deg wide, side lobes below 0.06, no
// grating lobe (u stays below pi), times a cosine element pattern that kills the back hemisphere.
float lobe(vec3 d, vec3 ax){
  float c = clamp(dot(d, ax), -1.0, 1.0);
  float u = uU * (1.0 - c);
  float af = abs(u) < 1e-4 ? 1.0 : sin(uN * u) / (uN * sin(u));
  return 0.004 + pow(abs(af), uPow) * (0.25 + 0.75 * max(c, 0.0));
}
float gain(vec3 d){ return max(uW1 * lobe(d, uDir), uW2 * lobe(d, uDir2)); }
vec3 dirOf(float th, float ph){ return cos(th) * uDir + sin(th) * (cos(ph) * uE1 + sin(ph) * uE2); }
vec3 posOf(float th, float ph){ vec3 d = dirOf(th, ph); return uO + d * (uL * uK * gain(d)); }
void main(){
  float th = tp.x, ph = tp.y;
  vec3 p = posOf(th, ph);
  float e = 0.004;
  vec3 pt = posOf(th + e, ph) - posOf(max(th - e, 0.0), ph);
  vec3 pp = posOf(th, ph + e) - posOf(th, ph - e);
  vec3 n = cross(pt, pp);
  vN = length(n) > 1e-12 ? normalize(n) : dirOf(th, ph);
  vWP = p; vTP = tp; vG = gain(dirOf(th, ph)); vR = length(p - uO);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const PAT_FS = `
uniform vec3 uCol; uniform float uI, uLines, uPar, uK, uRing, uLam, uPh, uRimP, uRimI, uBase, uCut;
varying vec3 vWP; varying vec3 vN; varying vec2 vTP; varying float vG; varying float vR;
void main(){
  vec3 v = normalize(cameraPosition - vWP);
  float f = 1.0 - abs(dot(normalize(vN), v));
  float rim = pow(f, uRimP) * uRimI;
  // meridians every 45 deg and parallels every 10 deg of polar angle, anti-aliased
  float m = vTP.y / 0.7853982, pz = vTP.x / 0.1745329;
  float lm = 1.0 - smoothstep(0.0, 1.4 * fwidth(m), abs(fract(m + 0.5) - 0.5));
  float lp = 1.0 - smoothstep(0.0, 1.4 * fwidth(pz), abs(fract(pz + 0.5) - 0.5));
  float lines = max(lm, lp * uPar) * uLines;
  // wavefronts: spheres |p - o| = const that travel outward; on the shell they are rings sliding to the tip
  float w = vR / uLam - uPh;
  float ring = 1.0 - smoothstep(0.0, 1.6 * fwidth(w) + 0.06, abs(fract(w + 0.5) - 0.5));
  float a = uI * (uBase + 0.9 * rim + lines + uRing * ring) * smoothstep(uCut, uCut + 0.08, vG);
  gl_FragColor = vec4(uCol * a, 1.0);
}`;

function patGeometry(nT = 96, nP = 72) {
  const tp = [], idx = [];
  for (let i = 0; i <= nT; i++) for (let j = 0; j <= nP; j++) tp.push((i / nT) * Math.PI, (j / nP) * Math.PI * 2);
  for (let i = 0; i < nT; i++) for (let j = 0; j < nP; j++) {
    const a = i * (nP + 1) + j, b = a + nP + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('tp', new THREE.Float32BufferAttribute(tp, 2));
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(tp.length / 2 * 3).fill(0), 3));
  g.setIndex(idx);
  return g;
}

export class AntennaPattern {
  /** nWave inner shells travel outward over `period` seconds. */
  constructor({ nWave = 0, period = 2.4, color = '#bfefff' } = {}) {
    this.group = new THREE.Group();
    this.geo = patGeometry();
    this.period = period;
    this.shells = [];
    for (let i = 0; i <= nWave; i++) {
      const m = new THREE.ShaderMaterial({
        vertexShader: PAT_VS, fragmentShader: PAT_FS,
        uniforms: {
          uO: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3(1, 0, 0) },
          uE1: { value: new THREE.Vector3(0, 1, 0) }, uE2: { value: new THREE.Vector3(0, 0, 1) },
          uDir2: { value: new THREE.Vector3(1, 0, 0) }, uW1: { value: 1 }, uW2: { value: 0 },
          uL: { value: 0.3 }, uK: { value: 1 }, uI: { value: 0 }, uLines: { value: 0 }, uPar: { value: 1 },
          uN: { value: 8 }, uU: { value: 1.1 }, uPow: { value: 2 }, uRimP: { value: 2.2 }, uRimI: { value: 1 }, uBase: { value: 0.1 }, uCut: { value: 0.02 }, uRing: { value: 0 }, uLam: { value: 0.1 }, uPh: { value: 0 }, uCol: { value: new THREE.Color(color) },
        },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      });
      m.extensions = { derivatives: true };
      const mesh = new THREE.Mesh(this.geo, m); mesh.frustumCulled = false; mesh.renderOrder = 8;
      this.group.add(mesh);
      this.shells.push(m);
    }
  }

  /** o: origin; dir: main lobe direction; L: main lobe length [m]; I: intensity; t: seconds;
   *  dir2, w2: optional second lobe (relative gain 0..1). */
  set(o, dir, L, I, t, { dir2 = null, w1 = 1, w2 = 0, lines = 0.5, par = 1, wave = 0.3, fill = 0.55, ring = 0.8, nEl = 8, uu = 1.1, waves = 3, pw = 2, rimP = 2.2, rimI = 1, base = 0.1, cut = 0.02 } = {}) {
    const d = dir.clone().normalize();
    const e1 = new THREE.Vector3(0, 0, 1).cross(d); if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0); e1.normalize();
    const e2 = d.clone().cross(e1).normalize();
    const n = this.shells.length - 1;
    this.shells.forEach((m, i) => {
      const u = m.uniforms;
      u.uO.value.copy(o); u.uDir.value.copy(d); u.uE1.value.copy(e1); u.uE2.value.copy(e2);
      u.uDir2.value.copy(dir2 || d); u.uW1.value = w1; u.uW2.value = w2; u.uL.value = L;
      u.uPar.value = par; u.uN.value = nEl; u.uU.value = uu; u.uPow.value = pw; u.uRimP.value = rimP; u.uRimI.value = rimI; u.uBase.value = base; u.uCut.value = cut;
      u.uRing.value = ring; u.uLam.value = L / waves; u.uPh.value = t / this.period * waves;
      if (i === 0) { u.uK.value = 1; u.uI.value = I * fill; u.uLines.value = lines; return; }
      const k = (((t / this.period + (i - 1) / n) % 1) + 1) % 1;               // 0 -> 1 outward
      u.uK.value = 0.15 + 0.85 * k;
      u.uI.value = I * wave * Math.sin(Math.PI * k) ** 2;
      u.uLines.value = 0;
    });
    this.group.visible = I > 0.002;
  }

  dispose() { this.geo.dispose(); this.shells.forEach((m) => m.dispose()); }
}
