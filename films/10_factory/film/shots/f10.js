// Film 10: the factory of chapter 3. One array becomes many, rays reach a worker, a Huygens box closes around
// the head and fills with voxels. Hold.
// Data: data/scene10.json (hall, machines, 25 elements), data/paths10.json (traced paths, MRT weights, box),
// data/vox10*.bin (the head and neck voxelised in the box at 16, 8 and 4 mm).
import * as THREE from 'three';
import { buildHall, hallFog, fatLines } from '../lib/factory.js';
import { loadWorker, poseWorker, bodyMaterial } from '../lib/worker.js';
import { POSE10 } from '../lib/poses.js';
import { RayLayer, makePath, drawPath } from '../lib/beam.js';
import { PathField, FIELD_GLSL } from '../lib/field.js';
import { ease, lerp, mix3, clamp, smoother, slerpDir, sub3, add3, len3, norm3 } from '../lib/cam.js';

let hotSpot = null, slice = null, scene, cam, hall, wk, rays, sc, pa, field, els = [], box, vox = [], paths = [], refl = null, armMesh = null, phoneMats = [];
const T = {
  spread: [2.5, 15], wideHold: [15, 22], rays: [19, 40], box: [41, 50], hand: [49.5, 52.5], vox: [52, 64], cut: [63.5, 67.5], slice: [66, 80], abs: [78.5, 83], end: 90,
};
// tissue conductivities at 28 GHz by display class, as in tools/fdtd2d.py (S/m)
const SIG = [0, 25.8, 1.9, 33.6, 4.6, 33.6, 21.6, 50.9, 48.0, 42.3, 21.3];
const J = (u) => fetch(u).then((r) => r.json());
const B = (u) => fetch(u).then((r) => r.arrayBuffer());

// ---------------------------------------------------------------- the array: 25 elements on mounts
function buildArray(ctx) {
  const g = new THREE.Group();
  const lam = sc.lam;
  const house = new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.5, metalness: 0.05, envMap: hall.env, envMapIntensity: 0.5 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xd08a4a, roughness: 0.3, metalness: 1.0, envMap: hall.env, envMapIntensity: 1.2, emissive: 0x3a1c08 });
  const sub = new THREE.MeshStandardMaterial({ color: 0x1b2a26, roughness: 0.6 });
  const rodM = new THREE.MeshStandardMaterial({ color: 0x5a6270, roughness: 0.4, metalness: 0.8, envMap: hall.env });
  for (let i = 0; i < 25; i++) {
    const e = new THREE.Group();
    const h = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), house);       // radome, scaled per frame
    const s = new THREE.Mesh(new THREE.BoxGeometry(lam / 2 * 0.96, lam / 2 * 0.96, 0.0008), sub);
    const p = new THREE.Mesh(new THREE.BoxGeometry(lam * 0.29, lam * 0.29, 0.0003), copper);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), rodM); rod.rotation.x = Math.PI / 2;
    e.add(h, s, p, rod); g.add(e);
    els.push({ e, h, s, p, rod, col: sc.col[i], dis: sc.dis[i] });
  }
  return g;
}

function placeArray(t) {
  const u = ease(t, ...T.spread);
  const d0 = sc.lam / 2, d = d0 * Math.pow(10 / d0, u);            // spacing grows from lambda/2 to 10 m
  for (let i = 0; i < 25; i++) {
    const E = els[i], ix = i % 5 - 2, iy = Math.floor(i / 5) - 2;
    const z = 9.0;
    E.e.position.set(25 + ix * d, 25 + iy * d, z);
    const hs = lerp(d0, 0.09, ease(u, 0.08, 0.6));                  // radome grows from the element pitch to 9 cm
    E.h.scale.set(hs, hs, lerp(0.004, 0.035, ease(u, 0.08, 0.6))); E.h.position.z = E.h.scale.z / 2 + 0.0006;
    E.s.position.z = -0.0003; E.p.position.z = -0.0009;
    const rl = (10 - z) - E.h.scale.z;                              // mount rod up to the ceiling
    const rr = lerp(0.0, 0.012, ease(u, 0.62, 0.85));
    E.rod.visible = rr > 1e-4;
    E.rod.scale.set(rr, Math.max(rl, 1e-3), rr); E.rod.position.z = E.h.scale.z + rl / 2;
    E.pos = [E.e.position.x, E.e.position.y, z - 0.001];
  }
  // single central rod for the collocated panel, fading into the 25 rods
  return d;
}

