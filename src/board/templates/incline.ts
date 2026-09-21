/**
 * A block on an inclined plane, and the forces on it.
 *
 * The most drawn diagram in mechanics, and the one a model draws worst
 * freehand: asked for it with `draw`, the live teacher put the weight arrow
 * pointing up and the forces at the foot of the slope. Here the physics sets
 * the geometry — the block sits on the slope, rotated with it; weight hangs
 * straight down; the normal leaves the surface at right angles, as long as
 * mg cos θ is; friction runs along the surface the way it opposes the slide —
 * and the teacher only chooses when each piece appears.
 *
 * Colours follow the board's colour rules: weight red, normal blue, friction
 * orange, construction dim, each label in its arrow's colour.
 */
import { createDraw, createFadeIn } from '../animations/draw';
import type { Animation } from '../clock';
import { FIGURE, type Pt } from '../units';
import type { Template } from './projectile';
import { arcD, arrowD, CHALK, dashedD, DIM, FigureParts, hatchD, INKS, onArc } from './primitives';
import { registerFigure } from './registry';

interface InclineParams {
  /** Angle of the slope, degrees. */
  theta: number;
  /** Which way friction acts: up the slope (block tends to slide down), down it, or none. */
  friction: 'up' | 'down' | 'none';
}

function read(p: Record<string, string>): InclineParams {
  const t = Number(p.theta ?? p.angle ?? p.i);
  const fr = (p.friction ?? 'up').toLowerCase();
  return {
    theta: Number.isFinite(t) && t > 0 ? Math.min(60, Math.max(10, t)) : 30,
    friction: /none|no|smooth|frictionless|0/.test(fr) ? 'none' : /down/.test(fr) ? 'down' : 'up',
  };
}

const RAD = Math.PI / 180;

