// Shot tables (seconds) for the two factory films. Each module exports { init(ctx), draw(tl, t, target, ctx), grade?, labels? }.
const FILMS = {
  10: [{ id: 'F10', module: './shots/f10.js', start: 0, end: 83 }],
  27: [{ id: 'F27', module: './shots/f27.js', start: 0, end: 36.5 }],
  pose: [{ id: 'POSE', module: './shots/pose.js', start: 0, end: 1 }],
};
export function timeline(film) {
  const TIMELINE = FILMS[film];
  return { TIMELINE, DURATION: TIMELINE[TIMELINE.length - 1].end };
}
