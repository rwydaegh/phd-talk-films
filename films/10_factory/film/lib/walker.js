// S5b walker: the SMPL-X body on the Mixamo skeleton (lib/human.js) standing in the Idle loop,
// right forearm raised so a phone sits at waist height, coloured with the surface-law look
// (jet, Lambert, emissive 0.35): cool blue/cyan everywhere plus a Gaussian hot spot near the phone.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { makePhone } from './phone.js';
import { loadHumanBot, prepClip } from './human.js';

function bodyMaterial(u) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWN; varying vec3 vWP;')
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvWN = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWN; varying vec3 vWP;
uniform vec3 uHotC, uHotD, uAmb; uniform float uHot, uHotR, uEmis, uSpill; uniform vec3 uBeamK;
vec3 jetc(float x){ x = clamp(x,0.,1.); return clamp(vec3(1.5-abs(4.*x-3.),1.5-abs(4.*x-2.),1.5-abs(4.*x-1.)),0.,1.); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 n = normalize(vWN);
// Cool background: weak multipath from all around plus the beam's side spill (surface law, cosine term).
float bg = 0.15 + 0.08 * max(0., dot(n, -uAmb)) + uSpill * max(0., dot(n, -uBeamK));
vec3 dp = vWP - uHotC;
float G = exp(-dot(dp, dp) / (2. * uHotR * uHotR));
float c = max(0., dot(n, uHotD));
float hot = uHot * G * (0.35 + 0.65 * c);
float x = bg + 0.78 * smoothstep(0.06, 0.95, hot);
diffuseColor.rgb = jetc(x);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = diffuseColor.rgb * uEmis;');
  };
  m.customProgramCacheKey = () => 's5b-body';
  return m;
}

export async function loadStandingWalker(ctx, parent, { phoneScale = 1 } = {}) {
  const u = {
    uHotC: { value: new THREE.Vector3() }, uHotD: { value: new THREE.Vector3(1, 0, 0) },
    uHot: { value: 0 }, uHotR: { value: 0.16 }, uEmis: { value: 0.35 },
    uAmb: { value: new THREE.Vector3(0, 0, -1) }, uBeamK: { value: new THREE.Vector3(1, 0, 0) }, uSpill: { value: 0 },
  };
  const mat = bodyMaterial(u);
  const { bot, mesh } = await loadHumanBot(mat);
  bot.scale.setScalar(0.01); bot.rotation.x = Math.PI / 2;
  const clip = prepClip((await new FBXLoader().loadAsync('assets/mixamo/Idle.fbx')).animations[0]);
  const mixer = new THREE.AnimationMixer(bot); mixer.clipAction(clip).play();
  const root = new THREE.Group(); root.add(bot); parent.add(root);
  // The FBX nests an identity copy of every bone under the animated one; the body is bound to the animated bone.
  const bones = {};
  bot.traverse((o) => { if (o.isBone && !bones[o.name]) bones[o.name] = THREE.PropertyBinding.findNode(bot, o.name); });
  // Bones that get pose overrides are set from the clip track directly every frame (the mixer skips writing a
  // bone whose animated value did not change, which would let an override accumulate across frames).
  const OVR = ['mixamorigRightShoulder', 'mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand', 'mixamorigNeck', 'mixamorigHead',
    'mixamorigSpine2', ...FINGERS];
  const ovr = {};
  for (const n of OVR) {
    const tr = clip.tracks.find((t) => t.name === `${n}.quaternion`);
    ovr[n] = { rest: bones[n].quaternion.clone(), ip: tr ? tr.createInterpolant() : null };
  }
  const phone = makePhone(ctx, { scale: phoneScale });
  parent.add(phone.group);
  phone.group.matrixAutoUpdate = false;
  return { root, bot, mesh, mixer, u, mat, bones, ovr, phone, clipDur: clip.duration };
}

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [1, 2, 3].map((k) => `mixamorigRightHand${f}${k}`));
const qTmp = new THREE.Quaternion(), eTmp = new THREE.Euler(), qClip = new THREE.Quaternion();
/** Set the idle clip pose at `time`, then apply overrides (degrees, about the bone's local axes). */
export function poseArm(wk, P, time) {
  const tt = ((time % wk.clipDur) + wk.clipDur) % wk.clipDur;
  const rot = (name, e) => {
    const o = wk.ovr[name], bone = wk.bones[name]; if (!o || !bone) return;
    if (o.ip) { const v = o.ip.evaluate(tt); qClip.set(v[0], v[1], v[2], v[3]).normalize(); } else qClip.copy(o.rest);
    qTmp.setFromEuler(eTmp.set(e[0] * Math.PI / 180, e[1] * Math.PI / 180, e[2] * Math.PI / 180));
    bone.quaternion.copy(qClip).multiply(qTmp);
  };
  rot('mixamorigRightArm', P.arm);
  rot('mixamorigRightForeArm', P.fore);
  rot('mixamorigRightHand', P.hand);
  rot('mixamorigNeck', P.neck || [0, 0, 0]);
  rot('mixamorigHead', P.head || [0, 0, 0]);
  rot('mixamorigRightShoulder', P.shoulder || [0, 0, 0]);
  rot('mixamorigSpine2', P.spine2 || [0, 0, 0]);
  // Grip: per-finger curl [deg] about the joints' local axes, P.fingers = { Thumb1: [x, y, z], Index2: ..., ... }.
  const F = P.fingers || {};
  for (const f of FINGERS) rot(f, F[f.slice(18)] || [0, 0, 0]);
}

