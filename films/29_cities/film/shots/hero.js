// H: Prague, Old Town Square, one route point of the thesis run. Rays leave the pedestrian backwards, stop at the
// first surface, and connect to the roofline (the possible antenna sites): direct, specular, diffuse.
// Then the power comes back along those paths and the body lights up with its absorbed power density (thesis data).
import * as THREE from 'three';
import { applyCam, sForFov, lerp, ease, smooth, smoother, mix3, add3, sub3, norm3, len3, clamp } from '../lib/cam.js';
import { cityData, loadCity, BG, disposeCity } from '../lib/city.js';
import { makeDuke, rangeDb } from '../lib/duke.js';
import { makeBeams, makeDots } from '../lib/beams.js';
import { mulberry32 } from '../lib/prng.js';

export const SITE = 'prague_staromestske', IDX = 8;
export const COL = {
  launch: [0.30, 0.50, 1.00], hit: [1.0, 0.62, 0.30], roof: [1.0, 0.55, 0.16],
  direct: [1.0, 1.0, 1.0], specular: [1.0, 0.10, 0.07], diffuse: [0.12, 0.95, 0.32],
};
// shot clock
export const T = { roof: 0.5, ex: 2.8, launch: 9.2, connect: 10.6, arrive: 12.6, lit: 13.0, push: 14.4, end: 20.0 };
const V_LAUNCH = 34;   // m/s, display speed of the launched heads
const V_BACK = 50;     // m/s, display speed of the arriving power
const V_CONN = 60;
let S = null;
const q = new URLSearchParams(location.search);

