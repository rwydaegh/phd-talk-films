// B: the stairwell. The photo (solved camera, frame B) comes alive; the robot fills three scan planes; the fourth
// stays empty. The digital twin draws itself over the photo and replaces it. Single-bounce rays from the antenna
// land on the held-out plane, the prediction spreads from there, and the measurement slides out beside it.
import * as THREE from 'three';
import { applyCam, ease, lerp, mix3, norm3, sub3, add3 } from '../lib/cam.js';
import { Photo } from '../lib/photo.js';
import { ScanMap, scanProgress } from '../lib/scanmap.js';
import { Twin, Rays } from '../lib/twin.js';
import { BG_HDR } from '../lib/common.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const DUR = 23.6;   // ends on the prediction in place; the fair comparison is the next slide (spatial spectra)
const T_FILL = [3.2, 5.6, 8.0], FILL_LEN = 2.6;     // three training planes, one after another
const T_EDGE0 = 10.6, T_EDGE1 = 14.0, T_PHOTO_OUT = 15.5;
const T_RAYS = 16.5, T_PRED = 19.6, T_FACE = 99, T_SLIDE = 102, T_V1 = 21.6;   // face-on compare cut (T_FACE/T_SLIDE beyond the end)
const ROBOT_TOP = [0.04, -0.614, 1.081];

let photo, scene, photoScene, cam, twin, rays, hits = [], walls = [], planes = {}, pred, obs, meta;
const X0_CUT = 0.17;   // x0's lowest 12 cm sit behind the railing; cut so nothing shows through the gaps

// held-out maps lose their top 3 cm (a stalled-probe strip in the observed field), so they are 0.670 m tall
function yPlane(x, h = 0.70) { return { corner: [x, -0.435, -0.152], U: [0, 0.85, 0], V: [0, 0, h] }; }

function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}

