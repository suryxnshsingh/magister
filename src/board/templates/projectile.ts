/**
 * The `projectile` template.
 *
 * This is the third board tier, and it replaces the pre-rendered Manim clips
 * the brief proposed. A clip has fixed numbers, a style of its own, cannot
 * freeze mid-stroke, and its innards are not addressable — so the teacher
 * could never point *into* it. A template takes the problem's real numbers,
 * draws in the same chalk as everything else, exposes named parts for deixis
 * and named steps the teacher drives, and costs nothing to generate.
 *
 * Every element is built up front and hidden. A step only reveals what it
 * owns, so steps stay idempotent and the whole figure remains seekable.
 *
 * Parts (addressable as `fig.<name>` by point/mark):
 *   ground trajectory u theta ux uy apex v_apex range ball
 * Steps:
 *   setup            the throw: ground, velocity arrow, angle, arc
 *   components       u resolved into horizontal and vertical
 *   apex_velocity    what survives at the top — the misconception beat
 *   launch           the ball flies the arc
 */
import rough from 'roughjs';

import { createDraw, createFadeIn, createMoveAlong } from '../animations/draw';
import type { Animation } from '../clock';
import { makeFigure, SCREENPLAY, type ProjectileParams } from './projectile-geometry';
import { registerFigure } from './registry';
import type { Pt } from '../units';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHALK = '#f2efe4';
const DIM = '#cfc9b6';
const YELLOW = '#f0d264';

export interface Template {
  /** Named, addressable pieces — what `point`/`mark` resolve `fig.x` against. */
  parts: Map<string, SVGGraphicsElement>;
  /** Named steps, each a factory so the caller supplies the scene time. */
  steps: Map<string, (at: number) => Animation[]>;
  stepNames: string[];
  partNames: string[];
}

/** An arrow as one path, so shaft and head draw as a single gesture. */
function arrowD(from: Pt, to: Pt, head = 15): string {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const wing = 0.42;
  const p1 = { x: to.x - head * Math.cos(a - wing), y: to.y - head * Math.sin(a - wing) };
  const p2 = { x: to.x - head * Math.cos(a + wing), y: to.y - head * Math.sin(a + wing) };
  return (
    `M${from.x},${from.y}L${to.x},${to.y}` +
    `M${p1.x},${p1.y}L${to.x},${to.y}L${p2.x},${p2.y}`
  );
}

