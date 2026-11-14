// Film 27: back in the factory (chapter 5's hall, 40 x 20 x 5 m, the LOS realisation of seed 0). A 16 x 16 array
// focuses on the phone at the worker's chest (MRT): the body near the phone absorbs. The precoder then moves along
// the Pareto front to ECBF at half the signal: the phone stays lit, the energy slides off the body.
// No numbers on screen; the slide after carries the result.
// Data: data/scene27.json, data/paths27.json (traced paths, effective amplitudes per precoder row, MRT -> ECBF).
import * as THREE from 'three';
import { buildHall, hallFog } from '../lib/factory.js';
import { loadWorker, poseWorker } from '../lib/worker.js';
import { POSE27 } from '../lib/poses.js';
import { RayLayer, makePath, drawPath } from '../lib/beam.js';
import { PathField } from '../lib/field.js';
import { ease, lerp, mix3, clamp, smoother, sub3, add3, len3, norm3 } from '../lib/cam.js';

let rowMax, scene, cam, hall, wk, rays, layers, sc, pa, field, paths = [], panel, rowAt;
const WIDTHS = [[1.0, 5], [2.4, 9], [4.4, 15], [7.5, 24]];   // [core, glow] px at 1080p, light to heavy
const T = { rays: [3, 12], abs: [15, 19], morph: [29, 33], end: 36.5 };
const J = (u) => fetch(u).then((r) => r.json());
const D2R = Math.PI / 180;

function buildPanel(ctx) {
  const g = new THREE.Group();
  const u = sc.ura, N = u.n, d = u.d, side = N * d;
  const house = new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.5, metalness: 0.05, envMap: hall.env, envMapIntensity: 0.5 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xd08a4a, roughness: 0.3, metalness: 1.0, envMap: hall.env, envMapIntensity: 1.2, emissive: 0x3a1c08 });
  const rodM = new THREE.MeshStandardMaterial({ color: 0x5a6270, roughness: 0.4, metalness: 0.8, envMap: hall.env });
  const tilt = new THREE.Group();
  const h = new THREE.Mesh(new THREE.BoxGeometry(0.03, side + 0.02, side + 0.02), house); h.position.x = -0.016; tilt.add(h);
  const pg = new THREE.BoxGeometry(0.0004, d * 0.58, d * 0.58);
  const im = new THREE.InstancedMesh(pg, copper, N * N); const m = new THREE.Matrix4();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { m.makeTranslation(0, (i - (N - 1) / 2) * d, (j - (N - 1) / 2) * d); im.setMatrixAt(j * N + i, m); }
  tilt.add(im);
  tilt.rotation.y = u.tilt * D2R;                     // the face (+x) turns down by the tilt
  tilt.position.set(...u.centre); g.add(tilt);
  const top = sc.room[1][2], rl = top - u.centre[2] - side / 2 - 0.01;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, rl, 12), rodM); rod.rotation.x = Math.PI / 2;
  rod.position.set(u.centre[0] - 0.02, u.centre[1], u.centre[2] + side / 2 + 0.01 + rl / 2); g.add(rod);
  return g;
}

function buildPaths() {
  const R = pa.rows;
  const amax = Math.max(...pa.paths.map((p) => Math.hypot(...p.A[0])));
  paths = pa.paths.map((p, i) => {
    const pts = p.pts.slice(), n = pts.length;
    if (p.tBody != null) pts[n - 1] = mix3(pts[n - 2], pts[n - 1], p.tBody);    // rays from behind stop on the back
    const mag = p.A.map((a) => Math.hypot(a[0], a[1]) / amax);
    return { P: makePath(pts), mag, rank: i, start: T.rays[0] + 0.45 * i, hitsBody: p.tBody != null, gain: mag[R - 1] / Math.max(1e-6, mag[0]) };
  });
  rowMax = Array.from({ length: R }, (_, r) => Math.max(...paths.map((q) => q.mag[r])));
}
const magAt = (q, row) => { const r0 = Math.floor(row), f = row - r0; return lerp(q.mag[r0], q.mag[Math.min(r0 + 1, q.mag.length - 1)], f); };

