/**
 * A graph: axes, a plotted curve, and the two things teachers do with one —
 * shade the area under it and draw a tangent on it.
 *
 * This is the figure physics reaches for in every chapter. A v-t graph whose
 * area is displacement and whose slope is acceleration; an I-V characteristic;
 * a P-V cycle; decay curves. Drawing axes by hand with `write` and `mark` is
 * possible and always looks wrong, because axes are the one thing a teacher
 * draws quickly and accurately.
 *
 * The reveal steps carry the teaching: `area` and `slope` exist because "area
 * under the curve" and "slope of the curve" are the sentences a teacher says,
 * and each should put the thing on the board as they say it.
 */
import rough from 'roughjs';

import { createDraw, createFadeIn } from '../animations/draw';
import type { Animation } from '../clock';
import { FIGURE, type Pt } from '../units';
import type { Template } from './projectile';
import { registerFigure } from './registry';
import { evaluate } from '@/teacher/calc';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHALK = '#f2efe4';
const DIM = '#cfc9b6';
const YELLOW = '#f0d264';

interface GraphParams {
  fn: string;
  from: number;
  to: number;
  xlabel: string;
  ylabel: string;
  /** Where a tangent is drawn, if the slope step is used. */
  at: number;
}

function read(p: Record<string, string>): GraphParams {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  return {
    fn: p.fn || p.y || 'x',
    from: num(p.from, 0),
    to: num(p.to, 5),
    xlabel: p.xlabel || p.x || 'x',
    ylabel: p.ylabel || 'y',
    at: num(p.at, NaN),
  };
}

/** Evaluate the curve, reusing the degree-mode calculator the teacher uses. */
function sample(fn: string, from: number, to: number, n = 64) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const x = from + ((to - from) * i) / n;
    // The model writes "2*t" or "x^2"; accept either variable name.
    const expr = fn.replace(/\b[xt]\b/g, `(${x})`);
    const r = evaluate(expr);
    pts.push({ x, y: r.ok && r.value !== undefined ? r.value : 0 });
  }
  return pts;
}

