// The WTC site (Google Photorealistic 3D Tiles, cached in assets/tiles/wtc) in a local ENU frame
// (x east, y north, z up, metres; origin 40.7113 N, 74.0132 W on the ellipsoid), graded to blue hour.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let P = null;
export const U = { uCity: { value: 1 }, uDim: { value: 1 }, uFocus: { value: new THREE.Vector3() }, uFogR: { value: 260 }, uEye: { value: new THREE.Vector3() }, uFogK: { value: 1 }, uFogD: { value: new THREE.Vector2(220, 520) }, uNear: { value: 0 }, uPool: { value: new THREE.Vector4(0, 0, 0, 0) }, uCor: { value: new THREE.Vector4(0, 0, 1, 0) }, uCorS: { value: new THREE.Vector4(0, 0, 0, 0) }, uCorG: { value: new THREE.Vector3(0, 0, 0) }, uKeep: { value: new THREE.Vector4(0, 0, 0, 0) }, uKeepK: { value: 0 }, uRingR: { value: 1e9 }, uFogC: { value: new THREE.Vector3(0.012, 0.018, 0.038) } };

function enuMatrix(m34) {
  const M = new THREE.Matrix4().set(...m34[0], ...m34[1], ...m34[2], 0, 0, 0, 1);
  const Y2Z = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  return M.multiply(Y2Z);
}

export const SKY_FS = `varying vec3 vD; uniform float uCity; uniform vec3 uFogC;
  void main(){ vec3 d = normalize(vD); float e = d.z;
    vec3 zen = vec3(0.0010, 0.0018, 0.0060), mid = vec3(0.0060, 0.0130, 0.0380), hor = vec3(0.030, 0.042, 0.085);
    vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, e)); c = mix(c, zen, smoothstep(0.18, 0.85, e));
    float az = atan(d.y, d.x);
    c += vec3(0.10, 0.045, 0.022) * exp(-pow((az - 2.9) / 0.8, 2.0)) * exp(-max(e, 0.0) * 18.0);   // last light, west over the Hudson
    c = mix(c, uFogC, smoothstep(0.0, -0.08, e));   // below the horizon: the haze the far city fades into
    gl_FragColor = vec4(c * uCity, 1.0); }`;

