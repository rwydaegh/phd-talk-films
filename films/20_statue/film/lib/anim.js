// Keyframed values with smooth, continuous velocity (cubic Hermite, Catmull-Rom tangents on a
// non-uniform time grid, zero velocity at the first and last key). keys: [[t, v0, v1, ...], ...]
export function track(keys) {
  const n = keys.length, dim = keys[0].length - 1;
  const tan = keys.map((k, i) => {
    if (i === 0 || i === n - 1) return new Array(dim).fill(0);
    const a = keys[i - 1], b = keys[i + 1];
    if (k.hold) return new Array(dim).fill(0);
    return Array.from({ length: dim }, (_, j) => (b[j + 1] - a[j + 1]) / (b[0] - a[0]));
  });
  return (t) => {
    if (t <= keys[0][0]) return keys[0].slice(1);
    if (t >= keys[n - 1][0]) return keys[n - 1].slice(1);
    let i = 0; while (t > keys[i + 1][0]) i++;
    const a = keys[i], b = keys[i + 1], h = b[0] - a[0], u = (t - a[0]) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    return Array.from({ length: dim }, (_, j) => h00 * a[j + 1] + h10 * h * tan[i][j] + h01 * b[j + 1] + h11 * h * tan[i + 1][j]);
  };
}
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, u) => a + (b - a) * u;
export const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
export const smoother = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
export const ease = (t, t0, t1, f = smoother) => f(clamp((t - t0) / (t1 - t0)));
export const add3 = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm3 = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const mix3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
// direction from azimuth (deg, 0 = +y front, 90 = +x) and elevation (deg)
export const dirAE = (az, el) => { const a = az * Math.PI / 180, e = el * Math.PI / 180; return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)]; };
