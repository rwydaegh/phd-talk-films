// C4: waves add up. One star rippling, two stars interfering, eight stars forming a beam that steers,
// then a powers-of-ten pullback: the stars are the elements of a 5G panel on a Ghent roof at dusk.
import * as THREE from 'three';
import { applyCam, sForFov, lerp, ease, smooth, smoother, mix3, add3, sub3, norm3, len3, slerpDir, clamp } from '../lib/cam.js';
import { Slice } from '../lib/slice.js';
import { Glows } from '../lib/glows.js';
import { buildCity, beamUniforms, PANEL, elemPos, LAM35, KW35, DX, AIM } from '../lib/city.js';
import { mulberry32 } from '../lib/prng.js';

let city, slice, glows, sky, cam, BU, SKY;
const { P, n: N, r: R } = PANEL, Z = [0, 0, 1];
const loc = (a, b, c) => [P[0] + N[0] * a + R[0] * b, P[1] + N[1] * a + R[1] * b, P[2] + c];
const PER = 0.9;                                  // seconds per cycle on screen
export const C4 = { start: 50, dur: 30 };

function steerAz(tl) {
  return 0.5 * Math.sin(2 * Math.PI * (tl - 10.5) / 5.5) * ease(tl, 10.5, 11.5) * (1 - ease(tl, 15.2, 16.4))
    + 0.22 * Math.sin(2 * Math.PI * (tl - 25) / 6) * ease(tl, 25, 26) * (1 - ease(tl, 29, 30));
}
// Up to 16 s the camera looks at the panel centre P with the principal point low in frame (cy), so the sources stay
// on screen at the bottom and the beam rises above them. Then a log-distance pullback reveals the roof.
function camAt(tl) {
  const K = [   // [t, pos, look, cy]
    [0, loc(-0.005, 0.0, 0.36), loc(0, 0, 0), 720],
    [3.5, loc(-0.02, 0.0, 0.44), loc(0, 0, 0), 650],
    [7.5, loc(-0.16, 0.0, 0.78), loc(0, 0, 0), 330],
    [16.5, loc(-0.34, -0.14, 1.02), loc(0, 0, 0), 300],
    [25, loc(36, -62, 58), loc(41, 0, -10), 720],
    [30, loc(43, -58, 52), loc(44, 0, -11), 720],
  ];
  let i = 0; while (i < K.length - 2 && tl >= K[i + 1][0]) i++;
  const [t0, p0, l0, c0] = K[i], [t1, p1, l1, c1] = K[i + 1];
  const u = ease(tl, t0, t1, smooth);
  let pos, look;
  if (i === 3) {
    const d0 = len3(sub3(p0, P)), d1 = len3(sub3(p1, P));
    const dir = slerpDir(norm3(sub3(p0, P)), norm3(sub3(p1, P)), smooth(u));
    pos = add3(P, dir, Math.exp(lerp(Math.log(d0), Math.log(d1), smooth(u))));
    look = mix3(l0, l1, Math.pow(smooth(u), 1.6));
  } else { pos = mix3(p0, p1, u); look = mix3(l0, l1, u); }
  const fwd = norm3(sub3(look, pos));
  const up = slerpDir(N, Z, ease(tl, 16.5, 24));
  const fov = lerp(42, 36, ease(tl, 16.5, 25));
  return { pos, fwd, up, s: sForFov(fov), cx: 1280, cy: lerp(c0, c1, u) };
}
// star layout over time: [m along r (in DX), l (row), weight]
function stars(tl) {
  const out = [];
  const two = ease(tl, 2.8, 4.2), eight = (m) => ease(tl, 6.6 + 0.2 * Math.abs(m - 3.5), 7.2 + 0.2 * Math.abs(m - 3.5));
  // star A splits from the centre into the two at m = 1.5 and 5.5
  out.push({ m: lerp(3.5, 1.5, two), l: 3.5, w: 1 });
  if (two > 0) out.push({ m: lerp(3.5, 5.5, two), l: 3.5, w: two });
  for (const m of [0, 1, 2, 3, 4, 5, 6, 7]) { if (m === 1 || m === 5) continue; const w = eight(m); if (w > 0) out.push({ m: m + (m < 3.5 ? 0.5 : -0.5) * (1 - w) * 0, l: 3.5, w }); }
  // m=1.5 -> 1 and 5.5 -> 5 so the row lands on the grid
  const snap = ease(tl, 6.6, 7.6);
  out[0].m = lerp(out[0].m, 1, snap); if (out[1]) out[1].m = lerp(out[1].m, 5, snap);
  return out;
}
export default {
  async init(ctx) {
    BU = beamUniforms();
    city = await buildCity(ctx.renderer, BU);
    slice = new Slice(); glows = new Glows(800, ctx.W, ctx.H);
    city.scene.add(slice.mesh, glows.mesh);
    cam = new THREE.PerspectiveCamera();
    const rnd = mulberry32(4242); SKY = [];
    for (let i = 0; i < 420; i++) { const z = rnd() * 1.1 - 0.15, a = rnd() * 2 * Math.PI, q = Math.sqrt(1 - z * z);
      SKY.push({ d: [q * Math.cos(a), q * Math.sin(a), z], s: 2.2 + 4 * Math.pow(rnd(), 3), b: 0.15 + 0.6 * Math.pow(rnd(), 2) }); }
  },
  draw(tl, t, target, ctx) {
    const spec = camAt(tl);
    const camD = len3(sub3(spec.pos, P));
    applyCam(cam, spec, ctx.W, ctx.H, Math.max(0.004, camD * 0.004), 5000);
    const wt = 2 * Math.PI * tl / PER;
    const az = steerAz(tl), el = PANEL.el * ease(tl, 17.5, 23);
    const st = stars(tl);
    const srcs = st.map((s) => { const p = elemPos(s.m, s.l); const x = (s.m - 3.5) * DX; return { p, a: s.w, ph: -KW35 * x * az, m: s.m }; });
    const sumA = srcs.reduce((a, s) => a + s.a, 0);
    const sliceOn = 1 - ease(tl, 17.8, 20.6);
    const r1 = Math.exp(lerp(Math.log(0.45), Math.log(9), ease(tl, 0, 19, smooth)));
    slice.update({ c: P, n: Z, srcs, k: KW35, wt, norm: 9 * Math.sqrt(sumA) * Math.sqrt(1 + 0.15 * sumA), range: 30, inst: 1,
      gain: 0.9 * sliceOn * ease(tl, 0, 0.6), r0: r1 * 0.55, r1, fwd: ease(tl, 16.5, 19.5), fwdDir: N, back: 1 });
    // stars: the card's profile, flashing at their own phase (the flash order is the steering)
    glows.begin();
    const pix = (p) => Math.max(1, len3(sub3(p, spec.pos)));
    const sizeAt = (p, k) => clamp(k * 1.1 / Math.max(0.05, len3(sub3(p, spec.pos))), 4, 90);
    const flash = (ph) => Math.pow(0.5 + 0.5 * Math.cos(wt + ph), 8);
    for (const s of srcs) glows.add(s.p, sizeAt(s.p, 30) * (0.6 + 0.4 * s.a), [1, 0.93, 0.82, (0.9 + 1.6 * flash(s.ph)) * s.a * (1 - 0.6 * ease(tl, 22, 25))]);
    // the full 8x8 panel fills in from the row
    for (let l = 0; l < 8; l++) for (let m = 0; m < 8; m++) {
      if (l === 3) continue;
      const w = ease(tl, 16.2 + 0.18 * Math.abs(l - 3), 17.0 + 0.18 * Math.abs(l - 3));
      if (w <= 0) continue;
      const p = elemPos(m, l + 0.5 - (l > 3 ? 0 : 0));
      const ph = -KW35 * (m - 3.5) * DX * az;
      glows.add(elemPos(m, l), sizeAt(p, 30) * (0.6 + 0.4 * w), [1, 0.93, 0.82, (0.9 + 1.6 * flash(ph)) * w * (1 - 0.6 * ease(tl, 22, 25))]);
    }
    { const b = ease(tl, 21, 24.5); if (b > 0) glows.add(add3(P, N, 0.05), 16 * b, [1, 0.9, 0.75, 1.4 * b]); }
    const skyB = 1 - 0.65 * ease(tl, 17.5, 23);
    for (const s of SKY) { if (s.d[2] < 0.02 && tl > 17.5) continue; glows.add(add3(spec.pos, s.d, 2500), s.s, [0.85, 0.9, 1, s.b * skyB * 0.5]); }
    glows.end();
    city.uCity.value = ease(tl, 17.5, 23);
    city.tiles.visible = city.ground.visible = city.uCity.value > 1e-3;
    city.panel.visible = ease(tl, 18.6, 21.2) > 1e-3;
    city.uPanel.value = ease(tl, 18.6, 21.2);
    city.uFoot.value = ease(tl, 20.5, 25);
    BU.uSteer.value.set(az, el);
    { const ce = Math.sqrt(Math.max(0, 1 - az * az - el * el)); const ax = norm3(add3(add3(N.map((x) => x * ce), R, az), Z, el)); city.beamU.uAxis.value.set(...ax); }
    city.beamU.uEye.value.copy(cam.position);
    city.beamU.uGain.value = 0.03 * ease(tl, 17.5, 22.5);
    city.beamU.uWt.value = wt * 0.18;
    city.beamU.uJetMix.value = 0.0;
    city.beam.visible = city.beamU.uGain.value > 1e-3;
    const r = ctx.renderer;
    r.setRenderTarget(target); r.setClearColor(0, 1); r.clear();
    r.render(city.scene, cam);
  },
  grade(tl) {
    const inF = 1 - ease(tl, 0, 0.1, (x) => x);
    return { bloom: 0.75, threshold: 0.06, vignette: 0.7, motionBlur: 1, flash: 1.1 * inF, zoomBlur: 0.25 * inF, shutter: 0.5 };
  },
  labels(tl) {
    const wt = 2 * Math.PI * tl / PER, az = steerAz(tl), items = [];
    const lab = (t0, t1) => ({ p: ease(tl, t0, t0 + 0.9, smooth), a: 1 - ease(tl, t1, t1 + 0.6) });
    // one antenna, then the label splits with the star: two antennas, two labels
    const st = stars(tl), two = ease(tl, 2.8, 4.2);
    items.push({ kind: 'label', at: elemPos(st[0].m, 3.5), off: [lerp(150, -150, two), -110], text: 'Antenna', size: 40, ...lab(0.8, 6.0) });
    if (st[1]) items.push({ kind: 'label', at: elemPos(st[1].m, 3.5), off: [150, -110], text: 'Antenna', size: 40, p: ease(tl, 3.2, 4.1, smooth), a: 1 - ease(tl, 6.0, 6.6) });
    items.push({ kind: 'label', at: add3(P, N, 0.55), off: [170, -40], text: 'Beam', size: 40, ...lab(8.2, 10.4) });
    // phase dials under the row: the hand is up when that antenna flashes
    const ph = ease(tl, 8.8, 9.6) * (1 - ease(tl, 16.0, 16.8));
    if (ph > 0) for (const s of stars(tl)) {
      const x = (s.m - 3.5) * DX;
      items.push({ kind: 'phasor', at: add3(elemPos(s.m, 3.5), N, -0.045), r: 36, ang: -(wt - KW35 * x * az), a: ph * s.w });
    }
    if (ph > 0) items.push({ kind: 'label', at: add3(elemPos(0, 3.5), N, -0.045 - 0.016), off: [-110, 90], text: 'Phase', size: 40, p: ease(tl, 10.0, 10.9, smooth), a: ph * (1 - ease(tl, 15.4, 16.0)) });
    items.push({ kind: 'label', at: add3(P, Z, 0.25), off: [-170, -130], text: '5G Antenna', size: 40, ...lab(22.2, 28.6) });
    return { cam, items };
  },
};