// ring: the coarse Lower Manhattan tiles, drawn only outside uRingR; the site tiles only inside it
function gradeMaterial(src, ring = false) {
  const m = new THREE.MeshBasicMaterial({ map: src.map || null });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    // Street clutter in a corridor along the walk (uCor: start, direction; uCorS: s and r range; uCorG: ground z0 + k s, on)
    // is pressed flat onto the pavement whole, so nothing stands in her way and no half-flattened spikes remain.
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nout vec3 vWP; uniform vec4 uCor, uCorS; uniform vec3 uCorG;')
      .replace('#include <project_vertex>', `vec4 wq = modelMatrix * vec4(transformed, 1.0);
        vec2 cq = wq.xy - uCor.xy; float cs = dot(cq, uCor.zw), cr = dot(cq, vec2(uCor.w, -uCor.z));
        float zg = uCorG.x + uCorG.y * cs, ch = wq.z - zg;
        float cw = uCorG.z * smoothstep(uCorS.x, uCorS.x + 1.0, cs) * (1.0 - smoothstep(uCorS.y - 1.0, uCorS.y, cs))
                 * smoothstep(uCorS.z, uCorS.z + 0.8, cr) * (1.0 - smoothstep(uCorS.w - 0.8, uCorS.w, cr)) * step(0.22, ch) * (1.0 - step(3.4, ch));
        wq.z = mix(wq.z, zg + 0.04, cw);
        vec4 mvPosition = viewMatrix * wq; gl_Position = projectionMatrix * mvPosition;`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = wq.xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      in vec3 vWP; uniform float uCity, uDim, uFogR, uFogK, uNear, uKeepK; uniform vec4 uKeep; uniform vec4 uPool; uniform vec2 uFogD; uniform vec3 uFocus, uEye; uniform float uRingR; uniform vec3 uFogC;`)
      .replace('#include <opaque_fragment>', `
        if (length(vWP.xy) ${ring ? '<' : '>'} uRingR) discard;
        vec3 tex = pow(outgoingLight, vec3(2.2));
        float lum = dot(tex, vec3(0.2126, 0.7152, 0.0722));
        vec3 c = mix(vec3(lum), tex, 0.55) * vec3(0.42, 0.52, 0.78) * 0.62;
        // lit windows read as warm specks on the facades: keep bright, warm texels warm
        float warm = smoothstep(0.35, 0.8, lum) * smoothstep(0.0, 0.15, tex.r - tex.b);
        c += tex * vec3(1.0, 0.75, 0.45) * warm * 0.35;
        float rr = length(vWP.xy - uFocus.xy);
        float fog = smoothstep(uFogR * 0.35, uFogR, rr);
        float dz = length(vWP - uEye);
        fog = max(fog, smoothstep(uFogD.x, uFogD.y, dz) * 0.85) * uFogK;
        // street level at night: blobby near geometry stays dark, a soft pool of light around the walker
        vec3 fn = normalize(cross(dFdx(vWP), dFdy(vWP)));
        c *= mix(1.0, 0.12, smoothstep(0.7, 0.95, abs(fn.z)) * uNear);
        c *= mix(1.0, mix(0.35, 1.0, smoothstep(3.0, 25.0, dz)), uNear);
        // only the cube's facade reads: everything on the street side of its face plane (uKeep: point, outward normal) sinks into the night
        c *= mix(1.0, 0.13, uKeepK * smoothstep(-0.3, 2.0, dot(vWP.xy - uKeep.xy, uKeep.zw)));
        vec3 dp = vWP - uPool.xyz; c += tex * vec3(0.55, 0.62, 0.80) * uPool.w * exp(-dot(dp.xy, dp.xy) / 30.0) * smoothstep(3.0, 0.0, abs(dp.z));
        c = mix(c, uFogC, fog);
        gl_FragColor = vec4(c * uCity * uDim, 1.0);`);
  };
  m.customProgramCacheKey = () => (ring ? 'nyc-grade-ring' : 'nyc-grade');
  return m;
}

export async function loadWorld() {
  if (P) return P;
  P = (async () => {
    const frame = await fetch('data/frame.json').then((r) => r.json());
    const scene = new THREE.Scene();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, uniforms: U,
      vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }`,
      fragmentShader: SKY_FS,
    }));
    sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);
    const tiles = new THREE.Group(); tiles.matrixAutoUpdate = false; tiles.matrix.copy(enuMatrix(frame.ecef_to_enu_matrix)); scene.add(tiles);
    const ring = new THREE.Group(); ring.matrixAutoUpdate = false; ring.matrix.copy(tiles.matrix); ring.visible = false; scene.add(ring);
    const loader = new GLTFLoader();
    const load = async (dir, group, isRing) => {
      const graded = new Map();
      const man = await fetch(`assets/tiles/${dir}/manifest.json`).then((r) => r.json());
      const files = man.tiles.map((t) => t.file);
      for (let i = 0; i < files.length; i += 64) {
        await Promise.all(files.slice(i, i + 64).map((f) => loader.loadAsync(`assets/tiles/${dir}/${f}`).then((g) => {
          g.scene.traverse((o) => {
            if (!o.isMesh) return;
            let gm = graded.get(o.material); if (!gm) { gm = gradeMaterial(o.material, isRing); graded.set(o.material, gm); } o.material = gm;
            o.frustumCulled = true;
          });
          group.add(g.scene);
        }).catch((e) => console.warn('tile failed', dir, f, e && e.message))));
      }
    };
    await load('wtc', tiles, false);
    await load('lm', ring, true);
    tiles.updateMatrixWorld(true); ring.updateMatrixWorld(true);
    return { scene, tiles, ring, sky };
  })();
  return P;
}

// The cube's ground-floor lobby is glass, which the photogrammetry never closed: a slot under the marble shows
// the buildings behind it. A dark glazed wall, set back behind the marble face (face: p, outward n, along t), closes it.
export function addGlazing(scene, F, { s0 = -12.5, s1 = 16.5, z0 = -28.5, z1 = -21.45, back = 1.2 } = {}) {
  const w = s1 - s0, h = z1 - z0;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uW: { value: w }, uS0: { value: s0 }, uZ0: { value: z0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uCity, uDim, uW, uS0, uZ0;
      void main(){
        float s = uS0 + vUv.x * uW, z = uZ0 + vUv.y * 7.05;
        float d = abs(fract(s / 1.55 + 0.5) - 0.5) * 1.55;          // distance to the nearest mullion
        float m = 1.0 - smoothstep(0.03, 0.08, d);
        vec3 c = vec3(0.0045, 0.0065, 0.0140) * (0.8 + 0.4 * vUv.y) + m * vec3(0.010, 0.013, 0.026);
        c += vec3(0.020, 0.013, 0.006) * smoothstep(-23.6, -25.6, z) * 0.6;   // the lobby, faintly lit behind the glass
        gl_FragColor = vec4(c * uCity * uDim, 1.0); }`,
  });
  const g = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const t = new THREE.Vector3(F.t[0], F.t[1], 0), up = new THREE.Vector3(0, 0, 1), n = new THREE.Vector3(F.n[0], F.n[1], 0);
  g.matrixAutoUpdate = false;
  g.matrix.makeBasis(t, up, n).setPosition(F.p[0] + F.t[0] * (s0 + s1) / 2 - F.n[0] * back, F.p[1] + F.t[1] * (s0 + s1) / 2 - F.n[1] * back, (z0 + z1) / 2);
  g.matrixWorldNeedsUpdate = true;
  scene.add(g);
  return g;
}
