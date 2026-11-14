// Layer depth of field: separable Gaussian at half resolution, then composited.
import * as THREE from 'three';
import { fsPass } from './post.js';
const rt = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
export class Blur {
  constructor(W, H) {
    this.full = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: true, samples: 4 });
    this.a = rt(W >> 1, H >> 1); this.b = rt(W >> 1, H >> 1); this.W = W; this.H = H;
    this.pass = fsPass(`uniform sampler2D uTex; uniform vec2 uDir, uRes; uniform float uRadius;
      void main(){ vec2 uv = gl_FragCoord.xy / uRes; vec3 c = vec3(0.0); float ws = 0.0;
        for (int i = -16; i <= 16; i++) { float x = float(i) / 16.0; float w = exp(-x * x * 2.5); c += texture(uTex, uv + uDir * x * uRadius / uRes).rgb * w; ws += w; }
        frag = vec4(c / ws, 1.0); }`, { uTex: { value: null }, uDir: { value: new THREE.Vector2() }, uRes: { value: new THREE.Vector2(W >> 1, H >> 1) }, uRadius: { value: 8 } });
    this.comp = fsPass(`uniform sampler2D uTex, uSharp; uniform vec2 uRes; uniform float uMix, uGain;
      void main(){ vec2 uv = gl_FragCoord.xy / uRes; frag = vec4(mix(texture(uSharp, uv).rgb, texture(uTex, uv).rgb, uMix) * uGain, 1.0); }`,
      { uTex: { value: null }, uSharp: { value: null }, uRes: { value: new THREE.Vector2(W, H) }, uMix: { value: 1 }, uGain: { value: 1 } });
  }
  // Render `fn(target)` into a layer, blur it by radius (px at 2560 wide), write into `target` (opaque).
  layer(r, fn, radiusPx, target, mix = 1, gain = 1) {
    fn(this.full);
    const rad = radiusPx * this.W / 2560 / 2;
    if (rad < 0.3 || mix <= 0) { this.comp.uniforms.uTex.value = this.full.texture; this.comp.uniforms.uSharp.value = this.full.texture; }
    else {
      this.pass.uniforms.uRadius.value = rad;
      this.pass.uniforms.uTex.value = this.full.texture; this.pass.uniforms.uDir.value.set(1, 0); this.pass.render(r, this.a);
      this.pass.uniforms.uTex.value = this.a.texture; this.pass.uniforms.uDir.value.set(0, 1); this.pass.render(r, this.b);
      if (rad > 6) { this.pass.uniforms.uTex.value = this.b.texture; this.pass.uniforms.uDir.value.set(0.7, 0.7); this.pass.render(r, this.a);
        this.pass.uniforms.uTex.value = this.a.texture; this.pass.uniforms.uDir.value.set(-0.7, 0.7); this.pass.render(r, this.b); }
      this.comp.uniforms.uTex.value = this.b.texture; this.comp.uniforms.uSharp.value = this.full.texture;
    }
    this.comp.uniforms.uMix.value = mix; this.comp.uniforms.uGain.value = gain;
    this.comp.render(r, target);
  }
}
