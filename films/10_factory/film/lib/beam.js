// S5b beam: translucent additive lobes (nested shells on a parametric tube, shaded by facing ratio so the
// centre reads as thicker light), thin rays inside them, and short bright pulses with tails at ~40 m/s.
// Everything is set per frame from t: no state carries between frames.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export const RAY = new THREE.Color('#bfefff');

// ---- lobe -------------------------------------------------------------------
const LOBE_VS = `
attribute vec2 st;
uniform vec3 uA, uB, uE1, uE2; uniform float uR0, uR1, uBulge;
varying vec3 vP;
void main(){
  float s = st.x, th = st.y;
  float r = 1.7 * (mix(uR0, uR1, s) + uBulge * sin(3.14159265 * s));   // hull: the visible glow sits inside
  vec3 radial = cos(th) * uE1 + sin(th) * uE2;
  vec3 p = uA + (uB - uA) * s + radial * r;
  vP = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
// Each back-face fragment integrates a Gaussian density around the beam axis along its view ray:
// distance of closest approach between the view ray and the axis, radius at that point, and a path-length
// factor that grows when the view runs along the beam. Reads as a soft volume from any angle.
const LOBE_FS = `
uniform vec3 uA, uB, uCol; uniform float uR0, uR1, uBulge, uI, uFront, uTail, uFadeIn, uFadeOut, uPhase, uRip, uK;
varying vec3 vP;
void main(){
  vec3 ro = cameraPosition, rd = normalize(vP - ro);
  vec3 ax = uB - uA; float L = length(ax); vec3 ad = ax / L;
  vec3 w0 = ro - uA;
  float b = dot(rd, ad), d = dot(rd, w0), e = dot(ad, w0);
  float den = max(1.0 - b * b, 1e-4);
  float t = (b * e - d) / den, s = (e - b * d) / den;
  float sc = clamp(s / L, 0.0, 1.0);
  vec3 pr = ro + rd * max(t, 0.0), pa = uA + ad * (sc * L);
  float dist = length(pr - pa);
  float r = mix(uR0, uR1, sc) + uBulge * sin(3.14159265 * sc);
  float dens = exp(-uK * dist * dist / (r * r));
  float path = min(1.0 / sqrt(den), 3.0);
  float along = smoothstep(0.0, uFadeIn, sc) * (1.0 - smoothstep(1.0 - uFadeOut, 1.0, sc));
  float front = 1.0 - smoothstep(uFront - 0.05, uFront, sc);
  float tail = smoothstep(uTail - 0.05, uTail, sc);
  float rip = 1.0 + uRip * (0.5 + 0.5 * cos(6.2831853 * (sc * L - uPhase) / 9.0));
  gl_FragColor = vec4(uCol * (uI * dens * path * along * front * tail * rip), 1.0);
}`;

function tubeGeometry(nS = 64, nT = 48) {
  const st = [], idx = [];
  for (let i = 0; i <= nS; i++) for (let j = 0; j <= nT; j++) st.push(i / nS, (j / nT) * Math.PI * 2);
  for (let i = 0; i < nS; i++) for (let j = 0; j < nT; j++) {
    const a = i * (nT + 1) + j, b = a + nT + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('st', new THREE.Float32BufferAttribute(st, 2));
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Array((nS + 1) * (nT + 1) * 3).fill(0), 3));
  g.setIndex(idx);
  return g;
}

export class Lobe {
  // shells: [radius scale, intensity, sharpness k of the Gaussian]
  constructor({ shells = [[1.0, 0.06, 1.1], [0.5, 0.075, 1.5], [0.2, 0.09, 2.0]] } = {}) {
    this.group = new THREE.Group();
    this.geo = tubeGeometry();
    this.shells = shells.map(([rs, I, k]) => {
      const m = new THREE.ShaderMaterial({
        vertexShader: LOBE_VS, fragmentShader: LOBE_FS,
        uniforms: {
          uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() },
          uE1: { value: new THREE.Vector3() }, uE2: { value: new THREE.Vector3() },
          uR0: { value: 0.3 }, uR1: { value: 0.3 }, uBulge: { value: 0 },
          uCol: { value: RAY.clone() }, uI: { value: I }, uFront: { value: 1.1 }, uTail: { value: -0.1 }, uK: { value: k },
          uFadeIn: { value: 0.03 }, uFadeOut: { value: 0.08 }, uPhase: { value: 0 }, uRip: { value: 0.35 },
        },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide, fog: false,
      });
      const mesh = new THREE.Mesh(this.geo, m);
      mesh.frustumCulled = false; mesh.renderOrder = 7;
      this.group.add(mesh);
      return { rs, I, m, mesh };
    });
  }

  /** a, b: Vector3 ends; r0, r1 radii; o: {gain, front (0..1 of length), tail, phase [m], bulge} */
  set(a, b, r0, r1, o = {}) {
    const ax = new THREE.Vector3().subVectors(b, a), L = ax.length(); ax.normalize();
    const e1 = new THREE.Vector3(0, 0, 1).cross(ax);
    if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0);
    e1.normalize();
    const e2 = ax.clone().cross(e1).normalize();
    for (const s of this.shells) {
      const u = s.m.uniforms;
      u.uA.value.copy(a); u.uB.value.copy(b); u.uE1.value.copy(e1); u.uE2.value.copy(e2);
      u.uR0.value = r0 * s.rs; u.uR1.value = r1 * s.rs; u.uBulge.value = (o.bulge ?? 0) * s.rs;
      u.uI.value = s.I * (o.gain ?? 1);
      u.uFront.value = o.front ?? 1.1; u.uTail.value = o.tail ?? -0.1;
      u.uPhase.value = o.phase ?? 0;
      u.uFadeIn.value = o.fadeIn ?? 0.03; u.uFadeOut.value = o.fadeOut ?? 0.08;
    }
    this.group.visible = (o.gain ?? 1) > 0.002;
  }

  dispose() { this.geo.dispose(); for (const s of this.shells) s.m.dispose(); }
}

// ---- rays and pulses --------------------------------------------------------
const PT_VS = `attribute float size; attribute vec3 color; varying vec3 vC;
  void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * mv; gl_PointSize = size; }`;
const PT_FS = `varying vec3 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.;
  float a = exp(-r * r * 5.) + 0.6 * exp(-r * r * 40.); if (r > 1.) discard; gl_FragColor = vec4(vC * a, 1.); }`;

export class RayLayer {
  constructor(ctx, { maxSeg = 4000, maxPts = 6000, core = 1.5, glow = 8 } = {}) {
    this.ctx = ctx; this.maxSeg = maxSeg; this.maxPts = maxPts;
    const mk = (w) => {
      const m = new LineMaterial({ vertexColors: true, linewidth: w * ctx.scale, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      m.resolution.set(ctx.W, ctx.H);
      const g = new LineSegmentsGeometry();
      g.setPositions(new Float32Array(maxSeg * 6)); g.setColors(new Float32Array(maxSeg * 6));
      const o = new LineSegments2(g, m); o.frustumCulled = false; o.renderOrder = 8;
      return { m, g, o };
    };
    this.core = mk(core); this.glow = mk(glow);
    this.segPos = new Float32Array(maxSeg * 6); this.segCol = new Float32Array(maxSeg * 6);
    const pg = new THREE.BufferGeometry();
    this.pPos = new Float32Array(maxPts * 3); this.pCol = new Float32Array(maxPts * 3); this.pSize = new Float32Array(maxPts);
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    pg.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    this.ptGeo = pg;
    this.ptMat = new THREE.ShaderMaterial({ vertexShader: PT_VS, fragmentShader: PT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(pg, this.ptMat); this.points.frustumCulled = false; this.points.renderOrder = 9;
    this.group = new THREE.Group();
    this.group.add(this.glow.o, this.core.o, this.points);
    this.ns = 0; this.np = 0;
  }

  begin() { this.ns = 0; this.np = 0; }

  seg(a, b, k) {
    if (this.ns >= this.maxSeg || k < 0.003) return;
    this.segPos.set([a[0], a[1], a[2], b[0], b[1], b[2]], this.ns * 6);
    const r = RAY.r * k, g = RAY.g * k, bb = RAY.b * k;
    this.segCol.set([r, g, bb, r, g, bb], this.ns * 6); this.ns++;
  }

  pt(p, k, sizePx, col = RAY) {
    if (this.np >= this.maxPts || k < 0.003) return;
    this.pPos.set(p, this.np * 3); this.pCol.set([col.r * k, col.g * k, col.b * k], this.np * 3);
    this.pSize[this.np] = sizePx * this.ctx.scale; this.np++;
  }

  end(glowGain = 0.12) {
    const up = (L, colScale) => {
      const ip = L.g.attributes.instanceStart.data; ip.array.set(this.segPos); ip.needsUpdate = true;
      const ic = L.g.attributes.instanceColorStart.data;
      if (colScale === 1) ic.array.set(this.segCol); else for (let i = 0; i < this.ns * 6; i++) ic.array[i] = this.segCol[i] * colScale;
      ic.needsUpdate = true; L.g.instanceCount = this.ns;
    };
    up(this.core, 1); up(this.glow, glowGain);
    this.ptGeo.setDrawRange(0, this.np);
    for (const k of ['position', 'color', 'size']) this.ptGeo.attributes[k].needsUpdate = true;
  }

  dispose() {
    for (const L of [this.core, this.glow]) { L.g.dispose(); L.m.dispose(); }
    this.ptGeo.dispose(); this.ptMat.dispose();
  }
}

/** A polyline path with cumulative length, for pulses. pts: array of [x,y,z]. */
export function makePath(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  return { pts, cum, L: cum[cum.length - 1] };
}

export function pointAt(path, s) {
  const { pts, cum } = path;
  s = Math.max(0, Math.min(path.L, s));
  let i = 1; while (i < pts.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i];
  const u = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/**
 * Draw a path: a faint full line (alpha*trail), up to `front` metres drawn (beam forming), and travelling pulses.
 * o: {alpha, trail, front [m], head0 [m] phase offset, gap [m], speed [m/s], t [s], tail [m], tailN, size, dots}
 */
export function drawPath(L, path, o) {
  const { alpha = 1, trail = 0.15, front = Infinity, gap = 40, t = 0, speed = 40, ph = 0, tail = 2.2, tailN = 8, size = 8 } = o;
  const { pts, cum } = path;
  const endFade = o.endFade || 0;    // metres before the end over which the path dissolves
  const fadeAt = (sv) => (endFade > 0 ? Math.min(1, Math.max(0, (path.L - sv) / endFade)) : 1);
  const cam = o.cam;                 // heads shrink with distance from the camera
  const sizeAt = (p) => {
    if (!cam) return size;
    const d = Math.hypot(p[0] - cam.x, p[1] - cam.y, p[2] - cam.z);
    return size * Math.min(1.25, Math.max(0.4, (o.refDist || 12) / d));
  };
  // faint line, cut at the forming front
  for (let j = 1; j < pts.length; j++) {
    if (cum[j - 1] >= front) break;
    const segEnd = Math.min(cum[j], front);
    if (endFade > 0 && j === pts.length - 1) {
      // split the last segment so its brightness can fall off towards the end
      const n2 = 6, s0 = cum[j - 1];
      for (let q = 0; q < n2; q++) {
        const a0 = s0 + ((segEnd - s0) * q) / n2, a1 = s0 + ((segEnd - s0) * (q + 1)) / n2;
        L.seg(pointAt(path, a0), pointAt(path, a1), alpha * trail * fadeAt(a1));
      }
    } else L.seg(pts[j - 1], cum[j] <= front ? pts[j] : pointAt(path, front), alpha * trail);
  }
  // pulses: heads at ph + speed*t - k*gap; each is a bright head with a streak tail that fades to nothing
  const period = gap;
  const head0 = ((speed * t + ph) % period + period) % period;
  const n = tailN;
  for (let h = head0; h <= path.L + tail; h += period) {
    if (h - tail > front) continue;
    for (let q = 0; q < n; q++) {
      const s0 = Math.min(h - (q * tail) / n, path.L), s1 = Math.min(h - ((q + 1) * tail) / n, path.L);
      if (s0 <= 0 || s1 >= Math.min(path.L, front)) continue;
      const k = alpha * 1.25 * Math.pow(1 - (q + 0.5) / n, 1.6) * fadeAt(s0);
      L.seg(pointAt(path, Math.max(0, s1)), pointAt(path, Math.min(s0, front)), k);
    }
    if (h >= 0 && h <= path.L && h <= front) {
      const p = pointAt(path, h), f = fadeAt(h), sz = sizeAt(p);
      L.pt(p, alpha * 1.1 * f, sz);
      L.pt(p, alpha * 0.35 * f, sz * 2.6);
    }
    // reflection dots flash as the pulse passes
    if (o.dots) for (let j = 1; j < pts.length - 1; j++) {
      const dh = h - cum[j];
      if (dh >= 0 && dh < 8) L.pt(pts[j], alpha * 1.4 * Math.exp(-dh / 2.5), 6 + 8 * Math.exp(-dh / 2.5));
    }
  }
  if (o.dots) for (let j = 1; j < pts.length - 1; j++) if (cum[j] <= front) L.pt(pts[j], alpha * 0.55, 5);
}
