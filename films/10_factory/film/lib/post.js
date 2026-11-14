// HDR pipeline: scene target (MSAA) -> optional sub-frame accumulation -> card bloom -> card grade.
import * as THREE from 'three';

const VS = `in vec3 position; void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const tri = new THREE.BufferGeometry();
tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
const orthoCam = new THREE.Camera();

export function fsPass(frag, uniforms = {}, opts = {}) {
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VS,
    fragmentShader: 'precision highp float;\nout vec4 frag;\n' + frag,
    uniforms, depthTest: false, depthWrite: false, ...opts,
  });
  const mesh = new THREE.Mesh(tri, material); mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(mesh);
  return { material, uniforms, render(renderer, target) { renderer.setRenderTarget(target); renderer.render(scene, orthoCam); } };
}

const rtOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };

export class Post {
  constructor(renderer, W, H, { msaa = 4 } = {}) {
    this.r = renderer; this.W = W; this.H = H;
    this.scene = new THREE.WebGLRenderTarget(W, H, { ...rtOpts, depthBuffer: true, samples: msaa });
    this.scene.depthTexture = null;
    this.acc = new THREE.WebGLRenderTarget(W, H, { ...rtOpts, type: THREE.FloatType });
    this.tmp = [0, 1].map(() => new THREE.WebGLRenderTarget(W, H, rtOpts));
    this.downs = []; this.ups = [];
    let w = W, h = H;
    for (let i = 0; i < 6; i++) { w = Math.max(2, w >> 1); h = Math.max(2, h >> 1); this.downs.push(new THREE.WebGLRenderTarget(w, h, rtOpts)); this.ups.push(new THREE.WebGLRenderTarget(w, h, rtOpts)); }
    this.copy = fsPass(`uniform sampler2D uTex; uniform float uGain; uniform vec2 uRes;
      void main(){ frag = vec4(texture(uTex, gl_FragCoord.xy / uRes).rgb * uGain, 1.0); }`,
      { uTex: { value: null }, uGain: { value: 1 }, uRes: { value: new THREE.Vector2(W, H) } },
      { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true });
    this.down = fsPass(`uniform sampler2D uTex; uniform vec2 uTexel; uniform float uThreshold;
      void main(){ vec2 uv = gl_FragCoord.xy * uTexel * 2.0;
        vec3 c = texture(uTex, uv).rgb * 4.0 + texture(uTex, uv + uTexel * vec2(-1.0,-1.0)).rgb + texture(uTex, uv + uTexel * vec2(1.0,-1.0)).rgb
          + texture(uTex, uv + uTexel * vec2(-1.0,1.0)).rgb + texture(uTex, uv + uTexel * vec2(1.0,1.0)).rgb; c /= 8.0;
        if (uThreshold > 0.0) { float l = max(c.r, max(c.g, c.b)); c *= smoothstep(uThreshold, uThreshold * 4.0, l); }
        frag = vec4(c, 1.0); }`, { uTex: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0 } });
    this.up = fsPass(`uniform sampler2D uTex, uAdd; uniform vec2 uTexel, uOutTexel;
      void main(){ vec2 uv = gl_FragCoord.xy * uOutTexel;
        vec3 c = texture(uTex, uv + uTexel * vec2(-1.0,0.0)).rgb + texture(uTex, uv + uTexel * vec2(1.0,0.0)).rgb + texture(uTex, uv + uTexel * vec2(0.0,-1.0)).rgb + texture(uTex, uv + uTexel * vec2(0.0,1.0)).rgb;
        c = c * 0.125 + (texture(uTex, uv + uTexel * vec2(-0.5,-0.5)).rgb + texture(uTex, uv + uTexel * vec2(0.5,-0.5)).rgb + texture(uTex, uv + uTexel * vec2(-0.5,0.5)).rgb + texture(uTex, uv + uTexel * vec2(0.5,0.5)).rgb) * 0.125;
        frag = vec4(c + texture(uAdd, uv).rgb, 1.0); }`, { uTex: { value: null }, uAdd: { value: null }, uTexel: { value: new THREE.Vector2() }, uOutTexel: { value: new THREE.Vector2() } });
    // The card's final grade plus: chromatic fringe (speed ramps), fade to black, radial zoom blur.
    this.final = fsPass(`uniform sampler2D uScene, uBloom; uniform vec2 uRes;
      uniform float uTime, uBloomGain, uExposure, uGrain, uVignette, uCA, uFade, uZoomBlur, uFlash;
      float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      vec3 tapScene(vec2 uv){
        if (uCA <= 0.0) return texture(uScene, uv).rgb;
        vec2 d = (uv - 0.5) * uCA;
        return vec3(texture(uScene, uv + d).r, texture(uScene, uv).g, texture(uScene, uv - d).b);
      }
      void main(){
        vec2 uv = gl_FragCoord.xy / uRes;
        vec3 c;
        if (uZoomBlur > 0.0) {
          c = vec3(0.0);
          for (int i = 0; i < 12; i++) { float f = 1.0 - uZoomBlur * float(i) / 12.0; c += tapScene(0.5 + (uv - 0.5) * f) + texture(uBloom, 0.5 + (uv - 0.5) * f).rgb * uBloomGain; }
          c /= 12.0;
        } else c = tapScene(uv) + texture(uBloom, uv).rgb * uBloomGain;
        c += uFlash;
        vec2 q = uv - 0.5; q.x *= uRes.x / uRes.y * 0.5625;
        c *= 1.0 - uVignette * dot(q, q);
        c = 1.0 - exp(-c * uExposure);
        c = pow(c, vec3(1.0 / 2.2));
        c += (hash(gl_FragCoord.xy + fract(uTime * 0.37) * 97.0) - 0.5) * uGrain;
        frag = vec4(max(c, 0.0) * uFade, 1.0);
      }`, {
      uScene: { value: null }, uBloom: { value: null }, uRes: { value: new THREE.Vector2(W, H) }, uTime: { value: 0 },
      uBloomGain: { value: 0.55 / 4 }, uExposure: { value: 1 }, uGrain: { value: 0.012 }, uVignette: { value: 0.6 },
      uCA: { value: 0 }, uFade: { value: 1 }, uZoomBlur: { value: 0 }, uFlash: { value: 0 },
    });
  }

  // draw(target) renders one sub-frame of the scene into `target` (HDR, linear).
  frame(drawAt, t, { sub = 1, shutter = 0.5, fps = 30, grade = {} } = {}) {
    const r = this.r;
    let src;
    if (sub <= 1) { drawAt(t, this.scene); src = this.scene; }
    else {
      r.setRenderTarget(this.acc); r.setClearColor(0x000000, 0); r.clear();
      for (let k = 0; k < sub; k++) {
        const tk = t + ((k + 0.5) / sub - 0.5) * shutter / fps;
        drawAt(tk, this.scene);
        this.copy.uniforms.uTex.value = this.scene.texture; this.copy.uniforms.uGain.value = 1 / sub;
        this.copy.render(r, this.acc);
      }
      src = this.acc;
    }
    // Bloom (the card's chain: 5 levels, threshold 0.05).
    const L = 5;
    let s = src;
    for (let i = 0; i < L; i++) {
      const d = this.downs[i];
      this.down.uniforms.uTex.value = s.texture; this.down.uniforms.uTexel.value.set(1 / s.width, 1 / s.height);
      this.down.uniforms.uThreshold.value = i === 0 ? (grade.threshold ?? 0.05) : 0;
      this.down.render(r, d); s = d;
    }
    let acc = this.downs[L - 1];
    for (let i = L - 2; i >= 0; i--) {
      const d = this.ups[i];
      Object.assign(this.up.uniforms.uTexel.value.set(1 / acc.width, 1 / acc.height));
      this.up.uniforms.uTex.value = acc.texture; this.up.uniforms.uAdd.value = this.downs[i].texture;
      this.up.uniforms.uOutTexel.value.set(1 / d.width, 1 / d.height);
      this.up.render(r, d); acc = d;
    }
    const u = this.final.uniforms;
    u.uScene.value = src.texture; u.uBloom.value = acc.texture; u.uTime.value = t;
    u.uBloomGain.value = (grade.bloom ?? 0.55) / (L - 1); u.uExposure.value = grade.exposure ?? 1;
    u.uGrain.value = grade.grain ?? 0.012; u.uVignette.value = grade.vignette ?? 0.6; u.uCA.value = grade.ca ?? 0;
    u.uFade.value = grade.fade ?? 1; u.uZoomBlur.value = grade.zoomBlur ?? 0; u.uFlash.value = grade.flash ?? 0;
    this.final.render(r, null);
  }
}
