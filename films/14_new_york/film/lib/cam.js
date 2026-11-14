// Cameras as plain data: position, a look direction, a focal length in pixels and a principal point.
// The card is: pos/right/up/fwd from bake.json, focal s = 19172.94 px and principal point (1689.6, 600.3)
// at 2560x1440 (origin bottom-left). Everything scales with W/2560.
import * as THREE from 'three';

export const CARD = {
  pos: [7.03923, 5.49965, 2.01682],
  right: [-0.6156615294995351, 0.7880107112814476, 0],
  up: [-0.09603403532719029, -0.0750300220886634, 0.9925462003575202],
  fwd: [-0.7821370373234277, -0.6110725118110629, -0.12186894664289731],
  s: 19172.9369989187, cx: 1689.600000000002, cy: 600.3010951689836, ref: 2560,
  target: [0, 0, 0.92], dist: 9.0,
};

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// Apply a camera spec {pos, fwd, up?, s (px at 2560 wide), cx, cy (px at 2560, bottom-left), roll?}.
export function applyCam(cam, spec, W, H, near = 0.01, far = 4000) {
  const k = W / CARD.ref;
  const p = V(spec.pos), f = V(spec.fwd).normalize();
  let up = spec.up ? V(spec.up) : new THREE.Vector3(0, 0, 1);
  let r = new THREE.Vector3().crossVectors(f, up).normalize();
  if (r.lengthSq() < 1e-8) r.set(1, 0, 0);
  up = new THREE.Vector3().crossVectors(r, f).normalize();
  if (spec.roll) { const q = new THREE.Quaternion().setFromAxisAngle(f, spec.roll); r.applyQuaternion(q); up.applyQuaternion(q); }
  const m = new THREE.Matrix4().makeBasis(r, up, f.clone().negate()).setPosition(p);
  cam.matrixAutoUpdate = false;
  cam.matrixWorld.copy(m); cam.matrix.copy(m); cam.matrixWorldInverse.copy(m).invert();
  cam.position.copy(p);
  const s = spec.s * k, cx = (spec.cx ?? CARD.ref / 2) * k, cy = (spec.cy ?? CARD.ref * 9 / 32) * k;
  cam.near = near; cam.far = far;
  cam.projectionMatrix.makePerspective(-cx / s * near, (W - cx) / s * near, (H - cy) / s * near, -cy / s * near, near, far);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  cam.userData = { s, cx, cy, W, H, right: r, up, fwd: f };
  return cam;
}

export const cardSpec = () => ({ pos: CARD.pos, fwd: CARD.fwd, up: CARD.up, s: CARD.s, cx: CARD.cx, cy: CARD.cy });

// Focal length (px at 2560 wide) for a vertical field of view in degrees, at 16:9.
export const sForFov = (deg) => (1440 / 2) / Math.tan(deg * Math.PI / 360);
export const fovForS = (s) => 2 * Math.atan(720 / s) * 180 / Math.PI;

// Smooth helpers.
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, u) => a + (b - a) * u;
export const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
export const smoother = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
export const ease = (t, t0, t1, f = smoother) => f(clamp((t - t0) / (t1 - t0)));
export const mix3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
export const add3 = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm3 = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function slerpDir(a, b, u) {
  a = norm3(a); b = norm3(b);
  const d = clamp(dot3(a, b), -1, 1), th = Math.acos(d);
  if (th < 1e-5) return a;
  const s = Math.sin(th);
  return norm3(add3(a.map((x) => x * Math.sin((1 - u) * th) / s), b, Math.sin(u * th) / s));
}
// Catmull-Rom through points, u in [0,1].
export function spline(pts, u) {
  const n = pts.length - 1, x = clamp(u) * n, i = Math.min(n - 1, Math.floor(x)), f = x - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  return p1.map((_, k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f * f + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f * f * f));
}
