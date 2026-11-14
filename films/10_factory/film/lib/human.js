// A smooth human for the walker: the SMPL-X neutral body (assets/human, from prep/smplx_body.py) bound to the
// Mixamo Y Bot skeleton, so the Mixamo clips drive it. Returns the FBX group with the jointed Y Bot meshes replaced.
//  1. Pose SMPL-X into the Y Bot bind pose: every bone gets the shortest-arc rotation onto the Y Bot bone direction.
//  2. Scale so the pelvis sits at the Y Bot hip height, and move the Y Bot bones onto the SMPL-X joints.
//  3. Bind with the SMPL-X skin weights.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

let dataP = null;
function loadData() {
  if (!dataP) dataP = Promise.all([
    fetch('assets/human/smplx_neutral.json').then((r) => r.json()),
    fetch('assets/human/smplx_neutral.bin').then((r) => r.arrayBuffer()),
  ]);
  return dataP;
}

// Primary child per SMPL-X joint for the bone direction; joints not listed take their parent's rotation.
const CHILD = { 1: 4, 2: 5, 3: 6, 4: 7, 5: 8, 6: 9, 7: 10, 8: 11, 9: 12, 12: 15, 13: 16, 14: 17, 16: 18, 17: 19, 18: 20, 19: 21, 20: 28, 21: 43 };
for (let s = 0; s < 2; s++) for (let f = 0; f < 5; f++) { const b = 25 + 15 * s + 3 * f; CHILD[b] = b + 1; CHILD[b + 1] = b + 2; }

// Mixamo clips: drop every translation track except the hips (they would undo the refitted bone offsets),
// and keep the hips walking in place.
export function prepClip(clip) {
  clip.tracks = clip.tracks.filter((t) => {
    t.name = t.name.replace('mixamorig1', 'mixamorig');
    if (t.name.endsWith('.scale')) return false;
    if (t.name.endsWith('.position')) return t.name === 'mixamorigHips.position';
    return true;
  });
  const hp = clip.tracks.find((t) => t.name === 'mixamorigHips.position');
  if (hp) { const v = hp.values; for (let i = 0; i < v.length; i += 3) { v[i] = 0; v[i + 2] = 0; } }
  return clip;
}

export async function loadHumanBot(material) {
  const [[meta, buf], bot] = await Promise.all([loadData(), new FBXLoader().loadAsync('assets/mixamo/Y Bot.fbx')]);
  bot.updateMatrixWorld(true);
  const bones = {};
  bot.traverse((o) => { if (o.isBone && !bones[o.name]) bones[o.name] = o; });
  for (const m of bot.children.filter((o) => o.isMesh)) bot.remove(m);

  const { names, parents, pos } = meta.joints;
  const nj = names.length;
  const Y = (n) => new THREE.Vector3().setFromMatrixPosition(bones['mixamorig' + n].matrixWorld);
  const J = pos.map((p) => new THREE.Vector3(...p));

  // 1. Global rotations and posed joints.
  const R = [], Jp = [];
  for (let i = 0; i < nj; i++) {
    const p = parents[i];
    if (i in CHILD) {
      const c = CHILD[i];
      const a = J[c].clone().sub(J[i]).normalize(), b = Y(names[c]).sub(Y(names[i])).normalize();
      R[i] = new THREE.Quaternion().setFromUnitVectors(a, b);
    } else R[i] = p < 0 ? new THREE.Quaternion() : R[p].clone();
    Jp[i] = p < 0 ? J[i].clone() : J[i].clone().sub(J[p]).applyQuaternion(R[p]).add(Jp[p]);
  }
  const rep = meta.bones.map((n) => names.indexOf(n));   // representative SMPL-X joint per bone

  const nv = meta.nv;
  const P0 = new Float32Array(buf, meta.offsets.pos, nv * 3);
  const SI = new Uint16Array(buf, meta.offsets.skinIndex, nv * 4);
  const SW = new Float32Array(buf, meta.offsets.skinWeight, nv * 4);
  const IDX = new Uint32Array(buf, meta.offsets.idx, meta.nf * 3);
  const P = new Float32Array(nv * 3);
  const v = new THREE.Vector3(), acc = new THREE.Vector3(), tmp = new THREE.Vector3();
  let minY = Infinity;
  for (let k = 0; k < nv; k++) {
    v.fromArray(P0, k * 3); acc.set(0, 0, 0);
    for (let q = 0; q < 4; q++) {
      const w = SW[k * 4 + q]; if (w <= 0) continue;
      const j = rep[SI[k * 4 + q]];
      tmp.copy(v).sub(J[j]).applyQuaternion(R[j]).add(Jp[j]).multiplyScalar(w);
      acc.add(tmp);
    }
    acc.toArray(P, k * 3);
    minY = Math.min(minY, acc.y);
  }

  // 2. Scale and place: pelvis on the Y Bot hips, soles on the floor.
  const hips = Y('Hips');
  const s = hips.y / (Jp[0].y - minY);
  for (let k = 0; k < nv; k++) {
    P[k * 3] = (P[k * 3] - Jp[0].x) * s + hips.x;
    P[k * 3 + 1] = (P[k * 3 + 1] - Jp[0].y) * s + hips.y;
    P[k * 3 + 2] = (P[k * 3 + 2] - Jp[0].z) * s + hips.z;
  }
  const Jw = Jp.map((j) => j.clone().sub(Jp[0]).multiplyScalar(s).add(hips));
  const done = new Set();
  for (let i = 1; i < nj; i++) {
    const n = names[i]; if (done.has(n) || rep[meta.bones.indexOf(n)] !== i) continue;
    done.add(n);
    const b = bones['mixamorig' + n];
    b.parent.updateWorldMatrix(true, false);
    b.position.copy(b.parent.worldToLocal(Jw[i].clone()));
    b.updateMatrixWorld(true);
  }

  // 3. Bind.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setIndex(new THREE.BufferAttribute(IDX, 1));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
  geo.computeVertexNormals();
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.name = 'smplx_body';
  mesh.frustumCulled = false;
  bot.add(mesh);
  bot.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(meta.bones.map((n) => bones['mixamorig' + n])), mesh.matrixWorld);
  return { bot, bones, mesh, scale: s };
}
