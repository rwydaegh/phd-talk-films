// Shared story geometry: the hero star and its comet, the film clock (speed ramp), camera helpers.
import { CARD, sForFov, lerp, smoother, smooth, clamp, add3, sub3, norm3, len3, mix3, cross3 } from './cam.js';
export const HERO = 11;
export const ANT11 = [2.0117, 1.2947, 1.2919];
export const TARGET = CARD.target;
export const U = CARD.fwd.map((x) => -x);      // from target towards the card camera
// Card camera at distance d from the target along the card axis.
export const axisPos = (d) => add3(TARGET, U, d);
// Card-clock rate: real time, then bullet time from LAUNCH+RAMP_IN.
export const LAUNCH = 15.2, RAMP0 = 16.0, RAMP1 = 19.5, SLOW = 0.02;
export function cardClock(t) {
  // integral of rate(t): 1 until RAMP0, smooth to SLOW at RAMP1, SLOW after
  if (t <= RAMP0) return t;
  const T = RAMP1 - RAMP0;
  if (t <= RAMP1) { const u = (t - RAMP0) / T; return RAMP0 + T * (u - (1 - SLOW) * (u * u * u - u * u * u * u / 2)); }
  return RAMP0 + T * (1 - (1 - SLOW) * 0.5) + (t - RAMP1) * SLOW;
}
export const rate = (t) => (t <= RAMP0 ? 1 : t >= RAMP1 ? SLOW : 1 - (1 - SLOW) * (3 * ((t - RAMP0) / (RAMP1 - RAMP0)) ** 2 - 2 * ((t - RAMP0) / (RAMP1 - RAMP0)) ** 3));
// Hero comet: launched at LAUNCH from the hero star towards the focus it had then; distance covered follows the film clock.
export const V0 = 0.30;  // m per card-second (the card bead speed is 0.27)
export function cometAt(t, focus) {
  if (t < LAUNCH) return null;
  const dir = norm3(sub3(focus, ANT11)), L = len3(sub3(focus, ANT11));
  const s = Math.min(L, V0 * (cardClock(t) - cardClock(LAUNCH)));
  return { head: add3(ANT11, dir, s), dir, s, L };
}
