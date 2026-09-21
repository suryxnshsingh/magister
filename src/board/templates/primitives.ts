/**
 * The pieces every figure draws with.
 *
 * `projectile.ts` and `graph.ts` each grew their own private `add()` and
 * `roughen()` — near-identical, because every figure needs the same two things:
 * a named group of chalk paths that starts hidden, and a way to make a clean
 * path look drawn by hand. `ray.ts` was about to write them a third time, which
 * is the point at which duplication becomes a shared module.
 *
 * Deliberately NOT a general drawing layer. These are the primitives the
 * existing figures actually use, extracted from working code. Inventing
 * primitives for figures that do not exist yet is how a drawing DSL gets built
 * by accident.
 */
import rough from 'roughjs';

import { splitAll } from '../chalk/subpaths';
import type { Pt } from '../units';

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Chalk, its dimmer shade for construction lines, and the accent. */
export const CHALK = '#f2efe4';
export const DIM = '#cfc9b6';
export const YELLOW = '#f0d264';

/**
 * The box of coloured chalk.
 *
 * Soft, light tones — what coloured chalk actually looks like on a green
 * board, and legible there at stroke width and at label size (checked by
 * rendering each on the board's own gradient). Saturated screen colours read
 * as a UI, not a blackboard.
 *
 * The names are the vocabulary for everything that can be coloured: a `draw`
 * shape, a `mark`, a `note`, and inline in a written line as `blue(N)` — so
 * the N in the equation and the N arrow on the diagram are named alike.
 * `accent` is kept as yellow, which it always was.
 */
export const INKS = {
  chalk: CHALK,
  dim: DIM,
  yellow: YELLOW,
  accent: YELLOW,
  blue: '#8cc8ff',
  red: '#ff8a95',
  green: '#a6e89a',
  orange: '#ffb870',
  purple: '#c9a8ff',
} as const;

export type Ink = keyof typeof INKS;

export const INK_NAMES = Object.keys(INKS) as Ink[];

/** An ink's colour by name; anything unknown is plain chalk. */
export function inkOf(name: string | undefined): string {
  return name && name in INKS ? INKS[name as Ink] : CHALK;
}

/** A name the model sent, if it names an ink. */
export function asInk(name: string): Ink | undefined {
  const n = name.trim().toLowerCase();
  if (n === 'white') return 'chalk';
  if (n === 'pink') return 'red';
  if (n === 'violet') return 'purple';
  return n in INKS ? (n as Ink) : undefined;
}

/**
 * An arrow as ONE path, so shaft and head draw as a single gesture.
 *
 * Two strokes would draw the head after the shaft as a separate animation, and
 * the tip would arrive late. It also has to be strokes rather than a filled
 * polygon: the roughening below discards fills, so a filled head vanishes.
 */
export function arrowD(from: Pt, to: Pt, head = 15): string {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const wing = 0.42;
  const p1 = { x: to.x - head * Math.cos(a - wing), y: to.y - head * Math.sin(a - wing) };
  const p2 = { x: to.x - head * Math.cos(a + wing), y: to.y - head * Math.sin(a + wing) };
  return `M${from.x},${from.y}L${to.x},${to.y}M${p1.x},${p1.y}L${to.x},${to.y}L${p2.x},${p2.y}`;
}

/**
 * A dashed line, as one path PER DASH.
 *
 * It cannot be done with `stroke-dasharray`: `createDraw` sets that property
 * inline to animate the reveal, and an inline style beats an attribute, so any
 * dash pattern is silently overwritten and the line comes out solid. Real
 * segments animate correctly and are drawn in order.
 *
 * Left unroughened on purpose — a construction line reading cleaner than the
 * rays around it is exactly the convention it is there to signal.
 */
export function dashedD(from: Pt, to: Pt, dash = 15, gap = 12): string[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const n = Math.hypot(dx, dy) || 1;
  const out: string[] = [];
  for (let d = 0; d < n; d += dash + gap) {
    const e = Math.min(n, d + dash);
    out.push(
      `M${(from.x + (dx * d) / n).toFixed(1)},${(from.y + (dy * d) / n).toFixed(1)}` +
        `L${(from.x + (dx * e) / n).toFixed(1)},${(from.y + (dy * e) / n).toFixed(1)}`,
    );
  }
  return out;
}

/** A point on a circle, in the same flipped-y convention {@link arcD} uses. */
export function onArc(c: Pt, r: number, deg: number): Pt {
  const rad = (deg * Math.PI) / 180;
  return { x: c.x + r * Math.cos(rad), y: c.y - r * Math.sin(rad) };
}

