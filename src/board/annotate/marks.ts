/**
 * Annotation marks: underline, strike, circle, box.
 *
 * rough.js supplies the geometry and nothing else. Its generator is pure —
 * `generator.line(...)` returns a description, `toPaths()` turns it into path
 * data — so we render it ourselves and drive it from the scene clock.
 *
 * rough-notation solves the same problem, but it assigns
 * `style.animation = 'rough-notation-dash ...'` with delays baked in at render
 * time. A CSS animation cannot be frozen mid-stroke by our clock, seeked, or
 * replayed deterministically, which is the one thing this board must do. So
 * the ~250 lines of geometry are worth borrowing and the playback is not.
 *
 * Each mark draws in two passes, the way a real hand doubles back over a
 * circle, and the pen follows the pass that is currently being drawn.
 */
import rough from 'roughjs';

import { splitSubpaths } from '../chalk/subpaths';
import { clamp01, type Animation, type Segment } from '../clock';
import type { MarkStyle } from '../oplog';
import type { Pt } from '../units';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Axis-aligned box in board-root user units (px). */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MarkOptions {
  duration?: number;
  color?: string;
  strokeWidth?: number;
  /** Extra room around the target, px. */
  pad?: number;
}

export interface MarkAnimation extends Animation {
  penAt(t: number): Pt | null;
}

const DEFAULTS: Record<MarkStyle, { duration: number; pad: number }> = {
  underline: { duration: 420, pad: 8 },
  strike: { duration: 380, pad: 4 },
  cancel: { duration: 300, pad: 6 },
  circle: { duration: 720, pad: 26 },
  box: { duration: 640, pad: 18 },
};

function buildPaths(style: MarkStyle, b: BBox, pad: number, strokeWidth: number) {
  const gen = rough.generator();
  const o = { roughness: 1.5, strokeWidth, bowing: 1.1 };
  // rough.js returns ONE element per shape however many strokes it describes,
  // and a dash offset restarts at every subpath — so without this the two
  // passes grow at once and the promise in the header above cannot hold.
  const cut = (out: ReturnType<typeof gen.toPaths>) =>
    out.flatMap((p) => splitSubpaths(p.d).map((d) => ({ ...p, d })));

  switch (style) {
    case 'underline':
      return cut(
        gen.toPaths(
          gen.line(b.x - pad * 0.4, b.y + b.h + pad, b.x + b.w + pad * 0.4, b.y + b.h + pad, o),
        ),
      );
    case 'strike':
      // Through the glyphs. Below them would read as an underline, which means
      // the opposite thing.
      return cut(
        gen.toPaths(gen.line(b.x - pad, b.y + b.h * 0.55, b.x + b.w + pad, b.y + b.h * 0.5, o)),
      );
    case 'cancel':
      // The other diagonal, so a term cancelled top-left to bottom-right is
      // visibly a different act from a line struck through it. Physics cancels
      // constantly — the m on both sides, the t that divides out — and it is
      // said out loud ("m cancel ho gaya") at the moment the hand draws it.
      return cut(
        gen.toPaths(
          gen.line(b.x - pad, b.y + b.h + pad, b.x + b.w + pad, b.y - pad, {
            ...o,
            roughness: 1.2,
          }),
        ),
      );
    case 'circle':
      return cut(
        gen.toPaths(
          gen.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w + pad * 2, b.h + pad * 2, {
            ...o,
            roughness: 1.7,
          }),
        ),
      );
    case 'box':
      return cut(
        gen.toPaths(gen.rectangle(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, o)),
      );
  }
}

/**
 * `box()` is read at init, not at construction, so a mark can be scheduled
 * before the thing it marks has been typeset and measured.
 *
 * `host` is made and placed by the caller rather than here, because init runs
 * at prime time — which on the replay path is after the whole log has been
 * compiled. A mark that created its own group would not exist in the DOM while
 * the log was still being read, so an erase earlier in that log could not know
 * to wipe it, and a cleared board would replay with its annotations still on.
 */
export function createMark(
  id: string,
  style: MarkStyle,
  box: () => BBox | null,
  host: SVGGElement,
  start: number,
  opts: MarkOptions = {},
): MarkAnimation {
  const base = DEFAULTS[style];
  const {
    duration = base.duration,
    color = '#f2efe4',
    strokeWidth = 3.5,
    pad = base.pad,
  } = opts;

  const els: SVGPathElement[] = [];
  let lens: number[] = [];
  let ready = false;

  function init() {
    const b = box();
    if (!b) return;
    for (const p of buildPaths(style, b, pad, strokeWidth)) {
      const el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('d', p.d);
      el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', String(p.strokeWidth || strokeWidth));
      el.setAttribute('stroke-linecap', 'round');
      host.appendChild(el);
      els.push(el);
    }
    lens = els.map((e) => e.getTotalLength());
    els.forEach((e, i) => {
      e.style.strokeDasharray = String(lens[i]);
      e.style.strokeDashoffset = String(lens[i]);
    });
    ready = true;
  }

  /** Which pass is drawing at u, and how far through it. */
  function passAt(u: number) {
    if (els.length === 0) return null;
    const each = 1 / els.length;
    const i = Math.min(els.length - 1, Math.floor(u / each));
    return { i, local: clamp01((u - i * each) / each) };
  }

  function apply(t: number) {
    if (!ready) return;
    const u = clamp01(t / duration);
    const cur = passAt(u);
    els.forEach((e, i) => {
      const done = cur && i < cur.i ? 1 : cur && i === cur.i ? cur.local : 0;
      e.style.strokeDashoffset = String(lens[i] * (1 - done));
    });
  }

  function penAt(t: number): Pt | null {
    if (!ready) return null;
    const cur = passAt(clamp01(t / duration));
    if (!cur) return null;
    const el = els[cur.i];
    const at = el.getPointAtLength(lens[cur.i] * cur.local);
    return { x: at.x, y: at.y };
  }

  const segments: Segment[] = [{ at: start, from: 0, len: duration }];
  return { id, segments, duration, init, apply, penAt };
}

/** Bounding box of an element in the board root's user space. */
export function bboxIn(el: SVGGraphicsElement, root: SVGSVGElement): BBox | null {
  const rootCTM = root.getScreenCTM();
  const elCTM = el.getScreenCTM();
  if (!rootCTM || !elCTM) return null;
  const m = rootCTM.inverse().multiply(elCTM);
  const b = el.getBBox();
  // Transform all four corners: the chain can include MathJax's scale(1,-1),
  // so taking just two corners can yield a negative height.
  const pts = [
    new DOMPoint(b.x, b.y),
    new DOMPoint(b.x + b.width, b.y),
    new DOMPoint(b.x, b.y + b.height),
    new DOMPoint(b.x + b.width, b.y + b.height),
  ].map((p) => p.matrixTransform(m));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** A point in an element's own space, expressed in the board root's. */
export function pointIn(el: SVGGraphicsElement, p: Pt, root: SVGSVGElement): Pt | null {
  const rootCTM = root.getScreenCTM();
  const elCTM = el.getScreenCTM();
  if (!rootCTM || !elCTM) return null;
  const q = new DOMPoint(p.x, p.y).matrixTransform(rootCTM.inverse().multiply(elCTM));
  return { x: q.x, y: q.y };
}

/** Union of several boxes — a `part` match can span a run of siblings. */
export function unionBox(boxes: (BBox | null)[]): BBox | null {
  const bs = boxes.filter((b): b is BBox => b !== null && b.w > 0);
  if (bs.length === 0) return null;
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  const r = Math.max(...bs.map((b) => b.x + b.w));
  const bot = Math.max(...bs.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: bot - y };
}
