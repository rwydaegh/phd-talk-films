// The multipath field as a sum of plane waves, evaluated per fragment.
// Each ray-traced path p arrives as a plane wave with direction k_p and complex amplitude a_p (phase referred to
// the point uRef). A precoder changes the a_p; several precoders are stored as rows and blended with uPRow.
//   E(r)     = sum_p a_p exp(i k k_p.(r - ref))                       (incident field, no body)
//   S_ab(r)  = | sum_p a_p sqrt(T(th_p) max(0, -n.k_p)) exp(i k k_p.(r - ref)) |^2   (on the skin, chapter 5 form)
// Data texture (RGBA float): row 0 = (k_p, 0); row 1 + j = (Re a_p, Im a_p, 0, 0) for precoder j.
import * as THREE from 'three';

export const MAXP = 256;

export const FIELD_GLSL = `
uniform sampler2D uPF; uniform int uPN; uniform float uPRow, uPK, uPWt, uPAlias; uniform vec3 uPRef;
vec2 pfA(int i){
  float r0 = floor(uPRow), f = uPRow - r0;
  vec2 a = texelFetch(uPF, ivec2(i, int(r0) + 1), 0).xy;
  vec2 b = texelFetch(uPF, ivec2(i, int(r0) + 2), 0).xy;
  return mix(a, b, f);
}
// coherent field (x: re, y: im) and incoherent power (z)
vec3 pfE(vec3 p){
  vec2 S = vec2(0.0); float inc = 0.0;
  for (int i = 0; i < ${MAXP}; i++) {
    if (i >= uPN) break;
    vec3 k = texelFetch(uPF, ivec2(i, 0), 0).xyz;
    vec2 a = pfA(i);
    float ph = uPK * dot(k, p - uPRef);
    float c = cos(ph), s = sin(ph);
    S += vec2(a.x * c - a.y * s, a.x * s + a.y * c);
    inc += dot(a, a);
  }
  return vec3(S, inc);
}
// pixel footprint -> how far the fringes are from being resolved (0 = resolved)
float pfAliasAt(vec3 p){ return smoothstep(0.5, 1.2, 2.0 * uPK * length(fwidth(p)) * uPAlias); }   // 2k: counter-propagating waves
// instantaneous real field, with the fringes faded to the local rms where they would alias
float pfReal(vec3 p){
  vec3 e = pfE(p);
  float ph = -uPWt;
  float re = e.x * cos(ph) - e.y * sin(ph);
  float al = pfAliasAt(p);
  return mix(re, sign(re) * sqrt(0.5 * (e.x * e.x + e.y * e.y)), al);
}
float pfPow(vec3 p){ vec3 e = pfE(p); float al = pfAliasAt(p); return mix(dot(e.xy, e.xy), e.z, al); }
// absorbed power density on skin with outward normal n
float pfSkin(vec3 p, vec3 n){
  vec2 S = vec2(0.0); float inc = 0.0;
  for (int i = 0; i < ${MAXP}; i++) {
    if (i >= uPN) break;
    vec3 k = texelFetch(uPF, ivec2(i, 0), 0).xyz;
    float c = max(0.0, -dot(n, k));
    if (c <= 0.0) continue;
    float T = 1.0 - pow(1.0 - c, 4.0);           // Fresnel transmission falls to zero at grazing
    vec2 a = pfA(i) * sqrt(c * T);
    float ph = uPK * dot(k, p - uPRef);
    float cc = cos(ph), s = sin(ph);
    S += vec2(a.x * cc - a.y * s, a.x * s + a.y * cc);
    inc += dot(a, a);
  }
  float al = pfAliasAt(p);
  return mix(dot(S, S), inc, al);
}
`;

export class PathField {
  /** paths: [{k:[3], a:[[re,im] per row]}]; rows: number of precoders */
  constructor(paths, rows, { k = 2 * Math.PI / 0.0107, ref = [0, 0, 0] } = {}) {
    const N = Math.min(MAXP, paths.length);
    const H = rows + 2;
    const data = new Float32Array(MAXP * H * 4);
    for (let i = 0; i < N; i++) {
      const p = paths[i];
      data.set([p.k[0], p.k[1], p.k[2], 0], i * 4);
      for (let r = 0; r < rows + 1; r++) {
        const a = p.a[Math.min(r, rows - 1)];
        data.set([a[0], a[1], 0, 0], ((r + 1) * MAXP + i) * 4);
      }
    }
    this.tex = new THREE.DataTexture(data, MAXP, H, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    this.rows = rows;
    this.u = {
      uPF: { value: this.tex }, uPN: { value: N }, uPRow: { value: 0 }, uPK: { value: k }, uPWt: { value: 0 },
      uPRef: { value: new THREE.Vector3(...ref) }, uPAlias: { value: 1 },
    };
  }
  /** scale each path's amplitude in row r by w[i] (paths arriving one by one) */
  setWeights(w, base, r = 0) {
    const d = this.tex.image.data, M = MAXP;
    for (let i = 0; i < this.u.uPN.value; i++) { const a = base[i]; d.set([a[0] * w[i], a[1] * w[i]], ((r + 1) * M + i) * 4); if (r + 1 === this.rows) d.set([a[0] * w[i], a[1] * w[i]], ((r + 2) * M + i) * 4); }
    this.tex.needsUpdate = true;
  }
  /** blend position along the precoder rows, 0..rows-1 */
  setRow(x) { this.u.uPRow.value = Math.max(0, Math.min(this.rows - 1 - 1e-4, x)); }
}
