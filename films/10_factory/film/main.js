// Film runtime. Every frame is a pure function of the global time t.
import * as THREE from 'three';
import { Post } from './lib/post.js';
import { timeline } from './timeline.js';
import { Overlay, loadFonts, projector } from './lib/labels.js';

THREE.ColorManagement.enabled = false;
const q = new URLSearchParams(location.search);
const W = +(q.get('w') || 1280), H = +(q.get('h') || 720);
const SUB = +(q.get('sub') || 1);
const { TIMELINE, DURATION } = timeline(q.get('film') || '10');          // motion-blur sub-frames where a shot asks for them
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);
const post = new Post(renderer, W, H, { msaa: q.get('aa') === '0' ? 0 : 4 });
const overlay = new Overlay(renderer, W, H);
const ctx = { THREE, renderer, W, H, post, q, overlay, scale: W / 1920, film: q.get('film') || '10' };
const fontsReady = loadFonts();

const loading = new Map(), mods = new Map();
async function shotMod(s) {
  if (!loading.has(s.id)) loading.set(s.id, import(s.module).then(async (m) => { const mod = m.default; await mod.init(ctx); mods.set(s.id, mod); return mod; }));
  return loading.get(s.id);
}
ctx.shotMod = shotMod; ctx.mods = mods;
function shotsAt(t) {
  const out = [];
  for (const s of TIMELINE) if (t >= s.start - (s.inPad || 0) && t < s.end + (s.outPad || 0)) out.push(s);
  return out.length ? out : [TIMELINE[TIMELINE.length - 1]];
}

// One sub-frame of the film at time t into target: the active shot draws itself (it may composite others).
async function prepare(t) { for (const dt of [-0.05, 0, 0.05]) for (const s of shotsAt(Math.max(0, t + dt))) await shotMod(s); }
function drawAt(t, target) {
  const list = shotsAt(t);
  const s = list.find((x) => t >= x.start && t < x.end) || list[list.length - 1];
  const mod = mods.get(s.id);
  return mod.draw(t - s.start, t, target, ctx) || {};
}

async function renderFrame(t) {
  t = Math.max(0, Math.min(t, DURATION - 1e-6));
  await prepare(t);
  const list = shotsAt(t);
  const s = list.find((x) => t >= x.start && t < x.end) || list[list.length - 1];
  const mod = mods.get(s.id);
  const g = (mod.grade && mod.grade(t - s.start, t, ctx)) || {};
  const sub = g.motionBlur ? Math.max(1, Math.round(SUB * g.motionBlur)) : 1;
  post.frame((tt, target) => drawAt(tt, target), t, { sub, shutter: g.shutter ?? 0.5, grade: g });
  await fontsReady;
  const L = q.get('nolabels') ? null : mod.labels && mod.labels(t - s.start, t, ctx);
  overlay.draw(L ? L.items : [], L ? projector(L.cam, W, H) : null);
  return t;
}
async function captureFrame(t, fmt = 'jpeg', quality = 0.95) {
  await renderFrame(t);
  return renderer.domElement.toDataURL('image/' + fmt, quality).split(',')[1];
}
window.renderFrame = renderFrame; window.captureFrame = captureFrame; window.filmDuration = DURATION; window.ctx = ctx;
try {
  if (q.has('t')) await renderFrame(+q.get('t'));
  window.renderReady = true;
} catch (e) { window.renderError = String(e && e.stack || e); console.error(e); }
