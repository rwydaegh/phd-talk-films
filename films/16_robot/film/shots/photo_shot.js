// A still photo seen through its own camera, with a slow push.
// opts: name, dur, from/to framing {u0, v0, zoom}, labels(tl, photo) -> items
import * as THREE from 'three';
import { applyCam, ease, lerp, smoother } from '../lib/cam.js';
import { Photo } from '../lib/photo.js';
import { BG_HDR } from '../lib/common.js';

export function photoShot({ name, dur, from, to, labels, dim = () => 1, fadeIn = 0, fadeOut = 0 }) {
  let photo, scene, cam;
  const frame = (tl) => {
    const u = smoother(Math.min(1, Math.max(0, tl / dur)));
    // ease the move gently; a little constant drift keeps it alive at the ends
    const k = 0.15 * (tl / dur) + 0.85 * u;
    return { u0: lerp(from.u0, to.u0, k), v0: lerp(from.v0, to.v0, k), zoom: lerp(from.zoom, to.zoom, k) };
  };
  return {
    async init(ctx) {
      photo = await Photo.load(name);
      scene = new THREE.Scene(); scene.add(photo.group);
      cam = new THREE.PerspectiveCamera();
    },
    draw(tl, t, target, ctx) {
      applyCam(cam, photo.spec(frame(tl)), ctx.W, ctx.H, 0.05, 100);
      photo.uniforms.uDim.value = dim(tl);
      const r = ctx.renderer; r.setRenderTarget(target); r.setClearColor(BG_HDR, 1); r.clear(); r.render(scene, cam);
    },
    grade(tl) {
      let fade = 1;
      if (fadeIn) fade *= ease(tl, 0, fadeIn); if (fadeOut) fade *= 1 - ease(tl, dur - fadeOut, dur);
      return { bloom: 0.08, vignette: 0.45, grain: 0.012, fade };
    },
    labels(tl, t, ctx) { applyCam(cam, photo.spec(frame(tl)), ctx.W, ctx.H, 0.05, 100); return { cam, items: labels ? labels(tl, photo) : [] }; },
  };
}