function camAt(t) {
  const W = { pos: [-17.5, -25.0, 17.0], look: [-5.5, 0.5, 0.8], fov: 38 };
  const M = { pos: [-4.6, -5.2, 3.0], look: [-1.0, 0.0, 1.35], fov: 40 };
  const C = { pos: [-0.95, -1.95, 1.72], look: [0.78, 0.08, 1.30], fov: 36 };
  let p = W.pos, l = W.look, f = W.fov;
  const d0 = ease(t, 0, 8, (x) => x); p = add3(p, [2.2 * d0, 1.5 * d0, -1.0 * d0]);
  // opening: close on the panel's element grid, then a log-distance pull-out to the wide shot
  const u0 = ease(t, 0.6, 4.6);
  if (u0 < 1) {
    const pc = sc.ura.centre, dc = norm3([0.8, -0.55, -0.12]), dw = norm3(sub3(p, l));
    const look = mix3(pc, l, u0 * u0 * u0), dir = norm3(mix3(dc, dw, u0));
    const dist = Math.exp(lerp(Math.log(0.42), Math.log(len3(sub3(p, l))), u0));
    p = add3(look, dir.map((v) => v * dist)); l = look; f = lerp(30, W.fov, u0);
  }
  const u1 = ease(t, 6, 16);
  if (u1 > 0) { const mid = mix3(p, M.pos, 0.5); mid[2] += 3; p = q3(p, mid, M.pos, u1); l = mix3(l, M.look, u1); f = lerp(f, M.fov, u1); }
  const u2 = ease(t, 15, 25);
  if (u2 > 0) { p = mix3(p, C.pos, u2); l = mix3(l, C.look, u2); f = lerp(f, C.fov, u2); }
  // a slow arc while the precoder changes, ending a little wider for the hold
  const u3 = ease(t, 25, T.end, (x) => 1 - Math.pow(1 - x, 2));
  if (u3 > 0) {
    const rel = sub3(p, l), r = Math.hypot(rel[0], rel[1]), a = Math.atan2(rel[1], rel[0]) - 22 * D2R * u3;
    const k = lerp(1, 1.18, u3);
    p = [l[0] + r * k * Math.cos(a), l[1] + r * k * Math.sin(a), l[2] + rel[2] * k];
  }
  return { pos: p, look: l, fov: f };
}
// Work trousers and shoes (by skin weight on the pelvis and leg bones, inflated ~1 cm, no rim); the bare skin carries the
// absorption, on a fixed dB colour scale.
function dress(wk) {
  const g = wk.mesh.geometry, names = wk.mesh.skeleton.bones.map((b) => b.name);
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const leg = names.map((n) => /Hips|UpLeg|Leg$|Foot|ToeBase/.test(n)), shoe = names.map((n) => /Foot|ToeBase/.test(n));
  const a = new Float32Array(si.count * 2);
  for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) {
    const b = si.getComponent(i, k), w = sw.getComponent(i, k);
    if (leg[b]) a[2 * i] += w; if (shoe[b]) a[2 * i + 1] += w;
  }
  g.setAttribute('aDress', new THREE.BufferAttribute(a, 2));
  const prev = wk.mat.onBeforeCompile;
  wk.mat.onBeforeCompile = (sh) => {
    prev(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aDress; varying vec2 vDress;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\ntransformed += normalize(objectNormal) * 1.1 * smoothstep(0.3, 0.6, aDress.x);')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvDress = aDress;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vDress;')
      .replace('diffuseColor.rgb *= uClayDim;', `diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.055, 0.065, 0.085), smoothstep(0.42, 0.58, vDress.x));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.018, 0.02, 0.024), smoothstep(0.4, 0.6, vDress.y));
diffuseColor.rgb *= uClayDim;`)
      .replace('float x = pow(max(s, 0.0), uAbsGamma);', 'float x = clamp(0.92 + 10.0 * log(max(s, 1e-6)) / log(10.0) / 14.0, 0.0, 1.0);')
      .replace('absA = uAbs * inside * smoothstep(0.015, 0.1, x);', 'absA = uAbs * inside * smoothstep(0.0, 0.01, x) * (1.0 - smoothstep(0.42, 0.58, vDress.x));')
      .replace('uRim * (1.0 - absA) * uClayDim;', 'uRim * (1.0 - absA) * uClayDim * (1.0 - 0.85 * smoothstep(0.42, 0.58, vDress.x));');
  };
  wk.mat.customProgramCacheKey = () => 'worker-body-f27-dressed';
  wk.mat.needsUpdate = true;
}
const q3 = (a, b, c, u) => a.map((_, k) => (1 - u) * (1 - u) * a[k] + 2 * u * (1 - u) * b[k] + u * u * c[k]);

