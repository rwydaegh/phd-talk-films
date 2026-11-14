// The route on the ground and the pedestrian along it, as a chronophotograph: the body appears at every route point
// of the thesis run in turn (facing the direction of travel, with that point's absorbed power density), the previous
// positions fade, and each visited point keeps a dot coloured by its whole-body SAR (shared log scale, all ten cities).
import * as THREE from 'three';
import { makeDuke, maxDb, base } from './duke.js';
import { makeBeams, makeDots } from './beams.js';
import { jet, sarV } from './city.js';
import { clamp, ease, smooth } from './cam.js';

export const GHOSTS = 5;

// k0: global index of the city's first route point in sab.bin
// keep: every position keeps its body (a chronophotograph); otherwise a pool of GHOSTS bodies trails the walker.
export async function makeWalk(city, k0, { t0 = 0.3, rate = 10, dotR = 6, fadeGhost = 0.45, keep = false } = {}) {
  const P = city.points;
  const n = P.length;
  const G = new THREE.Group(); G.userData.walk = true;
  const lift = 0.15;
  const at = (p) => [p.p[0], p.p[1], p.g + lift];
  const times = P.map((_, j) => t0 + j / rate);
  // route line, drawn on just ahead of the walker
  const segs = [];
  for (let j = 1; j < n; j++) segs.push({ A: at(P[j - 1]), B: at(P[j]), t0: times[j - 1], t1: times[j], col: [0.9, 0.93, 1.0], a: 0.55, w: 2.0 });
  const line = makeBeams(segs, { depthTest: false });   // street furniture must not break the route
  const dots = makeDots(P.map((p, j) => ({ P: at(p), t0: times[j], rise: 0.12, col: jet(sarV(p.sar)).map((x) => x ** 2.2 * 1.6), a: 1, r: dotR })));
  G.add(line.mesh, dots.mesh);
  await base();
  const mx = maxDb(k0, k0 + n);
  const bodies = [];
  const NB = keep ? n : GHOSTS;
  for (let i = 0; i < NB; i++) {
    const d = await makeDuke(); d.U.uLit.value = 1; d.U.uHi.value = mx; d.U.uLo.value = mx - 8;
    d.mesh.material.transparent = true; d.mesh.renderOrder = 5 + i;
    G.add(d.mesh); bodies.push(d);
  }
  return {
    group: G, times, n,
    update(tl, cam, W, H, { ghosts = true } = {}) {
      line.update(tl, cam, W, H); dots.update(tl, W, H);
      if (keep) {
        bodies.forEach((b, j) => {
          const a = ease(tl, times[j], times[j] + 0.1, smooth);
          b.mesh.visible = a > 0.003;
          if (!b.placed) { b.place(P[j].p[0], P[j].p[1], P[j].g, P[j].yaw); b.setBlocks(k0 + j, k0 + j, 0); b.placed = true; }
          b.U.uAlpha.value = a; b.U.uEye.value.copy(cam.position);
          b.mesh.material.depthWrite = a > 0.95;
        });
        return;
      }
      // which point is current
      const x = (tl - t0) * rate;
      const cur = clamp(Math.floor(x), 0, n - 1);
      for (let i = 0; i < GHOSTS; i++) {
        const j = cur - i, b = bodies[i];
        if (j < 0 || tl < t0) { b.mesh.visible = false; continue; }
        const age = (tl - times[j]);                      // seconds since the body arrived at point j
        const isCur = i === 0;
        const a = isCur ? ease(tl, times[j], times[j] + 0.06, smooth) * (j === n - 1 ? 1 : 1) : (ghosts ? 0.55 * Math.max(0, 1 - (age - 1 / rate) / fadeGhost) : 0);
        b.mesh.visible = a > 0.003;
        b.place(P[j].p[0], P[j].p[1], P[j].g, P[j].yaw);
        b.setBlocks(k0 + j, k0 + j, 0);
        b.U.uAlpha.value = a; b.U.uEye.value.copy(cam.position);
        b.mesh.material.depthWrite = a > 0.95;
      }
    },
  };
}
