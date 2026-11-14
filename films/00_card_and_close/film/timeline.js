// Shot tables (seconds), chosen with ?film=card|f34|f01. Each module exports { init(ctx), draw(tl, t, target, ctx), grade?(tl, t, ctx) }.
// card: the pre-show loop (24 s, the card's own period). f34: the closing pull-back. f01: film 1's C1 (copied verbatim) for the frame-0 match test.
const FILMS = {
  card: [{ id: 'CARD', module: './shots/card_loop.js', start: 0, end: 24 }],
  f34: [{ id: 'F34', module: './shots/f34_pullback.js', start: 0, end: 34 }],
  f01: [{ id: 'C1', module: './shots/c1_stars.js', start: 0, end: 22 }],
};
const name = new URLSearchParams(location.search).get('film') || 'card';
export const TIMELINE = FILMS[name];
export const DURATION = TIMELINE[TIMELINE.length - 1].end;
