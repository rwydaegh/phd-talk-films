// Film 14: New York. One continuous camera, blue hour.
// -3.5– 0.0  from 1.9 km out over the harbour, past One World Trade Center, down onto the thesis view
//  0.0– 9.5  the thesis view of the WTC site; the route draws on; the camera comes down to the street
//  9.5–15.0  pedestrian height in front of the walker (phone at the right ear), backing up as she walks
// 15.0–21.0  the camera rises: access points on the cube's facade light up (Antenna)
// 21.0–30.0  rays from the antennas (direct, ground and facade bounces), then from scatterers, reach the phone
// 29.0–31.0  time slows to a stop
// 31.0–37.5  push in to the right ear; arm and phone dissolve; a Huygens Box closes round the ear, the field on its faces
// 37.5–44.0  over the box: the head is cut at ear height, a slice shows the waves meeting at the ear
// 44.0–54.0  the crests settle into |E|/Emax: a focus about half a wavelength wide (λ); calm hold
import * as THREE from 'three';
import { loadWorld, addGlazing, U as WUni } from '../lib/world.js';
import { loadWalker, poseWalker, phoneAtEar, earW, WU } from '../lib/walker.js';
import { makePanel } from '../lib/props.js';
import { Rays } from '../lib/rays.js';
import { Glows } from '../lib/glows.js';
import { FU, setWaves, boxFaceMaterial, sliceMaterial, fwhm } from '../lib/field.js';
import { GROUND, LAM, SPEED, WALK, APS, PAC_FACE } from '../lib/site.js';
import { applyCam, sForFov, lerp, ease, smooth, smoother, clamp, mix3, add3, sub3, norm3, len3, dot3, slerpDir, spline } from '../lib/cam.js';
import { mulberry32 } from '../lib/prng.js';
import { worldTris, sectionLoops, capGeometry, outlineGeometry } from '../lib/section.js';
const ROUTEZ = await (await fetch('data/route.json')).json();

// The film opens PRE seconds before shot time 0 and cuts from the aerial (ends at TCUT) straight to behind her at TC.
const PRE = 3.5, TCUT = 8;
export const DUR = 44 + PRE;
const mapT = (T) => (T < PRE + TCUT ? T - PRE : T - PRE + 8);
const TA = 29, TD = 2, TF = TA + TD;     // time slows from TA and stands still from TF
const CLIP_V = 1.70;                     // the Mixamo walk's own speed (m/s), measured from the stance foot
const BOX = [0.051, 0.041, 0.071];       // Huygens box, 4.76 x 3.83 x 6.63 wavelengths: along travel, across, vertical
let HEADT, cap, lastCut = null, headLine, phoneLine;
let W, wk, cam, rays, glows, panels = [], boxEdges, boxFaces, slice, frame, lights, routeRays;

const A = [...WALK.A], B = [...WALK.B];
const LEN = Math.hypot(B[0] - A[0], B[1] - A[1]);
const FD = [(B[0] - A[0]) / LEN, (B[1] - A[1]) / LEN, 0];   // = walk.json FD
const RD = [FD[1], -FD[0], 0];           // the walker's right (north, toward the cube)
const HEAD = Math.atan2(FD[1], FD[0]);
// the walker's own clock: runs with t, eases to a stop between TA and TF
// TC: the dry cut from the front view to behind her. Time jumps there: she is 3.6 m further on after the cut, past a dark block by the cube.
const TC = 16, JUMP = 2.6;
const wt = (t) => { const j = t < TC ? 0 : JUMP; if (t <= TA) return t + j; const u = clamp((t - TA) / TD); return j + TA + TD * (u - u * u * u + 0.5 * u * u * u * u); };
const WALKZ = await (await fetch('data/walk.json')).json();
const groundAt = (sw) => { const u = clamp((sw - WALKZ.s0) / WALKZ.ds, 0, WALKZ.z.length - 1.001), i = Math.floor(u); return lerp(WALKZ.z[i], WALKZ.z[i + 1], u - i); };
const sAt = (t) => SPEED * (wt(t) - 8);                // metres west of A; she passes A at t = 8 s
const feet = (t) => { const s = sAt(t); return [A[0] + FD[0] * s, A[1] + FD[1] * s, groundAt(s)]; };
const twAt = (t) => wt(t) * SPEED / CLIP_V + 0.37;
const rel = (t, f, r, up) => { const p = feet(t); return [p[0] + FD[0] * f + RD[0] * r, p[1] + FD[1] * f + RD[1] * r, p[2] + up]; };

