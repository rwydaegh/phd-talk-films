import * as THREE from 'three';
export const ADD = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };
export const jetGLSL = `vec3 jet(float v){ return clamp(vec3(1.5 - abs(4.0*v - 3.0), 1.5 - abs(4.0*v - 2.0), 1.5 - abs(4.0*v - 1.0)), 0.0, 1.0); }`;
