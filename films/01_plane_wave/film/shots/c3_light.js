// C3: the arrows' crests become sheets (a plane wave) and travel to the child. No stars; lambda stays 3 cm.
import * as THREE from 'three';
import { Card3D, loadCardData, cardState, FILM_AIR, FILM_HAZE } from '../lib/card3d.js';
import { applyCam, sForFov, lerp, ease, smooth, smoother, mix3, add3, sub3, norm3, cross3, len3, slerpDir, clamp } from '../lib/cam.js';
import { cardClock, cometAt, LAUNCH, ANT11 } from '../lib/story.js';
import { c2Frame, c2Phase } from './c2_wave.js';
import { TextbookWave, studioEnv } from '../lib/wave.js';
import { Sheets } from '../lib/sheets.js';
import { Panes } from '../lib/panes.js';

let card, scene, cam, D, wave, sheets, panes, focus0;
export const C3 = { start: 40, dur: 10 };
const Vat = (tl) => lerp(0.03 / 4.5, 0.22, ease(tl, 0.8, 5, smooth));   // crest speed, m/s
// log10 of the wavelength (m) over the shot
export function lam(tl) { return Math.log10(0.03); }
const PH = []; // integrated phase table at 120 Hz
function phaseAt(tl) {
  const i = Math.max(0, Math.floor(tl * 120));
  while (PH.length <= i + 1) { const n = PH.length, prev = n ? PH[n - 1] : 0; PH.push(prev + 2 * Math.PI / Math.pow(10, lam(n / 120)) * Vat(n / 120) / 120); }
  return PH[i] + (PH[i + 1] - PH[i]) * (tl * 120 - i);
}
export function c3Geometry() {
  const c = cometAt(C3.start, focus0);
  const side = norm3(cross3(c.dir, [0, 0, 1])), upv = norm3(cross3(side, c.dir));
  return { ...c, side, upv };
}
// headAt: the packet's front along k from ANT11. The camera starts where C2 left it, steps out beside the packet
// (outside the growing sheets), travels with it, and stops short of the child so the packet flies on into her.
// speed ramps up over 1.2-3.2 s, then stays constant, reaching the child at 8.8 s and passing through her
export const headAt = (G, x) => {
  const v = (G.L + 0.1 - G.s) / (8.8 - 2.2), u = clamp((x - 1.2) / 2);
  const ramp = x < 1.2 ? 0 : x < 3.2 ? 2 * (u * u * u - u * u * u * u / 2) : x - 2.2;
  return G.s + v * ramp;
};
export function c3Camera(tl, G) {
  const F = c2Frame(C3.start - 22 - 1e-3, focus0);
  const off0 = sub3(F.cam.pos, G.head);
  const along = lerp(G.s - 0.1, G.L - 1.25, ease(tl, 1.4, 6.5, smoother));
  const c = add3(ANT11, G.dir, along);
  const offW = add3(add3(add3([0, 0, 0], G.side, 1.05), G.upv, 0.32), G.dir, -0.55);
  const u = ease(tl, 0.2, 4.2, smoother);
  const pos = add3(mix3(add3(G.head, off0, 1), c, u), mix3([0, 0, 0], offW, u));
  const pkt = add3(ANT11, G.dir, headAt(G, tl) - 0.1);
  const look = mix3(pkt, add3(ANT11, G.dir, G.L), ease(tl, 5.5, 9.2, smoother));
  const fwd = slerpDir(F.cam.fwd, norm3(sub3(look, pos)), ease(tl, 0, 1.2, smoother));
  return { pos, fwd, up: G.upv, s: lerp(sForFov(30), sForFov(40), u), cx: 1280, cy: 720 };
}
export default {
  async init(ctx) {
    D = await loadCardData();
    card = new Card3D(D, ctx.W, ctx.H);
    sheets = new Sheets(); panes = new Panes(700);
    wave = new TextbookWave(studioEnv(ctx.renderer));
    scene = new THREE.Scene(); scene.add(card.group, wave.group, sheets.mesh, panes.mesh);
    sheets.mesh.renderOrder = 5;
    cam = new THREE.PerspectiveCamera();
    focus0 = cardState(D, cardClock(LAUNCH)).focus;
  },
  draw(tl, t, target, ctx) {
    const G = c3Geometry();
    applyCam(cam, c3Camera(tl, G), ctx.W, ctx.H, 0.003, 100);
    const lw = Math.pow(10, lam(tl));
    const pwK = 2 * Math.PI / 0.03, pwHead = headAt(G, tl), pwPh = c2Phase(C3.start - 22) + 2 * Math.PI * (0.03 / 4.5) * tl / 0.03 + pwK * (pwHead - G.s) + pwK * G.s;
    card.update({ tc: cardClock(t), cam, air: FILM_AIR, haze: FILM_HAZE, field: 1, starGain: 0, streakGain: 0,
      pw: { mix: ease(tl, 0.8, 2.6), kw: pwK, ph: pwPh, head: pwHead, k: G.dir, o: ANT11 },
    });
    // the comet's packet of crests flies on to the child; arrows hand over to sheets
    const aF = 1 - ease(tl, 0.8, 3.4);
    const head = headAt(G, tl), kw = 2 * Math.PI / lw;
    const rel = c2Phase(C3.start - 22) + 2 * Math.PI * (0.03 / 4.5) * tl / lw;   // crests drifting within the packet, as in C2
    wave.group.visible = aF > 0.01;
    if (wave.group.visible) wave.update({ o: add3(ANT11, G.dir, head), k: G.dir, e: G.upv, phase: rel, reveal: 1, cam, ampScale: aF, envAlpha: aF, axisAlpha: aF, lambda: lw, L: 0.21 });
    const grow = ease(tl, 0.4, 4.5, smooth);
    const ph = rel + kw * (head - G.s), tail = head - 0.21;
    const half = lerp(0.012, 0.32, grow);
    panes.update({ o: ANT11, k: G.dir, e: G.upv, half, lambda: lw, phase: ph, anchor: G.s, head, tail, front: 0.03 + 0.05 * grow,
      gain: 1.3, fill: lerp(0.012, 0.016, grow), density: 14, grid: 0.0, edge: lerp(0.5, 1.0, grow), edgeFade: 1, near: 0.1, cam, bulge: 0 });
    sheets.mesh.visible = false;
    const r = ctx.renderer;
    r.setRenderTarget(target); r.setClearColor(0, 1); r.clear();
    r.render(scene, cam);
  },
  grade() { return { bloom: 0.8, threshold: 0.06, vignette: 0.7, motionBlur: 1 }; },
};