export default {
  async init(ctx) {
    photo = await Photo.load('WA0007', { depth: 2.7 });
    photoScene = new THREE.Scene(); photoScene.add(photo.group);
    scene = new THREE.Scene();
    cam = new THREE.PerspectiveCamera();
    twin = await Twin.load(ctx.W, ctx.H);
    meta = twin.meta;
    twin.room.renderOrder = twin.robot.renderOrder = -2;
    scene.add(twin.group);
    // planes: x0 (wall side), y0, y200 (training) and y400 (held out)
    planes.x0 = await ScanMap.load('assets/maps/s28_x0_zy.png', { rows: 611, cols: 149, order: 'cols', corner: [0, -0.435, -0.152], U: [-0.4, 0, 0], V: [0, 0, 0.70] });
    planes.y0 = await ScanMap.load('assets/maps/s28_y0_zx.png', { rows: 611, cols: 318, order: 'cols', ...yPlane(0) });
    planes.y200 = await ScanMap.load('assets/maps/s28_y200_zx.png', { rows: 611, cols: 318, order: 'cols', ...yPlane(-0.2) });
    pred = await ScanMap.load('assets/maps/s28_y400_predicted.png', { rows: 585, cols: 159, order: 'cols', ...yPlane(-0.4, 0.670) });
    obs = await ScanMap.load('assets/maps/s28_y400_observed.png', { rows: 585, cols: 159, order: 'cols', ...yPlane(-0.4, 0.670) });
    let ro = 1;
    for (const p of [planes.y0, planes.y200, planes.x0, obs, pred]) { p.mesh.renderOrder = ro++; scene.add(p.mesh); }
    planes.x0.set({ uCut: X0_CUT });
    pred.set({ uCut: 0.11 / 0.670 });   // its lowest 11 cm, also behind the railing
    // rays: the direct path and the bounce off the wall behind the robot (+x), the one wall that faces the camera
    const rs = twin.rays.filter((r) => r.kind === 'direct' || (r.kind === 'bounce' && r.normal[0] < -0.9));
    rays = new Rays(rs, ctx.W, ctx.H); rays.group.renderOrder = 10;
    scene.add(rays.group);
    // a soft spot where each ray meets a wall, and where it lands on the held-out plane (normal along x)
    rs.forEach((r, i) => {
      const L = r.pts.slice(1).reduce((acc, q, k) => acc + Math.hypot(...sub3(q, r.pts[k])), 0);
      const spots = [[r.pts[r.pts.length - 1], [-1, 0, 0], 1]];
      if (r.kind === 'bounce') {
        const frac = Math.hypot(...sub3(r.pts[1], r.pts[0])) / L;
        spots.push([r.pts[1], r.normal, frac]);
        // a soft lit patch of wall around the bounce, so the ray visibly meets a surface
        const m = new THREE.Mesh(new THREE.CircleGeometry(0.45, 64), new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xc8d4e6,
          transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
        m.position.set(...add3(r.pts[1], r.normal, 0.002)); m.lookAt(...add3(r.pts[1], r.normal, 1)); m.renderOrder = 9; m.frustumCulled = false;
        scene.add(m); walls.push({ m, i, frac });
      }
      for (const [at, n, frac] of spots) {
        // a dot with a ring lying in the surface, so its perspective shows which way the surface faces
        const g = mergeGeometries([new THREE.CircleGeometry(0.018, 32), new THREE.RingGeometry(0.075, 0.085, 64)]);
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0,
          depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
        m.position.set(...add3(at, n, 0.004)); m.lookAt(...add3(at, n, 1)); m.renderOrder = 11; m.frustumCulled = false;
        scene.add(m); hits.push({ m, i, frac });
      }
    });
  },
  camAt(tl) {
    // photo framing: wide, push toward the robot while it scans, back out for the twin
    const push = ease(tl, 1.5, 7.0) * (1 - ease(tl, 9.0, 13.5));
    const ph = photo.spec({ u0: lerp(760, 600, push), v0: lerp(700, 760, push), zoom: lerp(1.15, 1.9, push) });
    if (tl < T_PHOTO_OUT - 1.0) return ph;
    // free camera: off the photo viewpoint (shows the twin is 3D), then face-on to the held-out plane from -x
    const T = meta.target, mid = [T[0], T[1] + 0.475, T[2]];
    const phLook = add3(ph.pos, ph.fwd, 2.7);
    // a little off the photo's viewpoint, framing the antenna and the planes
    const v1 = { pos: add3(photo.meta.cam.C, [0.15, 0.05, -0.05]), look: [-0.2, -1.1, 0.8], s: 1650 };
    const v2 = { pos: [-1.86, mid[1], mid[2] + 0.04], look: [T[0], mid[1], mid[2]], s: 1560 };
    const u1 = ease(tl, T_PHOTO_OUT - 1.0, T_V1), u2 = ease(tl, T_FACE - 0.5, T_SLIDE + 0.8);
    let pos = mix3(ph.pos, v1.pos, u1), look = mix3(phLook, v1.look, u1), s = lerp(ph.s, v1.s, u1);
    let cx = lerp(ph.cx, 1280, u1), cy = lerp(ph.cy, 720, u1);
    pos = mix3(pos, v2.pos, u2); look = mix3(look, v2.look, u2); s = lerp(s, v2.s, u2);
    pos = add3(pos, [0, 0.03 * Math.sin(tl * 0.23), 0.015 * Math.sin(tl * 0.19)], ease(tl, T_V1 - 0.5, DUR + 2) * 0.5);
    return { pos, fwd: norm3(sub3(look, pos)), up: [0, 0, 1], s, cx, cy };
  },
  draw(tl, t, target, ctx) {
    applyCam(cam, this.camAt(tl), ctx.W, ctx.H, 0.05, 60);
    twin.setCam(cam);
    // photo
    const pDim = lerp(1, 0.55, ease(tl, 2.6, 4.0)) * (1 - ease(tl, T_EDGE1 - 1.0, T_PHOTO_OUT));
    photo.uniforms.uDim.value = pDim;   // hard cut in
    // twin
    const room = ease(tl, T_EDGE1 - 1.0, T_PHOTO_OUT) * (1 - ease(tl, T_FACE + 0.6, T_SLIDE));
    twin.setLook({ room, robot: room, tx: room, bright: 0.13 });
    twin.room.visible = room > 0.002 || tl < T_PHOTO_OUT;   // depth only while the photo shows (opacity 0)
    twin.robot.visible = room > 0.002;
    twin.drawEdges(ease(tl, T_EDGE0, T_EDGE1, (x) => x), lerp(0.55, 0.22, ease(tl, T_EDGE1, T_RAYS)) * ease(tl, T_EDGE0, T_EDGE0 + 0.3) * (1 - ease(tl, T_FACE - 0.5, T_FACE + 1.5)));
    // training planes
    const train = [planes.x0, planes.y0, planes.y200];
    const frameA = ease(tl, 1.8, 2.8) * (1 - ease(tl, T_FACE, T_FACE + 1.5));
    train.forEach((p, i) => {
      const prog = scanProgress(tl - T_FILL[i], p.total, p.rows * 1.5, 0.7, FILL_LEN);
      p.set({ uProg: prog, uAll: prog >= p.total ? 1 : 0, uTrail: p.rows * 1.2, uFresh: p.rows * 0.6, uHead: 1 - ease(tl, T_FILL[i] + FILL_LEN - 0.2, T_FILL[i] + FILL_LEN + 0.4),
        uFrame: frameA * 0.9, uGrid: frameA * (prog >= p.total ? 0 : 1), uOpacity: 1 - ease(tl, T_FACE, T_FACE + 1.5) });
      p.mesh.visible = frameA > 0.002;
    });
    // held-out plane: empty frame, then the prediction spreads from where the rays land
    // the same column sweep the robot used, without the probe head
    const rv = ease(tl, T_PRED, T_PRED + 2.0);
    pred.mesh.visible = tl > 1.8;
    pred.set({ uFrame: ease(tl, 1.8, 2.8) * 1.4, uGrid: ease(tl, 1.8, 2.8) * (1 - ease(tl, T_PRED + 1.5, T_PRED + 2.5)), uHead: 0, uAll: 0, uProg: rv * pred.total });
    // the measurement of that plane slides out beside it (toward +y, screen left in the final view)
    const sl = ease(tl, T_SLIDE, T_SLIDE + 1.8);
    obs.place([-0.4 - 0.025 * Math.sin(Math.PI * sl), -0.435 + 0.95 * sl, -0.152], [0, 0.85, 0], [0, 0, 0.670]);
    obs.set({ uAll: 1, uHead: 0, uFrame: 0.8, uOpacity: ease(tl, T_SLIDE - 0.2, T_SLIDE + 0.3) });
    obs.mesh.visible = tl > T_SLIDE - 0.2;
    // rays: the direct one first, then the bounces
    walls.forEach(({ m, i, frac }) => {
      const tHit = T_RAYS + i * 0.5 + 1.6 * frac;
      m.material.opacity = 0.22 * ease(tl, tHit - 0.7, tHit) * (1 - ease(tl, T_FACE - 0.6, T_FACE + 0.8));
      m.visible = m.material.opacity > 0.002;
    });
    hits.forEach(({ m, i, frac }) => {
      const tHit = T_RAYS + i * 0.5 + 1.6 * frac;
      m.material.opacity = (0.35 + 0.65 * Math.exp(-Math.max(0, tl - tHit) / 0.5)) * ease(tl, tHit - 0.05, tHit + 0.1) * (1 - ease(tl, T_FACE - 0.6, T_FACE + 0.8));
      m.visible = m.material.opacity > 0.002;
    });
    rays.lines.forEach((_, i) => {
      const t0 = T_RAYS + i * 0.5;
      const fade = 1 - ease(tl, T_FACE - 0.6, T_FACE + 0.8);
      rays.set(i, ease(tl, t0, t0 + 1.6, (x) => x), 0.8 * ease(tl, t0, t0 + 0.2) * fade, 0xffffff);
      // pulses run from the antenna to the plane once the rays are drawn: energy arriving
      const ph = (tl - t0 - 1.6) / 1.4;
      rays.pulse(i, ph - Math.floor(ph), 0.12, ph > 0 ? 0.9 * fade * Math.sin(Math.PI * Math.min(1, (ph - Math.floor(ph)) * 1.0)) ** 0.5 : 0);
    });
    const r = ctx.renderer; r.setRenderTarget(target); r.setClearColor(BG_HDR, 1); r.clear();
    if (photo.uniforms.uDim.value > 0.002) r.render(photoScene, cam);
    r.clearDepth();
    r.render(scene, cam);
  },
  grade(tl) { return { bloom: lerp(0.08, 0.16, ease(tl, T_PHOTO_OUT - 1, T_PHOTO_OUT + 1)), vignette: 0.45, grain: 0.012 }; },   // dry cut to the next slide
  labels(tl, t, ctx) {
    applyCam(cam, this.camAt(tl), ctx.W, ctx.H, 0.05, 60);
    const items = [], T = meta.target;
    const out1 = 1 - ease(tl, 9.0, 9.6);
    items.push({ kind: 'label', at: meta.tx, off: [-190, -150], text: 'Antenna', size: 54, p: ease(tl, 0.8, 2.0), a: 1 - ease(tl, 3.4, 4.0) });
    items.push({ kind: 'label', at: [-0.4, 0.2, 0.518], off: [-170, -150], text: 'Test plane', size: 54, p: ease(tl, 4.4, 5.6), a: 1 - ease(tl, 10.2, 10.8) });
    items.push({ kind: 'label', at: ROBOT_TOP, off: [-150, -170], text: 'Robot', size: 54, p: ease(tl, 1.4, 2.6), a: out1 });
    items.push({ kind: 'label', at: meta.tx, off: [-170, -130], text: 'Antenna', size: 54, p: ease(tl, T_RAYS - 0.6, T_RAYS + 0.6), a: 1 - ease(tl, T_FACE - 1.2, T_FACE - 0.4) });
    items.push({ kind: 'text', at: [150, 130], text: [['f', 'math'], [' = 28 GHz', 'main']], size: 50, a: ease(tl, 1.0, 2.0), p: 1 });
    items.push({ kind: 'label', at: [-0.4, 0.2, 0.518], off: [-170, -150], text: 'Prediction', size: 54, p: ease(tl, T_PRED + 0.6, T_PRED + 1.8), a: 1 });
    const fl = ease(tl, T_SLIDE + 2.2, T_SLIDE + 3.4);
    items.push({ kind: 'text', at: [-0.4, 0.94, 0.518 + 0.07], align: 'center', text: 'Measurement', size: 54, p: 1, a: fl });
    items.push({ kind: 'text', at: [-0.4, -0.01, 0.518 + 0.07], align: 'center', text: 'Prediction', size: 54, p: 1, a: ease(tl, T_SLIDE + 2.6, T_SLIDE + 3.8) });
    return { cam, items };
  },
};
