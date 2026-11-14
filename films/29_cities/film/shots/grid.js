// G: the ten squares side by side, ordered by route median of whole-body SAR (low to high), each with its route,
// its coloured route points and the pedestrian at the end of the route. Each city is rendered once into a tile at init.
import * as THREE from 'three';
import { applyCam, sForFov, ease, smooth, smoother, add3, sub3, norm3 } from '../lib/cam.js';
import { cityData, loadCity, routeFrame, BG, disposeCity } from '../lib/city.js';
import { makeWalk } from '../lib/walk.js';
import { LOOK } from './city.js';

// Portrait tiles that fill the frame: 94% of the width, two rows with the names in between.
const COLS = 5, TW = 468, TH = 560, GAP = 20, X0 = (2560 - (COLS * TW + (COLS - 1) * GAP)) / 2, Y0 = 70, ROWGAP = 110;
export const T0 = -0.3, STEP = 0.2;   // the first tile is already fading in on the cut
let S = null;

const VS = `in vec3 position; in vec2 uv; out vec2 vUv; uniform vec4 uRect; uniform vec2 uRes;
void main(){ vUv = uv; vec2 p = (uRect.xy + uv * uRect.zw) / uRes; p.y = 1.0 - p.y; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const FS = `precision highp float; in vec2 vUv; out vec4 frag; uniform sampler2D uT; uniform float uA, uZoom; uniform vec3 uBg;
void main(){ vec2 uv = 0.5 + (vUv - 0.5) * uZoom; vec3 c = texture(uT, vec2(uv.x, 1.0 - uv.y)).rgb;
  vec2 e = min(vUv, 1.0 - vUv); float m = smoothstep(0.0, 0.025, min(e.x, e.y));
  frag = vec4(mix(uBg, c, m * uA), 1.0); }`;

export function tileRect(i) {
  const r = Math.floor(i / COLS), c = i % COLS;
  return [X0 + c * (TW + GAP), Y0 + r * (TH + ROWGAP), TW, TH];
}

function tileCam(city, look) {
  const { c } = routeFrame(city);
  const az = look.az * Math.PI / 180, el = Math.max(look.el, 44) * Math.PI / 180, fov = 40;
  const dist = look.span * 0.95 / 2 / Math.tan(fov * Math.PI / 360);
  const tgt = add3(c, [0, 0, 4]);
  const pos = [tgt[0] + Math.sin(az) * Math.cos(el) * dist, tgt[1] + Math.cos(az) * Math.cos(el) * dist, tgt[2] + Math.sin(el) * dist];
  return { pos, fwd: norm3(sub3(tgt, pos)), up: [0, 0, 1], s: sForFov(fov) * 2560 / 1440, cx: 1280, cy: 1280 * TH / TW };
}

export default {
  async init(ctx) {
    const D = await cityData();
    const order = D.cities.map((c, i) => ({ c, i })).sort((a, b) => a.c.median - b.c.median);
    const NW = Math.round(ctx.H * TW / 1440 * 1.6), NH = Math.round(NW * TH / TW);
    const tiles = [];
    const cam = new THREE.PerspectiveCamera();
    for (const { c, i } of order) {
      const k0 = D.cities.slice(0, i).reduce((s, x) => s + x.points.length, 0);
      const C = await loadCity(c, { r0: 100, r1: 190 });
      const walk = await makeWalk(c, k0, { t0: 0, rate: 1000, dotR: 16, keep: true });
      C.scene.add(walk.group);
      applyCam(cam, tileCam(c, LOOK[c.site]), NW, NH, 0.5, 4000);
      walk.update(5, cam, NW, NH);
      const rt = new THREE.WebGLRenderTarget(NW, NH, { type: THREE.HalfFloatType, samples: 4, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      const r = ctx.renderer;
      C.U.uGain.value = LOOK[c.site].gain ?? 1.4; C.U.uKnee.value = LOOK[c.site].knee ?? 0;
      r.setRenderTarget(rt); r.setClearColor(new THREE.Color(...BG), 1); r.clear(); r.render(C.scene, cam);
      C.scene.remove(walk.group);
      C.U.uKnee.value = 0;
      await disposeCity(c.site);
      tiles.push({ rt, city: c, name: LOOK[c.site].name });
    }
    const scene = new THREE.Scene();
    const geo = new THREE.PlaneGeometry(1, 1);
    tiles.forEach((t, j) => {
      const U = { uT: { value: t.rt.texture }, uA: { value: 0 }, uZoom: { value: 1 }, uBg: { value: new THREE.Vector3(...BG) }, uRect: { value: new THREE.Vector4(...tileRect(j)) }, uRes: { value: new THREE.Vector2(2560, 1440) } };
      const m = new THREE.Mesh(geo, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, uniforms: U, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
      m.frustumCulled = false; scene.add(m); t.U = U;
    });
    S = { tiles, scene, cam: new THREE.Camera() };
  },
  draw(tl, t, target, ctx) {
    const r = ctx.renderer;
    r.setRenderTarget(target); r.setClearColor(new THREE.Color(...BG), 1); r.clear();
    S.tiles.forEach((T, j) => { T.U.uA.value = ease(tl, T0 + STEP * j, T0 + STEP * j + 0.45, smooth); T.U.uZoom.value = 1 - 0.05 * ease(tl, T0 + STEP * j, 10, smooth); });
    r.render(S.scene, S.cam);
  },
  grade(tl) { return { bloom: 0.45, threshold: 0.06, vignette: 0.3 }; },
  labels(tl) {
    const items = S.tiles.map((T, j) => {
      const [x, y, w, h] = tileRect(j), a0 = T0 + STEP * j + 0.2;
      return { kind: 'text', at: [x + w / 2, y + h + 50], text: T.name, size: 46, align: 'center', a: ease(tl, a0, a0 + 0.5) };
    });
    return { cam: S.cam, items };
  },
};
