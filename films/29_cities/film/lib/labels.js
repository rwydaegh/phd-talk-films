// Crisp 2D labels over the graded frame (no bloom, no grain), 3Blue1Brown style:
// a dot on the object, a leader line that draws on, then the word or symbol fades in.
// Items (sizes and offsets in px at 1440 lines; 3D points are projected by the shot's camera):
//   { kind: 'label', at, off:[dx,dy], text, size, a, p }
//   { kind: 'bracket', from, to, side, text, size, a, p }      dimension bracket with end ticks
//   { kind: 'arrow', from, to, text, off, size, a, p }          arrow along a direction
//   { kind: 'text', at:[x,y] px, text, size, align, a, p }         free text in screen space
//   { kind: 'scalebar', ppm, a }                                 truthful scale bar, lower right
//   { kind: 'phasor', at, r, ang, a }                            a small dial whose hand shows a phase (ang 0 = up)
// text: string (sans) or spans [[str, 'math'|'main'|'sans'], ...]. a: opacity 0..1, p: draw-on progress 0..1.
import * as THREE from 'three';

const FONTS = { sans: 'Inter', math: 'KaTeXMath', main: 'KaTeXMain' };
export async function loadFonts() {
  const list = [['Inter', 'assets/fonts/inter.woff2', {}], ['KaTeXMath', 'assets/fonts/KaTeX_Math-Italic.woff2', { style: 'normal' }], ['KaTeXMain', 'assets/fonts/KaTeX_Main-Regular.woff2', {}]];
  for (const [name, url, d] of list) { const f = new FontFace(name, `url(${url})`, d); await f.load(); document.fonts.add(f); }
}

export function projector(cam, W, H) {
  cam.updateMatrixWorld(); const v = new THREE.Vector3();
  return (p) => { v.set(p[0], p[1], p[2]).project(cam); return v.z > 1 || v.z < -1 ? null : [(v.x * 0.5 + 0.5) * W, (0.5 - v.y * 0.5) * H]; };
}

