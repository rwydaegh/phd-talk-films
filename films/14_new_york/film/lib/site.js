// Site constants (local ENU metres, from tools/place.py and Blender BVH probes of the tiles).
export const GROUND = -27.45;                 // pavement south of the Perelman cube (top surface of the tiles)
export const LAM = 0.299792458 / 28;          // 28 GHz: 10.7 mm
export const SPEED = 1.4;                     // walking speed (chapter 4)
// the filmed stretch of the thesis route: west along the south side of the Perelman cube
export const WALK = { A: [103.990, 114.083], B: [73.07, 111.89] };   // walk.json: where she is at t = 8 s, and at the stop
// whole thesis route for the overview (start at the cube, south through the memorial plaza to Liberty Street)
export const ROUTE = [[96, 116], [88, 114.6], [55, 111.2], [40, 104], [34, 70], [30, 48], [-6, 44], [-42, 40], [-52, 10], [-56, -30], [-62, -58], [-84, -74]];
// Cell-free access points on facades (>= 3 m up, normals facing the route, >= 14 m apart, LOS to the walk):
// pos, outward normal. The base station sits on the cube's roof edge.
export const APS = [
  { id: 'cube_w', pos: [50.5, 128.0, -20.5], n: [-0.24, -0.97, 0] },
  { id: 'cube_m', pos: [64.0, 124.5, -19.0], n: [-0.24, -0.97, 0] },
  { id: 'cube_hi', pos: [77.94, 120.73, -13.93], n: [-0.2325, -0.9726, 0] },
  { id: 'cube_e', pos: [88.5, 118.4, -20.0], n: [-0.25, -0.97, 0] },
  { id: 'east', pos: [137.47, 104.08, -20.10], n: [-0.9143, 0.4049, 0] },
];
export const BS = { id: 'roof', pos: [67.6, 124.3, 16.1], n: [-0.2325, -0.9726, -0.18] };
// the cube's south face (for facade reflections): a point, the normal, extent along the face and height
export const PAC_FACE = { p: [77.94, 120.73], n: [-0.2325, -0.9726], t: [0.9726, -0.2325], s0: -12.5, s1: 24, z0: GROUND, z1: 14.1 };
