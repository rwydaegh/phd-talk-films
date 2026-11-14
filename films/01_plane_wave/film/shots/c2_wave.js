// C2: bullet time at the comet head. The comet's glow condenses into the textbook E/H wave, labelled E, H, c and λ;
// then the wave stretches and squeezes (λ and f readout) before C3 turns the crests into sheets.
import * as THREE from 'three';
import { Card3D, loadCardData, cardState, FILM_AIR, FILM_HAZE } from '../lib/card3d.js';
import { applyCam, sForFov, lerp, ease, smooth, smoother, mix3, add3, sub3, norm3, cross3, len3 } from '../lib/cam.js';
import { cardClock, cometAt, LAUNCH } from '../lib/story.js';
import { c1Camera } from './c1_stars.js';
import { Blur } from '../lib/blur.js';
import { TextbookWave, studioEnv } from '../lib/wave.js';

let card, back, cam, D, blur, wave, front, focus0, C1END = 22, last = null;
export const C2 = { start: 22, dur: 18 };
const L0 = 0.21, V = 0.03 / 4.5;
// wavelength over the shot: 3 cm, stretch to 6 cm, squeeze to 1.5 cm, back to 3 cm for the sheets
export function lamAt(tl) {
  const l = Math.log;
  return Math.exp(l(0.03) + (l(0.06) - l(0.03)) * ease(tl, 10.2, 12.0) + (l(0.015) - l(0.06)) * ease(tl, 12.6, 14.8) + (l(0.03) - l(0.015)) * ease(tl, 15.6, 17.4));
}
const PH = [];
function phaseAt(tl) {
  const i = Math.max(0, Math.floor(tl * 240));
  while (PH.length <= i + 1) { const n = PH.length; PH.push((n ? PH[n - 1] : 0) + 2 * Math.PI * V / lamAt(n / 240) / 240); }
  return PH[i] + (PH[i + 1] - PH[i]) * (tl * 240 - i);
}
// phase handed to the wave: crests scale about the packet centre when lambda changes
export const c2Phase = (tl) => phaseAt(tl) - 2 * Math.PI / lamAt(tl) * L0 / 2;
// the crest the labels ride on: 4.5 cm ahead of the centre at tl 7, then carried along by the wave
let MLAB = null;
function crestS(tl, dm = 0) {
  if (MLAB === null) MLAB = Math.round((-phaseAt(7) - 2 * Math.PI / lamAt(7) * 0.045) / (2 * Math.PI));
  return L0 / 2 - (phaseAt(tl) + 2 * Math.PI * (MLAB + dm)) * lamAt(tl) / (2 * Math.PI);
}
const rotAbout = (v, ax, a) => { const c = Math.cos(a), s = Math.sin(a), d = v[0] * ax[0] + v[1] * ax[1] + v[2] * ax[2], x = cross3(ax, v);
  return [v[0] * c + x[0] * s + ax[0] * d * (1 - c), v[1] * c + x[1] * s + ax[1] * d * (1 - c), v[2] * c + x[2] * s + ax[2] * d * (1 - c)]; };
