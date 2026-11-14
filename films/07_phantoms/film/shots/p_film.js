// Film 07, one continuous shot: four glass phantoms -> a plane wave washes over them (450 MHz -> 26 GHz)
// -> a section plane slowly cuts them to the heart -> a close look at Thelonious -> hold on the four, front-on.
import * as THREE from 'three';
import { Phantoms, ORDER, WHO } from '../lib/phantoms.js';
import { Panes } from '../lib/panes.js';
import { projector } from '../lib/labels.js';
import { applyCam, sForFov, ease, smooth, smoother, clamp, lerp } from '../lib/cam.js';

export const T = {
  names: [0.8, 1.4, 2.0, 2.6], namesOut: 7.0,
  waveIn: 7.8, waveArrive: 10.6, chirp0: 11.8, chirp1: 16.2, waveOut: 16.6, waveGone: 17.6,
  planeIn: 15.6, sweep0: 16.0, sweep1: 20.3,
  close0: 21.3, close1: 23.7, labels0: 24.1, labelsOut: 32.9, back0: 33.3, back1: 35.9, names2: 36.1, end: 40.5,
};
const F0 = 0.45, F1 = 15.0;              // GHz: the range all four phantoms share (Thelonious alone also ran at 26 GHz)
const C0 = 0.299792458;                  // m/ns
const V = 0.55;                          // crest speed on screen, m/s (illustrative)
const S_TAIL = -1.25, S_ARR0 = -1.25;      // s = -y along k

const BG = new THREE.Color(0.00036, 0.00047, 0.00078);   // #07090d after post.js's tone curve
let ph, panes, frame, scene, cam, TH = 3;
// skin point on the final cut: outermost shell vertex near y = 0 at height z, on side sgn (+1 = +x)
let skinPt = null;
function skinAt(i, z, sgn) {
  const p = ph.list[i], pos = p.shell.geometry.attributes.position.array;
  let best = null;
  for (let k = 0; k < pos.length; k += 3) {
    if (Math.abs(pos[k + 1]) > 0.004 || Math.abs(pos[k + 2] - z) > 0.012) continue;
    if (!best || pos[k] * sgn > best[0] * sgn) best = [pos[k], 0, pos[k + 2]];
  }
  return best;
}

// --- frequency and phase (integrated so crests move at V while the wavelength shrinks)
export function ghzAt(t) { return Math.exp(Math.log(F0) + (Math.log(F1) - Math.log(F0)) * ease(t, T.chirp0, T.chirp1, smoother)); }
const kwAt = (t) => 2 * Math.PI * ghzAt(t) / C0;
const PH = [];
function phaseAt(t) {
  const r = 240, i = Math.max(0, Math.floor(t * r));
  while (PH.length <= i + 1) { const n = PH.length; PH.push(n ? PH[n - 1] + kwAt(n / r) * V / r : 0); }
  return PH[i] + (PH[i + 1] - PH[i]) * (t * r - i);
}
const headAt = (t) => t < T.waveIn ? -10 : S_ARR0 + V * (t - T.waveIn) * 1.0 + Math.max(0, t - T.waveArrive - 1) * 2;

