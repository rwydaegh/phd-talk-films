// The ten city squares: Google photorealistic 3D tiles cached by the thesis study, graded to dusk in the black world.
// One scene per city in local ENU metres (z up), the same frame as the thesis routes and roofline segments.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const BG = [0.0021, 0.0027, 0.0041];   // #07090d in linear light

let DATA = null;
export async function cityData() {
  if (!DATA) DATA = await fetch('data/cities.json').then((r) => r.json());
  return DATA;
}

function enuMatrix(m) {
  const M = new THREE.Matrix4().set(...m[0], ...m[1], ...m[2], 0, 0, 0, 1);
  const Y2Z = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  return M.multiply(Y2Z);
}

// Route centroid and ground level of a city.
export function routeFrame(c) {
  const P = c.points.map((p) => p.p);
  const cx = P.reduce((s, p) => s + p[0], 0) / P.length, cy = P.reduce((s, p) => s + p[1], 0) / P.length;
  const g = c.points.reduce((s, p) => s + p.g, 0) / P.length;
  return { c: [cx, cy, g], g };
}

const cache = new Map();
// opts: { r0, r1 } fog radii around the route centroid (m).
const refs = new Map();
export function loadCity(c, opts = {}) {
  refs.set(c.site, (refs.get(c.site) || 0) + 1);
  if (cache.has(c.site)) return cache.get(c.site);
  const pr = (async () => {
    const { c: C } = routeFrame(c);
    const U = {
      uC: { value: new THREE.Vector3(...C) }, uR0: { value: opts.r0 ?? 70 }, uR1: { value: opts.r1 ?? 150 },
      uGain: { value: 1 }, uSat: { value: 0.5 }, uTint: { value: new THREE.Vector3(0.62, 0.72, 0.95) },
      uWarm: { value: 0 }, uLift: { value: 0 }, uKnee: { value: 0 }, uNear: { value: 0 }, uNearZ: { value: 0 },
    };
    const scene = new THREE.Scene();
    const tiles = new THREE.Group(); tiles.matrixAutoUpdate = false; tiles.matrix.copy(enuMatrix(c.enu)); scene.add(tiles);
    const graded = new Map();
    const grade = (src) => {
      const m = new THREE.MeshBasicMaterial({ map: src.map || null });
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nout vec3 vWP;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
          in vec3 vWP; uniform vec3 uC, uTint; uniform float uR0, uR1, uGain, uSat, uWarm, uLift, uKnee, uNear, uNearZ;`)
          .replace('#include <opaque_fragment>', `
          vec3 tex = pow(max(outgoingLight, 0.0), vec3(2.2));       // texture is display-referred
          float lum = dot(tex, vec3(0.2126, 0.7152, 0.0722));
          vec3 col = mix(vec3(lum), tex, uSat) * uTint * 0.42 * uGain;
          // a little warmth on the lit facades, as if the street lamps were on
          col += tex * vec3(0.30, 0.17, 0.07) * uWarm * smoothstep(0.02, 0.25, lum);
          col += uLift * vec3(0.002, 0.003, 0.005);
          col = col / (1.0 + uKnee * col);                          // soft shoulder for very bright surfaces (tents, glass)
          if (vWP.z > uNearZ && fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) > smoothstep(0.6 * uNear, uNear, distance(vWP, cameraPosition))) discard;   // clutter right in front of the lens dissolves
          float rr = length(vWP.xy - uC.xy);
          if (rr > uR1) discard;
          float fog = smoothstep(uR0, uR1, rr);
          col = mix(col, vec3(${BG.join(', ')}), fog);
          gl_FragColor = vec4(col, 1.0);`);
      };
      return m;
    };
    const base = `assets/tiles/${c.site}`;
    const man = await fetch(`${base}/manifest.json`).then((r) => r.json());
    const loader = new GLTFLoader();
    await Promise.all(man.tiles.map((t) => loader.loadAsync(`${base}/${t.file}`).then((g) => {
      g.scene.traverse((o) => { if (!o.isMesh) return; let gm = graded.get(o.material); if (!gm) { gm = grade(o.material); graded.set(o.material, gm); } o.material = gm; });
      tiles.add(g.scene);
    }).catch(() => {})));
    tiles.updateMatrixWorld(true);
    return { scene, tiles, U, city: c, centre: C };
  })();
  cache.set(c.site, pr);
  return pr;
}

export async function disposeCity(site) {
  if (!cache.has(site)) return;
  const r = (refs.get(site) || 1) - 1; refs.set(site, r);
  if (r > 0) return;
  const C = await cache.get(site); cache.delete(site);
  const tex = new Set();
  C.tiles.traverse((o) => { if (!o.isMesh) return; o.geometry.dispose(); if (o.material.map) tex.add(o.material.map); o.material.dispose(); });
  for (const t of tex) { t.dispose(); if (t.image && t.image.close) t.image.close(); }
}

export const jetGLSL = `vec3 jet(float v){ return clamp(vec3(1.5 - abs(4.0*v - 3.0), 1.5 - abs(4.0*v - 2.0), 1.5 - abs(4.0*v - 1.0)), 0.0, 1.0); }`;
export const jet = (v) => [1.5 - Math.abs(4 * v - 3), 1.5 - Math.abs(4 * v - 2), 1.5 - Math.abs(4 * v - 1)].map((x) => Math.min(1, Math.max(0, x)));
// Shared route-point colour: whole-body SAR on a log scale over two decades, the same for all ten cities.
export const SAR_LO = 0.004, SAR_HI = 0.4;
export const sarV = (s) => Math.min(1, Math.max(0, Math.log10(Math.max(s, 1e-9) / SAR_LO) / Math.log10(SAR_HI / SAR_LO)));