/** A polyline through points, as a path. */
export function polylineD(pts: Pt[]): string {
  return pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
}

/**
 * An arc centred on `c`, from `a0` to `a1` in DEGREES, measured the way physics
 * measures angles — anticlockwise from east, in board orientation where y is
 * up. Used for every angle mark on the board.
 */
export function arcD(c: Pt, r: number, a0: number, a1: number): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const p = (d: number) => ({ x: c.x + r * Math.cos(rad(d)), y: c.y - r * Math.sin(rad(d)) });
  const s = p(a0);
  const e = p(a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  // Sweep 0 because screen y is flipped relative to the angle convention.
  const sweep = a1 > a0 ? 0 : 1;
  return `M${s.x.toFixed(1)},${s.y.toFixed(1)}A${r},${r} 0 ${large} ${sweep} ${e.x.toFixed(1)},${e.y.toFixed(1)}`;
}

/** Hatching along a line, the way chalk shades a surface or a solid body. */
export function hatchD(from: Pt, to: Pt, len: number, step = 18): string[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const n = Math.max(1, Math.hypot(dx, dy));
  // Perpendicular, pointing to the "solid" side.
  const px = -dy / n;
  const py = dx / n;
  const out: string[] = [];
  for (let d = step; d < n; d += step) {
    const x = from.x + (dx * d) / n;
    const y = from.y + (dy * d) / n;
    // Leaned over, as hand hatching always is.
    out.push(
      `M${x.toFixed(1)},${y.toFixed(1)}L${(x + px * len - dx / n * len * 0.5).toFixed(1)},${(y + py * len - dy / n * len * 0.5).toFixed(1)}`,
    );
  }
  return out;
}

/**
 * A figure under construction.
 *
 * Every element is built up front and hidden; a step only reveals what it owns.
 * That is what keeps steps idempotent and the whole figure seekable.
 */
export class FigureParts {
  readonly parts = new Map<string, SVGGraphicsElement>();
  readonly root: SVGGElement;
  private gen = rough.generator();

  constructor(
    private id: string,
    layer: SVGGElement,
  ) {
    this.root = document.createElementNS(SVG_NS, 'g');
    this.root.setAttribute('data-template', id);
    this.root.setAttribute('fill', 'none');
    layer.appendChild(this.root);
  }

  /** Roughen a clean path so it reads as chalk rather than plotter output. */
  rough(d: string, roughness = 0.9): string[] {
    // Split per subpath — see chalk/subpaths.ts. A figure's arcs and arrows
    // are drawn in order because of this, not despite it.
    return splitAll(
      this.gen
        .toPaths(this.gen.path(d, { roughness, strokeWidth: 3, bowing: 1 }))
        .map((p) => p.d),
    );
  }

  /**
   * Add a named, addressable group of paths, hidden until a step draws it.
   * Every part gets its OWN element — sharing one between two names makes
   * `point` tap the wrong thing, silently.
   */
  add(name: string, ds: string[], stroke: string, width: number) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-part', `${this.id}.${name}`);
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
    this.root.appendChild(g);
    this.parts.set(name, g);
    return paths;
  }

  /**
   * A small filled dot — a point of incidence, a pole, a focus.
   *
   * Faded in rather than stroked: a dot has no length to trace, and a circle
   * drawn by dash offset at this size reads as a flicker.
   */
  dot(name: string, at: Pt, r = 6, fill = CHALK) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-part', `${this.id}.${name}`);
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', String(at.x));
    c.setAttribute('cy', String(at.y));
    c.setAttribute('r', String(r));
    c.setAttribute('fill', fill);
    c.style.opacity = '0';
    g.appendChild(c);
    this.root.appendChild(g);
    this.parts.set(name, g);
    return c;
  }

  /**
   * A text label, faded in rather than stroked.
   *
   * MathJax emits `<use>` references into glyph defs, which are not
   * stroke-animatable without dereferencing them, so figure-internal labels
   * fade. Standalone equations still go through `write`.
   */
  label(name: string, text: string, at: Pt, anchor = 'middle', fill = DIM) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-part', `${this.id}.${name}`);
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', String(at.x));
    t.setAttribute('y', String(at.y));
    t.setAttribute('fill', fill);
    t.setAttribute('font-size', '30');
    t.setAttribute('font-style', 'italic');
    t.setAttribute('text-anchor', anchor);
    t.textContent = text;
    t.style.opacity = '0';
    g.appendChild(t);
    this.root.appendChild(g);
    this.parts.set(name, g);
    return t;
  }
}