const VS = `in vec3 position; out vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FS = `precision highp float; in vec2 vUv; uniform sampler2D uT; out vec4 frag; void main(){ frag = texture(uT, vUv); }`;

export class Overlay {
  constructor(renderer, W, H) {
    this.r = renderer; this.W = W; this.H = H; this.k = H / 1440;
    this.cv = document.createElement('canvas'); this.cv.width = W; this.cv.height = H;
    this.g = this.cv.getContext('2d', { willReadFrequently: true });
    this.tex = new THREE.CanvasTexture(this.cv); this.tex.premultiplyAlpha = true; this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter; this.tex.generateMipmaps = false;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, uniforms: { uT: { value: this.tex } },
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh); this.cam = new THREE.Camera();
  }
  spans(t) { return typeof t === 'string' ? [[t, 'sans']] : t; }
  measure(text, size) {
    const g = this.g; let w = 0;
    for (const [s, f] of this.spans(text)) { g.font = this.fontOf(f, size); w += g.measureText(s).width; }
    return w;
  }
  fontOf(f, size) { const px = Math.round(size * this.k * (f === 'sans' ? 1 : 1.22)); return `${f === 'sans' ? 500 : 400} ${px}px ${FONTS[f]}`; }
  text(text, x, y, size, a, align = 'left') {
    const g = this.g, w = this.measure(text, size);
    let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    g.textBaseline = 'middle';
    for (const [s, f] of this.spans(text)) {
      g.font = this.fontOf(f, size);
      g.fillStyle = `rgba(0,0,0,${0.55 * a})`; g.fillText(s, cx + 1.5 * this.k, y + 1.5 * this.k);
      g.fillStyle = `rgba(242,244,248,${a})`; g.fillText(s, cx, y);
      cx += g.measureText(s).width;
    }
    return w;
  }
  line(pts, a, width = 2.2) {
    const g = this.g; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [col, lw] of [[`rgba(0,0,0,${0.45 * a})`, width + 2], [`rgba(236,240,246,${0.85 * a})`, width]]) {
      g.strokeStyle = col; g.lineWidth = lw * this.k; g.beginPath(); g.moveTo(...pts[0]); for (const q of pts.slice(1)) g.lineTo(...q); g.stroke();
    }
  }
  dot(p, a, r = 4) { const g = this.g; g.fillStyle = `rgba(242,244,248,${a})`; g.beginPath(); g.arc(p[0], p[1], r * this.k, 0, 2 * Math.PI); g.fill(); }
  draw(items, project) {
    const g = this.g, k = this.k; g.clearRect(0, 0, this.W, this.H);
    for (const it of items || []) {
      const a = it.a ?? 1; if (a <= 0.003) continue;
      const p = it.p ?? 1, size = it.size ?? 34;
      const P = (q) => (q.length === 2 ? [q[0] * this.W / 2560, q[1] * this.H / 1440] : project(q));
      if (it.kind === 'label') {
        const A = P(it.at); if (!A) continue;
        const off = it.off || [80, -60];
        const B = [A[0] + off[0] * k, A[1] + off[1] * k];
        const lp = Math.min(1, p / 0.6), tp = Math.max(0, (p - 0.45) / 0.55);
        this.dot(A, a * Math.min(1, p * 4));
        if (lp > 0) this.line([A, [A[0] + (B[0] - A[0]) * lp, A[1] + (B[1] - A[1]) * lp]], a);
        const right = off[0] >= 0, gap = 12 * k;
        if (tp > 0) this.text(it.text, B[0] + (right ? gap : -gap), B[1], size, a * tp, right ? 'left' : 'right');
      } else if (it.kind === 'bracket') {
        const A = P(it.from), B = P(it.to); if (!A || !B) continue;
        let n = [-(B[1] - A[1]), B[0] - A[0]]; const l = Math.hypot(...n) || 1; n = [n[0] / l, n[1] / l];
        if (it.toward === 'right' ? n[0] < 0 : it.toward === 'left' ? n[0] > 0 : n[1] > 0) n = [-n[0], -n[1]];
        const s = (it.side ?? 30) * k, tk = 9 * k;
        const A2 = [A[0] + n[0] * s, A[1] + n[1] * s], B2 = [B[0] + n[0] * s, B[1] + n[1] * s];
        const M = [(A2[0] + B2[0]) / 2, (A2[1] + B2[1]) / 2];
        const lp = Math.min(1, p / 0.6), tp = Math.max(0, (p - 0.4) / 0.6);
        const ext = (Q, Q2) => [[Q2[0] - n[0] * tk, Q2[1] - n[1] * tk], [Q2[0] + n[0] * tk, Q2[1] + n[1] * tk]];
        this.line(ext(A, A2), a * Math.min(1, p * 3)); this.line(ext(B, B2), a * Math.min(1, p * 3));
        if (lp > 0) this.line([[M[0] + (A2[0] - M[0]) * lp, M[1] + (A2[1] - M[1]) * lp], [M[0] + (B2[0] - M[0]) * lp, M[1] + (B2[1] - M[1]) * lp]], a);
        if (tp > 0) {
          const d = (it.textGap ?? 34) * k, T = [M[0] + n[0] * d, M[1] + n[1] * d];
          this.text(it.text, T[0], T[1], size, a * tp, it.toward === 'right' ? 'left' : it.toward === 'left' ? 'right' : 'center');
        }
      } else if (it.kind === 'text') {
        const A = P(it.at); if (!A) continue;
        this.text(it.text, A[0], A[1], size, a * Math.min(1, p * 1.5), it.align || 'left');
      } else if (it.kind === 'scalebar') {
        // largest unit whose bar is shorter than 520 px at 1440 lines; ppm = pixels (1440 ref) per metre
        const U = [[0.1, '10 cm'], [0.01, '1 cm'], [0.001, '1 mm'], [0.0001, '0.1 mm']];
        const pick = U.find(([L]) => L * it.ppm < 520); if (!pick) continue;
        const L = pick[0] * it.ppm * k, x1 = this.W - 150 * k, y = this.H - 120 * k;
        this.line([[x1 - L, y], [x1, y]], a, 2.4);
        this.line([[x1 - L, y - 8 * k], [x1 - L, y + 8 * k]], a, 2.0); this.line([[x1, y - 8 * k], [x1, y + 8 * k]], a, 2.0);
        this.text(pick[1], x1 - L / 2, y - 30 * k, 32, a, 'center');
      } else if (it.kind === 'phasor') {
        const A = P(it.at); if (!A) continue;
        const r = (it.r ?? 26) * k, g2 = this.g;
        g2.lineWidth = 1.6 * k; g2.strokeStyle = `rgba(236,240,246,${0.55 * a})`;
        g2.beginPath(); g2.arc(A[0], A[1], r, 0, 2 * Math.PI); g2.stroke();
        this.line([A, [A[0] + Math.sin(it.ang) * r * 0.92, A[1] - Math.cos(it.ang) * r * 0.92]], a, 2.6);
        this.dot(A, a, 2.6);
      } else if (it.kind === 'arrow') {
        const A = P(it.from), B = P(it.to); if (!A || !B) continue;
        const lp = Math.min(1, p / 0.7), E = [A[0] + (B[0] - A[0]) * lp, A[1] + (B[1] - A[1]) * lp];
        this.line([A, E], a, 2.6);
        const d = [B[0] - A[0], B[1] - A[1]], l = Math.hypot(...d) || 1, u = [d[0] / l, d[1] / l], h = 16 * k;
        if (lp > 0.05) this.line([[E[0] - u[0] * h - u[1] * h * 0.55, E[1] - u[1] * h + u[0] * h * 0.55], E, [E[0] - u[0] * h + u[1] * h * 0.55, E[1] - u[1] * h - u[0] * h * 0.55]], a, 2.6);
        const tp = Math.max(0, (p - 0.5) / 0.5);
        if (tp > 0 && it.text) { const off = it.off || [18, -26]; this.text(it.text, E[0] + off[0] * k, E[1] + off[1] * k, size, a * tp, off[0] >= 0 ? 'left' : 'right'); }
      }
    }
    this.tex.needsUpdate = true;
    this.r.setRenderTarget(null); this.r.render(this.scene, this.cam);
  }
}
