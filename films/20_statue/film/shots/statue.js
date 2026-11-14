// Film 20: a child as a plaster statue under a lamp. The lamp recedes into a plane-wave source and the
// shading stays: behind the first plane front the plaster turns into the law's map, in jet. The camera
// then dives to one triangle of the mesh, its normal n and the wave direction k.
// One continuous camera. Every frame is a pure function of t.
import * as THREE from 'three';
import { loadBust, Shadow, bodyMaterial, Fronts } from '../lib/law.js';
import { loadTex } from '../lib/labels.js';
import { track, clamp, lerp, ease, smooth, smoother, add3, sub3, mul3, dot3, len3, norm3, cross3, mix3, dirAE } from '../lib/anim.js';

const BG = new THREE.Color(0.0021, 0.0027, 0.0040);      // #07090d in linear
const q = new URLSearchParams(location.search);
const Q = { nSide: +(q.get('ns') || 1), kSide: +(q.get('ks') || 1) };

// ---- the story in time (s) --------------------------------------------------------------------
export const T = {
  on: 1.0,                      // the lamp switches on after one second of black
  emit: 7.0,                    // the bulb sends out its first front
  recede0: 7.5, recede1: 14.0,  // the lamp moves out to a plane-wave source
  zoom0: 21.0, wire: 24.0, flat: 25.2, facet: 26.6, zoom1: 28.4,
  end: 34.0,
};
const LAMP_AZ = 52, LAMP_EL = 34;                     // toward the source, from the statue centre (0 = front, 90 = the statue's left)
const L_DIR = dirAE(LAMP_AZ, LAMP_EL);
export const K = mul3(L_DIR, -1);                      // propagation direction k
const D_NEAR = 0.66, D_FAR = 400, AIM_DZ = 0.09;                      // lamp distance before and after (m)
const FOV = 13, TELE = Math.tan(15 * Math.PI / 180) / Math.tan(FOV / 2 * Math.PI / 180);   // long lens: fronts read as lines
const LAMBDA_V = 0.13, SPEED = 0.16;                   // drawn front spacing (m) and speed (m/s); not physical
const WARM = [1.0, 0.9, 0.78], COOL = [0.97, 0.985, 1.0];
T.sweep = T.emit + D_NEAR / SPEED;                     // the lead front reaches the statue centre (15.9 s)

export function lampDist(t) { const u = ease(t, T.recede0, T.recede1, smooth); return D_NEAR * Math.pow(D_FAR / D_NEAR, u * u * (1.6 - 0.6 * u)); }

let C = [0, 0.045, 0.035];
let bust, shadow, scene, cam, mats, meshes, fronts, bulb, halo, wire, F = null;
let camTrack;

// the facet: a well-shaped, lit triangle on the upper chest, on the side facing the source
function pickFacet(geo) {
  const P = geo.attributes.position.array, I = geo.index.array, N = geo.attributes.normal.array;
  const want = [0.045, 0, -0.075];
  let best = null, bs = Infinity;
  for (let f = 0; f < I.length; f += 3) {
    const a = I[f] * 3, b = I[f + 1] * 3, c = I[f + 2] * 3;
    const A = [P[a], P[a + 1], P[a + 2]], B = [P[b], P[b + 1], P[b + 2]], Cc = [P[c], P[c + 1], P[c + 2]];
    const g = mul3(add3(add3(A, B), Cc), 1 / 3);
    if (Math.hypot(g[0] - want[0], g[2] - want[2]) > 0.02) continue;
    let n = cross3(sub3(B, A), sub3(Cc, A)); n = norm3(n);
    const vn = norm3([N[a] + N[b] + N[c], N[a + 1] + N[b + 1] + N[c + 1], N[a + 2] + N[b + 2] + N[c + 2]]);
    if (dot3(n, vn) < 0) n = mul3(n, -1);
    if (n[1] < 0.5) continue;                        // front-facing chest
    const e = [len3(sub3(B, A)), len3(sub3(Cc, B)), len3(sub3(A, Cc))];
    const qual = Math.min(...e) / Math.max(...e);
    const score = Math.hypot(g[0] - want[0], g[2] - want[2]) * 40 + (1 - qual) * 2 - g[1] * 5;
    if (qual > 0.72 && dot3(n, L_DIR) > 0.45 && score < bs) { bs = score; best = { A, B, C: Cc, g, n, size: Math.max(...e) }; }
  }
  return best;
}