// ---------- camera ----------
let EAR = null, EARF = null;
// thesis figure view (Google Earth: 40.71201 N, 74.01278 W, heading 38.9°, tilt 43.8°, range 538 m)
const TH_T = [35, 79, -28], TH_C = [35 - 0.628 * 372, 79 - 0.778 * 372, -28 + 388];
const camFront = (t) => ({ pos: rel(t, 4.2, -0.9, 1.2), look: rel(t, 0, 0.15, 1.45), fov: 36 });
const camHigh = (t) => { const k = ease(t, TC, 31, smoother); return { pos: rel(t, lerp(-5.6, -4.4, k), lerp(-3.8, -3.0, k), lerp(3.0, 2.6, k)), look: rel(t, 3, 2.6, 3.3), fov: 54 }; };
function camFar(t) {
  const u = 1 - Math.pow(1 - ease(t, -PRE, 0), 2.6);
  const K0 = mix3(TH_C, TH_T, 0.3), d1 = norm3(sub3(K0, TH_T)), el = (14 * Math.PI) / 180;
  const d0 = [-0.628 * Math.cos(el), -0.778 * Math.cos(el), Math.sin(el)];
  const d = Math.exp(lerp(Math.log(1900), Math.log(len3(sub3(K0, TH_T))), u));
  return { pos: add3(TH_T, slerpDir(d0, d1, u), d), look: mix3([2, 189, 230], TH_T, ease(t, -PRE * 0.6, 0, smoother)), fov: 36 };
}
function camAerial(t) {
  const K = [mix3(TH_C, TH_T, 0.3), mix3(TH_C, TH_T, 0.42), [-20, 0, 92], [28, 42, 42]];
  const L = [TH_T, [40, 85, -28], [62, 100, -27], [84, 112, -27]];
  const u = ease(t, 0, 8.6, (x) => { x = clamp(x); return x < 0.3 ? 0.165 * Math.pow(x / 0.3, 2) : 0.165 + 0.835 * smooth((x - 0.3) / 0.7); });
  return { pos: spline(K, u), look: spline(L, u), fov: lerp(36, 40, ease(t, 4, 8.6)) };
}
const SIDE = () => norm3(add3(add3(RD, FD, 0.75), [0, 0, 1], 0.3));
const TOP = () => norm3(add3([0, 0, 1], RD, 0.0001));
function camEar(t) {
  // push in to the ear (log distance), then arc over the box to a top view
  const h = camHigh(TF);
  const d0 = len3(sub3(h.pos, EARF)), dir0 = norm3(sub3(h.pos, EARF));
  const u1 = ease(t, 31, 37, smoother), u2 = ease(t, 37.5, 44, smoother);
  // swing round behind her head to her right side (azimuth in the walker frame, never over the top)
  const S = SIDE(), hz = (v) => [dot3(v, FD), dot3(v, RD), v[2]];
  const v0 = hz(dir0), v1 = hz(S), az0 = Math.atan2(v0[1], v0[0]); let az1 = Math.atan2(v1[1], v1[0]);
  while (az1 > az0) az1 -= 2 * Math.PI;
  const us = ease(t, 31, 36.5, smoother), az = lerp(az0, az1, us), el = lerp(Math.asin(v0[2]), Math.asin(v1[2]), us);
  let dir = add3(add3(FD.map((x) => x * Math.cos(az) * Math.cos(el)), RD, Math.sin(az) * Math.cos(el)), [0, 0, 1], Math.sin(el));
  dir = slerpDir(dir, TOP(), u2);
  const d = Math.exp(lerp(lerp(Math.log(d0), Math.log(0.42), u1), Math.log(0.088), u2));
  const look = mix3(h.look, EARF, ease(t, 31, 34.5, smoother));
  const up = slerpDir([0, 0, 1], [-RD[0], -RD[1], 0], ease(t, 39, 44, smoother));
  return { pos: add3(EARF, dir, d), look, up, fov: lerp(56, 38, ease(t, 31, 37)) };
}
const QP = new URLSearchParams(location.search);
function blend(a, b, w) { return { pos: mix3(a.pos, b.pos, w), look: mix3(a.look, b.look, w), fov: lerp(a.fov, b.fov, w), up: b.up || a.up }; }
function camAt(t) {
  if (QP.get('rcam')) { const v = QP.get('rcam').split(',').map(Number); return { pos: rel(t, v[0], v[1], v[2]), look: rel(t, v[3], v[4], v[5]), fov: v[6] || 50 }; }
  if (QP.get('acam')) { const v = QP.get('acam').split(',').map(Number); return { pos: v.slice(0, 3), look: v.slice(3, 6), fov: v[6] || 50 }; }
  if (t < 0) return camFar(t);
  if (t < 9.5) return camAerial(t);
  if (t < TC) return camFront(t);
  if (t < 31) return camHigh(t);   // dry cut to behind her: the facade with its antennas ahead
  return camEar(t);
}