export function createGraph(
  id: string,
  layer: SVGGElement,
  raw: Record<string, string>,
  toPx: (p: Pt) => Pt,
): Template {
  const p = read(raw);
  const data = sample(p.fn, p.from, p.to);

  const yMin = Math.min(0, ...data.map((d) => d.y));
  const yMax = Math.max(...data.map((d) => d.y), yMin + 1e-6);

  // Board-unit box for the plot, inside the figure column.
  const left = FIGURE.left + 0.7;
  const right = FIGURE.right - 0.4;
  const bottom = FIGURE.bottom + 1.6;
  const top = FIGURE.top - 1.1;

  const sx = (x: number) => left + ((x - p.from) / (p.to - p.from || 1)) * (right - left);
  const sy = (y: number) => bottom + ((y - yMin) / (yMax - yMin || 1)) * (top - bottom);
  const P = (x: number, y: number) => toPx({ x: sx(x), y: sy(y) });

  const gen = rough.generator();
  const parts = new Map<string, SVGGraphicsElement>();
  const root = document.createElementNS(SVG_NS, 'g');
  root.setAttribute('data-template', id);
  root.setAttribute('fill', 'none');
  layer.appendChild(root);

  function add(name: string, ds: string[], stroke: string, width: number, fill = false) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-part', `${id}.${name}`);
    const paths: SVGPathElement[] = [];
    for (const d of ds) {
      const el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('d', d);
      el.setAttribute('stroke', stroke);
      el.setAttribute('stroke-width', String(width));
      el.setAttribute('stroke-linecap', 'round');
      if (fill) el.setAttribute('fill', stroke);
      el.style.opacity = '0';
      g.appendChild(el);
      paths.push(el);
    }
    root.appendChild(g);
    parts.set(name, g);
    return paths;
  }

  const roughen = (d: string, r = 0.9) =>
    gen.toPaths(gen.path(d, { roughness: r, strokeWidth: 3, bowing: 1 })).map((q) => q.d);

  const o = P(p.from, yMin);
  const xEnd = P(p.to, yMin);
  const yEnd = P(p.from, yMax);

  const axes = add(
    'axes',
    roughen(
      `M${o.x},${o.y}L${xEnd.x},${xEnd.y}M${o.x},${o.y}L${yEnd.x},${yEnd.y}`,
      0.7,
    ),
    DIM,
    2.5,
  );

  const curveD = data
    .map((d, i) => {
      const q = P(d.x, d.y);
      return `${i === 0 ? 'M' : 'L'}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
    })
    .join(' ');
  const curve = add('curve', roughen(curveD, 0.6), CHALK, 3.5);

  // Area under the curve — hatched rather than solid, the way chalk shades.
  const HATCH = 22;
  const hatch: string[] = [];
  for (let px = o.x + HATCH; px < xEnd.x; px += HATCH) {
    const t = (px - o.x) / (xEnd.x - o.x || 1);
    const xv = p.from + t * (p.to - p.from);
    const expr = p.fn.replace(/\b[xt]\b/g, `(${xv})`);
    const r = evaluate(expr);
    const yv = r.ok && r.value !== undefined ? r.value : 0;
    const topPt = P(xv, yv);
    hatch.push(`M${px.toFixed(1)},${o.y.toFixed(1)}L${px.toFixed(1)},${topPt.y.toFixed(1)}`);
  }
  const area = add('area', hatch, YELLOW, 1.6);

  // Tangent at `at`, for "slope of this line is…".
  const tangentAt = Number.isFinite(p.at) ? p.at : (p.from + p.to) / 2;
  const h = (p.to - p.from) / 64;
  const fAt = (x: number) => {
    const r = evaluate(p.fn.replace(/\b[xt]\b/g, `(${x})`));
    return r.ok && r.value !== undefined ? r.value : 0;
  };
  const slope = (fAt(tangentAt + h) - fAt(tangentAt - h)) / (2 * h);
  const span = (p.to - p.from) * 0.22;
  const t0 = P(tangentAt - span, fAt(tangentAt) - slope * span);
  const t1 = P(tangentAt + span, fAt(tangentAt) + slope * span);
  const tangent = add(
    'tangent',
    roughen(`M${t0.x},${t0.y}L${t1.x},${t1.y}`, 0.6),
    YELLOW,
    3,
  );

  // Labels sit clear of the curve but INSIDE the figure column. An axis label
  // hung to the left of the y-axis (the textbook position) reaches back into
  // the derivation column and collides with the equations — verified at
  // /figure-test. Both labels therefore sit inside the plot's own footprint:
  // the y-label above its axis, the x-label under the right end of its own.
  // Each label is its own group. Pointing them at one shared <g> would make
  // point("g.xlabel") and point("g.ylabel") tap the same centroid — deixis
  // silently indicating the wrong axis, which is worse than not offering it.
  const label = (name: string, text: string, at: Pt, anchor: string) => {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-part', `${id}.${name}`);
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', String(at.x));
    t.setAttribute('y', String(at.y));
    t.setAttribute('fill', DIM);
    t.setAttribute('font-size', '30');
    t.setAttribute('font-style', 'italic');
    t.setAttribute('text-anchor', anchor);
    t.textContent = text;
    t.style.opacity = '0';
    g.appendChild(t);
    root.appendChild(g);
    parts.set(name, g);
    return t;
  };
  const xLab = label('xlabel', p.xlabel, { x: xEnd.x, y: xEnd.y + 42 }, 'end');
  const yLab = label('ylabel', p.ylabel, { x: yEnd.x + 14, y: yEnd.y - 16 }, 'start');

  const steps = new Map<string, (at: number) => Animation[]>();
  steps.set('setup', (at) => [
    createDraw(`${id}.axes`, axes, at, 520),
    // Named for the parts they reveal — see the note in ray.ts.
    createFadeIn(`${id}.xlabel`, [xLab], at + 320, 300),
    createFadeIn(`${id}.ylabel`, [yLab], at + 320, 300),
    createDraw(`${id}.curve`, curve, at + 520, 1100),
  ]);
  steps.set('area', (at) => [createDraw(`${id}.area`, area, at, 900)]);
  steps.set('slope', (at) => [createDraw(`${id}.tangent`, tangent, at, 520)]);

  return {
    root,
    parts,
    steps,
    stepNames: [...steps.keys()],
    partNames: [...parts.keys()],
  };
}

registerFigure('graph', {
  description:
    'axes with a plotted curve; steps shade the area under it or draw a tangent on it. ' +
    'Use for v-t and s-t graphs, I-V curves, P-V diagrams, decay curves.',
  params: 'fn=2*t, from=0, to=5, xlabel=time (s), ylabel=velocity (m/s), at=3',
  parts: ['axes', 'curve', 'area', 'tangent', 'xlabel', 'ylabel'],
  steps: ['setup', 'area', 'slope'],
  stepNotes: {
    area: 'shades the area under the curve',
    slope: 'draws the tangent at x = at',
  },
  build: createGraph,
});
