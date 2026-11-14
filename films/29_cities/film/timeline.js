// Global shot table (seconds). Each module exports { init(ctx), draw(tl, t, target, ctx), grade?(tl, t, ctx), labels?(tl, t, ctx), dispose?() }.
// The cleanest squares first at an easy pace, then the montage speeds up; Mexico City last and fastest.
const CUTS = [
  ['london_trafalgar', 2.6], ['milan_duomo', 2.3], ['madrid_plazamayor', 2.0], ['tokyo_hachiko', 1.5], ['toulouse_capitole', 1.1],
  ['krakow_rynek', 0.85], ['brussels_grandplace', 0.65], ['korenmarkt', 0.5], ['mexico_zocalo', 0.45],
];
export const TIMELINE = [
  { id: 'H', module: './shots/hero.js', start: 0, end: 20 },
  { id: 'C0', module: './shots/city.js?c=prague_staromestske&d=4', start: 20, end: 24 },
];
let t = 24;
CUTS.forEach(([c, d], i) => { TIMELINE.push({ id: 'C' + (i + 1), module: `./shots/city.js?c=${c}&d=${d}`, start: t, end: t + d }); t += d; });
TIMELINE.push({ id: 'G', module: './shots/grid.js', start: t, end: t + 8 });
export const DURATION = TIMELINE[TIMELINE.length - 1].end;
