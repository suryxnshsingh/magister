/**
 * The screenplay as an op log — M0's fixture, no model involved.
 *
 * This is the derivation column of `docs/screenplay.md`, beats 2 through 10.
 * The figure (`scene`/`step` ops) arrives with the projectile template; the
 * ops here are the ones that carry the kill criterion: writing during speech,
 * a freeze mid-line, a refer-back to a term written a minute earlier, and the
 * resume that finishes the line.
 *
 * Times are the screenplay's beat times minus its opening, compressed a little
 * so the whole slice can be watched in one go. In the real fixture they come
 * from TTS word timestamps against `anchor`; keeping `anchor` here means the
 * log stays self-describing when that happens.
 *
 * Every placement carries both the symbolic intent a model would emit and the
 * hand-tuned point actually used — see oplog.ts for why.
 */
import type { Op } from '../oplog';

/** Hand-tuned positions, matching the verified layout in /board-fit. */
const X = -4.98;
const Y = { given: 3.55, ux: 2.65, uy: 1.75, T: 0.83, range: -0.65, formula: -1.48 };

export const SCREENPLAY_OPS: Op[] = [
  // BEAT 1 — "aaj isko banate hain". The figure appears as he says it, which
  // is the first proof the board is listening rather than illustrating.
  { kind: 'scene', t: 0, id: 'fig', name: 'projectile', params: 'u=20, theta=30', anchor: 'banate' },

  // BEAT 2 — the throw
  {
    kind: 'write',
    t: 600,
    id: 'given',
    anchor: 'bees',
    content: String.raw`$u = 20\ \text{m/s},\ \theta = 30^\circ$`,
    place: { intent: 'title', resolved: { x: X, y: Y.given } },
  },

  // BEAT 3 — two balls, not one. The figure splits as the words do.
  { kind: 'step', t: 3000, id: 'fig', step: 'components', anchor: 'alag-alag' },
  {
    kind: 'write',
    t: 3600,
    id: 'ux',
    anchor: 'cos',
    content: String.raw`$u_x = u\cos\theta = 17.3\ \text{m/s}$`,
    place: { intent: 'under:given', resolved: { x: X, y: Y.ux } },
  },
  {
    kind: 'write',
    t: 7200,
    id: 'uy',
    anchor: 'sin',
    content: String.raw`$u_y = u\sin\theta = 10\ \text{m/s}$`,
    place: { intent: 'under:ux', resolved: { x: X, y: Y.uy } },
  },

  // BEAT 4 — the hold. The pen taps and stays; silence is the op.
  { kind: 'point', t: 10800, target: 'ux', anchor: 'Ye horizontal' },

  // BEAT 5 — student answers, teacher underlines
  {
    kind: 'mark',
    t: 12600,
    id: 'ux-underline',
    target: 'ux',
    style: 'underline',
    anchor: 'Bilkul',
  },

  // BEAT 6 — time of flight
  {
    kind: 'write',
    t: 14600,
    id: 'T',
    anchor: 'Total do',
    content: String.raw`$T = \frac{2u_y}{g} = 2\ \text{s}$`,
    place: { intent: 'under:uy', resolved: { x: X, y: Y.T } },
  },

  // BEAT 7 — the barge-in. Written as ONE op including the answer, so beat 9
  // can finish the same line rather than morphing a second object onto it.
  // The student cuts in at 34%, around "R = u_x \times".
  {
    kind: 'write',
    t: 18600,
    id: 'range',
    anchor: 'toh range bas',
    content: String.raw`$R = u_x \times T = 34.6\ \text{m}$`,
    place: { intent: 'under:T', resolved: { x: X, y: Y.range } },
    interruptedAt: 0.34,
  },

  // BEAT 8 — the correction. Point at the apex, show what actually survives
  // there, then cross the board back to the term written 18s earlier.
  { kind: 'point', t: 19900, target: 'fig.apex', anchor: 'Bahut accha' },
  { kind: 'step', t: 21000, id: 'fig', step: 'apex_velocity', anchor: 'Horizontal toh' },
  {
    kind: 'mark',
    t: 23000,
    id: 'ux-circle',
    target: String.raw`ux:u\cos\theta`,
    style: 'circle',
    color: '#f0d264',
    anchor: 'Yahan dekho',
  },

  // BEAT 9 — "toh hum yahan the": back to the frozen line, finish it.
  { kind: 'resume', t: 25400, id: 'range', anchor: 'toh hum yahan the' },
  {
    kind: 'mark',
    t: 29200,
    id: 'range-box',
    target: 'range',
    style: 'box',
    anchor: 'chauntis point chhe',
  },

  // BEAT 10 — the memorised formula turns out to be the same thing
  {
    kind: 'write',
    t: 30800,
    id: 'formula',
    anchor: 'Aur ab dekho',
    content: String.raw`$R = \frac{u^2\sin 2\theta}{g}$`,
    place: { intent: 'under:range', resolved: { x: X, y: Y.formula } },
  },
  {
    kind: 'mark',
    t: 34600,
    id: 'formula-circle',
    target: String.raw`formula:\sin 2\theta`,
    style: 'circle',
    color: '#f0d264',
    anchor: 'sin two theta',
  },

  // BEAT 10 end — "wahi formula": the ball finally flies the arc it was
  // always going to, and lands on the range the derivation predicted.
  { kind: 'step', t: 35600, id: 'fig', step: 'launch', anchor: 'Wahi formula' },
];
