// Global shot table (seconds). Each module exports { init(ctx), draw(tl, t, target, ctx), grade?(tl, t, ctx), labels? }.
export const TIMELINE = [
  { id: 'A1', module: './shots/a2_pole.js', start: 0, end: 6 },
  { id: 'A2', module: './shots/a1_probe.js', start: 6, end: 12 },
  { id: 'A3', module: './shots/a3_scan.js', start: 12, end: 25.5 },   // hard cut on the finished map; slide 19 compares it with the simulation
  { id: 'B', module: './shots/b_stair.js', start: 25.5, end: 49.1 },
];
export const DURATION = TIMELINE[TIMELINE.length - 1].end;