const mTmp = new THREE.Matrix4(), mOff = new THREE.Matrix4(), vS = new THREE.Vector3(), qR = new THREE.Quaternion(), vP = new THREE.Vector3();
/** Place the phone in the right hand: offset [m] and rotation [deg] in the hand bone frame (scale removed). */
export function placePhone(wk, off, rotDeg) {
  const hand = wk.bones.mixamorigRightHand;
  hand.updateWorldMatrix(true, false);
  hand.matrixWorld.decompose(vP, qR, vS);
  mTmp.compose(vP, qR, new THREE.Vector3(1, 1, 1));
  qTmp.setFromEuler(eTmp.set(...rotDeg.map((a) => a * Math.PI / 180)));
  mOff.compose(new THREE.Vector3(...off), qTmp, new THREE.Vector3(1, 1, 1));
  wk.phone.group.matrix.multiplyMatrices(mTmp, mOff);
  wk.phone.group.matrixWorldNeedsUpdate = true;
  return new THREE.Vector3().setFromMatrixPosition(wk.phone.group.matrix);
}

// ---- holding the phone ------------------------------------------------------
// The phone pose is given in the walker frame (right, forward, up from the hips, metres; tilt in degrees), the
// grip is the phone pose in the hand bone frame (P.phoneOff, P.phoneRot, as for placePhone). The hand bone
// pose follows from both; a two-bone IK with an elbow pole then sets the upper arm and forearm, and the
// forearm takes part of the wrist twist. Called after poseArm, so the clip idle still drives the body.
const _v = Array.from({ length: 8 }, () => new THREE.Vector3());
const _q = Array.from({ length: 6 }, () => new THREE.Quaternion());
const _m = Array.from({ length: 3 }, () => new THREE.Matrix4());
function worldQ(o, out) { o.matrixWorld.decompose(_v[7], out, _v[6]); return out; }
function worldP(o, out) { return out.setFromMatrixPosition(o.matrixWorld); }
function setWorldQ(bone, qW) {
  const qp = worldQ(bone.parent, _q[5]).invert();
  bone.quaternion.copy(qp.multiply(qW)).normalize();
  bone.updateMatrixWorld(true);
}
function aim(bone, child, target) {
  const p = worldP(bone, _v[0]), c = worldP(child, _v[1]);
  const v0 = c.sub(p).normalize(), v1 = _v[2].subVectors(target, p).normalize();
  const dq = _q[0].setFromUnitVectors(v0, v1);
  setWorldQ(bone, _q[1].copy(dq).multiply(worldQ(bone, _q[2])));
}

