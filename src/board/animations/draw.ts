/**
 * Shape animations: Create, FadeIn, MoveAlongPath.
 *
 * Manim's verbs, over plain SVG paths. `Create` traces a path with a dash
 * offset — for a shape that IS the pen's centreline (unlike a glyph outline),
 * so a freeze mid-stroke here genuinely looks like a hand stopping, and no
 * settling is needed.
 *
 * Elements are passed in already built and hidden; an animation only ever
 * changes how much of them is showing. That keeps every step of a template
 * idempotent and seekable, which is what the scene clock requires.
 */
import { bboxIn, type BBox } from '../annotate/marks';
import { clamp01, easeOutCubic, type Animation, type Segment } from '../clock';
import type { Pt } from '../units';

export interface DrawAnimation extends Animation {
  penAt(t: number): Pt | null;
}

/** Trace `els` in order, as one continuous gesture. */
export function createDraw(
  id: string,
  els: SVGPathElement[],
  start: number,
  duration = 900,
): DrawAnimation {
  let lens: number[] = [];
  let ready = false;

  function init() {
    lens = els.map((e) => Math.max(1, e.getTotalLength()));
    els.forEach((e, i) => {
      e.style.strokeDasharray = String(lens[i]);
      e.style.strokeDashoffset = String(lens[i]);
      e.style.opacity = '1';
    });
    ready = true;
  }

  /** Which element is drawing at u, weighted by length so speed is even. */
  function cursor(u: number) {
    if (!lens.length) return null;
    const total = lens.reduce((a, b) => a + b, 0);
    let acc = 0;
    for (let i = 0; i < els.length; i++) {
      const share = lens[i] / total;
      if (u <= acc + share || i === els.length - 1) {
        return { i, local: clamp01((u - acc) / (share || 1)) };
      }
      acc += share;
    }
    return null;
  }

  function apply(t: number) {
    if (!ready) return;
    const u = clamp01(t / duration);
    const cur = cursor(u);
    els.forEach((e, i) => {
      const done = !cur ? 0 : i < cur.i ? 1 : i === cur.i ? cur.local : 0;
      e.style.strokeDashoffset = String(lens[i] * (1 - done));
    });
  }

  function penAt(t: number): Pt | null {
    if (!ready) return null;
    const cur = cursor(clamp01(t / duration));
    if (!cur) return null;
    const p = els[cur.i].getPointAtLength(lens[cur.i] * cur.local);
    return { x: p.x, y: p.y };
  }

  const segments: Segment[] = [{ at: start, from: 0, len: duration }];
  return { id, segments, duration, init, apply, penAt };
}

/** Bring elements in without a stroke — labels, dots, anything not drawn. */
export function createFadeIn(
  id: string,
  els: SVGElement[],
  start: number,
  duration = 380,
): Animation {
  function init() {
    for (const e of els) e.style.opacity = '0';
  }
  function apply(t: number) {
    const u = easeOutCubic(clamp01(t / duration));
    for (const e of els) e.style.opacity = String(u);
  }
  const segments: Segment[] = [{ at: start, from: 0, len: duration }];
  return { id, segments, duration, init, apply };
}

/**
 * Wipe elements off the board, left to right, the way a duster crosses it.
 *
 * Opacity, never removal. The scene is a pure function of time, so scrubbing
 * back past an erase has to put the ink back — which it cannot do if the nodes
 * are gone. What an erase really destroys is the board's *memory*: the
 * registries the teacher's ids resolve against. The chalk just fades.
 *
 * The sweep is staggered by x so it reads as one gesture across the board
 * rather than everything blinking out together, which looks like a fault.
 */
export function createWipe(
  id: string,
  els: SVGGraphicsElement[],
  root: SVGSVGElement,
  start: number,
  duration = 760,
): DrawAnimation {
  /** How much of the sweep any one element spends fading. */
  const SMEAR = 0.3;
  let lanes: { el: SVGGraphicsElement; from: number }[] = [];
  let band: { x0: number; x1: number; y: number } | null = null;
  let ready = false;

  function init() {
    const seen = els
      .map((el) => ({ el, b: bboxIn(el, root) }))
      .filter((e): e is { el: SVGGraphicsElement; b: BBox } => e.b !== null);
    if (seen.length) {
      const x0 = Math.min(...seen.map((e) => e.b.x));
      const x1 = Math.max(...seen.map((e) => e.b.x + e.b.w));
      const y0 = Math.min(...seen.map((e) => e.b.y));
      const y1 = Math.max(...seen.map((e) => e.b.y + e.b.h));
      band = { x0, x1, y: (y0 + y1) / 2 };
      const span = Math.max(1, x1 - x0);
      lanes = seen.map(({ el, b }) => ({
        el,
        from: ((b.x + b.w / 2 - x0) / span) * (1 - SMEAR),
      }));
    }
    ready = true;
  }

  function apply(t: number) {
    if (!ready) return;
    const u = clamp01(t / duration);
    for (const l of lanes) {
      l.el.style.opacity = String(1 - clamp01((u - l.from) / SMEAR));
    }
  }

  /** The duster's position, so the hand crosses the board with it. */
  function penAt(t: number): Pt | null {
    if (!ready || !band) return null;
    const u = clamp01(t / duration);
    return { x: band.x0 + (band.x1 - band.x0) * u, y: band.y };
  }

  const segments: Segment[] = [{ at: start, from: 0, len: duration }];
  return { id, segments, duration, init, apply, penAt };
}

/**
 * Move an element along a path. The ball's flight: `path` is sampled in time,
 * not arc length, so it slows near the apex exactly as a real throw does.
 */
export function createMoveAlong(
  id: string,
  el: SVGElement,
  points: Pt[],
  start: number,
  duration = 1800,
): Animation {
  function init() {
    el.style.opacity = '0';
  }
  function apply(t: number) {
    const u = clamp01(t / duration);
    if (points.length === 0) return;
    el.style.opacity = u > 0 && u < 1 ? '1' : u >= 1 ? '1' : '0';
    const i = Math.min(points.length - 1, Math.floor(u * (points.length - 1)));
    const p = points[i];
    el.setAttribute('transform', `translate(${p.x}, ${p.y})`);
  }
  const segments: Segment[] = [{ at: start, from: 0, len: duration }];
  return { id, segments, duration, init, apply };
}
