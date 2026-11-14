// Debug: the walker at the origin of the plaza, camera from ?cam (relative to the head), ?tw ?tp
import * as THREE from 'three';
import { loadWorld, U } from '../lib/world.js';
import { loadWalker, poseWalker, boneW, phoneAtEar } from '../lib/walker.js';
import { applyCam, sForFov } from '../lib/cam.js';
let W, wk, cam, lights;
const P0 = [60, 95, -20.6];
export default {
  async init(ctx) {
    W = await loadWorld(); cam = new THREE.PerspectiveCamera();
    wk = await loadWalker(ctx, W.scene);
    lights = new THREE.Group();
    lights.add(new THREE.HemisphereLight(0x8aa4dd, 0x0c0e14, 0.9));
    const k = new THREE.DirectionalLight(0xb8c8ff, 1.2); k.position.set(-60, 40, 80); lights.add(k);
    const r = new THREE.DirectionalLight(0xffc49a, 0.8); r.position.set(-40, -80, 20); lights.add(r);
    W.scene.add(lights);
  },
  draw(tl, t, target, ctx) {
    const q = ctx.q;
    const J = (k, d) => (q.get(k) || d).split(',').map(Number);
    poseWalker(wk, { pos: P0, heading: +(q.get('hd') || 200) * Math.PI / 180, tw: +(q.get('tw') || 0.3), tp: +(q.get('tp') || 1),
      phoneOff: J('po', '0,0.09,0.03'), phoneRot: J('pr', '0,0,0') });
    phoneAtEar(wk, JSON.parse(q.get('pp') || '{}'));
    const head = boneW(wk, 'Head');
    const c = J('cam', '0.6,-0.6,0.0,0,0,0,30');
    const pos = [head.x + c[0], head.y + c[1], head.z + c[2]], look = [head.x + c[3], head.y + c[4], head.z + c[5]];
    applyCam(cam, { pos, fwd: [look[0] - pos[0], look[1] - pos[1], look[2] - pos[2]], s: sForFov(c[6]), cx: 1280, cy: 720 }, ctx.W, ctx.H, 0.01, 5000);
    U.uFocus.value.set(...pos); U.uEye.value.set(...pos);
    const r = ctx.renderer; r.setRenderTarget(target); r.setClearColor(0, 1); r.clear(); r.render(W.scene, cam);
  },
  grade() { return { bloom: 0.3, vignette: 0.4, grain: 0.0 }; },
};
window.armDbg = () => {
  const out = [];
  for (let tp = 0; tp < wk.phoneClip.duration; tp += 0.5) {
    poseWalker(wk, { pos: P0, heading: 0, tw: 0.3, tp });
    const h = boneW(wk, 'Head'), r = boneW(wk, 'RightHand'), l = boneW(wk, 'LeftHand');
    out.push([tp.toFixed(1), r.clone().sub(h).toArray().map((x) => x.toFixed(2)).join(','), l.clone().sub(h).toArray().map((x) => x.toFixed(2)).join(',')]);
  }
  return JSON.stringify({ dur: wk.phoneClip.duration, walk: wk.walk.duration, out });
};
window.footDbg = () => {
  const out = []; const T = wk.walk.duration;
  for (let i = 0; i < 60; i++) {
    const tw = i * T / 60; poseWalker(wk, { pos: [0, 0, 0], heading: 0, tw });
    const l = boneW(wk, 'LeftToeBase'), r = boneW(wk, 'RightToeBase');
    out.push([tw.toFixed(3), l.x.toFixed(3), l.z.toFixed(3), r.x.toFixed(3), r.z.toFixed(3)]);
  }
  return JSON.stringify(out);
};
