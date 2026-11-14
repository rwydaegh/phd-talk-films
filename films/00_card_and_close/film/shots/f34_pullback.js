// F34: the closing film. Close on the child's skin where the comets arrive, then one slow pull-back that lands exactly on
// the invitation card framing, which holds. It mirrors C1 (card -> into the starfield) in reverse.
// The card clock runs at real time and is phased so the hold is the pre-show loop, frame for frame (grain included):
// film frame i shows card frame (i + 421) mod 720, so the last frame (i = 1019) is the loop's frame 0, which is film 1's frame 0.
import * as THREE from 'three';
import { Card3D, loadCardData, cardState, CARD_AIR, CARD_HAZE, FILM_AIR, FILM_HAZE } from '../lib/card3d.js';
import { applyCam, CARD, sForFov, lerp, ease, smooth, spline, mix3, add3, norm3, sub3 } from '../lib/cam.js';
import { TARGET, U } from '../lib/story.js';
import { c1Camera } from './c1_stars.js';

export const FPS = 30, LOOP = 720, LEN = 34;            // film length (s); must match timeline.js
export const F0 = 2 * LOOP - (LEN * FPS - 1);          // card frame shown at film frame 0 (421): the last frame is card frame 0
export const PULL0 = 0.5, PULL1 = 21.0;                 // pull-back window (s); the hold follows
const D0 = 0.42, FOV0 = 34, AZ0 = -14, EL0 = 6;         // start: 42 cm from the skin, wide lens, slightly off the card axis
const S0 = CARD.s, D1 = 9;

let card, scene, cam, D, LOOK0;
const cardTime = (t) => t + F0 / FPS;
export const settled = (t) => t >= PULL1;

// Camera for film time t. Three keys on one Catmull-Rom path (log distance, log focal length, swing, tilt, principal point),
// walked by one smooth ease: close on the skin -> wide among all 120 stars (C1 at 14 s, mirrored) -> the card (C1 at 0 s).
const KEYS = () => [
  [Math.log(D0), Math.log(sForFov(FOV0)), AZ0, EL0, 1280, 720],
  [Math.log(3.1), Math.log(sForFov(FOV0)), AZ0 * 0.6, EL0 * 0.5, 1280, 720],
  [Math.log(D1), Math.log(S0), 0, 0, CARD.cx, CARD.cy],
];
let keys = null;
export function f34Camera(t) {
  if (settled(t)) return c1Camera(0, null);
  keys = keys || KEYS();
  const e = ease(t, PULL0, PULL1, smooth);
  const [ld, ls, azd, eld, cx, cy] = spline(keys, e);
  const d = Math.exp(ld), s = Math.exp(ls);
  // look point: where the comets arrive when the film starts (fixed, so the skin never drifts into the lens), then the card target
  const L = mix3(LOOK0, TARGET, smooth(Math.min(1, e * 2)));
  // direction from the look point: the card axis, swung by az/el that unwind to zero
  const az = azd * Math.PI / 180, el = eld * Math.PI / 180;
  const ux = U[0] * Math.cos(az) - U[1] * Math.sin(az), uy = U[0] * Math.sin(az) + U[1] * Math.cos(az);
  const h = Math.hypot(ux, uy), ez = Math.atan2(U[2], h) + el;
  const dir = [ux / h * Math.cos(ez), uy / h * Math.cos(ez), Math.sin(ez)];
  const pos = add3(L, dir, d);
  return { pos, fwd: norm3(sub3(L, pos)), up: [0, 0, 1], s, cx, cy, roll: 0 };
}

// Stars the camera flies past would flash up as big discs; shrink them away inside about a metre.
const sizes = new Float32Array(120);
function nearFade(c) {
  for (let i = 0; i < 120; i++) {
    const a = D.ants[i], r = Math.hypot(a[0] - c.position.x, a[1] - c.position.y, a[2] - c.position.z);
    sizes[i] = smooth((r - 0.35) / 0.75);
  }
  return sizes;
}

export default {
  async init(ctx) {
    D = await loadCardData();
    LOOK0 = cardState(D, cardTime(0)).focus;
    card = new Card3D(D, ctx.W, ctx.H);
    scene = new THREE.Scene(); scene.add(card.group);
    cam = new THREE.PerspectiveCamera();
  },
  draw(tl, t, target, ctx) {
    const hold = settled(tl);
    // in the hold, snap to whole card frames so it is bit-identical to the loop
    const tc = hold ? (Math.round(tl * FPS) + F0) / FPS : cardTime(tl);
    applyCam(cam, f34Camera(tl), ctx.W, ctx.H, 0.005, 100);
    const g = hold ? 0 : 1 - ease(tl, PULL0, PULL1, smooth);
    card.update({ tc, cam, air: hold ? CARD_AIR : mix3(CARD_AIR, FILM_AIR, g), haze: hold ? CARD_HAZE : mix3(CARD_HAZE, FILM_HAZE, g),
      starBoost: new Float32Array(120), extraLines: [], extraStars: [], starSize: hold ? undefined : nearFade(cam) });
    const r = ctx.renderer;
    r.setRenderTarget(target); r.setClearColor(0x000000, 1); r.clear();
    r.render(scene, cam);
  },
  grade(tl) {
    const hold = settled(tl);
    const g = hold ? 0 : 1 - ease(tl, PULL0, PULL1, smooth);
    const frame = ((Math.round(tl * FPS) + F0) % LOOP + LOOP) % LOOP;
    return { bloom: 0.55 + 0.08 * g, motionBlur: hold ? 0 : 1, shutter: 0.5, ca: 0, zoomBlur: 0, grainT: hold ? frame / FPS : undefined };
  },
};
