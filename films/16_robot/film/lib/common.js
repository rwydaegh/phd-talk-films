// Shared GLSL and loaders for film 16.
import * as THREE from 'three';

// The post grade maps HDR c to display (1 - e^-c)^(1/2.2). invTone() gives the c that displays a wanted sRGB value,
// so photos and colour maps keep their true colours through the grade.
export const GLSL_COMMON = `
vec3 invTone(vec3 s){ vec3 l = pow(clamp(s, 0.0, 1.0), vec3(2.2)); return -log(1.0 - min(l, vec3(0.985))); }
vec3 jet(float x){ x = clamp(x, 0.0, 1.0);
  return clamp(vec3(1.5 - abs(4.0 * x - 3.0), 1.5 - abs(4.0 * x - 2.0), 1.5 - abs(4.0 * x - 1.0)), 0.0, 1.0); }
`;

export async function fetchBin(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.arrayBuffer(); }
export async function fetchJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }

export async function loadTex(url, { mip = true, filter = THREE.LinearFilter } = {}) {
  const t = await new THREE.TextureLoader().loadAsync(url);
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = filter; t.minFilter = mip ? THREE.LinearMipmapLinearFilter : filter; t.generateMipmaps = mip;
  t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// A render target matching the post scene target (HDR, MSAA) for compositing layers.
export function layerTarget(W, H, samples = 4) {
  return new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, samples });
}

export const BG = new THREE.Color(0x07090d);
// The background in pre-grade HDR units, so that it displays as #07090d.
export const BG_HDR = (() => { const s = [0x07, 0x09, 0x0d].map((v) => v / 255); return new THREE.Color(...s.map((x) => -Math.log(1 - Math.pow(x, 2.2)))); })();