// ---------------------------------------------------------------- Huygens box faces: the incident field
const BOX_VS = `varying vec3 vWP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const BOX_FS = `varying vec3 vWP; uniform float uA, uGain;
${FIELD_GLSL}
// the field: one cool diverging map (troughs deep blue, crests pale cyan), so the absorbed power is the only hot colour
vec3 fieldc(float e){ e = clamp(e, -1.0, 1.0); vec3 c = e < 0.0 ? mix(vec3(0.03, 0.06, 0.16), vec3(0.10, 0.28, 0.95), -e) : mix(vec3(0.03, 0.06, 0.16), vec3(0.62, 0.90, 1.0), e); return pow(c, vec3(2.2)); }
// supersampled 3 x 3 inside each pixel: fringes near the pixel size blend to their mean instead of shimmering
vec4 shadeAt(vec3 p){
  vec3 E = pfE(p);
  float ph = -uPWt, e = (E.x * cos(ph) - E.y * sin(ph)) * uGain;
  vec3 c = fieldc(e);
  float a = 0.06 + 0.94 * smoothstep(0.05, 0.6, abs(e));
  return vec4(c * a, a);
}
void main(){
  vec3 dx = dFdx(vWP), dy = dFdy(vWP);
  vec4 acc = vec4(0.0);
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) acc += shadeAt(vWP + (float(i) * dx + float(j) * dy) / 3.0);
  acc /= 9.0;
  float al = smoothstep(0.8, 1.6, 2.0 * uPK * length(fwidth(vWP)));     // fringes under 8 px fade, gone by 4 px
  float k = uA * (1.0 - al);
  gl_FragColor = vec4(acc.rgb * k * 1.2, acc.a * k);
}`;

function buildBox(ctx) {
  const [c, h] = pa.hbox;
  const g = new THREE.Group();
  const u = Object.assign({ uA: { value: 0 }, uGain: { value: 1 } }, field.u);
  const mat = new THREE.ShaderMaterial({ vertexShader: BOX_VS, fragmentShader: BOX_FS, uniforms: u, transparent: true, depthWrite: false, side: THREE.BackSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
  const faces = new THREE.Mesh(new THREE.BoxGeometry(2 * h[0], 2 * h[1], 2 * h[2]), mat);
  faces.position.set(...c); faces.renderOrder = 6; g.add(faces);
  // 12 edges as fat lines, drawn on from the corners
  const lo = c.map((v, i) => v - h[i]), hi = c.map((v, i) => v + h[i]);
  const C = (a, b, d) => [[lo[0], hi[0]][a], [lo[1], hi[1]][b], [lo[2], hi[2]][d]];
  const edges = [];
  for (const a of [0, 1]) for (const b of [0, 1]) { edges.push([C(a, b, 0), C(a, b, 1)]); edges.push([C(a, 0, b), C(a, 1, b)]); edges.push([C(0, a, b), C(1, a, b)]); }
  const lines = fatLines(ctx, new Float32Array(edges.length * 6), { width: 2.2, color: 0xe8eef8, opacity: 1 });
  lines.renderOrder = 7; g.add(lines);
  return { g, faces, mat, lines, edges, lo, hi, c, h };
}
function setBox(t) {
  const u = ease(t, T.box[0], T.box[0] + 4.5);
  const pos = new Float32Array(box.edges.length * 6);
  box.edges.forEach(([a, b], i) => {
    const m = mix3(a, b, 0.5), A = mix3(m, a, u), Bp = mix3(m, b, u);   // edges grow from their middles
    pos.set([...A, ...Bp], i * 6);
  });
  box.lines.geometry.setPositions(pos);
  box.lines.material.opacity = Math.min(1, u * 3) * (1 - 0.35 * ease(t, T.vox[0] + 4, T.vox[0] + 10));
  box.g.visible = u > 0.001;
  box.mat.uniforms.uA.value = 0.85 * ease(t, T.box[0] + 3, T.box[0] + 7) * (1 - 0.8 * ease(t, T.vox[0], T.vox[0] + 6)) * (1 - 0.5 * ease(t, T.slice[0], T.slice[0] + 5));
}

// ---------------------------------------------------------------- voxels
const VOX_VS = `uniform float uFront, uNext, uPitch, uBand, uCutZ, uCut; varying vec3 vN; varying vec3 vWP; varying float vK; varying vec3 vL;
void main(){
  vec3 o = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float grow = smoothstep(uFront, uFront - uBand, o.z);             // cells appear just behind the rising front
  float gone = smoothstep(uNext - uBand, uNext, o.z);               // and give way to the finer level after it
  float s = grow * (1.0 - gone);
  float above = step(uCutZ, o.z);
  float c = clamp(uCut * 2.4 - (o.z - uCutZ) * 4.5, 0.0, 1.0) * above;   // the cells nearest the cut go first
  s *= 1.0 - c; o.z += 0.05 * c * above;
  vK = s;
  vec3 p = o + position * uPitch * 0.94 * s;
  vN = normal; vL = position; vec4 w = modelMatrix * vec4(p, 1.0); vWP = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const VOX_FS = `uniform vec3 uCol; uniform vec3 uLight; varying vec3 vN; varying vec3 vWP; varying float vK; varying vec3 vL;
void main(){
  if (vK < 0.02) discard;
  vec3 n = normalize(vN);
  float l = 0.18 + 0.62 * max(dot(n, normalize(uLight)), 0.0) + 0.12 * n.z;
  vec3 q = abs(vL) * 2.0; float m1 = max(q.x, max(q.y, q.z)); float m2 = q.x + q.y + q.z - m1 - min(q.x, min(q.y, q.z));
  float edge = smoothstep(0.80, 0.97, m2);                         // dark seams between cells
  vec3 c = uCol * l * (1.0 - 0.55 * edge);
  gl_FragColor = vec4(c, 1.0);
}`;
async function buildVox(ctx) {
  const meta = await J('data/vox10.json');
  const g = new THREE.Group();
  const cube = new THREE.BoxGeometry(1, 1, 1);
  for (let k = 0; k < meta.levels.length; k++) {
    const L = meta.levels[k];
    const ijk = new Uint16Array(await B(`data/vox10_L${k}.bin`));
    const n = ijk.length / 3;
    const mat = new THREE.ShaderMaterial({ vertexShader: VOX_VS, fragmentShader: VOX_FS, uniforms: {
      uFront: { value: -1 }, uNext: { value: 1e3 }, uCutZ: { value: pa.rx[2] }, uCut: { value: 0 }, uPitch: { value: L.pitch }, uBand: { value: 0.03 },
      uCol: { value: new THREE.Color(0.80, 0.52, 0.40) }, uLight: { value: new THREE.Vector3(-0.4, -0.6, 0.8) } } });
    const im = new THREE.InstancedMesh(cube, mat, n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      m.makeTranslation(meta.origin[0] + (ijk[i * 3] + 0.5) * L.pitch, meta.origin[1] + (ijk[i * 3 + 1] + 0.5) * L.pitch, meta.origin[2] + (ijk[i * 3 + 2] + 0.5) * L.pitch);
      im.setMatrixAt(i, m);
    }
    im.frustumCulled = false; g.add(im);
    vox.push({ im, mat, L, ijk });
  }
  vox.meta = meta;
  return g;
}
// the label's anchor: a surface voxel at neck height on the side facing the camera
let anch = null;
function fdtdAnchor() {
  if (!anch) {
    const L = vox[vox.length - 1], o = vox.meta.origin, p = L.L.pitch; anch = [];
    for (let i = 0; i < L.ijk.length; i += 3) { const z = o[2] + (L.ijk[i + 2] + 0.5) * p; if (Math.abs(z - 1.58) < 0.003) anch.push([o[0] + (L.ijk[i] + 0.5) * p, o[1] + (L.ijk[i + 1] + 0.5) * p, z]); }
  }
  let best = null, bd = 1e9;
  for (const q of anch) { const d = Math.hypot(q[0] - cam.position.x, q[1] - cam.position.y); if (d < bd) { bd = d; best = q; } }
  return best;
}
function setVox(t) {
  const z0 = vox.meta.origin[2] - 0.04, z1 = vox.meta.origin[2] + vox.meta.size[2] + 0.06;
  const a = T.vox[0], fr = lerp(z0, z1, ease(t, a, a + 9, (x) => x * x * (3 - 2 * x)));
  for (let k = 0; k < vox.length; k++) {
    const V = vox[k], on = k === vox.length - 1;
    V.mat.uniforms.uFront.value = fr; V.mat.uniforms.uNext.value = 1e3;
    V.mat.uniforms.uCut.value = ease(t, T.cut[0], T.cut[1], (x) => x);
    V.im.visible = on && fr > z0 + 1e-3;
  }
  wk.u.uHide.value = 1; wk.u.uHideZ.value = fr - 0.5 * vox[vox.length - 1].L.pitch;
  wk.u.uMaskC.value.set(...pa.hbox[0]); wk.u.uMaskH.value.set(...pa.hbox[1]);
}

// ---------------------------------------------------------------- the FDTD slice at the phone's height
const SL_VS = `varying vec2 vUv; varying vec3 vWP; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const SL_FS = `precision highp float; varying vec2 vUv; varying vec3 vWP;
uniform sampler2D uE, uC; uniform vec3 uPal[11]; uniform float uSig[11]; uniform float uA, uTis, uFld, uFront, uPh, uGain, uK, uPmax, uAbsA;
// the field: one cool diverging map (troughs deep blue, crests pale cyan), so the absorbed power is the only hot colour
vec3 fieldc(float e){ e = clamp(e, -1.0, 1.0); vec3 c = e < 0.0 ? mix(vec3(0.03, 0.06, 0.16), vec3(0.10, 0.28, 0.95), -e) : mix(vec3(0.03, 0.06, 0.16), vec3(0.62, 0.90, 1.0), e); return pow(c, vec3(2.2)); }
vec3 hotc(float x){ x = clamp(x, 0., 1.); return clamp(vec3(3.0 * x, 3.0 * x - 1.0, 3.0 * x - 2.0), 0., 1.); }
void main(){
  vec2 e2 = texture2D(uE, vUv).rg;
  int c = int(texture2D(uC, vUv).r * 255.0 + 0.5);
  float d = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));          // from the box faces inwards
  float on = smoothstep(uFront - 0.06, uFront, d) ;
  on = 1.0 - on;
  float al = smoothstep(1.2, 2.4, 2.0 * uK * length(fwidth(vWP)));         // far below a pixel: fade out (the mipmaps low-pass the rest)
  float e = (e2.x * cos(uPh) + e2.y * sin(uPh)) * uGain;
  vec3 tis = c > 0 ? pow(uPal[c], vec3(2.2)) * 0.55 : vec3(0.0);
  // with the absorbed power on, the tissues go to a dark grey so the power is the only colour in the head
  tis = mix(tis, vec3(dot(tis, vec3(0.3, 0.59, 0.11))) * 0.45, uAbsA);
  // absorbed power density 0.5 sigma |E|^2 in dB, black-red-yellow-white over the 25 dB below the skin's top values
  float pw = c > 0 ? 0.5 * uSig[c] * dot(e2, e2) : 0.0;
  float xa = 1.0 + 10.0 * log(max(pw, 1e-30) / uPmax) / log(10.0) / 25.0;
  float ka = uAbsA * smoothstep(0.0, 0.35, xa) * (c > 0 ? 1.0 : 0.0);
  tis = mix(tis, pow(hotc(xa), vec3(2.2)) * 1.6, ka);
  float ta = c > 0 ? uTis : 0.0;
  vec3 fc = fieldc(e);
  float fa = uFld * on * (0.15 + 0.85 * smoothstep(0.03, 0.5, abs(e))) * (1.0 - al) * (c > 0 ? 1.0 - uAbsA : 1.0 - 0.6 * uAbsA);
  vec3 col = mix(tis, fc * (c > 0 ? 1.0 : 1.0 - 0.55 * uAbsA), fa);
  // where the waves have arrived the slice is a dark plate under them, so the cubes below never show through
  float a = max(max(ta, fa * 0.92), c > 0 ? 0.0 : uFld * on) * uA;
  gl_FragColor = vec4(col * a, a);
}`;
async function buildSlice(ctx) {
  let meta; try { meta = await J('data/slice10.json'); } catch (e) { return null; }
  const buf = await B('data/slice10.bin');
  const N = meta.nx * meta.ny;
  const h = new Uint16Array(buf, 0, N * 2), cl = new Uint8Array(buf, N * 4, N);
  // file is [x][y]; textures are row-major in v (y), u (x)
  const ed = new Uint16Array(N * 2), cd = new Uint8Array(N);
  for (let x = 0; x < meta.nx; x++) for (let y = 0; y < meta.ny; y++) { const i = x * meta.ny + y, j = y * meta.nx + x; ed[j * 2] = h[i * 2]; ed[j * 2 + 1] = h[i * 2 + 1]; cd[j] = cl[i]; }
  // Deeper than about 3 mm into tissue the run leaves a numerical residual about 38 dB below the skin's top values.
  // Beyond 2.5 mm the field follows the measured decay (power -10 dB per mm in the outer 3 mm: e-fold 0.9 mm in the field).
  { const W = meta.nx, H = meta.ny, D = new Float32Array(N), BIG = 1e9;
    for (let j = 0; j < N; j++) D[j] = cd[j] ? BIG : 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const j = y * W + x; if (!D[j]) continue;
      let d = D[j]; if (x > 0) d = Math.min(d, D[j - 1] + 1); if (y > 0) d = Math.min(d, D[j - W] + 1);
      if (x > 0 && y > 0) d = Math.min(d, D[j - W - 1] + 1.414); if (x < W - 1 && y > 0) d = Math.min(d, D[j - W + 1] + 1.414); D[j] = d; }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const j = y * W + x; if (!D[j]) continue;
      let d = D[j]; if (x < W - 1) d = Math.min(d, D[j + 1] + 1); if (y < H - 1) d = Math.min(d, D[j + W] + 1);
      if (x < W - 1 && y < H - 1) d = Math.min(d, D[j + W + 1] + 1.414); if (x > 0 && y < H - 1) d = Math.min(d, D[j + W - 1] + 1.414); D[j] = d; }
    const d0 = 2.5e-3 / meta.dx, de = 0.9e-3 / meta.dx, H2F = THREE.DataUtils.fromHalfFloat, F2H = THREE.DataUtils.toHalfFloat;
    for (let j = 0; j < N; j++) if (D[j] > d0 && D[j] < BIG) { const f = Math.exp(-(D[j] - d0) / de); ed[j * 2] = F2H(H2F(ed[j * 2]) * f); ed[j * 2 + 1] = F2H(H2F(ed[j * 2 + 1]) * f); } }
  const tE = new THREE.DataTexture(ed, meta.nx, meta.ny, THREE.RGFormat, THREE.HalfFloatType);
  tE.minFilter = THREE.LinearMipmapLinearFilter; tE.magFilter = THREE.LinearFilter; tE.generateMipmaps = true; tE.needsUpdate = true;   // mipmaps low-pass fringes finer than a pixel
  const tC = new THREE.DataTexture(cd, meta.nx, meta.ny, THREE.RedFormat, THREE.UnsignedByteType);
  tC.minFilter = tC.magFilter = THREE.NearestFilter; tC.needsUpdate = true;
  // gain: the incident field's rms outside the head maps to about 0.7
  let s2 = 0, n = 0;
  const f16 = (u) => { const e = (u >> 10) & 31, m = u & 1023, sg = u >> 15 ? -1 : 1; return e === 0 ? sg * m * 2 ** -24 : sg * (1 + m / 1024) * 2 ** (e - 15); };
  for (let i = 0; i < N; i += 7) if (cd[i] === 0) { const a = f16(ed[i * 2]), b = f16(ed[i * 2 + 1]); s2 += a * a + b * b; n++; }
  const gain = 0.7 / Math.sqrt(s2 / n / 2);
  const pal = meta.classes.map((c) => new THREE.Color(c.col));
  // the hottest tissue cell (absorbed power density), for the colour scale and the Heat label
  let pm = 0, hot = null; const all = [];
  for (let y = 0; y < meta.ny; y++) for (let x = 0; x < meta.nx; x++) {
    const j = y * meta.nx + x, c = cd[j]; if (!c) continue;
    const a = f16(ed[j * 2]), b = f16(ed[j * 2 + 1]), pw = 0.5 * SIG[c] * (a * a + b * b);
    all.push(pw);
    if (pw > pm) { pm = pw; hot = [meta.lo[0] + (x + 0.5) * meta.dx, meta.lo[1] + (y + 0.5) * meta.dx, meta.z]; }
  }
  // the Heat label sits where the skin is hottest on average over 3 mm, not on a single cell
  { let best = 0; const R = 8;
    for (let y = R; y < meta.ny - R; y++) for (let x = R; x < meta.nx - R; x++) {
      if (cd[y * meta.nx + x] !== 1) continue;
      let sum = 0, n = 0;
      for (let v = -R; v <= R; v += 2) for (let u = -R; u <= R; u += 2) {
        const j = (y + v) * meta.nx + x + u, c = cd[j]; if (!c) continue;
        const a = f16(ed[j * 2]), b = f16(ed[j * 2 + 1]); sum += 0.5 * SIG[c] * (a * a + b * b); n++;
      }
      if (n && sum / n > best) { best = sum / n; hot = [meta.lo[0] + (x + 0.5) * meta.dx, meta.lo[1] + (y + 0.5) * meta.dx, meta.z]; }
    } }
  all.sort((a, b) => a - b);
  const pmax = all[Math.floor(all.length * 0.997)];          // top of the colour scale: the outer skin's top values
  hotSpot = hot;
  const mat = new THREE.ShaderMaterial({ vertexShader: SL_VS, fragmentShader: SL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: { uE: { value: tE }, uC: { value: tC }, uPal: { value: pal }, uA: { value: 0 }, uTis: { value: 0 }, uFld: { value: 0 }, uFront: { value: 0 }, uPh: { value: 0 }, uGain: { value: gain }, uK: { value: 2 * Math.PI * meta.f / 299792458 }, uSig: { value: SIG }, uPmax: { value: pmax }, uAbsA: { value: 0 } } });
  const W = meta.nx * meta.dx, H = meta.ny * meta.dx;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
  mesh.position.set(meta.lo[0] + W / 2, meta.lo[1] + H / 2, meta.z); mesh.renderOrder = 5;
  return { mesh, mat, meta };
}
function setSlice(t) {
  const u = slice.mat.uniforms;
  u.uAbsA.value = ease(t, ...T.abs);
  u.uA.value = ease(t, T.cut[0] + 0.5, T.cut[1]);
  u.uTis.value = ease(t, T.cut[0] + 0.5, T.cut[1]);
  u.uFld.value = ease(t, T.slice[0], T.slice[0] + 2);
  u.uFront.value = lerp(0, 0.62, ease(t, T.slice[0], T.slice[0] + 7, (x) => x));   // the field enters from the box faces
  u.uPh.value = t * 2 * Math.PI * 0.35;
  slice.mesh.visible = u.uA.value > 0.001;
}

// ---------------------------------------------------------------- rays
function buildPaths() {
  const amax = Math.max(...pa.paths.map((p) => p.amp));
  paths = pa.paths.map((p, i) => {
    const pts = p.pts.slice(); const n = pts.length;
    pts[n - 1] = mix3(pts[n - 2], pts[n - 1], p.tBox);                      // rays stop where they enter the box
    const P = makePath(pts);
    const start = T.rays[0] + 0.55 * i;
    return { P, w: Math.pow(p.amp / amax, 0.5), order: p.order, mats: p.mats, src: p.src, rank: i, raw: p, start, arrive: Math.max(start + P.L / 9.0, T.box[0] + 3) };
  });
  // the floor bounce to label: the strongest first-order floor reflection
  refl = paths.find((q) => q.order === 1 && q.mats[0] === 'floor');
}
function drawRays(t, camPos) {
  rays.begin();
  const [a, b] = T.rays;
  const fade = 1 - 0.85 * ease(t, T.vox[0], T.vox[0] + 8);
  for (const q of paths) {
    const front = Math.max(0, (t - q.start) * 9.0);           // m/s, strongest first, slow enough to follow
    if (front <= 0) continue;
    const alpha = (0.35 + 0.65 * q.w) * fade;
    drawPath(rays, q.P, { alpha, trail: 0.55, front, gap: 7, speed: 6, t, ph: q.rank * 1.7, tail: 1.6, tailN: 8, size: 7, dots: true, cam: camPos, refDist: 8 });
  }
  // the elements glow as they transmit
  for (const E of els) { const g = ease(t, 6, 12); rays.pt(E.pos, 0.9 * g, 10); rays.pt(E.pos, 0.3 * g, 34); }
  rays.end(0.16);
}

// ---------------------------------------------------------------- camera
const D2R = Math.PI / 180;
function camAt(t) {
  const BC = pa.hbox[0];
  const CW = { pos: [-17, -21, 36], look: [26, 28.5, 0.5], fov: 40 };                 // cutaway, like thesis fig 3.1a
  const M = { pos: [21.0, 28.2, 5.2], look: [24.95, 32.4, 1.35], fov: 40 };
  const C1 = { pos: add3(BC, [-0.69, -0.765, 0.24]), look: add3(BC, [0.0, 0.0, -0.03]), fov: 36 };
  let pos, look, fov;
  // A: from beside the panel, pulled back and up as the elements spread (distance scales with the spacing)
  const uA = ease(t, 1.0, 17.0);
  {
    const look0 = [25, 25, 9.0], dist0 = 0.075, dir0 = norm3([-0.52, -0.62, -0.55]);
    const wDir = norm3(sub3(CW.pos, CW.look)), wDist = len3(sub3(CW.pos, CW.look));
    const dir = slerpDir(dir0, wDir, smoother(clamp((uA - 0.4) / 0.6)));
    const dist = Math.exp(lerp(Math.log(dist0), Math.log(wDist), uA));
    look = mix3(look0, CW.look, smoother(clamp((uA - 0.5) / 0.5)));
    pos = add3(look, dir, dist); fov = lerp(42, CW.fov, uA);
  }
  // slow turn on the cutaway
  const dr = ease(t, 16, 26, (x) => x) * 0.6 + ease(t, 16, 26) * 0.4;
  { const rel = sub3(pos, look), a = Math.atan2(rel[1], rel[0]) + 6 * D2R * dr, r = Math.hypot(rel[0], rel[1]); pos = [look[0] + r * Math.cos(a), look[1] + r * Math.sin(a), pos[2]]; }
  // B: down towards the worker as the rays arrive
  const uB = ease(t, 23, 35);
  if (uB > 0) {
    const mid = mix3(pos, M.pos, 0.5); mid[2] += 4;
    pos = quad(pos, mid, M.pos, uB); look = mix3(look, M.look, uB); fov = lerp(fov, M.fov, uB);
    const d2 = ease(t, 35, 42, (x) => x); pos = add3(pos, [0.9 * d2, 0.8 * d2, -0.5 * d2]);
  }
  // C: in close to the head as the box closes
  const uC = ease(t, 40, 51);
  if (uC > 0) {
    const mid = mix3(pos, C1.pos, 0.6); mid[2] += 0.8;
    pos = quad(pos, mid, C1.pos, uC); look = mix3(look, C1.look, smoother(Math.min(1, uC * 1.25))); fov = lerp(fov, C1.fov, uC);
  }
  // D: a slow orbit towards the face while the box fills, settling for the hold
  const uD = ease(t, 51, 88, (x) => 1 - Math.pow(1 - x, 2.2));
  if (uD > 0) {
    const rel = sub3(pos, look), r3 = len3(rel), a0 = Math.atan2(rel[1], rel[0]), e0 = Math.asin(rel[2] / r3);
    const a = a0 + 30 * D2R * uD, uE = ease(t, 59, 75), e = lerp(e0, 40 * D2R, uE), d = lerp(r3, 0.82, uD);
    const L = mix3(look, [BC[0], BC[1], pa.rx[2] - 0.02], uE);
    pos = [L[0] + d * Math.cos(e) * Math.cos(a), L[1] + d * Math.cos(e) * Math.sin(a), L[2] + d * Math.sin(e)]; look = L;
  }
  // E: down close over the slice by the ear, where the waves are resolved; F: back out to the whole box for the hold
  const uE2 = ease(t, 69, 77), uF = ease(t, 79.5, 87.5);
  if (uE2 > 0) {
    const az = Math.atan2(pos[1] - look[1], pos[0] - look[0]);
    const Lc = [pa.rx[0] + 0.06, pa.rx[1] - 0.005, pa.rx[2]];
    const close = (d, e, L) => [L[0] + d * Math.cos(e) * Math.cos(az), L[1] + d * Math.cos(e) * Math.sin(az), L[2] + d * Math.sin(e)];
    const Lf = hotSpot || Lc, Pc = close(0.46, 54 * D2R, Lc), Pf = close(0.33, 58 * D2R, Lf);
    const P1 = mix3(pos, Pc, uE2), L1 = mix3(look, Lc, uE2);
    pos = mix3(P1, Pf, uF); look = mix3(L1, Lf, uF);
  }
  return { pos, look, fov };
}
const quad = (a, b, c, u) => a.map((_, k) => (1 - u) * (1 - u) * a[k] + 2 * u * (1 - u) * b[k] + u * u * c[k]);

// Film time t runs faster than the plan in two smooth bumps: the opening hall (3 s shorter) and the hold after the
// rays meet (4 s shorter). Each bump adds A (u - sin(2 pi u) / (2 pi)) with u going 0 to 1 across it.
const BUMPS = [[12, 23, 3], [29, 39, 4]];
function warp(t) {
  let p = t;
  for (const [a, b, A] of BUMPS) { const u = clamp((t - a) / (b - a)); p += A * (u - Math.sin(2 * Math.PI * u) / (2 * Math.PI)); }
  return p;
}
export default {
  async init(ctx) {
    [sc, pa] = await Promise.all([J('data/scene10.json'), J('data/paths10.json')]);
    scene = new THREE.Scene(); hallFog(scene, 30, 95);
    hall = buildHall(ctx, sc); scene.add(hall.group);
    field = new PathField(pa.paths.map((p) => ({ k: p.k, a: [p.A] })), 1, { k: pa.k, ref: pa.rx });
    wk = await loadWorker(ctx, scene, { pos: sc.worker.pos, face: sc.worker.face, clip: POSE10.clip, height: POSE10.height, key: 'f10', fieldU: field.u });
    // the arm and the phone fade out once the rays have met (FDTD models neither): a second, transparent pass draws the arm alone
    { const m = bodyMaterial(field.u, { key: 'f10arm' }); m.transparent = true; m.userData.u.uArmMode.value = 2;
      armMesh = new THREE.SkinnedMesh(wk.mesh.geometry, m); armMesh.bind(wk.mesh.skeleton, wk.mesh.bindMatrix);
      armMesh.position.copy(wk.mesh.position); armMesh.quaternion.copy(wk.mesh.quaternion); armMesh.scale.copy(wk.mesh.scale);
      armMesh.frustumCulled = false; armMesh.visible = false; wk.mesh.parent.add(armMesh);
      // depth first, so the fading arm shows only its nearest surface (no fingers seen through the forearm)
      const md = bodyMaterial(field.u, { key: 'f10armz' }); md.transparent = true; md.colorWrite = false; md.userData.u.uArmMode.value = 2;
      const az = new THREE.SkinnedMesh(wk.mesh.geometry, md); az.bind(wk.mesh.skeleton, wk.mesh.bindMatrix);
      az.position.copy(wk.mesh.position); az.quaternion.copy(wk.mesh.quaternion); az.scale.copy(wk.mesh.scale);
      az.frustumCulled = false; az.renderOrder = 1; armMesh.renderOrder = 2; armMesh.userData.z = az; wk.mesh.parent.add(az); }
    wk.phone.group.traverse((o) => { if (o.isMesh) phoneMats.push(o); });
    scene.add(buildArray(ctx));
    rays = new RayLayer(ctx); scene.add(rays.group);
    buildPaths();
    box = buildBox(ctx); scene.add(box.g);
    scene.add(await buildVox(ctx));
    slice = await buildSlice(ctx); if (slice) scene.add(slice.mesh);
    cam = new THREE.PerspectiveCamera(40, ctx.W / ctx.H, 0.005, 400); cam.up.set(0, 0, 1);
  },
  draw(tl, t, target, ctx) {
    t = warp(t);
    // the worker: real idle motion that settles to the traced pose (clip time 3.0) before the box closes
    const freeze = 40, ct = POSE10.ct - Math.max(0, freeze - 3 - t) - 1.5 * (1 - ease(t, freeze - 6, freeze, (x) => 1 - (1 - x) * (1 - x)));
    poseWorker(wk, t < freeze ? ct : POSE10.ct, POSE10);
    { const a = 1 - ease(t, ...T.hand);
      wk.u.uArmMode.value = a < 1 ? 1 : 0; armMesh.visible = armMesh.userData.z.visible = a < 1 && a > 0.003; armMesh.material.opacity = a;
      wk.phone.group.visible = a > 0.003;
      for (const o of phoneMats) { if (o.material.isShaderMaterial) { o.visible = a > 0.5; continue; } o.material.transparent = a < 1; o.material.opacity = a; } }
    placeArray(t);
    const C = camAt(t);
    const cut = ease(t, 6.5, 11);
    hall.setCut({ ceiling: 1 - cut, walls: [1 - ease(t, 9, 13), 1, 1 - ease(t, 9, 13), 1], edgeA: 0.35 * ease(t, 10, 14) * (1 - 0.6 * ease(t, 40, 48)) });
    { const d = len3(sub3(C.pos, C.look)); scene.fog.near = Math.max(30, d * 0.9); scene.fog.far = Math.max(95, d * 2.4); }
    cam.position.set(...C.pos); cam.lookAt(...C.look); cam.fov = C.fov; cam.aspect = ctx.W / ctx.H; cam.updateProjectionMatrix();
    field.u.uPWt.value = t * 2 * Math.PI * 0.35;       // the field's phase turns slowly on screen
    // each path's wave joins the box field when its ray arrives
    field.setWeights(paths.map((q) => ease(t, q.arrive, q.arrive + 1.2)), paths.map((q) => q.raw.A));
    drawRays(t, cam.position);
    setBox(t);
    setVox(t);
    if (slice) setSlice(t);
    const r = ctx.renderer; r.setRenderTarget(target); r.setClearColor(0x07090d, 1); r.clear(); r.render(scene, cam);
  },
  grade(tl) { return { bloom: 0.45, vignette: 0.55, grain: 0.01, exposure: 0.95 }; },
  labels(tl, t) {
    t = warp(t);
    const items = [];
    const win = (a, b, fi = 0.8, fo = 0.6) => Math.min(ease(t, a, a + fi), 1 - ease(t, b - fo, b));
    const E = els[18];
    if (E && E.pos) items.push({ kind: 'label', at: E.pos, off: [90, 70], text: 'Antenna elements', size: 40, a: win(13, 19.5), p: ease(t, 13, 14.6, (x) => x) });
    const Mc = sc.machines.reduce((b, m) => ((m.c[0] - 15) ** 2 + (m.c[1] - 12) ** 2 < (b.c[0] - 15) ** 2 + (b.c[1] - 12) ** 2 ? m : b));
    items.push({ kind: 'label', at: [Mc.c[0], Mc.c[1], Mc.s[2]], off: [-120, -70], text: 'Machines', size: 40, a: win(17, 23.5), p: ease(t, 17, 18.6, (x) => x) });
    items.push({ kind: 'label', at: [sc.worker.pos[0], sc.worker.pos[1], 1.2], off: [130, -60], text: 'Worker', size: 40, plate: true, a: win(23, 29.5), p: ease(t, 23, 24.6, (x) => x) });
    if (refl) items.push({ kind: 'label', at: refl.P.pts[1], off: [-110, 60], text: 'Reflection', size: 40, a: win(29.5, 37), p: ease(t, 29.5, 31, (x) => x) });
    const { lo, hi } = box;
    items.push({ kind: 'bracket', from: [lo[0], lo[1], hi[2]], to: [hi[0], lo[1], hi[2]], side: 30, text: 'Huygens box', size: 40, a: win(T.box[0] + 3, T.vox[0] + 2), p: ease(t, T.box[0] + 3, T.box[0] + 5, (x) => x) });
    const vp = fdtdAnchor();
    if (vp) items.push({ kind: 'label', at: vp, off: [-170, -70], text: 'FDTD', size: 40, plate: true, a: win(T.vox[0] + 4, T.vox[1] + 5), p: ease(t, T.vox[0] + 4, T.vox[0] + 5.5, (x) => x) });
    if (hotSpot) items.push({ kind: 'label', at: hotSpot, off: [-150, 110], text: 'Absorption', size: 40, plate: true, a: win(T.abs[0] + 2, T.end + 1), p: ease(t, T.abs[0] + 2, T.abs[0] + 3.5, (x) => x) });
    return { cam, items };
  },
};