function patchLines(geo, centre, radius, lift) {
  const P = geo.attributes.position.array, I = geo.index.array, N = geo.attributes.normal.array;
  const seen = new Set(), out = [];
  const vtx = (i) => [P[3 * i] + N[3 * i] * lift, P[3 * i + 1] + N[3 * i + 1] * lift, P[3 * i + 2] + N[3 * i + 2] * lift];
  for (let f = 0; f < I.length; f += 3) {
    const a = I[f], b = I[f + 1], c = I[f + 2];
    const g = [(P[3 * a] + P[3 * b] + P[3 * c]) / 3, (P[3 * a + 1] + P[3 * b + 1] + P[3 * c + 1]) / 3, (P[3 * a + 2] + P[3 * b + 2] + P[3 * c + 2]) / 3];
    if (len3(sub3(g, centre)) > radius) continue;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? u * 1e7 + v : v * 1e7 + u; if (seen.has(key)) continue; seen.add(key);
      out.push(...vtx(u), ...vtx(v));
    }
  }
  return out;
}

function camOrbit(t) { const v = camTrack(t); return { pos: add3([v[3], v[4], v[5]], dirAE(v[0], v[1]), v[2]), tgt: [v[3], v[4], v[5]], fov: v[6], up: [0, 0, 1] }; }

function camAt(t) {
  if (q.get('cam')) { const [az, el, d, f, dz = 0] = q.get('cam').split(',').map(Number); const tg = add3(C, [0, 0, 1], dz); return { pos: add3(tg, dirAE(az, el), d), tgt: tg, fov: f, up: [0, 0, 1] }; }
  const o = camOrbit(Math.min(t, T.zoom0));
  if (t <= T.zoom0) return camOrbit(t);
  // dive: target slides to the facet, direction turns to the facet view, distance falls exponentially
  const u = ease(t, T.zoom0, T.zoom1, (x) => x * x * x * (x * (x * 6 - 15) + 10));
  const d0 = len3(sub3(o.pos, o.tgt)), d1 = F.camDist * (1 - 0.06 * ease(t, T.zoom1, T.end, smooth));
  const dir0 = norm3(sub3(o.pos, o.tgt));
  const ud = ease(t, T.zoom0 + 1.5, T.zoom1);
  const dir = norm3(mix3(dir0, F.camDir, ud));
  const tgt = mix3(o.tgt, F.aim, ease(t, T.zoom0, T.zoom1 - 1.5, smooth));
  const dist = d0 * Math.pow(d1 / d0, u);
  const up = norm3(mix3([0, 0, 1], F.camUp, ease(t, T.zoom0 + 3, T.zoom1)));
  return { pos: add3(tgt, dir, dist), tgt, fov: o.fov, up };
}

