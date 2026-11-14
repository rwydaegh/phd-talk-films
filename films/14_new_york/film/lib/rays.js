// Rays as camera-facing ribbons (constant pixel width, additive), with pulses that run from source to receiver.
// Paths are polylines rebuilt every frame: setPaths([{ pts: [[x,y,z],...], w, a, ph }]).
import * as THREE from 'three';

const VS = `
in vec3 position; in vec2 side_u; in vec4 info; in vec4 amp;      // info: s0, s1 (distance from the source), total, width scale
uniform mat4 viewMatrix, projectionMatrix;
out float vS; out float vEdge; out vec4 vInfo; out vec4 vAmp;
void main(){
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  vS = mix(info.x, info.y, side_u.y); vEdge = side_u.x; vInfo = info; vAmp = amp;
}`;


export class Rays {
  constructor(max = 2400) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    this.su = new Float32Array(max * 4 * 2); this.info = new Float32Array(max * 4 * 4); this.amp = new Float32Array(max * 4 * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      const o = i * 4; idx.set([o, o + 1, o + 2, o + 2, o + 1, o + 3], i * 6);
      this.su.set([-1, 0, 1, 0, -1, 1, 1, 1], o * 2);
    }
    g.setAttribute('side_u', new THREE.BufferAttribute(this.su, 2)); g.setAttribute('info', new THREE.BufferAttribute(this.info, 4));
    g.setAttribute('amp', new THREE.BufferAttribute(this.amp, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 4 * 3), 3));
    this.geo = g;
    this.u = {
      uRes: { value: new THREE.Vector2(1280, 720) }, uWidth: { value: 3.0 }, uT: { value: 0 }, uSpeed: { value: 30 }, uSpacing: { value: 9 },
      uPulse: { value: 2.0 }, uBase: { value: 0.25 }, uGain: { value: 1 }, uCol: { value: new THREE.Color(0.75, 0.88, 1.0) },
    };
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, uniforms: this.u, transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      vertexShader: VS,
      fragmentShader: `precision highp float;
in float vS; in float vEdge; in vec4 vInfo; in vec4 vAmp;
uniform float uT, uSpeed, uSpacing, uPulse, uBase, uGain; uniform vec3 uCol;
out vec4 frag;
void main(){
  // vAmp: x = brightness, y = phase offset (s), z = drawn length (m from the source), w = pulse gain
  if (vS > vAmp.z) discard;
  float e = 1.0 - smoothstep(0.2, 1.0, abs(vEdge));
  float x = (uT + vAmp.y) * uSpeed - vS;                   // distance behind the pulse train head
  float k = fract(x / uSpacing) * uSpacing;               // 0 at a pulse head
  float pulse = exp(-k / uPulse) * step(0.0, x);
  float tip = exp(-max(vAmp.z - vS, 0.0) / 1.5) * step(vAmp.z, vInfo.z - 0.01);  // bright drawing tip while drawing on
  float I = vAmp.x * (uBase + vAmp.w * pulse * 2.2 + tip * 1.5);
  frag = vec4(uCol * I * e * uGain, 1.0);
}`,
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 30;
  }
  // paths: [{ pts, a (brightness), ph (pulse phase offset, s), draw (metres drawn from the source; Infinity = all), w (width scale), pg (pulse gain) }]
  // Ribbons are expanded on the CPU: each segment becomes a quad facing the camera, uWidth px wide at every depth.
  setPaths(paths, W, H, cam) {
    this.u.uRes.value.set(W, H);
    const V = cam.matrixWorldInverse.elements, P5 = cam.projectionMatrix.elements[5];
    const C = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const pos = this.geo.attributes.position.array, near = cam.near * 1.5;
    const depth = (p) => -(V[2] * p[0] + V[6] * p[1] + V[10] * p[2] + V[14]);
    let n = 0;
    for (const Pth of paths) {
      const pts = Pth.pts; let tot = 0; const seg = [];
      for (let i = 0; i + 1 < pts.length; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]); seg.push([tot, tot + l]); tot += l; }
      const wpx = this.u.uWidth.value * (Pth.w ?? 1);
      for (let i = 0; i + 1 < pts.length && n < this.max; i++) {
        let a = pts[i], b = pts[i + 1], s0 = seg[i][0], s1 = seg[i][1];
        const za = depth(a), zb = depth(b);
        if (za < near && zb < near) continue;
        if (za < near || zb < near) {   // clip at the near plane
          const f = (near - za) / (zb - za), q = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], sq = s0 + (s1 - s0) * f;
          if (za < near) { a = q; s0 = sq; } else { b = q; s1 = sq; }
        }
        const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        for (let v = 0; v < 4; v++) {
          const o = n * 4 + v, e = this.su[o * 2], u = this.su[o * 2 + 1];
          const p = u ? b : a;
          const toC = [C.x - p[0], C.y - p[1], C.z - p[2]];
          let sx = d[1] * toC[2] - d[2] * toC[1], sy = d[2] * toC[0] - d[0] * toC[2], sz = d[0] * toC[1] - d[1] * toC[0];
          const sl = Math.hypot(sx, sy, sz) || 1;
          const z = Math.max(depth(p), near), k = e * wpx * z / (P5 * H * 0.5) * 0.5 / sl;
          pos[o * 3] = p[0] + sx * k; pos[o * 3 + 1] = p[1] + sy * k; pos[o * 3 + 2] = p[2] + sz * k;
          this.info[o * 4] = s0; this.info[o * 4 + 1] = s1; this.info[o * 4 + 2] = tot; this.info[o * 4 + 3] = 1;
          this.amp[o * 4] = Pth.a ?? 1; this.amp[o * 4 + 1] = Pth.ph ?? 0; this.amp[o * 4 + 2] = Pth.draw ?? 1e9; this.amp[o * 4 + 3] = Pth.pg ?? 1;
        }
        n++;
      }
    }
    for (const k of ['position', 'info', 'amp']) this.geo.attributes[k].needsUpdate = true;
    this.geo.setDrawRange(0, n * 6);
  }
}
