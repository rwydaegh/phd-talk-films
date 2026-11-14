// Debug view: camera from ?cam=px,py,pz,lx,ly,lz,fov
import * as THREE from 'three';
import { loadWorld, U } from '../lib/world.js';
import { applyCam, sForFov } from '../lib/cam.js';
let W, cam;
export default {
  async init(ctx) { W = await loadWorld(); cam = new THREE.PerspectiveCamera(); },
  draw(tl, t, target, ctx) {
    const c = (ctx.q.get('cam') || '-199,-210,360,35,79,-28,35').split(',').map(Number);
    applyCam(cam, { pos: c.slice(0, 3), fwd: [c[3] - c[0], c[4] - c[1], c[5] - c[2]], s: sForFov(c[6]), cx: 1280, cy: 720 }, ctx.W, ctx.H, +(ctx.q.get('near')||0.3), 8000);
    U.uFocus.value.set(c[3], c[4], c[5]); U.uCity.value = +(ctx.q.get('gain') || 1); U.uEye.value.set(c[0], c[1], c[2]); U.uFogK.value = ctx.q.has('nofog') ? 0 : 1; U.uFogR.value = +(ctx.q.get('fog') || 400);
    const r = ctx.renderer; r.setRenderTarget(target); r.setClearColor(0, 1); r.clear(); r.render(W.scene, cam);
  },
  grade() { return { bloom: 0.3, vignette: 0.4, grain: 0.0 }; },
};
