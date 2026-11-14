// A photo as one flat quad seen from the photo's own camera. The camera only zooms and pans in the image plane
// (moving the principal point), so every frame is an exact crop of the photo: no parallax, no tears.
// The lens distortion (k1, k2) is applied per pixel. The quad draws first and never writes or tests depth, so 3D overlays are never cut by it.
import * as THREE from 'three';
import { GLSL_COMMON, fetchJSON, loadTex } from './common.js';

const VS = `in vec3 position; in vec2 uv; uniform mat4 modelViewMatrix, projectionMatrix; out vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FS = `precision highp float; ${GLSL_COMMON}
in vec2 vUv; uniform sampler2D uTex; uniform float uDim, uOpacity, uDesat, uEdge, uK1, uK2; uniform vec4 uCam; uniform vec2 uWH; out vec4 frag;
void main(){
  // vUv is pinhole image space; apply the lens distortion to find the photo pixel (uCam = f, cx, cy)
  vec2 x = (vec2(vUv.x, 1.0 - vUv.y) * uWH - uCam.yz) / uCam.x;
  float r2 = dot(x, x);
  vec2 px = uCam.yz + uCam.x * x * (1.0 + uK1 * r2 + uK2 * r2 * r2);
  vec2 uv = vec2(px.x / uWH.x, 1.0 - px.y / uWH.y);
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
  vec3 s = texture(uTex, uv).rgb;
  float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
  s = mix(s, vec3(l), uDesat);
  vec2 e = min(uv, 1.0 - uv);
  float edge = uEdge > 0.0 ? smoothstep(0.0, uEdge, e.x) * smoothstep(0.0, uEdge, e.y) : 1.0;
  vec3 lin = pow(s, vec3(2.2)) * uDim * edge;
  frag = vec4(invTone(pow(lin, vec3(1.0 / 2.2))), uOpacity);
}`;

export class Photo {
  // depth: camera-z of the quad (m). Only matters if a shot moves the camera off the photo's eye while it shows.
  static async load(name, { depth = 2.0 } = {}) {
    const meta = await fetchJSON(`assets/mesh/${name}.json`);
    const tex = await loadTex(`assets/${meta.image}`);
    const p = new Photo(); p.meta = meta; p.tex = tex;
    p.uniforms = { uTex: { value: tex }, uDim: { value: 1 }, uOpacity: { value: 1 }, uDesat: { value: 0 }, uEdge: { value: 0.06 },
      uK1: { value: meta.cam.k1 || 0 }, uK2: { value: meta.cam.k2 || 0 }, uCam: { value: new THREE.Vector4(meta.cam.f, meta.cam.cx, meta.cam.cy, 0) }, uWH: { value: new THREE.Vector2(meta.W, meta.H) } };
    const { W, H } = meta;
    const corners = [[0, H], [W, H], [W, 0], [0, 0]].map(([u, v]) => p.point(u, v, depth));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(corners.flat()), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const m = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, uniforms: p.uniforms,
      side: THREE.DoubleSide, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = -100;
    p.group = new THREE.Group(); p.group.add(mesh);
    return p;
  }
  // Camera spec (for cam.js applyCam) through the photo's own camera, with photo pixel (u0, v0) at frame centre
  // and `zoom` = frame width / photo width shown.
  spec({ u0, v0, zoom = 1 }) {
    const c = this.meta.cam, R = c.R;
    const s = 2560 / this.meta.W * zoom * c.f;          // focal length in px at 2560 wide
    const k = s / c.f;
    const cx = 1280 - (u0 - c.cx) * k;
    const cyTop = 720 - (v0 - c.cy) * k;
    return { pos: c.C.slice(), fwd: R[2].slice(), up: R[1].map((x) => -x), s, cx, cy: 1440 - cyTop };
  }
  // World point seen at photo pixel (u, v) at camera-z depth z (pinhole).
  point(u, v, z) {
    const c = this.meta.cam, R = c.R;
    const x = (u - c.cx) / c.f * z, y = (v - c.cy) / c.f * z;
    return [0, 1, 2].map((i) => c.C[i] + R[0][i] * x + R[1][i] * y + R[2][i] * z);
  }
}
