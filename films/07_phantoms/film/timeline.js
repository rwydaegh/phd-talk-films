// Global shot table (seconds). One continuous shot.
import { T } from './shots/p_film.js';
export const TIMELINE = [{ id: 'P', module: './shots/p_film.js', start: 0, end: T.end }];
export const DURATION = T.end;
