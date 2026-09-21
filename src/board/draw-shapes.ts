/**
 * Freehand primitives — the teacher drawing something nobody prepared.
 *
 * Prepared figures cover the diagrams worth getting exactly right, and they
 * will always be better where they exist: they know their own physics, their
 * parts are named, and their reveal steps are choreographed. But there are
 * more physics diagrams than anyone can pre-build, and a teacher who can only
 * draw two of them is an equation writer with a picture book.
 *
 * So this is the escape hatch, and it is deliberately shaped like chalk rather
 * than like a drawing API:
 *
 *  - **One primitive per call.** A complex sketch is several calls across
 *    several seconds of speech, which is how a hand actually builds a diagram —
 *    and (per docs/research-board-connection.md) stepwise construction is the
 *    part that teaches. It also keeps tool arguments short, and long arguments
 *    are what cost audible silence.
 *  - **Everything drawn becomes an anchor.** The first primitive usually needs
 *    a position; everything after it hangs off something already on the board.
 *    The model names things instead of computing coordinates.
 *  - **Chalk by default.** Roughened on the same generator as the figures, so
 *    a sketch and a template cannot be told apart.
 */
import { splitAll } from './chalk/subpaths';
import { arcD, arrowD, dashedD, inkOf, SVG_NS, type Ink } from './templates/primitives';
import {
  chargeD,
  componentD,
  curveArrowD,
  curveD,
  dimensionD,
  fieldD,
  groundD,
  springD,
  triangleD,
  turnD,
  waveD,
  type Component,
} from './shape-paths';
import type { Pt } from './units';
import rough from 'roughjs';

export type Shape =
  | 'arrow'
  | 'line'
  | 'dashed'
  | 'circle'
  | 'box'
  | 'dot'
  | 'label'
  | 'angle'
  | 'link'
  | 'curve'
  | 'curvearrow'
  | 'turn'
  | 'wave'
  | 'spring'
  | 'field'
  | 'dimension'
  | 'ground'
  | 'triangle'
  | 'shade'
  | 'charge'
  | Component;

export const SHAPES: Shape[] = [
  'arrow',
  'line',
  'dashed',
  'circle',
  'box',
  'dot',
  'label',
  'angle',
  'link',
  'curve',
  'curvearrow',
  'turn',
  'wave',
  'spring',
  'field',
  'dimension',
  'ground',
  'triangle',
  'shade',
  'charge',
  'resistor',
  'cell',
  'capacitor',
  'bulb',
  'switch',
  'inductor',
  'meter',
];

export interface ShapeSpec {
  shape: Shape;
  /** Already resolved to pixel space by the caller. */
  from: Pt;
  to?: Pt | null;
  to2?: Pt | null;
  text?: string;
  colour?: Ink;
  /** A count, where a shape has one: coils, cycles, field arrows. Negative turns clockwise. */
  n?: number;
}

export interface BuiltShape {
  group: SVGGElement;
  /** Stroked paths, drawn by the pen. */
  paths: SVGPathElement[];
  /** Text or dots, which fade rather than draw. */
  fades: SVGElement[];
}

const gen = rough.generator();

function roughen(d: string, roughness = 0.9): string[] {
  // One element per subpath: rough.js answers with a single path holding both
  // of its passes (eight, for a rectangle), and a dash offset restarts at each
  // one — so undivided they all grow at once instead of being drawn in order.
  return splitAll(
    gen.toPaths(gen.path(d, { roughness, strokeWidth: 3, bowing: 1 })).map((p) => p.d),
  );
}


/** Greek letters by the names the model writes them in, as they should read on a board. */
const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', eta: 'η', theta: 'θ',
  lambda: 'λ', mu: 'μ', nu: 'ν', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ',
  omega: 'ω', Delta: 'Δ', Theta: 'Θ', Phi: 'Φ', Sigma: 'Σ', Omega: 'Ω', Lambda: 'Λ',
};

/**
 * Set a label's text the way it would be written on a board, not typed.
 *
 * Labels are plain SVG text, so "S_1" went up with its underscore and an
 * angle named "theta" as the word. Greek names become their letters and `_x`
 * / `_{xy}` / `^x` become real sub- and superscripts. A backslash — the model
 * reaching for LaTeX — is dropped rather than shown.
 */
export function setLabel(t: SVGTextElement, text: string) {
  const plain = text
    .replace(/\\/g, '')
    .replace(/\b([A-Za-z]+)\b/g, (w) => GREEK[w] ?? w);
  t.textContent = '';
  const parts = plain.split(/([_^](?:\{[^}]*\}|\S))/);
  let shifted = 0;
  for (const part of parts) {
    if (!part) continue;
    const span = document.createElementNS(SVG_NS, 'tspan');
    const script = /^[_^]/.test(part);
    // Back to the baseline before anything that is not itself a script.
    const dy = script ? (part[0] === '_' ? 0.3 : -0.45) - shifted : -shifted;
    if (dy) span.setAttribute('dy', `${dy}em`);
    shifted = script ? shifted + dy : 0;
    if (script) span.setAttribute('font-size', '70%');
    span.textContent = script ? part.slice(1).replace(/^\{|\}$/g, '') : part;
    t.appendChild(span);
  }
}

