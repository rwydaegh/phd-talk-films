const q = new URLSearchParams(location.search);
export const TIMELINE = q.has('wprobe') ? [{ id: 'W', module: './shots/wprobe.js', start: 0, end: 1 }]
  : q.has('probe') ? [{ id: 'P', module: './shots/probe.js', start: 0, end: 1 }]
  : [{ id: 'NYC', module: './shots/nyc.js', start: 0, end: 47.5 }];
export const DURATION = TIMELINE[TIMELINE.length - 1].end;
