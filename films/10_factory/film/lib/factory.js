// The factory hall, built from film/data/scene{10,27}.json (tools/scene.py): concrete floor, walls and ceiling,
// metal machines (the chapter's cuboid scatterers, true sizes and positions), soft ceiling light.
// World frame: z up, metres. Everything here is static; shots animate cameras, rays and the worker.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { mulberry32 } from './prng.js';

export const BG = new THREE.Color('#07090d');

// Procedural concrete: value noise in a canvas, tiled; joints drawn every `joint` metres.
function concreteTex(seed, px, tileM, joint, base, vary, jointCol) {
  const cv = document.createElement('canvas'); cv.width = cv.height = px;
  const g = cv.getContext('2d');
  const rnd = mulberry32(seed);
  const img = g.createImageData(px, px);
  const grid = (n) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
  const octs = [[8, 0.45], [32, 0.3], [128, 0.17], [512, 0.08]].map(([n, w]) => [n, w, grid(n)]);
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    let v = 0;
    for (const [n, w, a] of octs) {
      const fx = (x / px) * n, fy = (y / px) * n, ix = Math.floor(fx), iy = Math.floor(fy), ux = fx - ix, uy = fy - iy;
      const s = (i, j) => a[((iy + j) % n) * n + ((ix + i) % n)];
      const sx = ux * ux * (3 - 2 * ux), sy = uy * uy * (3 - 2 * uy);
      v += w * ((s(0, 0) * (1 - sx) + s(1, 0) * sx) * (1 - sy) + (s(0, 1) * (1 - sx) + s(1, 1) * sx) * sy);
    }
    const k = (base + vary * (v - 0.5)) * 255;
    const o = (y * px + x) * 4; img.data[o] = k; img.data[o + 1] = k * 1.01; img.data[o + 2] = k * 1.04; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  if (joint) {
    g.strokeStyle = jointCol; g.lineWidth = Math.max(1, px / 700);
    const n = Math.round(tileM / joint);
    for (let i = 0; i <= n; i++) { const p = (i / n) * px; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, px); g.stroke(); g.beginPath(); g.moveTo(0, p); g.lineTo(px, p); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function fatLines(ctx, pts, { width = 1.5, color = 0xffffff, opacity = 1, depthTest = true } = {}) {
  const g = new LineSegmentsGeometry(); g.setPositions(pts);
  const m = new LineMaterial({ color, linewidth: width * ctx.scale, transparent: true, opacity, depthTest, depthWrite: false });
  m.resolution.set(ctx.W, ctx.H);
  const o = new LineSegments2(g, m); o.frustumCulled = false;
  return o;
}

/** Build the hall. Returns { group, env, sun, lamps, machines, room } */
export function buildHall(ctx, sc, { lamps = true } = {}) {
  const r = ctx.renderer;
  const group = new THREE.Group();
  const [lo, hi] = sc.room; const Lx = hi[0] - lo[0], Ly = hi[1] - lo[1], Lz = hi[2] - lo[2];
  const cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2;
  const pm = new THREE.PMREMGenerator(r);
  const env = pm.fromScene(new RoomEnvironment(), 0.02).texture;

  // floor: dark polished concrete, 5 m joints (the scatterer grid pitch)
  const tile = 10;
  const ft = concreteTex(11, 1024, tile, 5, 0.30, 0.16, 'rgba(10,12,16,0.85)');
  ft.repeat.set(Lx / tile, Ly / tile);
  const floorMat = new THREE.MeshStandardMaterial({ map: ft, color: 0x3c424b, roughness: 0.38, metalness: 0.0, envMap: env, envMapIntensity: 0.18 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(Lx, Ly), floorMat);
  floor.position.set(cx, cy, 0); floor.receiveShadow = true; group.add(floor);

  // walls and ceiling: rougher, darker concrete, panel joints every 2.5 m
  const wt = concreteTex(12, 512, 10, 2.5, 0.26, 0.12, 'rgba(6,7,10,0.9)');
  const wallMat = (w, h) => { const t = wt.clone(); t.needsUpdate = true; t.repeat.set(w / 10, h / 10); return new THREE.MeshStandardMaterial({ map: t, color: 0x3a4049, roughness: 0.85, envMap: env, envMapIntensity: 0.08 }); };
  const walls = [
    [Lx, Lz, [cx, lo[1], Lz / 2], [Math.PI / 2, 0, 0]],
    [Lx, Lz, [cx, hi[1], Lz / 2], [Math.PI / 2, Math.PI, 0]],
    [Ly, Lz, [lo[0], cy, Lz / 2], [Math.PI / 2, Math.PI / 2, 0]],
    [Ly, Lz, [hi[0], cy, Lz / 2], [Math.PI / 2, -Math.PI / 2, 0]],
  ];
  const wallMeshes = [];
  for (const [w, h, p, e] of walls) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat(w, h));
    m.position.set(...p); m.up.set(0, 0, 1); m.lookAt(cx, cy, Lz / 2); m.receiveShadow = true; group.add(m); wallMeshes.push(m);
    m.material.transparent = true;
  }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(Lx, Ly), new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.9, transparent: true }));
  ceil.position.set(cx, cy, Lz); ceil.rotation.x = Math.PI; group.add(ceil);
  // the room as line art, for when the near walls and the ceiling are faded away (cutaway)
  const E = new THREE.EdgesGeometry(new THREE.BoxGeometry(Lx, Ly, Lz)).attributes.position.array.slice();
  for (let i = 0; i < E.length; i += 3) { E[i] += cx; E[i + 1] += cy; E[i + 2] += Lz / 2; }
  const edges = fatLines(ctx, E, { width: 1.4, color: 0x9aa6b8, opacity: 0 }); group.add(edges);

  // roof beams every 5 m along x (steel, under the ceiling)
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x3a404a, roughness: 0.55, metalness: 0.6, envMap: env, envMapIntensity: 0.4, transparent: true });
  const beams = [];
  const bd = Math.min(0.5, Lz * 0.05);
  for (let x = lo[0] + 5; x < hi[0] - 0.1 && false; x += 5) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.25, Ly, bd), beamMat); b.position.set(x, cy, Lz - bd / 2); group.add(b); beams.push(b);
  }

  // ceiling light strips (emissive, they bloom) between beams, plus their light on the floor
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.62, 1.7), transparent: true });
  const lampsList = [];
  if (lamps) {
    for (let x = lo[0] + 7.5; x < hi[0] - 2; x += 10) for (let y = lo[1] + 5; y < hi[1] - 2; y += 10) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.2, 0.06), lampMat); l.position.set(x, y, Lz - 0.06); group.add(l); lampsList.push(l);
    }
  }

  // machines: the chapter's metal cuboids, softly rounded so the edges catch light
  const metal = new THREE.MeshStandardMaterial({ color: 0x4d5868, roughness: 0.38, metalness: 0.8, envMap: env, envMapIntensity: 0.2 });
  const machines = new THREE.Group();
  for (const m of sc.machines) {
    const geo = new RoundedBoxGeometry(m.s[0], m.s[1], m.s[2], 3, 0.03);
    const b = new THREE.Mesh(geo, metal); b.position.set(...m.c); b.rotation.z = m.yaw; b.castShadow = true; b.receiveShadow = true;
    machines.add(b);
  }
  group.add(machines);

  // light: cool sky fill + one high key that casts soft shadows on the floor
  group.add(new THREE.HemisphereLight(0x9fb0c8, 0x0c0e12, 0.22));
  const sun = new THREE.DirectionalLight(0xfff1e2, 0.75);
  sun.position.set(cx - 0.25 * Lx, cy - 0.35 * Ly, Lz * 6); sun.target.position.set(cx, cy, 0);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  const R = Math.max(Lx, Ly) * 0.62; Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: Lz * 12 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
  group.add(sun, sun.target);
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;

  // opacities: ceiling (with beams and lamps), each wall [y-lo, y-hi, x-lo, x-hi], room edges
  const setCut = ({ ceiling = 1, walls = [1, 1, 1, 1], edgeA = 0 } = {}) => {
    ceil.material.opacity = ceiling; ceil.visible = ceiling > 0.003;
    beamMat.opacity = ceiling; for (const b of beams) b.visible = ceiling > 0.003;
    lampMat.opacity = ceiling; for (const l of lampsList) l.visible = ceiling > 0.003;
    wallMeshes.forEach((m, i) => { m.material.opacity = walls[i]; m.visible = walls[i] > 0.003; m.material.depthWrite = walls[i] > 0.99; });
    ceil.material.depthWrite = ceiling > 0.99;
    edges.material.opacity = edgeA; edges.visible = edgeA > 0.003;
  };
  return { group, env, sun, lamps: lampsList, machines, floor, setCut, room: { lo, hi, Lx, Ly, Lz, cx, cy } };
}

/** The fog that sinks the far hall into the film's black. */
export function hallFog(scene, near, far) { scene.fog = new THREE.Fog(BG, near, far); scene.background = BG; }