// --- camera keys: t, az (deg, + toward Duke's side), dist, camera z, target x, target z, vertical fov
let KEYS;
function keys() {
  const xT = ph.list[TH].x;
  return [
    [0, -12, 6.3, 1.12, 0.0, 0.93, 25],
    [6.4, -6, 5.9, 1.1, 0.0, 0.93, 25],
    [9.8, -27, 5.7, 2.05, 0.0, 0.86, 29],
    [15.2, -31, 5.5, 2.0, 0.0, 0.86, 29],
    [17.4, -22, 5.7, 1.35, 0.0, 0.92, 27],
    [20.9, -7, 5.8, 1.12, 0.0, 0.93, 25],
    [T.close1, -9, 1.75, 0.95, xT + 0.0, 0.84, 26],
    [T.back0, -6, 1.68, 0.95, xT + 0.0, 0.84, 26],
    [T.back1, 0, 6.0, 1.05, 0.0, 0.93, 25],
    [T.end, 0, 6.0, 1.05, 0.0, 0.93, 25],
  ];
}
// monotone cubic (Fritsch-Carlson) through the keys, per channel
function interp(t, col) {
  const K = KEYS, n = K.length;
  if (t <= K[0][0]) return K[0][col];
  if (t >= K[n - 1][0]) return K[n - 1][col];
  let i = 0; while (K[i + 1][0] < t) i++;
  const x = (j) => K[j][0], y = (j) => K[j][col];
  const d = (j) => (y(j + 1) - y(j)) / (x(j + 1) - x(j));
  const m = (j) => {
    if (j === 0 || j === n - 1) return 0;
    const a = d(j - 1), b = d(j);
    if (a * b <= 0) return 0;
    return 3 * (x(j + 1) - x(j - 1)) / ((2 * x(j + 1) - x(j) - x(j - 1)) / a + (x(j + 1) - 2 * x(j) + x(j - 1)) / b);
  };
  const h = x(i + 1) - x(i), s = (t - x(i)) / h, s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * y(i) + (s3 - 2 * s2 + s) * h * m(i) + (-2 * s3 + 3 * s2) * y(i + 1) + (s3 - s2) * h * m(i + 1);
}
export function camAt(t) {
  const az = interp(t, 1) * Math.PI / 180, dist = interp(t, 2), cz = interp(t, 3), tx = interp(t, 4), tz = interp(t, 5), fov = interp(t, 6);
  const pos = [tx + dist * Math.sin(az), dist * Math.cos(az), cz];
  return { pos, fwd: [tx - pos[0], -pos[1], tz - pos[2]], up: [0, 0, 1], s: sForFov(fov), cx: 1280, cy: 720 };
}
export const cutAt = (t) => 0.23 * Math.pow(1 - ease(t, T.sweep0, T.sweep1, smooth), 1.4);   // starts just in front of the toes

