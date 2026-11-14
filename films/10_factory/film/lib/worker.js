// The worker: the SMPL-X neutral body on the Mixamo skeleton (lib/human.js, from the AEGIS film), driven by a
// real Mixamo capture ("Talking On Phone" for film 10, "Idle" plus the AEGIS phone hold for film 27), with the
// AEGIS smartphone in the right hand. World frame: z up, metres.
// The body material is a matte clay with an optional absorbed-power overlay (lib/field.js): jet only where
// the field deposits power.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { loadHumanBot, prepClip } from './human.js';
import { makePhone } from './phone.js';
import { poseArm, holdPhone, placePhone } from './walker.js';
import { FIELD_GLSL } from './field.js';

const D2R = Math.PI / 180;

export function bodyMaterial(fieldU, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0x9aa3ae, roughness: 0.62, metalness: 0.0 });
  const u = Object.assign({
    uAbs: { value: 0 }, uAbsGain: { value: 1 }, uClayDim: { value: 1 }, uMaskC: { value: new THREE.Vector3() },
    uMaskH: { value: new THREE.Vector3(1e3, 1e3, 1e3) }, uRim: { value: 0.35 }, uRimCol: { value: new THREE.Color(0x8fb4ff) },
    uAbsFloor: { value: 0.0 }, uAbsGamma: { value: 0.5 }, uHide: { value: 0 }, uHideZ: { value: 1e3 }, uArmMode: { value: 0 },
  }, fieldU, extra);
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWN; varying vec3 vWP; attribute float aArm; varying float vArm;')
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvWN = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vArm = aArm;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWN; varying vec3 vWP; varying float vArm;
uniform float uAbs, uAbsGain, uClayDim, uRim, uAbsFloor, uAbsGamma, uHide, uHideZ, uArmMode; uniform vec3 uMaskC, uMaskH, uRimCol;
${FIELD_GLSL}
vec3 jetc(float x){ x = clamp(x,0.,1.); return clamp(vec3(1.5-abs(4.*x-3.),1.5-abs(4.*x-2.),1.5-abs(4.*x-1.)),0.,1.); }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (uArmMode > 0.5 && (uArmMode < 1.5) == (vArm > 0.5)) discard;
if (uHide > 0.5 && vArm < 0.5 && vWP.z < uHideZ) { vec3 hd = abs(vWP - uMaskC) - uMaskH; if (max(hd.x, max(hd.y, hd.z)) < 0.0) discard; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= uClayDim;
vec3 absCol = vec3(0.0);
float absA = 0.0;
if (uAbs > 0.001) {
  vec3 n = normalize(vWN);
  vec3 dm = abs(vWP - uMaskC) - uMaskH;
  float inside = 1.0 - smoothstep(-0.004, 0.004, max(dm.x, max(dm.y, dm.z)));
  float s = pfSkin(vWP, n) * uAbsGain;
  float x = pow(max(s, 0.0), uAbsGamma);
  absCol = pow(jetc(uAbsFloor + (1.0 - uAbsFloor) * x), vec3(2.2));
  absA = uAbs * inside * smoothstep(0.015, 0.1, x);              // low absorption stays clay
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.0), absA);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{ vec3 vv = normalize(cameraPosition - vWP); float fr = pow(1.0 - abs(dot(normalize(vWN), vv)), 3.0);
  totalEmissiveRadiance += uRimCol * fr * uRim * (1.0 - absA) * uClayDim; }
totalEmissiveRadiance += absCol * absA * 0.9;`);
  };
  m.customProgramCacheKey = () => 'worker-body-' + (extra.key || '');
  return m;
}

/**
 * opts: { pos:[x,y,z] feet, face: deg (direction the body faces, CCW from +x), clip: 'phone'|'idle', height: m,
 *         fieldU: uniforms from PathField, hold: AEGIS hold config (idle clip only) }
 */
export async function loadWorker(ctx, parent, opts) {
  const mat = bodyMaterial(opts.fieldU || {}, { key: opts.key || '' });
  const { bot, mesh } = await loadHumanBot(mat);
  bot.scale.setScalar(0.01); bot.rotation.x = Math.PI / 2;
  const clipFile = opts.clip === 'phone' ? 'assets/mixamo/Talking On Phone.fbx' : 'assets/mixamo/Idle.fbx';
  const clip = prepClip((await new FBXLoader().loadAsync(clipFile)).animations[0]);
  const mixer = new THREE.AnimationMixer(bot); mixer.clipAction(clip).play();
  const scaleG = new THREE.Group(); scaleG.add(bot);
  const root = new THREE.Group(); root.add(scaleG); parent.add(root);
  const bones = {};
  bot.traverse((o) => { if (o.isBone && !bones[o.name]) bones[o.name] = THREE.PropertyBinding.findNode(bot, o.name); });
  const OVR = ['mixamorigRightShoulder', 'mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand', 'mixamorigNeck', 'mixamorigHead', 'mixamorigSpine2',
    ...['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [1, 2, 3].map((k) => `mixamorigRightHand${f}${k}`))];
  const ovr = {};
  for (const n of OVR) {
    const tr = clip.tracks.find((t) => t.name === `${n}.quaternion`);
    ovr[n] = { rest: bones[n] ? bones[n].quaternion.clone() : null, ip: tr ? tr.createInterpolant() : null };
  }
  // right arm and hand (skin weight on the arm chain > 0.5): kept when the head is handed to the voxels
  {
    const names = mesh.skeleton.bones.map((b) => b.name), si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
    const isArm = names.map((n) => /RightArm|RightForeArm|RightHand/.test(n));
    const a = new Float32Array(si.count);
    for (let i = 0; i < si.count; i++) { let w = 0; for (let k = 0; k < 4; k++) if (isArm[si.getComponent(i, k)]) w += sw.getComponent(i, k); a[i] = w > 0.5 ? 1 : 0; }
    mesh.geometry.setAttribute('aArm', new THREE.BufferAttribute(a, 1));
  }
  const phone = makePhone(ctx, { scale: opts.phoneScale || 1.0 });
  parent.add(phone.group);
  phone.group.matrixAutoUpdate = false;
  mesh.castShadow = true;
  const wk = { root, scaleG, bot, mesh, mixer, mat, u: mat.userData.u, bones, ovr, phone, clipDur: clip.duration, opts };
  wk.root.position.set(...opts.pos);
  wk.root.rotation.z = (opts.face) * D2R + Math.PI / 2;
  if (opts.height) scaleG.scale.setScalar(opts.height / 1.70);
  return wk;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
/** Pose at clip time `ct` (seconds). Returns the phone antenna point (world). */
export function poseWorker(wk, ct, P = {}) {
  const o = wk.opts;
  wk.mixer.setTime(((ct % wk.clipDur) + wk.clipDur) % wk.clipDur);
  if (o.clip !== 'phone') poseArm(wk, P, ct);
  wk.root.updateMatrixWorld(true);
  if (o.clip !== 'phone' && P.hold) holdPhone(wk, P);
  // phone in the right hand: offset/rotation in the hand bone frame
  const off = P.phoneOff || [0, 0.08, 0.03], rot = P.phoneRot || [0, 0, 0];
  placePhone(wk, off, rot);
  wk.phone.group.updateMatrixWorld(true);
  return wk;
}

/** The phone's antenna (top edge, centre) in world coordinates. */
export function phoneAntenna(wk, scale = 1) {
  return new THREE.Vector3(0, 0.147 * 0.5 * scale - 0.008, 0).applyMatrix4(wk.phone.group.matrix);
}