// ---------- paths ----------
const rng = mulberry32(14);
// last-bounce scatterers (QuaDRiGa subclusters): street furniture, trees and facade detail all round the walker
const SCAT = [];
{
  const P0 = feet(TF);
  for (let i = 0; i < 22; i++) {
    const az = (i + 0.35 * rng()) / 22 * 2 * Math.PI, r = 4 + rng() * 16;
    let x = P0[0] + Math.cos(az) * r, y = P0[1] + Math.sin(az) * r;
    // keep them off the cube: push north ones back onto its face
    const F = PAC_FACE, dn = (x - F.p[0]) * F.n[0] + (y - F.p[1]) * F.n[1];
    if (dn < 0) { x -= dn * F.n[0]; y -= dn * F.n[1]; }
    SCAT.push([x, y, GROUND + 0.6 + rng() * 3.2]);
  }
}
function mirrorZ(p, z) { return [p[0], p[1], 2 * z - p[2]]; }
function mirrorFace(p) { const F = PAC_FACE; const d = (p[0] - F.p[0]) * F.n[0] + (p[1] - F.p[1]) * F.n[1]; return [p[0] - 2 * d * F.n[0], p[1] - 2 * d * F.n[1], p[2]]; }
function hitFace(a, b) {   // where a->b crosses the cube's face plane, if within the face
  const F = PAC_FACE; const da = (a[0] - F.p[0]) * F.n[0] + (a[1] - F.p[1]) * F.n[1], db = (b[0] - F.p[0]) * F.n[0] + (b[1] - F.p[1]) * F.n[1];
  if (da * db >= 0) return null;
  const u = da / (da - db), q = mix3(a, b, u);
  const s = (q[0] - F.p[0]) * F.t[0] + (q[1] - F.p[1]) * F.t[1];
  return s > F.s0 - 30 && s < F.s1 && q[2] > -21 && q[2] < F.z1 - 0.3 ? q : null;
}
const SRC = APS.map((a) => ({ ...a, c: add3(a.pos, a.n, 0.25) }));
function pathsTo(P) {
  const out = [];
  SRC.forEach((s, i) => {
    out.push({ pts: [s.c, P], k: 0, src: i });
    const gz = GROUND + 0.02, Pm = mirrorZ(P, gz), u = (s.c[2] - gz) / (s.c[2] - Pm[2]);
    out.push({ pts: [s.c, mix3(s.c, Pm, u), P], k: 1, src: i });
    if (!s.id.startsWith('cube')) { const q = hitFace(s.c, mirrorFace(P)); if (q) out.push({ pts: [s.c, q, P], k: 1, src: i }); }
  });
  SCAT.forEach((q, i) => out.push({ pts: [q, P], k: 2, src: -1 - i }));
  return out;
}
// rays end on the box once it has closed: clip the last segment where it enters the box (box axes FD, RD, z)
function clipToBox(a, b, C) {
  const toL = (p) => { const d = sub3(p, C); return [dot3(d, FD), dot3(d, RD), d[2]]; };
  const la = toL(a), lb = toL(b), h = BOX.map((x) => x * 0.5);
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    const d = lb[k] - la[k];
    if (Math.abs(d) < 1e-12) { if (Math.abs(la[k]) > h[k]) return b; continue; }
    let u0 = (-h[k] - la[k]) / d, u1 = (h[k] - la[k]) / d; if (u0 > u1) [u0, u1] = [u1, u0];
    t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
  }
  return t0 <= t1 && t0 > 0 ? mix3(a, b, t0) : b;
}
const plen = (pts) => pts.reduce((s, q, k) => (k ? s + len3(sub3(q, pts[k - 1])) : 0), 0);

