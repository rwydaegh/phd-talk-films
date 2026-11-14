// Posing bench (not part of a film): the worker on a grey floor, a camera from ?cam=az,el,dist,lookZ,fov.
// ?clip=phone|idle  ?ct=clip seconds  ?po=x,y,z phone offset  ?pr=x,y,z phone rotation (hand bone frame)
// window.dumpPose() returns the posed, skinned mesh in world coordinates (for tools/trace.py).
import * as THREE from 'three';
import { loadWorker, poseWorker, phoneAntenna } from '../lib/worker.js';
import { POSE10, POSE27 } from '../lib/poses.js';

let scene, cam, wk, P;
const num = (s, d) => (s ? s.split(',').map(Number) : d);
export default {
  async init(ctx) {
    const q = ctx.q;
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdde6ff, 0x202428, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, -4, 6); scene.add(key);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.9 }));
    scene.add(floor);
    const base = (q.get('pose') || '10') === '10' ? POSE10 : POSE27;
    P = Object.assign({}, base);
    if (q.get('po')) P.phoneOff = num(q.get('po')); if (q.get('pr')) P.phoneRot = num(q.get('pr'));
    if (q.get('ct')) P.ct = +q.get('ct');
    const at = num(q.get('at'), [0, 0, 0, -90]);
    wk = await loadWorker(ctx, scene, { pos: at.slice(0, 3), face: at[3], clip: base.clip, height: base.height, key: 'pose' });
    cam = new THREE.PerspectiveCamera(30, ctx.W / ctx.H, 0.01, 100);
    window.dumpPose = () => {
      poseWorker(wk, P.ct, P);
      const g = wk.mesh.geometry, n = g.attributes.position.count, v = new THREE.Vector3();
      const out = new Float32Array(n * 3);
      wk.mesh.updateMatrixWorld(true);
      for (let i = 0; i < n; i++) { wk.mesh.getVertexPosition(i, v); v.applyMatrix4(wk.mesh.matrixWorld); out.set([v.x, v.y, v.z], i * 3); }
      const head = new THREE.Matrix4().copy(wk.bones.mixamorigHead.matrixWorld);
      return { n, pos: Array.from(out), idx: Array.from(g.index.array), phone: phoneAntenna(wk).toArray(),
        phoneMatrix: wk.phone.group.matrix.toArray(), head: head.toArray(), arm: Array.from(g.attributes.aArm.array),
        hand: wk.bones.mixamorigRightHand.matrixWorld.toArray(), boneNames: wk.mesh.skeleton.bones.map((b) => b.name),
        bones: Object.fromEntries(Object.keys(wk.bones).filter((k) => /RightHand/.test(k)).map((k) => [k, wk.bones[k].matrixWorld.toArray()])),
        dom: Array.from({ length: n }, (_, i) => { const si = g.attributes.skinIndex, sw = g.attributes.skinWeight; let b = 0, w = -1; for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > w) { w = sw.getComponent(i, k); b = si.getComponent(i, k); } return b; }) };
    };
  },
  draw(tl, t, target, ctx) {
    const W = window.__pose || {};
    if (W.po) P.phoneOff = W.po; if (W.pr) P.phoneRot = W.pr; if (W.hold) P.hold = Object.assign({}, P.hold, W.hold); for (const k of ['head', 'neck', 'arm', 'fore', 'hand', 'fingers']) if (W[k]) P[k] = W[k];
    poseWorker(wk, P.ct + (W.tt ?? (+ctx.q.get('tt') || 0)), P);
    const c = W.cam || num(ctx.q.get('cam'), [0, 5, 2.2, 1.0, 30]);   // az (deg, 0 = in front of the face), el, dist, lookZ, fov
    const face = -90 * Math.PI / 180, az = face + c[0] * Math.PI / 180, el = c[1] * Math.PI / 180;
    const look = new THREE.Vector3(c[5] || 0, c[6] || 0, c[3]);
    cam.position.set(look.x + c[2] * Math.cos(el) * Math.cos(az), look.y + c[2] * Math.cos(el) * Math.sin(az), look.z + c[2] * Math.sin(el));
    cam.up.set(0, 0, 1); cam.lookAt(look); cam.fov = c[4]; cam.aspect = ctx.W / ctx.H; cam.updateProjectionMatrix();
    const r = ctx.renderer; r.setRenderTarget(target); r.setClearColor(0x0b0d11, 1); r.clear(); r.render(scene, cam);
  },
  grade() { return { bloom: 0.2, vignette: 0.3, grain: 0 }; },
};