export function createProjectile(
  id: string,
  layer: SVGGElement,
  params: ProjectileParams = SCREENPLAY,
  toPx: (p: Pt) => Pt = (p) => p,
): Template {
  const fig = makeFigure(params);
  const gen = rough.generator();
  const parts = new Map<string, SVGGraphicsElement>();

  const root = document.createElementNS(SVG_NS, 'g');
  root.setAttribute('data-template', id);
  root.setAttribute('fill', 'none');
  layer.appendChild(root);

  /** Create a named group of paths, hidden until a step draws them. */
  function add(name: string, ds: string[], stroke: string, width: number) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-part', `${id}.${name}`);
    const paths: SVGPathElement[] = [];
    for (const d of ds) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('stroke', stroke);
      p.setAttribute('stroke-width', String(width));
      p.setAttribute('stroke-linecap', 'round');
      p.style.opacity = '0';
      g.appendChild(p);
      paths.push(p);
    }
    root.appendChild(g);
    parts.set(name, g);
    return paths;
  }

  /** Roughen a path so it reads as chalk rather than plotter output. */
  const rough1 = (d: string, roughness = 1.1) =>
    gen.toPaths(gen.path(d, { roughness, strokeWidth: 3, bowing: 1 })).map((p) => p.d);

  const P = (p: Pt) => toPx(p);
  const line = (a: Pt, b: Pt) => `M${P(a).x},${P(a).y}L${P(b).x},${P(b).y}`;

  // ---- geometry, in board-root user units -------------------------------
  const ground = add(
    'ground',
    rough1(line({ x: fig.ground.x1, y: fig.ground.y }, { x: fig.ground.x2, y: fig.ground.y }), 0.9),
    DIM,
    3,
  );

  const trajD = fig.path
    .map((pt, i) => {
      const q = P(pt);
      return `${i === 0 ? 'M' : 'L'}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
    })
    .join(' ');
  const trajectory = add('trajectory', rough1(trajD, 0.7), CHALK, 3.5);

  const u = add('u', rough1(arrowD(P(fig.launch), P(fig.uTip)), 0.8), CHALK, 4);

  // angle mark between the ground and u
  const r = 46;
  const th = fig.solved.thetaRad;
  const o = P(fig.launch);
  const theta = add(
    'theta',
    rough1(
      `M${o.x + r},${o.y}A${r},${r} 0 0 0 ${o.x + r * Math.cos(th)},${o.y - r * Math.sin(th)}`,
      0.8,
    ),
    DIM,
    2.5,
  );

  const ux = add('ux', rough1(arrowD(P(fig.launch), P(fig.uxTip)), 0.8), YELLOW, 3.5);
  const uy = add('uy', rough1(arrowD(P(fig.uxTip), P(fig.uyTip)), 0.8), YELLOW, 3.5);

  // apex marker
  const apexPt = P(fig.apex);
  const apexDot = document.createElementNS(SVG_NS, 'circle');
  apexDot.setAttribute('cx', String(apexPt.x));
  apexDot.setAttribute('cy', String(apexPt.y));
  apexDot.setAttribute('r', '6');
  apexDot.setAttribute('fill', CHALK);
  apexDot.style.opacity = '0';
  const apexG = document.createElementNS(SVG_NS, 'g');
  apexG.setAttribute('data-part', `${id}.apex`);
  apexG.appendChild(apexDot);
  root.appendChild(apexG);
  parts.set('apex', apexG);

  const vApex = add(
    'v_apex',
    rough1(arrowD(P(fig.apexVel.from), P(fig.apexVel.to)), 0.8),
    YELLOW,
    4,
  );

  const range = add(
    'range',
    rough1(
      line({ x: fig.rangeBar.x1, y: fig.rangeBar.y }, { x: fig.rangeBar.x2, y: fig.rangeBar.y }),
      0.9,
    ),
    DIM,
    2.5,
  );

  const ballG = document.createElementNS(SVG_NS, 'g');
  ballG.setAttribute('data-part', `${id}.ball`);
  const ball = document.createElementNS(SVG_NS, 'circle');
  ball.setAttribute('r', '9');
  ball.setAttribute('fill', CHALK);
  ballG.appendChild(ball);
  ballG.style.opacity = '0';
  root.appendChild(ballG);
  parts.set('ball', ballG);

  // ---- steps -------------------------------------------------------------
  const steps = new Map<string, (at: number) => Animation[]>();

  steps.set('setup', (at) => [
    createDraw(`${id}.ground`, ground, at, 520),
    createDraw(`${id}.u`, u, at + 420, 620),
    createDraw(`${id}.theta`, theta, at + 900, 320),
    // The arc is the throw itself — the longest single gesture on the board.
    createDraw(`${id}.trajectory`, trajectory, at + 1150, 1500),
  ]);

  steps.set('components', (at) => [
    createDraw(`${id}.ux`, ux, at, 520),
    createDraw(`${id}.uy`, uy, at + 420, 520),
  ]);

  steps.set('apex_velocity', (at) => [
    createFadeIn(`${id}.apex`, [apexDot], at, 260),
    createDraw(`${id}.v_apex`, vApex, at + 200, 480),
  ]);

  steps.set('launch', (at) => [
    createDraw(`${id}.range`, range, at, 620),
    createMoveAlong(`${id}.ball`, ballG, fig.path.map(P), at + 400, 1700),
  ]);

  return {
    parts,
    steps,
    stepNames: [...steps.keys()],
    partNames: [...parts.keys()],
  };
}

registerFigure('projectile', {
  description:
    'a thrown ball: ground, launch velocity at an angle, trajectory; steps add the ' +
    'velocity components, the velocity at the apex, and the flight itself.',
  params: 'u=20, theta=30, g=10',
  parts: ['ground', 'trajectory', 'u', 'theta', 'ux', 'uy', 'apex', 'v_apex', 'range', 'ball'],
  steps: ['setup', 'components', 'apex_velocity', 'launch'],
  build: (id, layer, params, toPx) =>
    createProjectile(
      id,
      layer,
      {
        u: Number(params.u) || SCREENPLAY.u,
        thetaDeg: Number(params.theta ?? params.thetaDeg) || SCREENPLAY.thetaDeg,
        g: Number(params.g) || SCREENPLAY.g,
      },
      toPx,
    ),
});