export default {
  async init(ctx) {
    W = await loadWorld();
    addGlazing(W.scene, PAC_FACE);
    cam = new THREE.PerspectiveCamera();
    lights = new THREE.Group();
    lights.add(new THREE.HemisphereLight(0x8aa4dd, 0x0c0e14, 0.8));
    const k = new THREE.DirectionalLight(0xc8d4ff, 1.1); k.position.set(-60, -30, 80); lights.add(k);
    const r = new THREE.DirectionalLight(0xffc49a, 0.6); r.position.set(-40, 80, 20); lights.add(r);
    W.scene.add(lights);
    wk = await loadWalker(ctx, W.scene);
    wk.phone.group.traverse((o) => { if (o.material && o.material.envMapIntensity !== undefined) o.material.envMapIntensity *= 0.35; });
    for (const a of SRC) { const p = makePanel({ pos: a.pos, n: a.n, size: 0.6 }); W.scene.add(p.group); panels.push(p); }
    rays = new Rays(1200); W.scene.add(rays.mesh);
    window.__nyc = { get rays() { return rays; }, get cam() { return cam; }, camAt, feet };
    routeRays = new Rays(220); routeRays.u.uCol.value.setRGB(0.55, 0.75, 1.0); routeRays.u.uWidth.value = 4.5; routeRays.mat.depthTest = false; W.scene.add(routeRays.mesh);
    glows = new Glows(96, ctx.W, ctx.H); W.scene.add(glows.mesh);
    // Huygens box
    boxEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xe8eef8, transparent: true, opacity: 0 }));
    boxEdges.matrixAutoUpdate = false; boxEdges.renderOrder = 40; W.scene.add(boxEdges);
    boxFaces = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), boxFaceMaterial());
    boxFaces.matrixAutoUpdate = false; boxFaces.renderOrder = 35; W.scene.add(boxFaces);
    slice = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sliceMaterial());
    slice.matrixAutoUpdate = false; slice.renderOrder = 36; W.scene.add(slice);
    // the slice's outline: the frame of the map on the next slide
    frame = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([x, y]) => new THREE.Vector3(x, y, 0.0004))), new THREE.LineBasicMaterial({ color: 0xe8eef8, transparent: true, opacity: 0 }));
    frame.matrixAutoUpdate = false; frame.renderOrder = 41; W.scene.add(frame);
    // the ear and the receiver point at the frozen moment
    poseWalker(wk, { pos: feet(TF), heading: HEAD, tw: twAt(TF) }); phoneAtEar(wk);
    EAR = earW(wk).toArray();
    EARF = add3(EAR, RD, 0.012);
    const waves = pathsTo(EARF).map((p) => {
      const a = p.pts[p.pts.length - 2], L = plen(p.pts);
      return { dir: sub3(EARF, a), a: (p.k === 2 ? 0.55 : p.k === 1 ? 0.6 : 1.0) * Math.min(1, 12 / L) ** 0.5 };
    });
    // the thesis map is 0.44 lambda wide along x: weight the arrivals so this film's focus has the same width
    let best = null;
    for (let g = 0; g <= 6; g += 0.25) {
      setWaves(waves.map((w) => { const d = norm3(w.dir); return { dir: w.dir, a: w.a * (1 + g * dot3(d, FD) ** 2) }; }));
      const f = fwhm(FD); if (!best || Math.abs(f - 0.44) < Math.abs(best[1] - 0.44)) best = [g, f];
    }
    setWaves(waves.map((w) => { const d = norm3(w.dir); return { dir: w.dir, a: w.a * (1 + best[0] * dot3(d, FD) ** 2) }; }));
    FU.uC.value.set(...EARF);
    // the head and the phone at the frozen moment, for the cap over the cut and their outlines in the slice
    const aArm = wk.mesh.geometry.attributes.aArm;
    const nearEar = (a, b, c, ia, ib, ic) => (!aArm || Math.max(aArm.getX(ia), aArm.getX(ib), aArm.getX(ic)) < 0.5) && [a, b, c].every((q) => len3(sub3(q, EAR)) < 0.3);
    HEADT = worldTris(wk.mesh, nearEar);
    const PT = []; wk.phone.group.traverse((o) => { if (o.isMesh) PT.push(...worldTris(o)); });
    const zs = EARF[2] - 0.0005 + 0.0002, line = (op) => new THREE.LineBasicMaterial({ color: 0xe8eef8, transparent: true, opacity: 0 });
    headLine = new THREE.LineSegments(outlineGeometry(sectionLoops(HEADT, zs), zs), line()); headLine.renderOrder = 41; W.scene.add(headLine);
    phoneLine = new THREE.LineSegments(outlineGeometry(sectionLoops(new Float32Array(PT), zs), zs), line()); phoneLine.renderOrder = 41; W.scene.add(phoneLine);
    cap = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide })); cap.visible = false; W.scene.add(cap);
    console.warn('FWHM along travel', fwhm(FD).toFixed(3), 'across', fwhm(RD).toFixed(3), 'lambda; waves', waves.length);
  },

  draw(tl, t, target, ctx) {
    t = mapT(t);
    const c = camAt(t);
    applyCam(cam, { pos: c.pos, fwd: sub3(c.look, c.pos), up: c.up, s: sForFov(c.fov), cx: 1280, cy: 720 }, ctx.W, ctx.H, t > 31.5 ? 0.004 : 0.15, 6000);
    WUni.uFocus.value.set(...c.look); WUni.uEye.value.set(...c.pos);
    W.ring.visible = t < 9.5; WUni.uRingR.value = t < 9.5 ? 272 : 1e9;
    const far = 1 - ease(t, -PRE, 0, smooth);
    WUni.uFogC.value.set(lerp(0.012, 0.026, far), lerp(0.018, 0.037, far), lerp(0.038, 0.075, far));
    WUni.uFogR.value = lerp(lerp(520, 240, ease(t, 2, 9.5)), 1500, far);
    WUni.uNear.value = t < TC ? 0 : 1;
    WUni.uKeep.value.set(PAC_FACE.p[0], PAC_FACE.p[1], PAC_FACE.n[0], PAC_FACE.n[1]); WUni.uKeepK.value = t < TC ? 0 : 1;
    // clutter corridor along the walk: s from A (metres west), r to her right (north, toward the podium wall); walk.json ground fit
    WUni.uCor.value.set(A[0], A[1], FD[0], FD[1]); WUni.uCorS.value.set(8, 46, -3.2, 1.3); WUni.uCorG.value.set(-27.300, -0.0064, 1);
    WUni.uFogD.value.set(lerp(lerp(420, 220, ease(t, 4, 9.5)), 2200, far), lerp(lerp(1100, 520, ease(t, 4, 9.5)), 3400, far));
    WUni.uFogK.value = t < 0 ? lerp(1, 0.6, ease(t, -1.2, 0)) : lerp(0.6, 1, ease(t, 4, 9.5));
    { const f = feet(t); WUni.uPool.value.set(f[0], f[1], f[2], 0.1 * WUni.uNear.value); }
    // walker
    poseWalker(wk, { pos: feet(t), heading: HEAD, tw: twAt(t) });
    phoneAtEar(wk);
    const P = t < TF ? add3(earW(wk).toArray(), RD, 0.012) : EARF;
    // antennas switch on, one after the other
    SRC.forEach((s, i) => { const on = ease(t, 17.0 + 0.4 * i, 17.7 + 0.4 * i); panels[i].patchU.uOn.value = on; panels[i].lit.value = on; });
    // arm and phone dissolve once time has stopped
    const armF = ease(t, 35.3, 36.5);
    WU.uArm.value = armF;
    wk.phone.group.visible = armF < 0.98;
    wk.phone.group.traverse((o) => { if (o.material) { o.material.transparent = true; o.material.opacity = 1 - armF; } });
    // Huygens box: closes from head size onto the ear
    const R3 = new THREE.Matrix4().makeBasis(new THREE.Vector3(...FD), new THREE.Vector3(...RD), new THREE.Vector3(0, 0, 1));
    const boxS = lerp(7, 1, ease(t, 33.0, 36.0, smoother));
    const M = R3.clone().scale(new THREE.Vector3(BOX[0] * boxS, BOX[1] * boxS, BOX[2] * boxS)).setPosition(new THREE.Vector3(...EARF));
    const boxA = ease(t, 32.6, 33.6);
    boxEdges.visible = boxA > 0; boxEdges.matrix.copy(M); boxEdges.matrixWorld.copy(M);
    boxEdges.material.opacity = boxA * 0.9 * (1 - ease(t, 39.0, 41.0));
    frame.material.opacity = 0.9 * ease(t, 39.5, 41.5);
    FU.uWt.value = 2 * Math.PI * 0.6 * t;
    FU.uFace.value = ease(t, 35.6, 37.0) * (1 - ease(t, 39.0, 40.6));
    boxFaces.visible = FU.uFace.value > 0.003; boxFaces.matrix.copy(M); boxFaces.matrixWorld.copy(M);
    // slice through the focus, the box's horizontal cross-section
    const MS = R3.clone().scale(new THREE.Vector3(BOX[0], BOX[1], 1)).setPosition(new THREE.Vector3(...add3(EARF, [0, 0, 1], -0.0005)));
    slice.matrix.copy(MS); slice.matrixWorld.copy(MS);
    frame.matrix.copy(MS); frame.matrixWorld.copy(MS); frame.visible = frame.material.opacity > 0.003;
    FU.uSlice.value = ease(t, 40.2, 41.8);
    FU.uEnv.value = ease(t, 44.0, 47.0, smoother);
    slice.visible = FU.uSlice.value > 0.003;
    // body: absorption glow on the ear while the box closes; then the head is cut at ear height
    WU.uHot.value = ease(t, 35.5, 37.0) * (1 - ease(t, 39, 40.5));
    WU.uHotC.value.set(...EAR); WU.uHotR.value = 0.011;
    WU.uCut.value = t < 38 ? 1e4 : lerp(EARF[2] + 0.25, EARF[2] - 0.002, ease(t, 38.2, 40.5, smoother));
    WU.uFade.value = 1 - 0.9 * ease(t, 38.8, 40.8) - 0.05 * ease(t, 41, 45);
    // the cut is closed: a flat cross-section at the cut height, never an open shell
    if (WU.uCut.value < 1e3) {
      const zc = WU.uCut.value - 0.0001;
      if (zc !== lastCut) { cap.geometry.dispose(); cap.geometry = capGeometry(sectionLoops(HEADT, zc), zc); lastCut = zc; }
      cap.visible = true; cap.material.color.setRGB(0.13, 0.125, 0.12).multiplyScalar(WU.uFade.value);
    } else cap.visible = false;
    headLine.material.opacity = 0.75 * ease(t, 40.6, 41.8); headLine.visible = headLine.material.opacity > 0.003;
    phoneLine.material.opacity = 0.6 * ease(t, 40.9, 42.1); phoneLine.visible = phoneLine.material.opacity > 0.003;
    WUni.uDim.value = 1 - 0.8 * ease(t, 34, 39);
    // rays
    const list = [];
    if (t > 21) {
      const boxClip = t >= 36.0;
      for (const p of pathsTo(P)) {
        let pts = p.pts;
        if (boxClip) { pts = pts.slice(); pts[pts.length - 1] = clipToBox(pts[pts.length - 2], pts[pts.length - 1], EARF); }
        const L = plen(pts);
        let draw, a;
        if (p.k === 2) { const j = -1 - p.src, ap = ease(t, 24.6 + 0.07 * j, 26.0 + 0.07 * j); draw = L * ap; a = 0.24; }
        else { const ap = ease(t, 21.2 + 0.45 * p.src + (p.k ? 0.9 : 0), 22.8 + 0.45 * p.src + (p.k ? 0.9 : 0), (x) => x * x); draw = L * ap; a = p.k === 0 ? 1.0 : 0.45; }
        a *= 1 - ease(t, 39.5, 41.0);
        if (a > 0.003) list.push({ pts, a, ph: ((p.src * 0.37) % 1 + 1) % 1, draw: draw >= L * 0.999 ? 1e9 : draw, w: p.k === 2 ? 0.7 : 1, pg: p.k === 2 ? 0.6 : 1 });
      }
    }
    rays.setPaths(list, ctx.W, ctx.H, cam);
    // pulses run along the rays on the walker's clock, so they stop when time stops
    rays.u.uT.value = wt(t);
    rays.u.uSpeed.value = 24;
    rays.u.uSpacing.value = 8;
    rays.u.uPulse.value = 1.6;
    rays.u.uWidth.value = 3.0;
    rays.u.uBase.value = 0.28;
    // the route (overview)
    const rA = ease(t, 0.6, 4.2, smooth), rOut = 1 - ease(t, 6.0, 8.0);
    routeRays.setPaths(rOut > 0.003 ? [{ pts: ROUTEZ, a: 0.9 * rOut, draw: rA * plen(ROUTEZ), pg: 0 }] : [], ctx.W, ctx.H, cam);
    routeRays.u.uBase.value = 0.9;
    // glows: route start, antennas, scatterers
    glows.begin();
    if (rOut > 0.003) { glows.add(ROUTEZ[0], 60, [0.6, 0.8, 1.0, rOut * ease(t, 0.4, 1.0)]); }
    SRC.forEach((s, i) => { const on = panels[i].patchU.uOn.value; if (on > 0) glows.add(s.c, 64, [1.0, 0.82, 0.55, 0.85 * on * (1 - 0.7 * ease(t, 33, 36))]); });
    SCAT.forEach((q, j) => { const ap = ease(t, 24.4 + 0.07 * j, 25.0 + 0.07 * j) * (1 - ease(t, 33, 36)); if (ap > 0) glows.add(q, 26, [0.75, 0.88, 1.0, 0.5 * ap]); });
    glows.end();
    // render
    const r = ctx.renderer; r.setRenderTarget(target); r.setClearColor(0, 1); r.clear(); r.render(W.scene, cam);
  },

  grade(tl, t) {
    t = mapT(t);
    return { bloom: t > 40 ? 0.45 : 0.6, threshold: 0.06, vignette: 0.5, grain: 0.01, motionBlur: 1, shutter: 0.5, fade: ease(t, -PRE, -PRE + 0.6), exposure: 1.1 };
  },

  labels(tl, t, ctx) {
    t = mapT(t);
    const items = [];
    const la = (t0, t1) => ease(t, t0, t0 + 0.5) * (1 - ease(t, t1, t1 + 0.5));
    const lw = la(-3.1, -1.9), ll = la(-3.2, 1.2);
    if (lw > 0) items.push({ kind: 'label', at: [2, 189, 360], off: [190, -60], text: 'One World Trade Center', a: lw, p: ease(t, -3.1, -2.4), size: 50 });
    if (ll > 0) items.push({ kind: 'text', at: [150, 1330], text: 'Lower Manhattan, New York', a: ll, p: ease(t, -3.2, -2.5), size: 54 });
    const a1 = la(17.8, 25.5), a2 = la(18.3, 25.5);
    if (a1 > 0) items.push({ kind: 'label', at: SRC[1].c, off: [150, -90], text: 'Antenna', a: a1, p: ease(t, 17.8, 18.8), size: 50 });
    if (a2 > 0) items.push({ kind: 'label', at: SRC[2].c, off: [150, -60], text: 'Antenna', a: a2, p: ease(t, 18.3, 19.3), size: 50 });
    const hb = la(36.2, 39.6);
    if (hb > 0) {
      const top = add3(add3(add3(EARF, [0, 0, 1], BOX[2] / 2), FD, BOX[0] / 2), RD, BOX[1] / 2);
      items.push({ kind: 'label', at: top, off: [160, -110], text: 'Huygens box', a: hb, p: ease(t, 36.2, 37.2), size: 50 });
    }
    const lb = ease(t, 47.5, 48.3);
    if (lb > 0) {
      const y0 = add3(EARF, RD, BOX[1] / 2 + 0.0035);
      items.push({ kind: 'bracket', from: add3(y0, FD, -LAM / 2), to: add3(y0, FD, LAM / 2), side: 18, toward: 'down', textGap: 40, text: [['λ', 'math']], a: lb, p: ease(t, 47.5, 48.5), size: 56 });
    }
    return { cam, items };
  },
};