export function createIncline(
  id: string,
  layer: SVGGElement,
  raw: Record<string, string>,
  toPx: (p: Pt) => Pt,
): Template {
  const p = read(raw);
  const f = new FigureParts(id, layer);
  const P = (q: Pt) => toPx(q);
  const c = Math.cos(p.theta * RAD);
  const s = Math.sin(p.theta * RAD);

  // ---- geometry, in board units (y up) ------------------------------------
  // The slope rises to the right from A to its top C, with the right angle at
  // B. Sized to the column, and shortened for a steep slope so it still fits.
  const width = FIGURE.right - FIGURE.left;
  const height = FIGURE.top - FIGURE.bottom;
  const base = Math.min(width * 0.78, (height * 0.62) / Math.tan(p.theta * RAD));
  const A = { x: FIGURE.left + (width - base) / 2, y: FIGURE.bottom + height * 0.2 };
  const B = { x: A.x + base, y: A.y };
  const C = { x: B.x, y: A.y + base * Math.tan(p.theta * RAD) };
  const slopeLen = base / c;

  // Along the slope, and out of it.
  const u = { x: c, y: s };
  const n = { x: -s, y: c };
  const at = (o: Pt, du: number, dn: number): Pt => ({ x: o.x + u.x * du + n.x * dn, y: o.y + u.y * du + n.y * dn });

  const side = Math.min(0.62, slopeLen * 0.2);
  const M = at(A, slopeLen * 0.52, 0); // middle of the block's base, on the slope
  const G = at(M, 0, side / 2); // the block's centre
  const F = Math.min(1.35, height * 0.3); // how long mg is drawn

  // ---- setup: ground, slope, angle, block --------------------------------
  const ground = f.add(
    'ground',
    [`M${P({ x: A.x - 0.3, y: A.y }).x},${P(A).y}L${P({ x: B.x + 0.3, y: B.y }).x},${P(B).y}`, ...hatchD(P({ x: A.x - 0.3, y: A.y }), P({ x: B.x + 0.3, y: B.y }), 18, 22)],
    DIM,
    2.5,
  );
  const slope = f.add('slope', f.rough(`M${P(A).x},${P(A).y}L${P(C).x},${P(C).y}L${P(B).x},${P(B).y}`, 0.6), CHALK, 3.5);
  const angle = f.add('angle', f.rough(arcD(P(A), 70, 0, p.theta), 0.5), DIM, 2.5);
  const labTheta = f.label('label_theta', 'θ', onArc(P(A), 100, p.theta / 2), 'middle', CHALK);
  const corners = [at(M, -side / 2, 0), at(M, side / 2, 0), at(M, side / 2, side), at(M, -side / 2, side)].map(P);
  const block = f.add(
    'block',
    f.rough(`M${corners.map((q) => `${q.x},${q.y}`).join('L')}Z`, 0.5),
    CHALK,
    3.5,
  );

  // ---- forces ------------------------------------------------------------
  const tip = (from: Pt, dir: Pt, len: number) => ({ x: from.x + dir.x * len, y: from.y + dir.y * len });
  const beyond = (from: Pt, dir: Pt, len: number) => P(tip(from, dir, len + 0.24));

  const mgEnd = tip(G, { x: 0, y: -1 }, F);
  const weight = f.add('weight', f.rough(arrowD(P(G), P(mgEnd)), 0.5), INKS.red, 4);
  const labMg = f.label('label_mg', 'mg', beyond(G, { x: 0, y: -1 }, F), 'middle', INKS.red);

  // The normal is mg cos θ long — the same force as the component it balances.
  const nEnd = tip(G, n, F * c);
  const normal = f.add('normal', f.rough(arrowD(P(G), P(nEnd)), 0.5), INKS.blue, 4);
  const labN = f.label('label_N', 'N', beyond(G, n, F * c), 'middle', INKS.blue);

  // Friction runs along the contact surface, from the middle of the base.
  const fDir = p.friction === 'down' ? { x: -u.x, y: -u.y } : u;
  const fEnd = tip(M, fDir, F * 0.55);
  const friction =
    p.friction === 'none' ? null : f.add('friction', f.rough(arrowD(P(M), P(fEnd)), 0.5), INKS.orange, 4);
  const labF =
    p.friction === 'none' ? null : f.label('label_f', 'f', beyond(M, fDir, F * 0.55), 'middle', INKS.orange);

  // Components of the weight, dashed: construction on top of the real force.
  const alongEnd = tip(G, { x: -u.x, y: -u.y }, F * s);
  const perpEnd = tip(G, { x: -n.x, y: -n.y }, F * c);

  // A dashed shaft, then only the head of an arrow ending where it does.
  const head = (dir: Pt, len: number, end: Pt) =>
    arrowD(P(tip(G, dir, len - 0.12)), P(end), 12).replace(/^M[^M]*/, '');
  const down = { x: -u.x, y: -u.y };
  const into = { x: -n.x, y: -n.y };
  const compAlong = f.add('comp_along', [...dashedD(P(G), P(alongEnd), 11, 9), head(down, F * s, alongEnd)], INKS.red, 2.5);
  const compPerp = f.add('comp_perp', [...dashedD(P(G), P(perpEnd), 11, 9), head(into, F * c, perpEnd)], INKS.red, 2.5);
  const labAlong = f.label('label_along', 'mg sin θ', beyond(G, down, F * s), 'end', INKS.red);
  const labPerp = f.label('label_perp', 'mg cos θ', beyond(G, into, F * c), 'start', INKS.red);
  // The angle between mg and its perpendicular component is θ again — the
  // step every student asks about.
  const angleG = f.add('angle_g', f.rough(arcD(P(G), 46, 270, 270 + p.theta), 0.4), DIM, 2);
  const labThetaG = f.label('label_theta_g', 'θ', onArc(P(G), 70, 270 + p.theta / 2), 'middle', DIM);

  // ---- steps -------------------------------------------------------------
  const steps = new Map<string, (at: number) => Animation[]>();
  steps.set('setup', (t) => [
    createDraw(`${id}.ground`, ground, t, 420),
    createDraw(`${id}.slope`, slope, t + 200, 620),
    createDraw(`${id}.angle`, angle, t + 760, 300),
    createFadeIn(`${id}.label_theta`, [labTheta], t + 900, 240),
    createDraw(`${id}.block`, block, t + 1000, 520),
  ]);
  steps.set('weight', (t) => [
    createDraw(`${id}.weight`, weight, t, 480),
    createFadeIn(`${id}.label_mg`, [labMg], t + 380, 220),
  ]);
  steps.set('normal', (t) => [
    createDraw(`${id}.normal`, normal, t, 480),
    createFadeIn(`${id}.label_N`, [labN], t + 380, 220),
  ]);
  steps.set('friction', (t) =>
    friction && labF
      ? [createDraw(`${id}.friction`, friction, t, 440), createFadeIn(`${id}.label_f`, [labF], t + 340, 220)]
      : [],
  );
  steps.set('components', (t) => [
    createDraw(`${id}.comp_perp`, compPerp, t, 420),
    createFadeIn(`${id}.label_perp`, [labPerp], t + 340, 220),
    createDraw(`${id}.comp_along`, compAlong, t + 520, 420),
    createFadeIn(`${id}.label_along`, [labAlong], t + 860, 220),
    createDraw(`${id}.angle_g`, angleG, t + 1100, 280),
    createFadeIn(`${id}.label_theta_g`, [labThetaG], t + 1300, 220),
  ]);

  return {
    root: f.root,
    parts: f.parts,
    steps,
    stepNames: [...steps.keys()],
    partNames: [...f.parts.keys()],
  };
}

registerFigure('incline', {
  description:
    'a block on an inclined plane at angle theta: the slope on hatched ground, the ' +
    'angle, the block; steps add the weight mg (straight down), the normal N (out ' +
    'of the surface), friction f (along it), and the components mg sin θ and mg cos θ ' +
    'with the θ between mg and mg cos θ marked. friction=up (the block tends to ' +
    'slide down), down, or none. Use for any block on a slope: forces, friction, ' +
    'acceleration down an incline, the angle of repose',
  params: 'theta=30, friction=up',
  parts: [
    'ground',
    'slope',
    'angle',
    'label_theta',
    'block',
    'weight',
    'label_mg',
    'normal',
    'label_N',
    // Only built when there is friction; declared so pointing at it on a
    // smooth slope fails with the list of what IS there.
    'friction',
    'label_f',
    'comp_along',
    'comp_perp',
    'label_along',
    'label_perp',
    'angle_g',
    'label_theta_g',
  ],
  steps: ['setup', 'weight', 'normal', 'friction', 'components'],
  stepNotes: {
    weight: 'mg, straight down from the centre',
    normal: 'N, out of the surface at right angles',
    friction: 'f, along the surface, opposing the slide',
    components: 'mg split into mg sin θ along the slope and mg cos θ into it',
  },
  build: createIncline,
});