function pickSubset(arr, n, rnd) {
  if (arr.length <= n) return arr.slice();
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

export function heroCam(tl, P, g) {
  // P: receiver point. Establish, hold for the three example paths, pull back for the fan, push in while the body lights.
  const yaw0 = 205 * Math.PI / 180;            // camera bearing seen from the body (from north)
  const k1 = ease(tl, 8.8, 12.8, smoother), k2 = ease(tl, 14.0, 19.0, smoother);
  const dist = lerp(lerp(lerp(11, 13, ease(tl, 0, 8.6, smooth)), 40, k1), 5.2, k2);
  const h = lerp(lerp(lerp(1.8, 3.0, ease(tl, 0, 8.6, smooth)), 20, k1), -0.2, k2);
  const az = yaw0 + 0.010 * tl - 0.30 * k1 + 0.35 * k2 - 2.3 * ease(tl, 15.0, 20.0, smooth);   // swing round to the hot back
  const tgt = add3(P, [0, 0, lerp(lerp(lerp(1.9, 3.6, ease(tl, 0, 8.6, smooth)), 2, k1), -0.65, k2)]);
  const pos = [P[0] + Math.sin(az) * dist, P[1] + Math.cos(az) * dist, g + 1.4 + h];
  return { pos, fwd: norm3(sub3(tgt, pos)), up: [0, 0, 1], s: sForFov(lerp(lerp(52, 54, k1), 30, k2)), cx: 1280, cy: 720 };
}

export default {
  async init(ctx) {
    const D = await cityData();
    const city = D.cities.find((c) => c.site === SITE);
    const C = await loadCity(city, { r0: 90, r1: 175 });
    const R = await fetch(`data/rays_${SITE}_${IDX}.json`).then((r) => r.json());
    const duke = await makeDuke();
    const pt = city.points[IDX];
    const kGlobal = D.cities.slice(0, D.cities.indexOf(city)).reduce((s, c) => s + c.points.length, 0) + IDX;
    duke.place(pt.p[0], pt.p[1], pt.g, pt.yaw);
    duke.setBlocks(kGlobal, kGlobal, 0);
    [duke.U.uLo.value, duke.U.uHi.value] = rangeDb(kGlobal, 0.02, 0.995);   // this point's own spread, so its pattern reads
    const O = R.origin;                       // the receiver point of the run (1.5 m above the ground)
    const chest = [O[0], O[1], pt.g + 1.3];
    const rnd = mulberry32(2029);

    // roofline: all visible segments, drawn on in a sweep outward from the body
    const roof = city.roof.map((s) => {
      const A = s.slice(0, 3), B = s.slice(3, 6), d = len3(sub3(mix3(A, B, 0.5), O));
      return { A, B, t0: T.roof + d / 80 + rnd() * 0.2, t1: T.roof + d / 80 + 0.25 + rnd() * 0.2, col: COL.roof, a: 0.9, w: 2.4 };
    });
    const L = R.launch.map((r, i) => ({ ...r, i }));
    const byI = new Map(L.map((r) => [r.i, r]));

    // --- the three example paths, chosen to read well from the camera of that moment
    const cam0 = new THREE.PerspectiveCamera();
    applyCam(cam0, heroCam(5.5, O, pt.g), 1920, 1080, 0.1, 3000);
    const scr = (p) => { const v = new THREE.Vector3(...p).project(cam0); return v.z < 1 && Math.abs(v.x) < 0.84 && Math.abs(v.y) < 0.78 ? [(v.x * 0.5 + 0.5) * 1920, (0.5 - v.y * 0.5) * 1080] : null; };
    const so = scr(O) || [960, 700];
    let exD = null, bD = -1;
    for (const S1 of R.direct) { const p = scr(S1); if (!p) continue; const sc = -Math.abs(p[0] - so[0] - 380) - 2 * Math.abs(p[1] - 300); if (sc > bD || !exD) { bD = sc; exD = S1; } }
    let exS = null, bS = -1e9;
    for (const sp of R.specular) { const r = byI.get(sp.i); const a = scr(r.h), b = scr(sp.s); if (!a || !b || Math.abs(r.n[2]) > 0.4 || r.t < 8) continue;
      const sc = Math.min(Math.hypot(a[0] - so[0], a[1] - so[1]), Math.hypot(b[0] - a[0], b[1] - a[1])) - (a[0] < so[0] + 100 ? 300 : 0); if (sc > bS) { bS = sc; exS = sp; } }
    let exF = null, bF = -1e9;
    for (const df of R.diffuse) { const r = byI.get(df.i); const a = scr(r.h), b = scr(df.s); if (!a || !b || r.t < 8 || Math.abs(r.n[2]) > 0.4) continue;
      const sa = exS ? scr(byI.get(exS.i).h) : [0, 0];
      const sc = Math.min(Math.hypot(a[0] - so[0], a[1] - so[1]), Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(a[0] - sa[0], a[1] - sa[1])) - (a[0] > so[0] ? 400 : 0); if (sc > bF) { bF = sc; exF = df; } }
    const ex = [], exDots = [], exBack = [];
    const E = T.ex;
    { const d = len3(sub3(exD, O)); ex.push({ A: O, B: exD, t0: E, t1: E + d / 45, col: COL.direct, a: 0.9, w: 2.2, soft: 1.2, f0: T.connect + 2, f1: T.connect + 3 }); }
    const rS = byI.get(exS.i), rF = byI.get(exF.i);
    { const t0 = E + 1.6, t1 = t0 + rS.t / 40, d = len3(sub3(exS.s, rS.h));
      ex.push({ A: O, B: rS.h, t0, t1, col: COL.launch, a: 0.9, w: 2.2, soft: 1.2, f0: T.connect + 2, f1: T.connect + 3 });
      ex.push({ A: rS.h, B: exS.s, t0: t1, t1: t1 + d / 45, col: COL.specular, a: 1.0, w: 2.2, f0: T.connect + 2, f1: T.connect + 3 });
      exDots.push({ P: rS.h, t0: t1, col: COL.hit, r: 3.2, f0: T.connect + 2, f1: T.connect + 3 }); }
    { const t0 = E + 3.2, t1 = t0 + rF.t / 40, d = len3(sub3(exF.s, rF.h));
      ex.push({ A: O, B: rF.h, t0, t1, col: COL.launch, a: 0.9, w: 2.2, soft: 1.2, f0: T.connect + 2, f1: T.connect + 3 });
      ex.push({ A: rF.h, B: exF.s, t0: t1 + 0.25, t1: t1 + 0.25 + d / 45, col: COL.diffuse, a: 1.0, w: 2.2, dash: 1.4, f0: T.connect + 2, f1: T.connect + 3 });
      exDots.push({ P: rF.h, t0: t1, col: COL.hit, r: 3.2, f0: T.connect + 2, f1: T.connect + 3 }); }
    const exT = { D: E, S: E + 1.6 + rS.t / 40, F: E + 3.2 + rF.t / 40 };

    // --- the fan: launched rays (subset), sky rays shortened
    const hits = L.filter((r) => r.t > 0), sky = L.filter((r) => r.t < 0);
    const shown = new Set([...pickSubset(hits, 130, rnd), ...pickSubset(sky, 30, rnd)].map((r) => r.i));
    const spec = pickSubset(R.specular.filter((sp) => sp.i !== exS.i && byI.get(sp.i).t > 4 && Math.abs(byI.get(sp.i).n[2]) < 0.5), 16, rnd);
    for (const sp of spec) shown.add(sp.i);
    const launch = [], hitDots = [];
    const tLaunch = new Map();
    for (const r of L) {
      if (!shown.has(r.i)) continue;
      const len = r.t > 0 ? r.t : 60;
      const B = add3(O, r.d, len);
      const t0 = T.launch + rnd() * 0.3, t1 = t0 + len / V_LAUNCH;
      tLaunch.set(r.i, t1);
      launch.push({ A: O, B, t0, t1, f0: r.t > 0 ? T.arrive - 0.8 : t1 - 0.6, f1: r.t > 0 ? T.arrive + 0.4 : t1, col: COL.launch, a: r.t > 0 ? 0.26 : 0.16, w: 1.2, soft: 2.0 });
      if (r.t > 0) hitDots.push({ P: r.h, t0: t1, rise: 0.12, f0: T.arrive + 1.0, f1: T.arrive + 2.4, col: COL.hit, a: 0.75, r: 1.8 });
    }
    const conn = [], back = [];
    const diff = pickSubset(R.diffuse.filter((c) => shown.has(c.i) && c.i !== exF.i), 32, rnd);
    const dir = pickSubset(R.direct, 18, rnd);
    const FADE = { f0: T.arrive + 1.0, f1: T.arrive + 2.4 };
    const backT = () => T.arrive + rnd() * 1.2;
    dir.forEach((S1) => {
      const t0 = T.connect + rnd() * 1.2, d = len3(sub3(S1, O));
      conn.push({ A: O, B: S1, t0, t1: t0 + d / V_CONN, col: COL.direct, a: 0.34, w: 1.1, soft: 2.0, ...FADE });
      const tb = backT();
      back.push({ A: S1, B: O, t0: tb, t1: tb + d / V_BACK, col: COL.direct, a: 0.8, w: 1.8, trail: 6, soft: -2.5 });
    });
    spec.forEach((sp) => {
      const r = byI.get(sp.i), th = tLaunch.get(sp.i), d = len3(sub3(sp.s, r.h));
      conn.push({ A: r.h, B: sp.s, t0: th, t1: th + d / V_CONN, col: COL.specular, a: 0.6, w: 1.3, ...FADE });
      const tb = backT();
      back.push({ A: sp.s, B: r.h, t0: tb, t1: tb + d / V_BACK, col: COL.specular, a: 0.9, w: 1.8, trail: 6 });
      back.push({ A: r.h, B: O, t0: tb + d / V_BACK, t1: tb + (d + r.t) / V_BACK, col: COL.specular, a: 0.9, w: 1.8, trail: 6, soft: -2.5 });
    });
    diff.forEach((c) => {
      const r = byI.get(c.i), th = tLaunch.get(c.i) + 0.1, d = len3(sub3(c.s, r.h));
      conn.push({ A: r.h, B: c.s, t0: th, t1: th + d / V_CONN, col: COL.diffuse, a: 0.4, w: 1.2, dash: 1.4, ...FADE });
      const tb = backT();
      back.push({ A: c.s, B: r.h, t0: tb, t1: tb + d / V_BACK, col: COL.diffuse, a: 0.7, w: 1.6, trail: 5 });
      back.push({ A: r.h, B: O, t0: tb + d / V_BACK, t1: tb + (d + r.t) / V_BACK, col: COL.diffuse, a: 0.7, w: 1.6, trail: 5, soft: -2.5 });
    });
    // the example paths also carry power back
    { const d = len3(sub3(exD, O)), tb = backT(); back.push({ A: exD, B: O, t0: tb, t1: tb + d / V_BACK, col: COL.direct, a: 0.8, w: 1.8, trail: 6, soft: -2.5 }); }
    const scene = C.scene;
    const G = new THREE.Group();
    const bRoof = makeBeams(roof), bLaunch = makeBeams(launch), bConn = makeBeams(conn), bBack = makeBeams(back), bEx = makeBeams(ex);
    const dHit = makeDots(hitDots), dEx = makeDots(exDots);
    for (const b of [bRoof, bLaunch, bConn, bBack, bEx, dHit, dEx]) G.add(b.mesh);
    G.add(duke.mesh);
    S = { C, scene, G, duke, bRoof, bLaunch, bConn, bBack, bEx, dHit, dEx, O, chest, pt, city, byI, exD, exS, exF, rS, rF, exT, cam: new THREE.PerspectiveCamera() };
  },
  async dispose() { if (S) { S = null; await disposeCity(SITE); } },
  draw(tl, t, target, ctx) {
    const { C, scene, G, duke, O, pt, cam } = S;
    let spec = heroCam(tl, O, pt.g);
    if (q.get('cam')) { const v = q.get('cam').split(',').map(Number); spec = { pos: v.slice(0, 3), fwd: norm3(sub3(v.slice(3, 6), v.slice(0, 3))), up: [0, 0, 1], s: sForFov(v[6] || 45), cx: 1280, cy: 720 }; }
    applyCam(cam, spec, ctx.W, ctx.H, 0.1, 3000);
    S.camSpec = spec;
    duke.U.uEye.value.set(...spec.pos);
    duke.U.uLit.value = ease(tl, T.lit, T.lit + 2.2, smooth);
    C.U.uGain.value = 1.3 * (1 - 0.25 * ease(tl, T.launch, T.launch + 2) + 0.2 * ease(tl, T.arrive + 1.5, T.arrive + 4));
    duke.U.uGain.value = 1 - 0.3 * ease(tl, T.lit, T.lit + 2.2);
    for (const b of [S.bRoof, S.bLaunch, S.bConn, S.bBack, S.bEx]) b.update(tl, cam, ctx.W, ctx.H);
    S.dHit.update(tl, ctx.W, ctx.H); S.dEx.update(tl, ctx.W, ctx.H);
    S.bRoof.U.uGain.value = 1 - 0.6 * ease(tl, T.arrive + 1.5, T.arrive + 3.5);
    scene.add(G);                                       // the city scene is shared with the Prague montage shot
    C.U.uNear.value = 22; C.U.uNearZ.value = pt.g + 0.15;
    const r = ctx.renderer;
    r.setRenderTarget(target); r.setClearColor(new THREE.Color(...BG), 1); r.clear();
    r.render(scene, cam);
    scene.remove(G); C.U.uNear.value = 0;
  },
  grade(tl) { return { bloom: 0.6 - 0.42 * ease(tl, T.lit, T.push + 2), threshold: 0.06, vignette: 0.55, motionBlur: 1, shutter: 0.5, exposure: 1.0, fade: ease(tl, 0, 0.6) }; },
  labels(tl, t, ctx) {
    const { O, exD, exS, exF, rS, rF, exT, city } = S;
    const items = [];
    const pa = (a, b) => ease(tl, a, a + 0.6) * (1 - ease(tl, b, b + 0.5));
    // Antennas: the roofline segment nearest the top-right of the opening frame
    if (!S.antAt) {
      const c0 = new THREE.PerspectiveCamera(); applyCam(c0, heroCam(1.5, O, S.pt.g), 1920, 1080, 0.1, 3000);
      let best = -1e9;
      for (const r of city.roof) { const m = mix3(r.slice(0, 3), r.slice(3, 6), 0.5); const v = new THREE.Vector3(...m).project(c0);
        if (v.z > 1 || Math.abs(v.x) > 0.8 || v.y > 0.8 || v.y < 0.1) continue; const sc = -v.x * 0.7 + v.y; if (sc > best) { best = sc; S.antAt = m; } }
    }
    items.push({ kind: 'label', at: S.antAt, off: [70, 80], text: 'Antennas', a: pa(1.3, 8.8), p: ease(tl, 1.3, 2.3, smooth) });
    items.push({ kind: 'label', at: mix3(O, exD, 0.6), off: [90, 40], text: 'Direct', a: pa(exT.D + 0.5, T.launch - 0.1), p: ease(tl, exT.D + 0.5, exT.D + 1.3, smooth) });
    items.push({ kind: 'label', at: rS.h, off: [80, -60], text: 'Specular', a: pa(exT.S + 0.3, T.launch - 0.1), p: ease(tl, exT.S + 0.3, exT.S + 1.1, smooth) });
    items.push({ kind: 'label', at: rF.h, off: [-80, 60], text: 'Diffuse', a: pa(exT.F + 0.4, T.launch - 0.1), p: ease(tl, exT.F + 0.4, exT.F + 1.2, smooth) });
    return { cam: S.cam, items };
  },
};