export default {
  async init(ctx) {
    ph = await new Phantoms().init();
    panes = new Panes(ph, 420);
    frame = new Panes(ph, 2);
    KEYS = keys();
    scene = new THREE.Scene(); scene.add(ph.group, panes.mesh, frame.mesh);
    cam = new THREE.PerspectiveCamera();
    skinPt = skinAt(TH, 0.62, 1);
  },
  draw(tl, t, target, ctx) {
    applyCam(cam, camAt(t), ctx.W, ctx.H, 0.05, 60);
    const kw = kwAt(t), lam = 2 * Math.PI / kw, phase = phaseAt(t), head = headAt(t);
    const wOn = ease(t, T.waveIn, T.waveIn + 1.2) * (1 - ease(t, T.waveOut, T.waveGone));
    const cut = cutAt(t);
    const planeA = ease(t, T.planeIn, T.sweep0 + 0.4) * (1 - ease(t, T.sweep1 + 0.3, T.sweep1 + 2.2));
    const dimO = 1 - ease(t, T.close0, T.close1 - 1.0) * (1 - ease(t, T.back0, T.back1 - 0.8));
    ph.update({ cam, cut, dim: [dimO, dimO, dimO, 1], ghost: lerp(0.32, 0.14, ease(t, T.sweep1, T.close1)), exposure: 1, edge: 0.0, cutAlpha: 1, rim: 0,
      wave: { on: wOn, kw, anchor: 0, phase, head } });
    panes.update({ o: [0, 0, 0], k: [0, -1, 0], e: [1, 0, 0], halfE: 1.95, halfH: 1.1, cE: 0, cH: 1.02, lambda: lam, phase, anchor: 0,
      head, tail: S_TAIL, front: 0.06, gain: 1.0 * wOn * (1 - ease(lam, 0.07, 0.025)), fill: 0.0012, edge: 0.6, soft: 0.7, mask: [0, 1], topEdge: 0, cam, density: 14 });
    frame.update({ o: [0, 0, 0], k: [0, -1, 0], e: [1, 0, 0], halfE: 2.05, halfH: 1.12, cE: 0, cH: 1.02, lambda: 100, phase: 2 * Math.PI * (-cut) / 100, anchor: 0,
      head: 10, tail: -10, gain: 1.0 * planeA, fill: 0.006, edge: 0.3, cam, density: 1 });
    const r = ctx.renderer;
    r.setRenderTarget(target); r.setClearColor(BG, 1); r.clear();
    r.render(scene, cam);
  },
  grade(tl, t) {
    return { bloom: 0.25, threshold: 2.4, vignette: 0.35, grain: 0.008, exposure: 1 };
  },
  labels(tl, t, ctx) {
    const items = [];
    const lab = (t0, t1, d = 0.9) => ({ p: ease(t, t0, t0 + d, smooth), a: t1 ? 1 - ease(t, t1, t1 + 0.5) : 1 });
    // names over the heads (Duke on the left); again for the hold
    ORDER.forEach((k, i) => {
      const top = ph.meta[k].top, at = ph.at(i, [top[0], top[1], top[2] + 0.025]);
      const [nm, age] = WHO[k];
      const first = t < T.names2 - 0.1;
      const p = first ? ease(t, T.names[i], T.names[i] + 0.9, smooth) : ease(t, T.names2 + 0.25 * i, T.names2 + 0.25 * i + 0.9, smooth);
      const a = first ? 1 - ease(t, T.namesOut, T.namesOut + 0.6) : 1;
      items.push({ kind: 'label', at, off: [34, -64], text: `${nm}, ${age}`, size: 50, p, a });
    });
    // f readout and lambda bracket during the wave
    const g = ghzAt(t), wA = ease(t, T.waveIn + 0.6, T.waveIn + 1.4) * (1 - ease(t, T.waveOut - 0.2, T.waveOut + 0.6));
    const fs = g < 1 ? `${Math.round(g * 1000 / 5) * 5} MHz` : g < 10 ? `${g.toFixed(1)} GHz` : `${Math.round(g)} GHz`;
    items.push({ kind: 'text', at: [170, 150], text: [['f', 'math'], ['  =  ' + fs, 'main']], size: 50, a: wA, p: 1 });
    const lam = 2 * Math.PI / kwAt(t), ph0 = phaseAt(t), s1 = (ph0 + 2 * Math.PI * Math.ceil((-0.75 * kwAt(t) - ph0) / (2 * Math.PI))) / kwAt(t);
    const bA = wA * (1 - ease(lam, 0.16, 0.09)) * ease(t, T.waveArrive - 0.5, T.waveArrive + 0.5);
    if (bA > 0.003 && s1 > S_TAIL && s1 + lam < headAt(t)) items.push({ kind: 'bracket', from: [-1.3, -s1, 0], to: [-1.3, -(s1 + lam), 0], side: 26, textGap: 30, toward: 'right', text: [['λ', 'math']], size: 46, a: bA, p: 1 });
    // organ labels on Thelonious's cut; text placed at fixed screen points (px at 2560x1440) in clear black space
    const A = ph.meta.thelonious.anchors, P = (q) => ph.at(TH, [q[0], 0.0, q[2]]);
    const proj = projector(cam, 2560, 1440);
    // each tissue is its own material: relative permittivity and conductivity at 3.5 GHz (IT'IS V5.0, as in the thesis)
    const eps = (e, sg) => [['ε', 'math'], ['r', 'sub'], [`  =  ${e},    `, 'main'], ['σ', 'math'], [`  =  ${sg} S/m`, 'main']];
    const org = (q, scr, text, t0, sub) => {
      const w = P(q), s0 = proj(w); if (!s0) return;
      items.push({ kind: 'label', at: w, off: [scr[0] - s0[0], scr[1] - s0[1]], text, sub, size: 52, subSize: 40, ...lab(t0, T.labelsOut, 1.4) });
    };
    org(A.Brain, [1660, 150], 'Brain', T.labels0, eps(47, '2.6'));
    org([Math.abs(A.Lung[0]), 0, A.Lung[2]], [800, 540], 'Lung', T.labels0 + 0.6, eps(20, '1.1'));
    org(A.Heart, [1700, 660], 'Heart', T.labels0 + 1.2, eps(53, '3.2'));
    org(A.Liver, [860, 800], 'Liver', T.labels0 + 1.8, eps(41, '2.5'));
    if (skinPt) org(skinPt, [860, 1110], 'Skin', T.labels0 + 2.4, eps(37, '2.0'));
    const fA = ease(t, T.labels0 + 0.2, T.labels0 + 1.0) * (1 - ease(t, T.labelsOut, T.labelsOut + 0.5));
    items.push({ kind: 'text', at: [170, 150], text: [['f', 'math'], ['  =  3.5 GHz', 'main']], size: 50, a: fA, p: 1 });
    return { cam, items };
  },
};
