// C5b: a patch of skin (the AEGIS film's curved shoulder patch). A section plane sweeps through it to open a cutaway:
// skin, fat, muscle. A plane wave arrives at an angle, part reflects at the mirror angle, part enters almost straight
// down and becomes heat; as f climbs 3.5 -> 28 -> 100 GHz the heat retreats into the skin (delta = 16, 1, 0.35 mm).
import * as THREE from 'three';
import { applyCam, sForFov, lerp, ease, smooth, smoother, mix3, add3, sub3, norm3, slerpDir } from '../lib/cam.js';
import { SkinPatch, PATCH, height } from '../lib/tissue.js';

let scene, cam, skin, last;
const PER = 0.9, TH = 35 * Math.PI / 180, FOV = 34;
const KI = [Math.sin(TH), 0, -Math.cos(TH)], KR = [Math.sin(TH), 0, Math.cos(TH)];
const PX = -0.035, Y0 = PATCH.y0, P = [PX, Y0, height(PX, Y0)];
export const C5B = { start: 88, dur: 27 };
const lg = Math.log;
const g28 = (tl) => ease(tl, 13.6, 17), g100 = (tl) => ease(tl, 19.8, 23.2);
export const ghzAt = (tl) => Math.exp(lg(3.5) + (lg(28) - lg(3.5)) * g28(tl) + (lg(100) - lg(28)) * g100(tl));
const xcAt = (tl) => tl < 3.4 ? PATCH.x1 + 0.01 : tl > 6.2 ? PATCH.x0 - 0.02 : lerp(PX + 0.07, PX - 0.09, ease(tl, 3.4, 6.2, smooth));
// framing: [distance, look] for the intact view and for each frequency
const DIRA = norm3([0.2, -0.75, 0.63]), DIRB = norm3([0.14, -1, 0.2]);
function camAt(tl) {
  const a = g28(tl), b = g100(tl);
  const dB = Math.exp(lg(0.11) + (lg(0.0125) - lg(0.11)) * a);          // held from 28 to 100 GHz: the heat visibly shrinks
  const lookB = [PX + 0.004 * a, Y0, P[2] + lerp(-0.007, -0.0011, a)];
  const open = ease(tl, 3.6, 6.6, smoother);
  const d0 = Math.exp(lerp(lg(0.004), lg(0.075), ease(tl, 0.2, 3.2, smoother)));
  const d = Math.exp(lerp(lg(d0), lg(dB), open));
  const look = mix3(P, lookB, open);
  const dir = slerpDir(slerpDir([0, -0.01, 1], DIRA, ease(tl, 0.5, 3.2, smoother)), DIRB, open);
  const up = slerpDir([0, 1, 0], [0, 0, 1], ease(tl, 0.5, 3.0, smoother));
  return { pos: add3(look, dir, d), fwd: norm3(sub3(look, add3(look, dir, d))), up, s: sForFov(FOV), cx: 1280, cy: 720, d, look };
}
export default {
  async init(ctx) {
    scene = new THREE.Scene();
    skin = new SkinPatch();
    scene.add(skin.group);
    cam = new THREE.PerspectiveCamera();
  },
  draw(tl, t, target, ctx) {
    const spec = camAt(tl);
    applyCam(cam, spec, ctx.W, ctx.H, spec.d * 0.05, 5);
    const ghz = ghzAt(tl), wt = 2 * Math.PI * tl / PER, lam0 = 0.299792458 / ghz;
    const front = -0.1 + 0.095 * Math.max(0, tl - 5.6), refFront = -0.08 + 0.095 * Math.max(0, tl - 6.0);
    const s = skin.update({ ghz, wt, theta: TH, heat: ease(tl, 8.2, 10.8), wave: ease(tl, 6.6, 7.6), xc: xcAt(tl), P, front, refFront, air: ease(tl, 5.6, 6.2) });
    last = { spec, s, ghz };
    const r = ctx.renderer;
    if (target) skin.u.uRes.value.set(target.width, target.height); else skin.u.uRes.value.set(ctx.W, ctx.H);
    r.setRenderTarget(target); r.setClearColor(new THREE.Color(0.00036, 0.00063, 0.0014), 1); r.clear();
    r.render(scene, cam);
  },
  grade(tl) {
    const inF = 1 - ease(tl, 0, 0.3);
    return { bloom: 0.6, threshold: 0.1, vignette: 0.7, motionBlur: 1, flash: 0.35 * inF, zoomBlur: 0.6 * inF };
  },
  labels(tl) {
    if (!last) return null;
    const { spec, s, ghz } = last;
    const fh = spec.d * Math.tan(FOV / 2 * Math.PI / 180), fw = fh * 16 / 9, lx = spec.look[0], z0 = P[2], hz = (x) => height(x, Y0);
    const lab = (t0, t1 = 99) => ({ p: ease(tl, t0, t0 + 0.9, smooth), a: 1 - ease(tl, t1, t1 + 0.6) });
    const xL = lx - 0.5 * fw, xR = lx + 0.42 * fw;
    // dimension brackets attached to the tissue: they scale with the zoom
    const tS = (x) => 0.0016 + 0.00022 * Math.sin(x * 830 + 1) + 0.00012 * Math.sin(x * 2300 + 2);
    const tF = (x) => 0.0085 + 0.0011 * Math.sin(x * 140 + 0.5) + 0.0005 * Math.sin(x * 410 + 1.3);
    const zL = hz(xL), zR = hz(xR);
    const br = (z0, z1, text, t0, t1, x = xL, toward = 'left') => ({ kind: 'bracket', from: [x, Y0, z0], to: [x, Y0, z1], side: 22, textGap: 26, toward, text, size: 42, ...lab(t0, t1) });
    const items = [
      br(zL, zL - tS(xL), 'Skin', 6.2),
      br(zL - tS(xL), zL - tF(xL), 'Fat', 6.5, 15.0),
      br(zL - tF(xL), zL - 0.03, 'Muscle', 6.8, 15.0),
      br(zR, zR - s.delta, 'Heat', 10.4, 99, xR, 'right'),
      { kind: 'text', at: [170, 150], text: [['f', 'math'], ['  =  ' + (ghz < 10 ? ghz.toFixed(1) : Math.round(ghz)) + ' GHz', 'main']], size: 46, ...lab(6.2) },
      { kind: 'scalebar', ppm: 1440 / (2 * spec.d * Math.tan(FOV / 2 * Math.PI / 180)), ...lab(0.8) },
    ];
    return { cam, items };
  },
};