/** Returns the phone's world matrix target (scale 1). H = { pos: [r, f, u], rot: [pitch, yaw, roll], pole: [r, f, u], twist } */
export function holdPhone(wk, P) {
  const H = P.hold, B = wk.bones;
  const fh = wk.root.rotation.z - Math.PI / 2;
  const F = _v[3].set(Math.cos(fh), Math.sin(fh), 0), R = _v[4].set(Math.cos(fh - Math.PI / 2), Math.sin(fh - Math.PI / 2), 0);
  const U = new THREE.Vector3(0, 0, 1);
  wk.root.updateMatrixWorld(true);
  const hips = worldP(B.mixamorigHips, new THREE.Vector3());
  const toW = (a) => hips.clone().addScaledVector(R, a[0]).addScaledVector(F, a[1]).addScaledVector(U, a[2]);
  // phone orientation: screen (+z) toward the walker (-F), top (+y) up, then yaw about up, pitch (top away), roll
  const base = new THREE.Matrix4().makeBasis(R.clone(), U, F.clone().negate());
  const D = Math.PI / 180;
  const qPh = new THREE.Quaternion().setFromRotationMatrix(base)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), H.rot[1] * D))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -H.rot[0] * D))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), H.rot[2] * D));
  let mPh = new THREE.Matrix4().compose(toW(H.pos), qPh, new THREE.Vector3(1, 1, 1));
  const grip = new THREE.Matrix4().compose(new THREE.Vector3(...P.phoneOff),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...P.phoneRot.map((a) => a * D))), new THREE.Vector3(1, 1, 1));
  const mHand = mPh.clone().multiply(grip.clone().invert());
  const T = new THREE.Vector3(), qH = new THREE.Quaternion(); mHand.decompose(T, qH, _v[5]);
  if (H.wrist) T.copy(toW(H.wrist));
  // two-bone IK: shoulder S, elbow E, wrist W
  const sh = B.mixamorigRightArm, el = B.mixamorigRightForeArm, wr = B.mixamorigRightHand;
  const S = worldP(sh, new THREE.Vector3()), E = worldP(el, new THREE.Vector3()), W = worldP(wr, new THREE.Vector3());
  const a = S.distanceTo(E), b = E.distanceTo(W);
  const st = new THREE.Vector3().subVectors(T, S); let d = st.length(); st.divideScalar(d);
  d = Math.min(d, (a + b) * 0.999);
  const x = (a * a - b * b + d * d) / (2 * d), hgt = Math.sqrt(Math.max(0, a * a - x * x));
  const pole = toW(H.pole).sub(hips); pole.addScaledVector(st, -pole.dot(st)).normalize();
  const E1 = S.clone().addScaledVector(st, x).addScaledVector(pole, hgt);
  if (H.wrist) {
    // Hand from the forearm: palm normal (+z) toward the eyes, fingers (+y) continue the forearm in the palm plane
    // (no radial/ulnar bend), then H.ext [deg] wrist extension and H.dev [deg] deviation; the phone follows the grip.
    const eye = worldP(B.mixamorigHead, new THREE.Vector3()).addScaledVector(F, 0.09).addScaledVector(U, 0.08);
    const hz = eye.sub(T).normalize();
    const fa = new THREE.Vector3().subVectors(T, E1).normalize();
    const hy = fa.clone().addScaledVector(hz, -fa.dot(hz)).normalize();
    hy.applyAxisAngle(hz, (H.dev || 0) * D);
    let hx = new THREE.Vector3().crossVectors(hy, hz);
    hy.applyAxisAngle(hx, -(H.ext || 0) * D); hz.applyAxisAngle(hx, -(H.ext || 0) * D);
    hx = new THREE.Vector3().crossVectors(hy, hz);
    qH.setFromRotationMatrix(new THREE.Matrix4().makeBasis(hx, hy, hz));
    mPh = new THREE.Matrix4().compose(T, qH, new THREE.Vector3(1, 1, 1)).multiply(grip);
    if (!holdPhone.logged) { holdPhone.logged = 1; const loc = (v) => { const q = v.clone().sub(hips); return [q.dot(R), q.dot(F), q.dot(U)].map((z) => z.toFixed(2)).join(','); };
      console.warn('S5b wrist flexion', (Math.asin(Math.min(1, Math.abs(fa.dot(hz)))) / D).toFixed(1), 'deg; S', loc(S), 'E', loc(E1), 'T', loc(T), 'eye', loc(worldP(B.mixamorigHead, new THREE.Vector3())), 'arm', a.toFixed(3), b.toFixed(3)); }
  }
  aim(sh, el, E1);
  aim(el, wr, T);
  // wrist twist: give the forearm a share of the hand's roll about the forearm axis
  const qF = worldQ(el, new THREE.Quaternion());
  const qL = qF.clone().invert().multiply(qH);            // hand relative to the forearm (bone frames)
  const tw = new THREE.Quaternion(0, qL.y, 0, qL.w).normalize();
  const share = H.twist ?? 0.5;
  const qTw = new THREE.Quaternion().slerp(tw, share);
  el.quaternion.multiply(qTw).normalize(); el.updateMatrixWorld(true);
  setWorldQ(wr, qH);
  return mPh;
}