export default {
  async init(ctx) {
    const { renderer } = ctx;
    await loadTex(['n', 'k']);
    bust = await loadBust(q.get('bust') || 'bust_st');
    const [lo, hi] = bust.meta.bbox;
    C = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    shadow = new Shadow(renderer, +(q.get('sh') || 4096));
    scene = new THREE.Scene();
    cam = new THREE.PerspectiveCamera(30, ctx.W / ctx.H, 0.002, 3000);

    const mb = bodyMaterial(shadow, {}, true), mc = bodyMaterial(shadow), ms = bodyMaterial(shadow);
    mats = [mb, mc, ms];
    for (const m of mats) { m.uniforms.uPow.value = 2.2; m.uniforms.uAmb.value.set(0.022, 0.024, 0.028); }
    const body = new THREE.Mesh(bust.tri, mb), cap = new THREE.Mesh(bust.cap, mc);
    // a turned stone socle; its top is the bust's own cut surface, so the two touch everywhere and nowhere cross
    const [z0, cA, cx] = bust.meta.cut || [0, 0, 0];
    ms.uniforms.uTint.value.set(0.94, 0.9, 0.84); ms.uniforms.uAlbedo.value = 0.74; ms.uniforms.uGrainAmp.value = 0.09;
    ms.uniforms.uCut.value.set(z0, cA, cx, 0); ms.uniforms.uAO.value.set(0.005, 0, 0, 0.6);
    const socle = new THREE.Mesh(bust.socle || new THREE.BufferGeometry(), ms);
    meshes = [body, cap, socle];
    scene.add(body, cap, socle);
    for (const i of (q.get('hide') || '').split(',').filter(Boolean)) meshes[+i].visible = false;

    // the bulb: a hot core and a soft halo (bloom does the rest)
    bulb = new THREE.Mesh(new THREE.SphereGeometry(0.011, 32, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const hm = new THREE.ShaderMaterial({ uniforms: { uCol: { value: new THREE.Vector3(1, 0.8, 0.6) }, uA: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform vec3 uCol; uniform float uA; void main(){ float r = length(vUv - 0.5) * 2.0; float g = exp(-r * r * 9.0) * 0.6 + exp(-r * 3.5) * 0.25; gl_FragColor = vec4(uCol * g * uA * (1.0 - smoothstep(0.85, 1.0, r)), 0.0); }`,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    halo = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), hm);
    scene.add(bulb, halo);

    fronts = new Fronts(shadow, 48, 72); fronts.u.uShell.value = 0.05;
    scene.add(fronts.mesh);

    // the facet, its view, and the wireframe patch around it
    F = pickFacet(bust.body);
    const side = norm3(sub3(L_DIR, mul3(F.n, dot3(L_DIR, F.n))));   // toward the source, in the facet plane
    const w = norm3(cross3(F.n, side));                               // normal to the plane of n and k
    F.camDir = norm3(add3(mul3(F.n, 0.72), mul3(w, dot3(w, sub3(add3(C, dirAE(12, 4), 1), C)) > 0 ? 0.7 : -0.7)));
    F.camUp = norm3(sub3(F.n, mul3(F.camDir, dot3(F.n, F.camDir))));
    F.camDist = F.size * 5.6 * TELE;
    F.aim = add3(F.g, F.n, F.size * 0.6);                          // centre the triangle and its arrows, not the triangle alone
    for (const m of mats) { m.uniforms.uTa.value.set(...F.A); m.uniforms.uTb.value.set(...F.B); m.uniforms.uTc.value.set(...F.C); }
    mb.uniforms.uWirePx.value = 1.6 * ctx.H / 1080;

    const zc0 = C[2];
    camTrack = track([
      [0, -33, -3, 1.75 * TELE, C[0] + 0.14, C[1] + 0.07, zc0 + 0.08, FOV],
      [6.5, -35, -2.5, 1.6 * TELE, C[0] + 0.12, C[1] + 0.06, zc0 + 0.07, FOV],
      [12.5, -37, -1.5, 1.45 * TELE, C[0] + 0.05, C[1] + 0.02, zc0 + 0.03, FOV],
      [17, -22, 2, 1.1 * TELE, C[0], C[1], zc0 + 0.0, FOV],
      [T.zoom0, 10, 4, 1.0 * TELE, C[0], C[1], zc0 + 0.0, FOV],
    ]);
  },

  grade(tl, t) { return { bloom: 0.5, threshold: 0.95, vignette: 0.25, grain: 0.006, fade: t < T.on - 0.02 ? 0 : 1 }; },

  draw(tl, t, target, ctx) {
    const { renderer } = ctx;
    const d = lampDist(t);
    const P = add3(C, [0, 0, AIM_DZ], 1);                   // the lamp aims at the head, so near and far light agree there
    const L = add3(P, L_DIR, d);
    const on = ease(t, T.on, T.on + 0.45, smooth) * (0.9 + 0.1 * ease(t, T.on + 0.2, T.on + 1.6));
    const cool = ease(t, T.recede0 + 1.5, T.recede1, smooth);
    const lc = mix3(WARM, COOL, cool);
    shadow.u.uShSoft.value = lerp(1.6, 1.0, cool);
    shadow.update(L, P, 0.45, meshes);

    const sFront = -D_NEAR + SPEED * (t - T.emit);      // the lead front, along k from the centre
    const flat = ease(t, T.flat, T.flat + 2), iso = ease(t, T.facet, T.facet + 2);
    for (const m of mats) {
      const u = m.uniforms;
      u.uC.value.set(...P); u.uK.value.set(...K); u.uLightCol.value.set(...lc); u.uE.value = on * 1.25;
      u.uFront.value = sFront; u.uFlat.value = flat; u.uIso.value = iso;
    }
    mats[0].uniforms.uJetMix.value = 1; mats[1].uniforms.uJetMix.value = 1;
    mats[2].uniforms.uJetMix.value = 0;                  // the socle stays plaster, and dims
    mats[2].uniforms.uFade.value = lerp(1, 0.4, ease(t, T.sweep + 1, T.sweep + 5));

    // bulb
    const lampVis = on * (1 - ease(t, T.recede0 + 3.5, T.recede1));
    bulb.position.set(...L); bulb.material.color.setRGB(lc[0] * 6 * lampVis, lc[1] * 6 * lampVis, lc[2] * 6 * lampVis);
    bulb.visible = halo.visible = lampVis > 0.002;
    halo.position.set(...L); halo.material.uniforms.uA.value = lampVis * 1.4; halo.material.uniforms.uCol.value.set(...lc);

    // fronts: the lead front left the bulb at T.emit and moves along k at SPEED relative to the
    // statue (sLead along k from C); front n trails it by n LAMBDA_V. Each is a sphere around the lamp.
    const sLead = sFront, list = [], wfar = ease(d, 1.6, 2.6);
    const zoomOut = 1 - ease(t, T.zoom0 + 2, T.zoom0 + 6);
    for (let n = 0; n < 48; n++) {
      const sn = sLead - n * LAMBDA_V, R = sn + d;
      if (R < 0.02) break;
      if (sn > 0.6) continue;
      let a = ease(R, 0.02, 0.16, smooth) * (1 - ease(sn, 0.05, 0.4, smooth));
      a *= lerp(1, ease(sn, -1.45, -1.1, smooth), wfar);
      if (n === 0) a *= 1.8;
      list.push({ R, a: a * zoomOut });
    }
    const fg = 0.4 * (1 - 0.97 * ease(t, T.sweep + 0.8, T.sweep + 4.5));
    fronts.set(L, K, list, { half: 0.42, gain: fg, col: mix3([1.0, 0.9, 0.8], [0.8, 0.9, 1.1], cool), edge: 0.35 });

    mats[0].uniforms.uWire.value = 0.9 * ease(t, T.wire, T.wire + 2);

    // camera
    const cv = camAt(t);
    cam.position.set(...cv.pos); cam.up.set(...cv.up); cam.fov = cv.fov; cam.aspect = ctx.W / ctx.H;
    const dist = len3(sub3(cv.pos, cv.tgt));
    cam.near = Math.max(0.0004, dist * 0.05); cam.far = 3000;
    cam.lookAt(...cv.tgt); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    halo.quaternion.copy(cam.quaternion);
    fronts.u.uEye.value.copy(cam.position);

    renderer.setRenderTarget(target); renderer.setClearColor(BG, 1); renderer.clear();
    renderer.render(scene, cam);
    return {};
  },

  labels(tl, t) {
    const items = [];
    const a = ease(t, T.zoom1 - 0.5, T.zoom1 + 1.0);
    if (a > 0 && F) {
      const ln = F.size * 1.55;
      items.push({ kind: 'arrow', head: 'latex', from: F.g, to: add3(F.g, F.n, ln), tex: 'n', along: 0.9, gap: 72, side: Q.nSide, size: 118, lw: 12, a, p: ease(t, T.zoom1 - 0.5, T.zoom1 + 1.2) });
      const ak = ease(t, T.zoom1 + 0.6, T.zoom1 + 2.2);
      items.push({ kind: 'arrow', head: 'latex', from: add3(F.g, K, -ln * 1.25), to: add3(F.g, K, -F.size * 0.06), tex: 'k', along: 0.66, gap: 72, side: Q.kSide, size: 118, lw: 12, a: ak, p: ak });
    }
    return { cam, items };
  },
};
