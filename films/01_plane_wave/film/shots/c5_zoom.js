// C5a: back in the card's world. The camera tilts up from the floor to the child, then three snap zooms land on the skin
// of the neck, where the card's comets arrive; the last push goes into the skin and cuts to the cross-section.
import * as THREE from 'three';
import { Card3D, loadCardData, cardState, FILM_AIR, FILM_HAZE } from '../lib/card3d.js';
import { applyCam, sForFov, lerp, ease, smooth, smoother, mix3, add3, sub3, norm3, slerpDir } from '../lib/cam.js';
import { TARGET, U } from '../lib/story.js';

let card, scene, cam, D, F, NF;
export const C5A = { start: 80, dur: 8 };
const TC0 = 180;
// three punches: [start, distance after]
const PUNCH = [[2.7, 1.15], [4.15, 0.42], [5.6, 0.14]];
const PD = 0.32;
function distAt(tl) {
  let l = Math.log(3.3);
  let prev = 3.3;
  for (const [t0, d] of PUNCH) { l += (Math.log(d) - Math.log(prev)) * ease(tl, t0, t0 + PD, (x) => 1 - Math.pow(1 - x, 3)); prev = d; }
  l += (Math.log(0.03) - Math.log(0.14)) * ease(tl, 7.3, 8, (x) => x * x * x);
  return Math.exp(l) * (1 - 0.04 * ease(tl, 0, 2.7));
}
function camAt(tl) {
  const d = distAt(tl);
  const k = ease(tl, 2.7, 5.9, smooth);                        // from the card axis over to the neck's normal
  const dir = slerpDir(U, NF, k);
  const tgt = mix3(TARGET, F, ease(tl, 2.6, 4.5, smoother));
  const pos = add3(add3(tgt, dir, d), [0, 0, 1], -0.35 * (1 - ease(tl, 0, 2.6, smoother)));
  // the tilt: the camera starts looking down at the floor in front of the child
  const tilt = 1 - ease(tl, 0.1, 2.6, smoother);
  const look = add3(tgt, [0, 0, 1], -0.95 * tilt);
  return { pos, fwd: norm3(sub3(look, pos)), up: [0, 0, 1], s: sForFov(lerp(38, 30, ease(tl, 2.7, 6))), cx: 1280, cy: 720, d };
}
export default {
  async init(ctx) {
    D = await loadCardData();
    card = new Card3D(D, ctx.W, ctx.H);
    scene = new THREE.Scene(); scene.add(card.group);
    cam = new THREE.PerspectiveCamera();
    const f = cardState(D, TC0 + 5.6).focus;
    let best = 1e9, bi = 0;
    for (let i = 0; i < D.V; i++) { const dx = D.pos[3 * i] - f[0], dy = D.pos[3 * i + 1] - f[1], dz = D.pos[3 * i + 2] - f[2], q = dx * dx + dy * dy + dz * dz; if (q < best) { best = q; bi = i; } }
    F = [D.pos[3 * bi], D.pos[3 * bi + 1], D.pos[3 * bi + 2]];
    NF = norm3(add3(norm3([D.nrm[3 * bi], D.nrm[3 * bi + 1], D.nrm[3 * bi + 2]]), U, 0.5));
  },
  draw(tl, t, target, ctx) {
    const spec = camAt(tl);
    applyCam(cam, spec, ctx.W, ctx.H, Math.max(0.0015, spec.d * 0.05), 100);
    card.update({ tc: TC0 + tl, cam, air: FILM_AIR, haze: FILM_HAZE, field: 1 });
    const r = ctx.renderer;
    r.setRenderTarget(target); r.setClearColor(0x000000, 1); r.clear();
    r.render(scene, cam);
  },
  grade(tl) {
    let zb = 0, fl = 0;
    for (const [t0] of PUNCH) { const x = (tl - t0) / PD; if (x > -0.2 && x < 1.6) { const g = Math.exp(-(((x - 0.35) / 0.45) ** 2)); zb += 0.3 * g; fl += 0.02 * g; } }
    const last = ease(tl, 7.3, 8, (x) => x * x);
    return { bloom: 0.8, threshold: 0.08, vignette: 0.7, motionBlur: 1, zoomBlur: zb + 1.2 * last, flash: fl + 0.5 * last, shutter: 0.5 };
  },
};
