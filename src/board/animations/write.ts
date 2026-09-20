/**
 * Write — stroke-by-stroke equation writing.
 *
 * Manim's DrawBorderThenFill. MathJax glyphs are filled outlines, not
 * centerlines, so "writing" one means tracing its contour with a dash offset
 * and then ramping the fill in behind. The pen therefore runs up one side of a
 * stem and back down the other, which is what Manim does and which reads
 * correctly for maths. It does NOT read correctly for long prose — that is
 * what the single-line centerline font is for.
 *
 * Every glyph keeps its own element (see mathjax.ts: fontCache must be 'none'),
 * so each animates independently and a freeze can land inside any of them.
 */
import { clamp01, type Animation, type Segment } from '../clock';
import type { Pt } from '../units';

export interface WriteOptions {
  /** Total time for the whole expression, ms. */
  duration?: number;
  /** Portion of each glyph's slice spent tracing before the fill starts. */
  borderFraction?: number;
  strokeWidth?: number;
  color?: string;
}

interface GlyphPlan {
  el: SVGPathElement;
  len: number;
  /** Window within the animation, normalised 0..1. */
  from: number;
  to: number;
}

export interface WriteAnimation extends Animation {
  penAt(t: number): Pt | null;
  progressAt(t: number): number;
  /**
   * Resolve a freeze at `atLocal` into a crisp chalk edge, and return the
   * local time to hold at.
   *
   * Tracing an outline means a half-drawn glyph is a faint contour around the
   * *whole* letter plus partial fill — a ghost, not half a letter. In motion
   * that reads as writing; held on screen for the length of a correction it
   * reads as a bug. So a glyph mostly drawn is completed, one barely begun is
   * erased, and everything after is pinned unwritten until local time passes
   * the settle point again (i.e. until the line is resumed). Compared as still
   * frames at /write-test.
   */
  settleTime(atLocal: number): number;
}

export function createWrite(
  id: string,
  glyphs: SVGPathElement[],
  root: SVGSVGElement,
  start: number,
  opts: WriteOptions = {},
): WriteAnimation {
  const {
    duration = 0,
    borderFraction = 0.72,
    strokeWidth = 1.6,
    color = '#f2efe4',
  } = opts;

  let plans: GlyphPlan[] = [];
  let total = duration;
  let ready = false;
  /** Local time of a settled freeze, and the last glyph it allows. */
  let settledAt: number | null = null;
  let settledIndex = -1;

  const segments: Segment[] = [{ at: start, from: 0, len: 0 }];

  function init() {
    // Length-proportional slices: a wide "m" takes longer than a ".", which is
    // how a hand actually moves. A small floor keeps punctuation from being
    // instantaneous.
    const lens = glyphs.map((g) => Math.max(20, g.getTotalLength()));
    const sum = lens.reduce((a, b) => a + b, 0) || 1;

    // Slight overlap so the next glyph begins as the previous one fills,
    // rather than a staccato one-at-a-time march.
    const OVERLAP = 0.18;
    let acc = 0;
    plans = glyphs.map((el, i) => {
      const share = lens[i] / sum;
      const from = Math.max(0, acc - share * OVERLAP);
      acc += share;
      const plan: GlyphPlan = { el, len: lens[i], from, to: acc };
      // A glyph that came out of MathJax already coloured keeps its colour:
      // these are inline styles and they beat the inherited attribute, so
      // without asking, every accented term would be written in plain chalk.
      const ink = el.getAttribute('data-ink') || color;
      el.style.stroke = ink;
      el.style.strokeWidth = String(strokeWidth);
      el.style.strokeLinecap = 'round';
      el.style.fill = ink;
      el.style.fillOpacity = '0';
      el.style.strokeDasharray = `${lens[i]}`;
      el.style.strokeDashoffset = `${lens[i]}`;
      return plan;
    });
    if (!duration) {
      // ~34ms per 100 units of outline, clamped to something a teacher would
      // plausibly take over one line.
      total = Math.min(4200, Math.max(700, sum * 0.34));
    }
    // The first segment's length is only knowable once the glyphs are measured.
    if (segments.length === 1 && segments[0].len === 0) segments[0].len = total;
    ready = true;
  }

  function apply(t: number) {
    if (!ready) return;
    const u = clamp01(t / total);
    // The hard stop applies only while held at or before the settle point;
    // once local time moves past it the line is being finished, so release it.
    const stop =
      settledAt !== null && t <= settledAt + 1 ? settledIndex : plans.length - 1;

    for (let i = 0; i < plans.length; i++) {
      const p = plans[i];
      if (i > stop) {
        // Pinned unwritten. Needed because the inter-glyph overlap would
        // otherwise leak a faint stray mark past the chalk edge.
        p.el.style.strokeDashoffset = String(p.len);
        p.el.style.fillOpacity = '0';
        p.el.style.strokeOpacity = '1';
        continue;
      }
      const span = p.to - p.from || 1;
      const local = clamp01((u - p.from) / span);
      const traced = clamp01(local / borderFraction);
      p.el.style.strokeDashoffset = String(p.len * (1 - traced));
      const fillStart = borderFraction * 0.78;
      const fill = clamp01((local - fillStart) / (1 - fillStart));
      p.el.style.fillOpacity = String(fill);
      // Once filled, drop the outline so glyph weight matches the final art.
      p.el.style.strokeOpacity = String(1 - fill * 0.85);
    }
  }

  function currentGlyph(t: number) {
    const u = clamp01(t / total);
    for (let i = 0; i < plans.length; i++) {
      const p = plans[i];
      if (u >= p.from && u <= p.to) {
        return { p, i, local: (u - p.from) / (p.to - p.from || 1) };
      }
    }
    return null;
  }

  function penAt(t: number): Pt | null {
    if (!ready || plans.length === 0) return null;
    const cur = currentGlyph(t);
    if (!cur) return null;
    const traced = clamp01(cur.local / borderFraction);
    const at = cur.p.el.getPointAtLength(cur.p.len * traced);
    const rootCTM = root.getScreenCTM();
    const elCTM = cur.p.el.getScreenCTM();
    if (!rootCTM || !elCTM) return null;
    const m = rootCTM.inverse().multiply(elCTM);
    const dp = new DOMPoint(at.x, at.y).matrixTransform(m);
    return { x: dp.x, y: dp.y };
  }

  function settleTime(atLocal: number): number {
    const cur = currentGlyph(atLocal);
    if (!cur) return atLocal;
    const keep = cur.local >= 0.5;
    settledIndex = keep ? cur.i : cur.i - 1;
    settledAt = (keep ? cur.p.to : cur.p.from) * total;
    return settledAt;
  }

  function onReset() {
    settledAt = null;
    settledIndex = -1;
  }

  return {
    id,
    segments,
    get duration() {
      return total;
    },
    init,
    apply,
    penAt,
    progressAt: (t: number) => clamp01(t / total),
    settleTime,
    onReset,
  };
}

/** Put an expression into its finished state without animating it. */
export function showInstantly(glyphs: SVGPathElement[], color = '#f2efe4') {
  for (const g of glyphs) {
    g.style.fill = color;
    g.style.fillOpacity = '1';
    g.style.stroke = 'none';
    g.style.strokeDasharray = '';
    g.style.strokeDashoffset = '';
  }
}