export function c2Frame(tl, f0 = focus0) {
  const t = C1END + tl, comet = cometAt(t, f0);
  const side = norm3(cross3(comet.dir, [0, 0, 1])), upv = norm3(cross3(side, comet.dir));
  const end = c1Camera(C1END, cometAt(C1END, f0));
  let off = sub3(end.pos, comet.head);
  // orbit: yaw about the wave's up axis, then a gentle rise; distance breathes in
  off = rotAbout(off, comet.dir, -0.62 * ease(tl, 0.5, 6));
  const yaw = -95 * Math.PI / 180 * ease(tl, 1.5, 18, (x) => x * x * (3 - 2 * x));
  off = rotAbout(off, upv, yaw);
  off = rotAbout(off, side, 0.18 * Math.sin(Math.PI * ease(tl, 2, 18)));
  const dist = lerp(1, 1.3, ease(tl, 0, 6)) * (1 + 0.25 * ease(tl, 10, 12.5) - 0.25 * ease(tl, 14, 17));
  const pos = add3(comet.head, off.map((x) => x * dist));
  const look = add3(comet.head, comet.dir, -0.105 * ease(tl, 0, 6));
  return { comet, side, upv, cam: { pos, fwd: norm3(sub3(look, pos)), up: upv, s: sForFov(30), cx: 1280, cy: 720 } };
}
export default {
  async init(ctx) {
    D = await loadCardData();
    card = new Card3D(D, ctx.W, ctx.H);
    back = new THREE.Scene(); back.add(card.group);
    cam = new THREE.PerspectiveCamera();
    blur = new Blur(ctx.W, ctx.H);
    wave = new TextbookWave(studioEnv(ctx.renderer));
    front = new THREE.Scene(); front.add(wave.group);
    focus0 = cardState(D, cardClock(LAUNCH)).focus;
  },
  draw(tl, t, target, ctx) {
    const F = c2Frame(tl);
    applyCam(cam, F.cam, ctx.W, ctx.H, 0.002, 100);
    const r = ctx.renderer;
    const bg = 1 - ease(tl, 4, 8);
    card.update({ tc: cardClock(t), cam, air: FILM_AIR, haze: FILM_HAZE, starSize: new Array(120).fill(2.2), starGain: 0.7 * bg, streakGain: bg, field: 1, opacity: bg,
      extraLines: tl < 4 ? [{ a: add3(F.comet.head, F.comet.dir, -0.45), b: F.comet.head, width: 3.2, color: [1, 0.96, 0.9, 2.2 * (1 - ease(tl, 0.5, 3.5))], decay: 0.12 }] : [],
      extraStars: tl < 4 ? [{ p: F.comet.head, size: 22, color: [1, 0.97, 0.92, 2.5 * (1 - ease(tl, 0.5, 3))] }] : [] });
    blur.layer(r, (rt) => { r.setRenderTarget(rt); r.setClearColor(0, 1); r.clear(); r.render(back, cam); }, lerp(2, 26, ease(tl, 0, 3)), target);
    const phase = c2Phase(tl), lambda = lamAt(tl);
    const W = wave.update({ o: F.comet.head, k: F.comet.dir, e: F.upv, phase, reveal: ease(tl, 0.6, 4.5, smooth), cam, ampScale: ease(tl, 0.3, 3.5), lambda, L: L0 });
    last = { F, W, phase, lambda, tl };
    r.setRenderTarget(target); r.clearDepth(); r.render(front, cam);
  },
  grade() { return { bloom: 0.8, threshold: 0.08, vignette: 0.7 }; },
  labels(tl) {
    if (!last) return null;
    const { F, W, phase, lambda } = last, o = F.comet.head, k = F.comet.dir, e = W.e, h = W.h;
    const pt = (s, dir, v) => add3(add3(o, k, -s), dir, v);
    const s1 = crestS(tl), s2 = crestS(tl, 1);
    const tip = (sv, dir, sc) => pt(sv, dir, W.amp * sc * W.win(sv) * Math.cos(-W.kw * sv - phase));
    const out = ease(tl, 16.6, 17.6, smooth);
    const lab = (t0, t1 = 99) => ({ p: ease(tl, t0, t0 + 0.9, smooth), a: (1 - out) * (1 - ease(tl, t1, t1 + 0.6)) });
    const f = 0.299792458 / lambda;
    const items = [
      { kind: 'label', at: tip(s1, e, 1), off: [70, -80], text: [['E', 'math']], size: 50, ...lab(4.2, 9.4) },
      { kind: 'label', at: tip(s1, h, 0.82), off: [80, 60], text: [['H', 'math']], size: 50, ...lab(4.8, 9.4) },
      { kind: 'arrow', from: add3(o, k, 0.006), to: add3(o, k, 0.04), text: [['c', 'math']], off: [10, -34], size: 50, ...lab(5.6) },
      { kind: 'bracket', from: add3(tip(s1, e, 1), e, 0.0035), to: add3(tip(s2, e, 1), e, 0.0035), side: 18, textGap: 40, text: [['λ', 'math']], size: 54,
        p: ease(tl, 7.0, 8.0, smooth), a: 1 - out },
      { kind: 'label', at: add3(pt(L0 * 0.75, e, 0), e, -W.amp * 1.25), off: [-60, 70], text: [['f', 'math'], ['  =  ' + Math.round(f) + ' GHz', 'main']], size: 44,
        p: ease(tl, 9.6, 10.4, smooth), a: 1 - out },
    ];
    return { cam, items };
  },
};
