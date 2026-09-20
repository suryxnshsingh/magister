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
import { arcD, arrowD, CHALK, dashedD, DIM, SVG_NS, YELLOW } from './templates/primitives';
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
  | 'link';

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
];

export interface ShapeSpec {
  shape: Shape;
  /** Already resolved to pixel space by the caller. */
  from: Pt;
  to?: Pt | null;
  to2?: Pt | null;
  text?: string;
  colour?: 'chalk' | 'dim' | 'accent';
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

function colourOf(c: ShapeSpec['colour']) {
  return c === 'dim' ? DIM : c === 'accent' ? YELLOW : CHALK;
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
  const stroke = colourOf(spec.colour ?? (spec.shape === 'link' ? 'dim' : undefined));
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

  switch (spec.shape) {
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
      t.textContent = spec.text ?? '';
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
          t.textContent = spec.text;
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
