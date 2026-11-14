// One city of the montage (module URL ?c=<site>&d=<duration>): the square at dusk, the thesis route drawn on the ground,
// the pedestrian at every route point in turn (chronophotograph), and the city's name.
import * as THREE from 'three';
import { applyCam, sForFov, lerp, ease, smooth, smoother, add3, sub3, norm3 } from '../lib/cam.js';
import { cityData, loadCity, routeFrame, BG, disposeCity } from '../lib/city.js';
import { makeWalk } from '../lib/walk.js';

const QS = new URL(import.meta.url).searchParams;
const SITE = QS.get('c'), DUR = +(QS.get('d') || 2.6);
const K = Math.min(1, DUR / 2.6);   // short montage shots run their animation and label on a compressed clock
const q = new URLSearchParams(location.search);

// Display names and per-city framing: az = camera bearing from the route centre (deg from north),
// el = elevation (deg), span = metres of ground that fill the frame width, rot = slow orbit (deg over the shot).
export const LOOK = {
  brussels_grandplace: { name: 'Brussels', az: 257, el: 55, span: 85, rot: 6 },
  korenmarkt: { name: 'Ghent', az: 300, el: 55, span: 85, rot: -6, gain: 1.15 },
  krakow_rynek: { name: 'Krakow', az: 292, el: 34, span: 145, rot: 6 },
  london_trafalgar: { name: 'London', az: 310, el: 34, span: 140, rot: -6 },
  madrid_plazamayor: { name: 'Madrid', az: 219, el: 34, span: 85, rot: 6 },
  mexico_zocalo: { name: 'Mexico City', az: 0, el: 65, span: 100, rot: -6, gain: 0.55, knee: 12 },
  milan_duomo: { name: 'Milan', az: 237, el: 34, span: 155, rot: 6 },
  prague_staromestske: { name: 'Prague', az: 119, el: 34, span: 135, rot: -6 },
  tokyo_hachiko: { name: 'Tokyo', az: 136, el: 34, span: 95, rot: 6 },
  toulouse_capitole: { name: 'Toulouse', az: 267, el: 34, span: 105, rot: -6 },
};

let S = null;

export function cityCam(city, look, u) {
  const { c } = routeFrame(city);
  const P = city.points.map((p) => p.p);
  const az = (look.az + look.rot * (u - 0.5)) * Math.PI / 180, el = look.el * Math.PI / 180;
  const fov = 34, hfov = 2 * Math.atan(Math.tan(fov * Math.PI / 360) * 16 / 9);
  const span = look.span * (1 - (0.06 + 0.12 * (1 - K)) * u);
  const dist = span / 2 / Math.tan(hfov / 2);
  const tgt = add3(c, [0, 0, 2 + (look.dz || 0)]);
  const pos = [tgt[0] + Math.sin(az) * Math.cos(el) * dist, tgt[1] + Math.cos(az) * Math.cos(el) * dist, tgt[2] + Math.sin(el) * dist];
  return { pos, fwd: norm3(sub3(tgt, pos)), up: [0, 0, 1], s: sForFov(fov), cx: 1280, cy: 720 };
}

export default {
  async init(ctx) {
    const D = await cityData();
    const city = D.cities.find((c) => c.site === SITE);
    const k0 = D.cities.slice(0, D.cities.indexOf(city)).reduce((s, c) => s + c.points.length, 0);
    const C = await loadCity(city, { r0: 110, r1: 210 });
    const n = city.points.length;
    const fast = DUR < 1.9, t0 = fast ? 0.06 * DUR : 0.25;
    const walk = await makeWalk(city, k0, { t0, rate: n / (fast ? Math.max(0.2, 0.6 * DUR) : DUR - 0.9), dotR: 9, keep: true });
    const look = { ...LOOK[SITE] };
    for (const e of (q.get('look') || '').split(';')) { const [k, v] = e.split(':'); if (k === SITE) { const n = v.split(',').map(Number); Object.assign(look, { az: n[0], el: n[1], span: n[2] }); } }
    S = { C, city, walk, look, cam: new THREE.PerspectiveCamera() };
  },
  async dispose() { if (S) { await disposeCity(SITE); S = null; } },
  draw(tl, t, target, ctx) {
    const { C, city, walk, look, cam } = S;
    let spec = cityCam(city, look, tl / DUR);
    if (q.get('cam')) { const v = q.get('cam').split(',').map(Number); spec = { pos: v.slice(0, 3), fwd: norm3(sub3(v.slice(3, 6), v.slice(0, 3))), up: [0, 0, 1], s: sForFov(v[6] || 45), cx: 1280, cy: 720 }; }
    applyCam(cam, spec, ctx.W, ctx.H, 0.5, 4000);
    C.scene.add(walk.group);
    C.U.uGain.value = look.gain ?? 1.45; C.U.uKnee.value = look.knee ?? 0;
    walk.update(tl, cam, ctx.W, ctx.H);
    const r = ctx.renderer;
    r.setRenderTarget(target); r.setClearColor(new THREE.Color(...BG), 1); r.clear();
    r.render(C.scene, cam);
    C.scene.remove(walk.group); C.U.uKnee.value = 0;
  },
  grade(tl) { return { bloom: 0.5, threshold: 0.06, vignette: 0.55, motionBlur: 1, shutter: 0.5 }; },
  labels(tl) {
    const { city, look } = S;
    const P = city.points, pm = P[Math.floor(P.length / 2)], at = [pm.p[0], pm.p[1], pm.g + 0.2];
    if (!S.off) {   // the diagonal whose text stays in frame and farthest from the route, decided once per shot
      const sc = (p) => { const v = new THREE.Vector3(...p).project(S.cam); return [(v.x + 1) * 1280, (1 - v.y) * 720]; };
      const A = sc(at), R = P.map((p) => sc([p.p[0], p.p[1], p.g]));
      let best = -1e9;
      for (const o of [[110, -90], [-110, -90], [110, 90], [-110, 90]]) {
        const w = 40 * 0.62 * look.name.length, cx = A[0] + o[0] + Math.sign(o[0]) * (12 + w / 2), cy = A[1] + o[1];
        let d = 1e9; for (const r of R) d = Math.min(d, Math.hypot(Math.max(0, Math.abs(r[0] - cx) - w / 2), r[1] - cy));
        const inside = cx - w / 2 > 60 && cx + w / 2 < 2500 && cy > 60 && cy < 1380;
        const score = Math.min(d, 200) + (inside ? 0 : -1000) + (o[1] < 0 ? 5 : 0);
        if (score > best) { best = score; S.off = o; }
      }
    }
    return { cam: S.cam, items: [{ kind: 'label', at, off: S.off, text: look.name, size: 40, a: ease(tl, 0.1 * K, 0.5 * K) * (1 - ease(tl, DUR - 0.25 * K, DUR)), p: ease(tl, 0.1 * K, 0.8 * K, smooth) }] };
  },
};
