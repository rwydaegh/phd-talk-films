// A2: the four antenna sets on the pole. A slow tilt down the pole.
import { photoShot } from './photo_shot.js';
import { ease } from '../lib/cam.js';

const SETS = [[668, 72], [668, 762], [668, 1292], [668, 1922]];   // pixel of each set's Butler board (pole26.png)
export default photoShot({
  name: 'pole26', dur: 6, fadeIn: 0.6,
  from: { u0: 790, v0: 380, zoom: 1.3 },
  to: { u0: 780, v0: 1450, zoom: 1.3 },
  labels: (tl, photo) => SETS.map(([u, v], i) => {
    const tIn = [0.4, 2.0, 3.6, 4.9][i];
    return { kind: 'label', at: photo.point(u, v, [0.81, 0.87, 0.86, 0.92][i]), off: [300, -40], text: 'Antenna', size: 54, p: ease(tl, tIn, tIn + 1.0), a: 1 };
  }),
});
