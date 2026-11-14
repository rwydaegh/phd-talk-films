// CARD: the invitation card, alive, for the pre-show loop. It is film 1's C1 at tl = 0 (same camera, air, grade and
// renderer) with only the card clock running. Everything in the card has a 24 s period (focus path, twinkle, streak slots),
// so frames 0..719 at 30 fps loop seamlessly, and frame 0 is film 1's frame 0.
// ?tc0=S offsets the card clock (seam test: tc0=24 at t=0 must equal frame 0).
import * as THREE from 'three';
import { Card3D, loadCardData, CARD_AIR, CARD_HAZE } from '../lib/card3d.js';
import { applyCam } from '../lib/cam.js';
import { c1Camera } from './c1_stars.js';

let card, scene, cam, tc0 = 0;

export default {
  async init(ctx) {
    const D = await loadCardData();
    card = new Card3D(D, ctx.W, ctx.H);
    scene = new THREE.Scene(); scene.add(card.group);
    cam = new THREE.PerspectiveCamera();
    tc0 = +(ctx.q.get('tc0') || 0);
  },
  draw(tl, t, target, ctx) {
    applyCam(cam, c1Camera(0, null), ctx.W, ctx.H, 0.005, 100);
    card.update({ tc: tl + tc0, cam, air: CARD_AIR, haze: CARD_HAZE, starBoost: new Float32Array(120), extraLines: [], extraStars: [] });
    const r = ctx.renderer;
    r.setRenderTarget(target); r.setClearColor(0x000000, 1); r.clear();
    r.render(scene, cam);
  },
  grade() {
    return { bloom: 0.55, motionBlur: 0, shutter: 0.5, ca: 0, zoomBlur: 0 };
  },
};
