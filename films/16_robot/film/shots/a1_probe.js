// A1: the anechoic room. The probe on its scanner comes alive.
import { photoShot } from './photo_shot.js';
import { ease } from '../lib/cam.js';

export default photoShot({
  name: 'probe26', dur: 6,
  from: { u0: 1230, v0: 860, zoom: 1.0 },
  to: { u0: 1050, v0: 760, zoom: 1.18 },
  labels: (tl, photo) => [
    { kind: 'label', at: photo.point(528, 612, 0.715), off: [-130, -190], text: 'Probe', size: 54, p: ease(tl, 1.6, 2.8), a: 1 },
  ],
});
