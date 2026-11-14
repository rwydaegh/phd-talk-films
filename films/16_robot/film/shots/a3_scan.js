// A3 + A4 (one continuous shot): the probe scans the 51 x 47.5 cm plane in the photo and the measured 26 GHz map
// builds point by point; the room falls away; the model appears (four antenna sets on a pole, 62 cm from the
// plane, aimed at its centre); the simulated map slides out beside the measured one.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { applyCam, ease, lerp, mix3, smoother, norm3, sub3, add3, slerpDir } from '../lib/cam.js';
import { Photo } from '../lib/photo.js';
import { ScanMap, scanProgress } from '../lib/scanmap.js';
import { BG_HDR, GLSL_COMMON } from '../lib/common.js';

let photo, scene, cam, meas, sim, model, beams, sets = [], P = {};
const T_SCAN0 = 1.2, T_SCAN1 = 12.5;          // scan runs between these shot times
const T_MODEL = 14.0, T_SLIDE = 17.6, T_FRONT = 20.4, DUR = 26;

function darkMat(col = [0.06, 0.065, 0.075], key = [0.5, -0.8, 0.6]) {
  return new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, transparent: true,
    vertexShader: `in vec3 position; in vec3 normal; uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix; out vec3 vN;
      void main(){ vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `precision highp float; ${GLSL_COMMON} in vec3 vN; uniform vec3 uC, uK; uniform float uO; out vec4 frag;
      void main(){ vec3 n = normalize(vN); float l = 0.35 * (0.6 + 0.4 * n.z) + 0.9 * max(dot(n, normalize(uK)), 0.0);
        frag = vec4(invTone(pow(uC * l, vec3(1.0/2.2))) * uO, uO); }`,
    uniforms: { uC: { value: new THREE.Vector3(...col) }, uK: { value: new THREE.Vector3(...key) }, uO: { value: 1 } },
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
}

export default {
  async init(ctx) {
    photo = await Photo.load('probe26');
    scene = new THREE.Scene(); scene.add(photo.group);
    cam = new THREE.PerspectiveCamera();
    // The probe measures the field along its own axis, which lies in the scan plane (thesis 6.1). So the plane
    // contains the probe and faces the camera; the scan starts with the tip at its top-left corner.
    const tip = photo.point(528, 612, 0.715);
    const Wd = 0.510, Ht = 0.475;
    const c = [tip[0] + Wd / 2, tip[1], tip[2] - Ht / 2];
    P.c = c; P.tip = tip;
    meas = await ScanMap.load('assets/maps/a26_meas.png', { rows: 142, cols: 153, order: 'rows', corner: [c[0] - Wd / 2, c[1], c[2] - Ht / 2], U: [Wd, 0, 0], V: [0, 0, Ht] });
    sim = await ScanMap.load('assets/maps/a26_sim.png', { rows: 142, cols: 153, order: 'rows', corner: [c[0] - Wd / 2, c[1] - 0.001, c[2] - Ht / 2], U: [Wd, 0, 0], V: [0, 0, Ht] });
    meas.set({ uFresh: 40 }); sim.set({ uAll: 0, uHead: 0 });
    scene.add(meas.mesh, sim.mesh);
    // the model: a glass-fibre pole 62 cm in front of the plane, four 4x1 sets at -0.52, -0.15, +0.15, +0.52 m
    model = new THREE.Group();
    const poleX = c[0], poleY = c[1] - 0.62;
    P.pole = [poleX, poleY];
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 16), darkMat([0.2, 0.2, 0.22]));
    pole.rotation.x = Math.PI / 2; pole.position.set(poleX - 0.05, poleY, c[2]);
    model.add(pole);
    for (const h of [-0.52, -0.15, 0.15, 0.52]) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.10), darkMat([0.07, 0.07, 0.08]));
      const face = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.004, 0.086), darkMat([0.85, 0.62, 0.22]));
      face.position.set(0, 0.022, 0);
      g.add(body, face);
      g.position.set(poleX, poleY, c[2] + h);
      g.lookAt(new THREE.Vector3(poleX, poleY - 1, c[2] + h).lerp(new THREE.Vector3(...c), 0)); // placeholder, set below
      // aim the face (+y) at the plane centre
      const dir = new THREE.Vector3(c[0] - poleX, c[1] - poleY, -h).normalize();
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      sets.push(g); model.add(g);
    }
    scene.add(model);
    // beams: one line per set to the plane centre
    beams = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: 0xffffff, linewidth: 2.0 * ctx.H / 1080, transparent: true, opacity: 0.8 }));
    beams.material.resolution.set(ctx.W, ctx.H); beams.frustumCulled = false;
    scene.add(beams);
  },
  camAt(tl) {
    // photo framing during the scan, then free camera
    // continue from A1's last framing, then ease back until the whole plane is in frame
    const u = ease(tl, 0.8, 7.0);
    const ph = photo.spec({ u0: lerp(1050, 1200, u), v0: lerp(760, 1235, u), zoom: lerp(1.18, 0.9, u) });
    if (tl < T_MODEL - 0.6) return ph;
    const c = P.c, mid = [c[0] + 0.285, c[1], c[2] - 0.02];
    const v34 = { pos: [c[0] + 1.3, c[1] - 1.75, c[2] + 0.45], look: [c[0] + 0.02, c[1] - 0.36, c[2]], s: 1650 };
    const front = { pos: [mid[0], c[1] - 1.42, mid[2] + 0.02], look: [mid[0], c[1], mid[2]], s: 2250 };
    const phLook = add3(ph.pos, ph.fwd, 0.64);
    const u1 = ease(tl, T_MODEL - 0.6, T_SLIDE - 0.2), u2 = ease(tl, T_FRONT - 1.2, T_FRONT + 2.6);
    let pos = mix3(ph.pos, v34.pos, u1), look = mix3(phLook, v34.look, u1), s = lerp(ph.s, v34.s, u1);
    let cx = lerp(ph.cx, 1280, u1), cy = lerp(ph.cy, 720, u1);
    pos = mix3(pos, front.pos, u2); look = mix3(look, front.look, u2); s = lerp(s, front.s, u2);
    // a slow drift on the hold
    pos = add3(pos, [0.04 * Math.sin(tl * 0.21), 0, 0.02 * Math.sin(tl * 0.17)], ease(tl, T_FRONT + 2, DUR));
    return { pos, fwd: norm3(sub3(look, pos)), up: [0, 0, 1], s, cx, cy };
  },
  draw(tl, t, target, ctx) {
    applyCam(cam, this.camAt(tl), ctx.W, ctx.H, 0.02, 100);
    const total = meas.total;
    const prog = scanProgress(tl - T_SCAN0, total, 153 * 1.0, 2.2, T_SCAN1 - T_SCAN0);
    const done = prog >= total;
    meas.set({ uProg: prog, uTrail: 153 * 2.5, uHead: 1 - ease(tl, T_SCAN1 - 0.2, T_SCAN1 + 0.8), uFrame: ease(tl, 0.2, 1.0) * (1 - 0.6 * ease(tl, T_MODEL, T_MODEL + 2)), uGrid: ease(tl, 0.2, 1.0) * (1 - ease(tl, T_SCAN1, T_SCAN1 + 1)), uAll: done ? 1 : 0 });
    // the room dims while the map builds, and is gone before the model comes
    const dim = lerp(1, 0.38, ease(tl, 0.6, 2.4)) * (1 - ease(tl, T_SCAN1 - 1.5, T_MODEL - 0.4));
    photo.uniforms.uDim.value = dim;
    photo.group.visible = dim > 0.002;
    // model
    const mIn = ease(tl, T_MODEL + 1.0, T_MODEL + 2.2), mOut = 1 - ease(tl, T_FRONT - 0.6, T_FRONT + 1.2);
    model.visible = mIn * mOut > 0.002;
    model.traverse((m) => { if (m.material && m.material.uniforms && m.material.uniforms.uO) m.material.uniforms.uO.value = mIn * mOut; });
    // beams grow from the sets to the centre
    const bp = ease(tl, T_MODEL + 1.6, T_MODEL + 3.2), segs = [];
    for (const g of sets) { const a = g.position.toArray(); segs.push(...a, ...mix3(a, P.c, bp)); }
    beams.geometry.setPositions(segs); beams.material.opacity = 0.75 * mOut * (bp > 0 ? 1 : 0); beams.visible = bp > 0 && mOut > 0.002;
    // simulated map slides out to the right and fills from the centre
    const sl = ease(tl, T_SLIDE, T_SLIDE + 1.8);
    const c = P.c;
    sim.place([c[0] - 0.255 + 0.57 * sl, c[1] - 0.002 - 0.02 * Math.sin(Math.PI * sl), c[2] - 0.2375], [0.51, 0, 0], [0, 0, 0.475]);
    const rv = ease(tl, T_SLIDE + 1.2, T_SLIDE + 3.0);
    sim.set({ uFrame: ease(tl, T_SLIDE, T_SLIDE + 0.4) * 0.7, uProg: rv * sim.total, uOpacity: 1 });
    sim.mesh.visible = tl > T_SLIDE;
    const r = ctx.renderer; r.setRenderTarget(target); r.setClearColor(BG_HDR, 1); r.clear(); r.render(scene, cam);
  },
  grade(tl) { return { bloom: lerp(0.08, 0.16, ease(tl, 2, 8)), vignette: 0.45, grain: 0.012 }; },
  labels(tl, t, ctx) {
    applyCam(cam, this.camAt(tl), ctx.W, ctx.H, 0.02, 100);
    const c = P.c, items = [];
    // the Probe label carries over from the previous shot and leaves as the scan begins
    items.push({ kind: 'label', at: P.tip, off: [-130, -190], text: 'Probe', size: 54, p: 1, a: 1 - ease(tl, 0.4, 1.1) });
    const ghz = ease(tl, 2.0, 3.0) * (1 - ease(tl, DUR - 0.4, DUR));
    items.push({ kind: 'text', at: [150, 130], text: [['f', 'math'], [' = 26 GHz', 'main']], size: 50, a: ghz, p: 1 });
    const fa = 1 - ease(tl, T_FRONT - 0.4, T_FRONT + 0.4);
    items.push({ kind: 'label', at: sets[3].position.toArray(), off: [-200, -60], text: 'Antenna', size: 54, p: ease(tl, T_MODEL + 1.8, T_MODEL + 3.0), a: fa });
    const fl = ease(tl, T_FRONT + 2.4, T_FRONT + 3.6);
    items.push({ kind: 'text', at: [c[0], c[1], c[2] + 0.2375 + 0.055], align: 'center', text: 'Measurement', size: 54, p: 1, a: fl });
    items.push({ kind: 'text', at: [c[0] + 0.57, c[1], c[2] + 0.2375 + 0.055], align: 'center', text: 'Simulation', size: 54, p: 1, a: ease(tl, T_FRONT + 2.8, T_FRONT + 4.0) });
    return { cam, items };
  },
};
