// Antennas: 4x4 patch panels on facades (cell-free access points) and one base-station panel on a mast on the
// cube's roof. Panels are drawn larger than the real 28 GHz arrays (4 cm) so they read at street scale.
import * as THREE from 'three';

function panelMat(on) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.10, 0.11, 0.13), roughness: 0.45, metalness: 0.4 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLit = on;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uLit;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.05, 0.07, 0.10) * uLit;');
  };
  return m;
}

// One panel: a slab with 4x4 patches. size = edge length (m). Returns { group, patches (uniform), centre }.
export function makePanel({ pos, n, size = 0.55 }) {
  const group = new THREE.Group();
  const N = new THREE.Vector3(...n).normalize();
  const Z = new THREE.Vector3(0, 0, 1);
  let X = new THREE.Vector3().crossVectors(Z, N); if (X.lengthSq() < 1e-6) X.set(1, 0, 0); X.normalize();
  const Y = new THREE.Vector3().crossVectors(N, X).normalize();
  const basis = new THREE.Matrix4().makeBasis(X, Y, N);
  const lit = { value: 0 };
  const slab = new THREE.Mesh(new THREE.BoxGeometry(size, size, 0.07), panelMat(lit));
  slab.position.z = 0.035; group.add(slab);
  const pg = new THREE.PlaneGeometry(size * 0.13, size * 0.13);
  const patchU = { uOn: { value: 0 } };
  const pm = new THREE.ShaderMaterial({ uniforms: patchU, vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uOn; void main(){ gl_FragColor = vec4(mix(vec3(0.16, 0.13, 0.08), vec3(2.2, 1.7, 1.0), uOn), 1.0); }' });
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const p = new THREE.Mesh(pg, pm); p.position.set((i - 1.5) * size * 0.22, (j - 1.5) * size * 0.22, 0.072); group.add(p);
  }
  group.matrixAutoUpdate = false;
  group.matrix.copy(basis).setPosition(new THREE.Vector3(...pos).addScaledVector(N, 0.12));
  group.updateMatrixWorld(true);
  const centre = new THREE.Vector3(...pos).addScaledVector(N, 0.2);
  return { group, patchU, lit, centre: centre.toArray(), N };
}

export function makeMast(base, h) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, h, 12), new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.5, metalness: 0.5 }));
  m.rotation.x = Math.PI / 2; m.position.set(base[0], base[1], base[2] + h / 2);
  return m;
}
