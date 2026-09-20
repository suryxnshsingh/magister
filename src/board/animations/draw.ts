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
