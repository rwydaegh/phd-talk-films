// C1: the card, alive; dolly zoom into the starfield; the hero star fires; whip and speed ramp into bullet time.
import * as THREE from 'three';
import { Card3D, loadCardData, cardState, CARD_AIR, CARD_HAZE, FILM_AIR, FILM_HAZE } from '../lib/card3d.js';
import { applyCam, CARD, sForFov, lerp, ease, smooth, smoother, mix3, add3, sub3, norm3, cross3, len3, slerpDir, spline } from '../lib/cam.js';
import { HERO, ANT11, TARGET, U, axisPos, cardClock, rate, LAUNCH, RAMP0, RAMP1, cometAt } from '../lib/story.js';

let card, scene, cam, D, focusAtLaunch;
const S0 = CARD.s;
export function c1Camera(t, comet) {
  // 0-4 card; 4-12 dolly zoom (child constant size) 9 m -> 3.1 m; 12-15 widen and drift; 15.2 launch; 15.6-16.4 whip to the side; 16-19.5 catch up.
  const u = ease(t, 4, 12.5);
  const d = lerp(9, 3.1, u);
  let pos = axisPos(d), s = S0 * d / 9;
  const w = ease(t, 10.5, 15);
  s = lerp(s, sForFov(34), w * w);
  // gentle arc: rotate the camera about the vertical through the target
  const az = (-10 * ease(t, 4, 15) + 4 * ease(t, 11, 15)) * Math.PI / 180;
  const rot = (p) => { const x = p[0] - TARGET[0], y = p[1] - TARGET[1]; return [TARGET[0] + x * Math.cos(az) - y * Math.sin(az), TARGET[1] + x * Math.sin(az) + y * Math.cos(az), p[2]]; };
  pos = rot(pos);
  let look = TARGET;
  // look slowly towards the hero star before it fires
  const lk = ease(t, 11, 15);
  look = mix3(TARGET, mix3(TARGET, ANT11, 0.55), lk);
  let cx = lerp(CARD.cx, 1280, ease(t, 5, 13)), cy = lerp(CARD.cy, 720, ease(t, 5, 13));
  let fwd = norm3(sub3(look, pos)), up = [0, 0, 1], roll = 0;
  if (comet && t > 15.0) {
    // chase: side-on, slightly behind and above the head, closing in; whip = fast swing of the look direction
    const side = norm3(cross3(comet.dir, [0, 0, 1]));
    const upv = norm3(cross3(side, comet.dir));
    const c = ease(t, 15.6, 20.5, smoother);
    const offEnd = add3(add3(side.map((x) => x * 0.16), upv, 0.035), comet.dir, -0.05);
    const off0 = sub3(pos, comet.head);
    const p2 = add3(comet.head, mix3(off0, offEnd, c));
    const wh = ease(t, 15.2, 18.2, smoother);
    pos = mix3(pos, p2, wh);
    const lookC = add3(comet.head, comet.dir, 0.02);
    fwd = slerpDir(fwd, norm3(sub3(lookC, pos)), ease(t, 15.0, 17.4, smoother));
    s = lerp(s, sForFov(lerp(34, 30, c)), wh);
    cx = lerp(cx, 1280, wh); cy = lerp(cy, 720, wh);
    roll = 0;
  }
  return { pos, fwd, up, s, cx, cy, roll };
}

export default {
  async init(ctx) {
    D = await loadCardData();
    card = new Card3D(D, ctx.W, ctx.H);
    scene = new THREE.Scene(); scene.add(card.group);
    cam = new THREE.PerspectiveCamera();
    focusAtLaunch = cardState(D, cardClock(LAUNCH)).focus;
  },
  draw(tl, t, target, ctx) {
    const tc = cardClock(tl);
    const comet = cometAt(tl, focusAtLaunch);
    applyCam(cam, c1Camera(tl, comet), ctx.W, ctx.H, 0.005, 100);
    const g = ease(tl, 4, 12);
    const boost = new Float32Array(120);
    // hero swells before firing and flares at launch
    const sw = ease(tl, 13.0, LAUNCH, smooth) * (1 - ease(tl, LAUNCH, LAUNCH + 1.5));
    boost[HERO] = 3.0 * sw + 6 * Math.exp(-Math.abs(tl - LAUNCH) * 4);
    const lines = [], extra = [];
    if (comet) {
      const tail = Math.min(comet.s, 0.45);
      lines.push({ a: add3(comet.head, comet.dir, -tail), b: comet.head, width: 3.2, color: [1, 0.96, 0.9, 2.2], decay: 0.12 });
      extra.push({ p: comet.head, size: 22, color: [1, 0.97, 0.92, 2.5] });
    }
    card.update({ tc, cam, air: mix3(CARD_AIR, FILM_AIR, g), haze: mix3(CARD_HAZE, FILM_HAZE, g), starBoost: boost, extraLines: lines, extraStars: extra });
    const r = ctx.renderer;
    r.setRenderTarget(target); r.setClearColor(0x000000, 1); r.clear();
    r.render(scene, cam);
  },
  grade(tl) {
    const whip = 0;
    return { bloom: 0.55 + 0.25 * ease(tl, 4, 12), motionBlur: tl > 4 ? 1 : 0, shutter: 0.5 + 1.5 * whip, ca: 0.004 * whip, zoomBlur: 0.0 };
  },
};
