// The walker: SMPL-X body on the Mixamo skeleton (lib/human.js, from the AEGIS film), walking with the
// Mixamo walk, the right arm taken from "Talking On Phone" so the phone sits at the right ear (chapter 4: T = 0).
// Deterministic: pose(t) sets everything from the clip time alone.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { loadHumanBot, prepClip } from './human.js';
import { makePhone } from './phone.js';

export const WU = {
  uHot: { value: 0 }, uHotC: { value: new THREE.Vector3() }, uHotR: { value: 0.05 }, uRim: { value: new THREE.Vector3(0.0, 1.0, 0.3) },
  uExpo: { value: 0 }, uFade: { value: 1 }, uArm: { value: 0 }, uCut: { value: 1e4 },
};

function bodyMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.34, 0.32, 0.31), roughness: 0.62, metalness: 0.0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP2; varying vec3 vWN2; attribute float aArm; varying float vArm;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP2 = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN2 = normalize(mat3(modelMatrix) * objectNormal); vArm = aArm;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWP2; varying vec3 vWN2; varying float vArm; uniform float uHot, uHotR, uExpo, uFade, uArm, uCut; uniform vec3 uHotC, uRim;
      float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z); }
      vec3 jetc(float x){ x = clamp(x,0.,1.); return clamp(vec3(1.5-abs(4.*x-3.),1.5-abs(4.*x-2.),1.5-abs(4.*x-1.)),0.,1.); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (vWP2.z > uCut) discard;
        if (vArm * uArm * 1.3 > 0.15 + 0.85 * vnoise(vWP2 * 90.0)) discard;
        vec3 vv = normalize(cameraPosition - vWP2);
        float rim = pow(1.0 - max(dot(normalize(vWN2), vv), 0.0), 3.0);
        totalEmissiveRadiance += vec3(0.30, 0.42, 0.70) * rim * 0.22;
        // absorbed power near the focus (illustrative footprint around the ear)
        vec3 dp = vWP2 - uHotC; float g = exp(-dot(dp, dp) / (2.0 * uHotR * uHotR));
        float x = uHot * g;
        totalEmissiveRadiance += pow(jetc(0.15 + 0.85 * x), vec3(2.2)) * smoothstep(0.02, 0.25, x) * 1.6 * uHot;`)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\nif (!gl_FrontFacing) gl_FragColor.rgb = vec3(0.075, 0.08, 0.095);\ngl_FragColor.rgb *= uFade;');
  };
  m.customProgramCacheKey = () => 'nyc-walker';
  return m;
}

const ARM = ['mixamorigRightShoulder', 'mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand',
  ...['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [1, 2, 3].map((k) => `mixamorigRightHand${f}${k}`))];

export async function loadWalker(ctx, parent) {
  const mat = bodyMaterial();
  const { bot, mesh } = await loadHumanBot(mat);
  bot.scale.setScalar(0.01); bot.rotation.x = Math.PI / 2;
  const fbx = new FBXLoader();
  const walk = prepClip((await fbx.loadAsync('assets/mixamo/Walking.fbx')).animations[0]);
  const phoneClip = prepClip((await fbx.loadAsync('assets/mixamo/Talking On Phone.fbx')).animations[0]);
  const root = new THREE.Group(); root.add(bot); parent.add(root);
  const mixer = new THREE.AnimationMixer(bot);
  const act = mixer.clipAction(walk); act.play();
  const bones = {};
  bot.traverse((o) => { if (o.isBone && !bones[o.name]) bones[o.name] = THREE.PropertyBinding.findNode(bot, o.name); });
  const ip = {};
  for (const n of ARM) { const tr = phoneClip.tracks.find((t) => t.name === `${n}.quaternion`); if (tr) ip[n] = tr.createInterpolant(); }
  const phone = makePhone(ctx, { scale: 1 }); phone.group.matrixAutoUpdate = false; parent.add(phone.group);
  // the right ear: the most lateral head vertex on the right (the helix), in the bind pose (Y up, facing +Z, right = -X)
  const hb = mesh.skeleton.bones.findIndex((b) => b.name === 'mixamorigHead');
  const pos = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
  let earIdx = -1, best = -1e9;
  for (let k = 0; k < pos.count; k++) {
    let w = 0; for (let c = 0; c < 4; c++) if (si.getComponent(k, c) === hb) w += sw.getComponent(k, c);
    if (w < 0.9) continue;
    const x = -pos.getX(k); if (x > best) { best = x; earIdx = k; }
  }
  // right arm weight per vertex (upper arm, forearm, hand): the arm dissolves when time stops
  const armB = new Set(mesh.skeleton.bones.map((b, i) => [b.name, i]).filter(([n]) => /RightArm|RightForeArm|RightHand/.test(n)).map(([, i]) => i));
  const aw = new Float32Array(pos.count);
  for (let k = 0; k < pos.count; k++) { let w = 0; for (let c = 0; c < 4; c++) if (armB.has(si.getComponent(k, c))) w += sw.getComponent(k, c); aw[k] = w; }
  mesh.geometry.setAttribute('aArm', new THREE.BufferAttribute(aw, 1));
  return { root, bot, mesh, mixer, act, walk, phoneClip, bones, ip, phone, mat, earIdx };
}

const q = new THREE.Quaternion(), e = new THREE.Euler(), m4 = new THREE.Matrix4(), vP = new THREE.Vector3(), vS = new THREE.Vector3(), qR = new THREE.Quaternion();
// pos [x,y,z] of the feet, heading (rad, direction of travel in the xy plane), walk clip time, phone clip time,
// walkW (0 = standing still in the walk's first frame), opts.phoneOff / phoneRot in the hand bone frame.
export function poseWalker(wk, { pos, heading, tw, tp = 1.0, phoneOff = [0, 0.09, 0.03], phoneRot = [0, 0, 0], armTweak = null }) {
  wk.root.position.set(pos[0], pos[1], pos[2]);
  wk.root.rotation.set(0, 0, heading + Math.PI / 2);
  wk.act.time = ((tw % wk.walk.duration) + wk.walk.duration) % wk.walk.duration;
  wk.mixer.update(0);
  const tt = ((tp % wk.phoneClip.duration) + wk.phoneClip.duration) % wk.phoneClip.duration;
  for (const n of ARM) {
    const I = wk.ip[n]; if (!I) continue;
    const v = I.evaluate(tt); wk.bones[n].quaternion.set(v[0], v[1], v[2], v[3]).normalize();
  }
  if (armTweak) for (const [n, d] of Object.entries(armTweak)) {
    q.setFromEuler(e.set(d[0] * Math.PI / 180, d[1] * Math.PI / 180, d[2] * Math.PI / 180));
    wk.bones[n].quaternion.multiply(q);
  }
  wk.root.updateMatrixWorld(true);
  const hand = wk.bones.mixamorigRightHand;
  hand.matrixWorld.decompose(vP, qR, vS);
  m4.compose(vP, qR, new THREE.Vector3(1, 1, 1));
  const off = new THREE.Matrix4().compose(new THREE.Vector3(...phoneOff),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...phoneRot.map((a) => a * Math.PI / 180))), new THREE.Vector3(1, 1, 1));
  wk.phone.group.matrix.multiplyMatrices(m4, off); wk.phone.group.matrixWorldNeedsUpdate = true;
  wk.phone.group.updateMatrixWorld(true);
}

// Right ear helix (skinned, world) after poseWalker.
export function earW(wk) { const v = new THREE.Vector3(); wk.mesh.getVertexPosition(wk.earIdx, v); return v.applyMatrix4(wk.mesh.matrixWorld); }

// Phone at the right ear: world frame of the walker (R right, F forward, U up), ear helix E.
// Phone: screen (+z) toward the head, top (+y) up and back, centre below and in front of the ear.
// Hand: palm (+z) toward the head, fingers (+y) along the phone, wrist below the phone; two-bone IK with the elbow out and down.
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
function wq(o) { const q2 = new THREE.Quaternion(); o.matrixWorld.decompose(_a, q2, _b); return q2; }
function setWQ(bone, qW) { bone.quaternion.copy(wq(bone.parent).invert().multiply(qW)).normalize(); bone.updateMatrixWorld(true); }
function aim(bone, child, target) {
  const p = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld), c = new THREE.Vector3().setFromMatrixPosition(child.matrixWorld);
  const dq = new THREE.Quaternion().setFromUnitVectors(c.sub(p).normalize(), target.clone().sub(p).normalize());
  setWQ(bone, dq.multiply(wq(bone)));
}
export function phoneAtEar(wk, P = {}) {
  const h = wk.root.rotation.z - Math.PI / 2;
  const F = new THREE.Vector3(Math.cos(h), Math.sin(h), 0), R = new THREE.Vector3(Math.sin(h), -Math.cos(h), 0), Up = new THREE.Vector3(0, 0, 1);
  wk.root.updateMatrixWorld(true);
  const E = earW(wk);
  const tilt = (P.tilt ?? 50) * Math.PI / 180;
  const top = Up.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(F, -Math.sin(tilt));
  const zS = R.clone().negate();                                   // screen normal, toward the head
  const yT = top.clone().addScaledVector(zS, -top.dot(zS)).normalize();
  const xT = new THREE.Vector3().crossVectors(yT, zS);
  const C = E.clone().addScaledVector(R, P.out ?? 0.006).addScaledVector(yT, -(P.down ?? 0.052)).addScaledVector(F, P.fwd ?? 0.004);
  const qPh = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xT, yT, zS));
  wk.phone.group.matrix.compose(C, qPh, new THREE.Vector3(1, 1, 1)); wk.phone.group.matrixWorldNeedsUpdate = true; wk.phone.group.updateMatrixWorld(true);
  // hand: wrist below the phone's centre, behind its back
  const T = C.clone().addScaledVector(yT, -(P.wrist ?? 0.085)).addScaledVector(zS, -(P.palm ?? 0.03)).addScaledVector(xT, P.side ?? 0.0);
  const hz = zS.clone(), hy = yT.clone().applyAxisAngle(hz, (P.dev ?? 0) * Math.PI / 180), hx = new THREE.Vector3().crossVectors(hy, hz);
  const qH = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(hx, hy, hz));
  const B = wk.bones, sh = B.mixamorigRightArm, el = B.mixamorigRightForeArm, wr = B.mixamorigRightHand;
  const S = new THREE.Vector3().setFromMatrixPosition(sh.matrixWorld), E0 = new THREE.Vector3().setFromMatrixPosition(el.matrixWorld), W0 = new THREE.Vector3().setFromMatrixPosition(wr.matrixWorld);
  const a = S.distanceTo(E0), b = E0.distanceTo(W0);
  const st = T.clone().sub(S); let d = st.length(); st.divideScalar(d); d = Math.min(d, (a + b) * 0.999);
  const x = (a * a - b * b + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, a * a - x * x));
  const pole = R.clone().multiplyScalar(P.poleR ?? 0.6).addScaledVector(Up, -1).addScaledVector(F, P.poleF ?? 0.25);
  pole.addScaledVector(st, -pole.dot(st)).normalize();
  const EL = S.clone().addScaledVector(st, x).addScaledVector(pole, hh);
  aim(sh, el, EL); aim(el, wr, T);
  const qF = wq(el), qL = qF.clone().invert().multiply(qH);
  const tw = new THREE.Quaternion(0, qL.y, 0, qL.w).normalize();
  el.quaternion.multiply(new THREE.Quaternion().slerp(tw, 0.5)).normalize(); el.updateMatrixWorld(true);
  setWQ(wr, qH);
  return { ear: E, phone: C, R, F, U: Up };
}

// World positions of named bones (after poseWalker).
export const boneW = (wk, n) => new THREE.Vector3().setFromMatrixPosition(wk.bones['mixamorig' + n].matrixWorld);