export default {
  async init(ctx) {
    [sc, pa] = await Promise.all([J('data/scene27.json'), J('data/paths27.json')]);
    scene = new THREE.Scene(); hallFog(scene, 25, 80);
    hall = buildHall(ctx, sc); scene.add(hall.group);
    field = new PathField(pa.paths.map((p) => ({ k: p.k, a: p.A })), pa.rows, { k: pa.k, ref: pa.rx });
    wk = await loadWorker(ctx, scene, { pos: sc.worker.pos, face: sc.worker.face, clip: POSE27.clip, height: POSE27.height, key: 'f27', fieldU: field.u });
    dress(wk); window.__wk27 = wk; window.__T27 = T;
    wk.u.uAbsGain.value = 1.2;   // one fixed dB scale for MRT and ECBF (dress): 0 dB = MRT chest, 14 dB span; ECBF keeps its pattern, shifted down
    panel = buildPanel(ctx); scene.add(panel);
    // ray width carries the path's weight: each path is split between the two nearest width layers
    layers = WIDTHS.map(([c, g]) => { const L = new RayLayer(ctx, { core: c, glow: g, maxSeg: 2500, maxPts: 3000 }); scene.add(L.group); return L; });
    rays = layers[0];
    buildPaths();
    cam = new THREE.PerspectiveCamera(40, ctx.W / ctx.H, 0.01, 300); cam.up.set(0, 0, 1);
    rowAt = (t) => (pa.rows - 1) * ease(t, ...T.morph);
  },
  draw(tl, t, target, ctx) {
    poseWorker(wk, POSE27.ct + 0.35 * Math.sin(t * 0.25), POSE27);   // breathing-slow idle around the traced pose
    const C = window.__cam27 || camAt(t);                            // QA override: { pos, look, fov }
    { const d = len3(sub3(C.pos, C.look)); scene.fog.near = Math.max(25, d * 0.9); scene.fog.far = Math.max(80, d * 2.4); }
    cam.position.set(...C.pos); cam.lookAt(...C.look); cam.fov = C.fov; cam.aspect = ctx.W / ctx.H; cam.updateProjectionMatrix();
    hall.setCut({ ceiling: 0, walls: [0, 1, 1, 1], edgeA: 0.32 * (1 - 0.7 * ease(t, 14, 22)) });
    const row = rowAt(t);
    field.setRow(row); field.u.uPWt.value = t * 2 * Math.PI * 0.35;
    wk.u.uAbs.value = ease(t, ...T.abs);
    // rays: brightness follows each path's amplitude under the current precoder
    for (const L of layers) L.begin();
    for (const q of paths) {
      const front = Math.max(0, (t - q.start) * 14);
      if (front <= 0) continue;
      // width: the path's share under the current precoder (MRT: a few heavy paths; ECBF: spread over many);
      // brightness: its absolute amplitude; paths the precoder picks up flare while it changes
      const m = magAt(q, row), sm = Math.sqrt(m), share = m / lerp(rowMax[Math.floor(row)], rowMax[Math.min(pa.rows - 1, Math.floor(row) + 1)], row % 1);
      const flare = Math.sin(Math.PI * ease(t, T.morph[0], T.morph[1] + 1, (x) => x)) * clamp((q.gain - 1) / 1.5);
      const w = (WIDTHS.length - 1) * clamp(share), i0 = Math.min(WIDTHS.length - 2, Math.floor(w)), f = w - i0;
      const o = { trail: 0.55, front, gap: 6, speed: 7, t, ph: q.rank * 1.3, tail: 1.6, tailN: 8, size: 5 + 7 * sm, dots: true, cam: cam.position, refDist: 8 };
      const alpha = clamp(0.2 + 0.45 * sm + 0.55 * share + 0.7 * flare);
      if (f < 0.999) drawPath(layers[i0], q.P, { ...o, alpha: alpha * (1 - f) });
      if (f > 0.001) drawPath(layers[i0 + 1], q.P, { ...o, alpha: alpha * f });
    }
    // the array transmits; the phone lights with the received power (field amplitude, so half the power reads as 0.71)
    rays.pt(sc.ura.centre, 0.9 * ease(t, 0.5, 2.5), 12); rays.pt(sc.ura.centre, 0.3 * ease(t, 0.5, 2.5), 40);
    const sig = (() => { const r0 = Math.floor(row), f = row - r0; return lerp(pa.sig[r0], pa.sig[Math.min(r0 + 1, pa.rows - 1)], f); })();
    const on = ease(t, T.rays[0] + 1.5, T.rays[0] + 3.5) * Math.sqrt(sig);
    rays.pt(pa.rx, 1.1 * on, 10); rays.pt(pa.rx, 0.45 * on, 46);
    for (const L of layers) L.end(0.16);
    wk.phone.group.traverse((o) => { if (o.material && o.material.uniforms && o.material.uniforms.uOn) o.material.uniforms.uOn.value = on; });
    const r = ctx.renderer; r.setRenderTarget(target); r.setClearColor(0x07090d, 1); r.clear(); r.render(scene, cam);
  },
  grade() { return { bloom: 0.45, vignette: 0.55, grain: 0.01, exposure: 0.95 }; },
  labels(tl, t) {
    const win = (a, b, fi = 0.8, fo = 0.6) => Math.min(ease(t, a, a + fi), 1 - ease(t, b - fo, b));
    const items = [];
    items.push({ kind: 'label', at: sc.ura.centre, off: [90, -70], text: 'Antenna', size: 40, a: win(1, 8), p: ease(t, 1, 2.5, (x) => x) });
    items.push({ kind: 'label', at: pa.rx, off: [-120, -110], text: 'Phone', size: 40, a: win(17, 26), p: ease(t, 17, 18.5, (x) => x) });
    items.push({ kind: 'label', at: heatAt(), off: [140, 90], text: 'Absorption', size: 40, a: win(19.5, 27.5), p: ease(t, 19.5, 21, (x) => x) });
    return { cam, items };
  },
};
// the hottest skin under MRT, just beside the phone (on the chest, facing the array)
function heatAt() { return [0.921, -0.009, 1.362]; }  // front of the chest, facing the array (from data/pose27.bin)
