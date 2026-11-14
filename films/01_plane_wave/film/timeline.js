// Global shot table (seconds). Each module exports { init(ctx), draw(tl, t, target, ctx), grade?(tl, t, ctx) }.
// orig: the shot's start in the v2 cut. warp: [new local, v2 local] knots, piecewise linear, so a shot is retimed
// without touching its module: it still sees its own v2 clock (tl) and the v2 global time (orig + tl).
export const TIMELINE = [
  { id: 'C1', module: './shots/c1_stars.js', start: 0, end: 22, orig: 0 },
  { id: 'C2', module: './shots/c2_wave.js', start: 22, end: 40, orig: 22 },
  // the sheets land on the child and the exposure holds for 2.5 s before the cut
  { id: 'C3', module: './shots/c3_light.js', start: 40, end: 52.5, orig: 40 },
  // one antenna, two, eight run 1.36 times slower, the phase dials and the steering 1.6 times; the pull-back keeps its pace
  { id: 'C4', module: './shots/c4_beam.js', start: 52.5, end: 90.5, orig: 50, warp: [[0, 0], [12, 8.8], [24.5, 16.5], [38, 30]] },
  // the tilt up to the child runs 2.25 times faster, the three punches 1.25 times, the last push as before
  { id: 'C5A', module: './shots/c5_zoom.js', start: 90.5, end: 96.1, orig: 80, warp: [[0, 0], [1.2, 2.7], [4.9, 7.3], [5.6, 8]] },
  // the pull-out from the skin and the section opening run 1.5 times faster; the physics keeps its pace
  { id: 'C5B', module: './shots/c5_section.js', start: 96.1, end: 120.9, orig: 88, warp: [[0, 0], [4.4, 6.6], [24.8, 27]] },
];
export const DURATION = TIMELINE[TIMELINE.length - 1].end;
// The v2 local time a shot sees at local time x of this cut.
export function shotClock(s, x) {
  const k = s.warp;
  if (!k) return x;
  let i = 0;
  while (i < k.length - 2 && x > k[i + 1][0]) i++;
  const [a0, b0] = k[i], [a1, b1] = k[i + 1];
  return x > a1 ? b1 + (x - a1) : b0 + (b1 - b0) * (x - a0) / (a1 - a0);
}