/**
 * Build one primitive, hidden, ready for an animation to reveal it.
 *
 * A shape whose second point is missing degrades rather than throwing — a
 * `line` with no `to` becomes a dot at `from`. The teacher is mid-sentence;
 * nothing here is allowed to be an exception.
 */
export function buildShape(id: string, spec: ShapeSpec): BuiltShape {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('data-draw', id);
  g.setAttribute('fill', 'none');

  // A link is construction, not content: it says two things already on the
  // board are the same thing, so it defaults to the dimmer chalk.
  const stroke = inkOf(spec.colour ?? (spec.shape === 'link' ? 'dim' : undefined));
  const paths: SVGPathElement[] = [];
  const fades: SVGElement[] = [];

  const path = (d: string, width = 3.5, dash = false) => {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('stroke', stroke);
    p.setAttribute('stroke-width', String(width));
    p.setAttribute('stroke-linecap', 'round');
    p.style.opacity = '0';
    g.appendChild(p);
    (dash ? paths : paths).push(p);
    return p;
  };

  const a = spec.from;
  const b = spec.to ?? null;
  const c = spec.to2 ?? null;

  /** Words on a shape — fade in, like every label. */
  const words = (at: Pt, text: string, size = 30, italic = true) => {
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', String(at.x));
    t.setAttribute('y', String(at.y));
    t.setAttribute('fill', stroke);
    t.setAttribute('font-size', String(size));
    if (italic) t.setAttribute('font-style', 'italic');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    setLabel(t, text);
    t.style.opacity = '0';
    g.appendChild(t);
    fades.push(t);
  };
  /** Strokes, lightly roughened — a symbol has to stay the symbol it is. */
  const chalk = (ds: string[], roughness: number, width = 3) => {
    for (const d of ds) for (const piece of roughen(d, roughness)) path(piece, width);
  };

  switch (spec.shape) {
    case 'curve':
      if (b) chalk([curveD(a, b, c)], 0.6);
      break;

    case 'curvearrow':
      if (b) chalk([curveArrowD(a, b, c)], 0.5, 3.5);
      break;

    case 'turn':
      chalk([turnD(a, b ?? { x: a.x + 60, y: a.y }, (spec.n ?? 1) < 0)], 0.5, 3.5);
      if (spec.text) words({ x: a.x, y: a.y }, spec.text);
      break;

    case 'wave':
      if (b) chalk([waveD(a, b, spec.n)], 0.3);
      break;

    case 'spring':
      if (b) chalk([springD(a, b, spec.n)], 0.3);
      break;

    case 'field':
      if (b) chalk(fieldD(a, b, spec.n), 0.5, 3);
      break;

    case 'dimension':
      if (b) {
        const dim = dimensionD(a, b);
        chalk(dim.d, 0.3, 2.5);
        if (spec.text) words(dim.label, spec.text);
      }
      break;

    case 'ground':
      if (b) chalk(groundD(a, b), 0.5, 3);
      break;

    case 'triangle':
      if (b && c) chalk([triangleD(a, b, c)], 0.7, 3.5);
      break;

    case 'shade': {
      // A hatched region — the area under a graph, a solid's cross-section.
      // Hachure strokes only, no outline: the region's edges are usually
      // already on the board, and a shaded area is lighter than a line.
      const pts = c && b ? [a, b, c] : b ? [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }] : null;
      if (pts) {
        const sets = gen.toPaths(
          gen.polygon(pts.map((p) => [p.x, p.y] as [number, number]), {
            fill: stroke,
            fillStyle: 'hachure',
            hachureGap: 14,
            hachureAngle: -41,
            fillWeight: 2,
            stroke: 'none',
            roughness: 0.8,
          }),
        );
        for (const d of splitAll(sets.map((p) => p.d))) path(d, 2).setAttribute('stroke-opacity', '0.6');
      }
      break;
    }

    case 'charge':
      chalk(chargeD(a, /^[-−–]/.test(spec.text ?? '') ? '-' : '+'), 0.3, 3);
      break;

    case 'resistor':
    case 'cell':
    case 'capacitor':
    case 'bulb':
    case 'switch':
    case 'inductor':
    case 'meter':
      if (b) {
        const part = componentD(spec.shape, a, b);
        chalk(part.d, 0.35, 3);
        if (spec.shape === 'meter') words(part.centre, spec.text || 'A', 26, false);
        else if (spec.text) words(part.label, spec.text, 26);
      }
      break;

    case 'arrow':
      if (b) for (const d of roughen(arrowD(a, b), 0.6)) path(d, 4);
      break;

    case 'line':
      if (b) for (const d of roughen(`M${a.x},${a.y}L${b.x},${b.y}`, 0.7)) path(d, 3.5);
      break;

    case 'dashed':
      // Real segments: stroke-dasharray is overwritten by the draw animation.
      if (b) for (const d of dashedD(a, b)) path(d, 2.5);
      break;

    case 'circle': {
      // `to` sits on the rim, so the model sizes a circle by naming something
      // it should reach rather than by guessing a radius.
      const r = b ? Math.hypot(b.x - a.x, b.y - a.y) : 60;
      for (const d of roughen(
        `M${a.x - r},${a.y}a${r},${r} 0 1 0 ${r * 2},0a${r},${r} 0 1 0 ${-r * 2},0`,
        0.8,
      )) {
        path(d, 3);
      }
      break;
    }

    case 'box': {
      const c = b ?? { x: a.x + 120, y: a.y + 90 };
      const x0 = Math.min(a.x, c.x);
      const y0 = Math.min(a.y, c.y);
      const w = Math.abs(c.x - a.x);
      const h = Math.abs(c.y - a.y);
      for (const d of roughen(
        `M${x0},${y0}L${x0 + w},${y0}L${x0 + w},${y0 + h}L${x0},${y0 + h}Z`,
        0.8,
      )) {
        path(d, 3);
      }
      break;
    }

    case 'dot': {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', String(a.x));
      dot.setAttribute('cy', String(a.y));
      dot.setAttribute('r', '7');
      dot.setAttribute('fill', stroke);
      dot.style.opacity = '0';
      g.appendChild(dot);
      fades.push(dot);
      break;
    }

    case 'label': {
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', String(a.x));
      t.setAttribute('y', String(a.y));
      t.setAttribute('fill', stroke);
      t.setAttribute('font-size', '32');
      t.setAttribute('font-style', 'italic');
      t.setAttribute('text-anchor', 'middle');
      setLabel(t, spec.text ?? '');
      t.style.opacity = '0';
      g.appendChild(t);
      fades.push(t);
      break;
    }

    case 'link': {
      // A connector between two representations of the same physics — the
      // symbol in the equation and the thing it denotes in the diagram.
      //
      // Worth its own primitive rather than being a `line`, for three reasons.
      // It bows, so it reads as a gesture joining two things rather than as
      // part of either. It is dim by default, because it is about the other
      // two marks and must not compete with them. And it is trimmed to the
      // edges of what it joins by the caller, so it never crosses the ink at
      // either end.
      //
      // Teaching a term and its picture as one thing is the best-evidenced
      // move in the board research: multi-representation learning carries a
      // real (if modest) effect, and observation of expert boards has the
      // teacher literally drawing lines between the diagram and the equation
      // when a pupil cannot connect them. It is also the one gesture a
      // single-pen board can make that a two-handed teacher makes by holding
      // one hand on each — it indexes both at once, and it stays.
      if (b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        // Bowed perpendicular to the chord, away from the shorter axis so a
        // link across the board arcs over the gap rather than through it.
        const bow = Math.min(90, len * 0.16);
        const cx = (a.x + b.x) / 2 - (dy / len) * bow;
        const cy = (a.y + b.y) / 2 + (dx / len) * bow;
        for (const d of roughen(`M${a.x},${a.y}Q${cx},${cy} ${b.x},${b.y}`, 0.8)) {
          path(d, 2.2);
        }
      }
      break;
    }

    case 'angle': {
      // An arc at the vertex between two arms. Physics marks angles constantly
      // and doing it by hand with two lines never looks right.
      const arm = (p: Pt | null | undefined) =>
        p ? (Math.atan2(a.y - p.y, p.x - a.x) * 180) / Math.PI : null;
      const a1 = arm(b);
      const a2 = arm(spec.to2) ?? 0;
      if (a1 !== null) {
        const lo = Math.min(a1, a2);
        const hi = Math.max(a1, a2);
        for (const d of roughen(arcD(a, 58, lo, hi), 0.6)) path(d, 2.5);
        if (spec.text) {
          const mid = ((lo + hi) / 2) * (Math.PI / 180);
          const t = document.createElementNS(SVG_NS, 'text');
          t.setAttribute('x', String(a.x + 88 * Math.cos(mid)));
          t.setAttribute('y', String(a.y - 88 * Math.sin(mid)));
          t.setAttribute('fill', stroke);
          t.setAttribute('font-size', '30');
          t.setAttribute('font-style', 'italic');
          t.setAttribute('text-anchor', 'middle');
          setLabel(t, spec.text);
          t.style.opacity = '0';
          g.appendChild(t);
          fades.push(t);
        }
      }
      break;
    }
  }

  return { group: g, paths, fades };
}
