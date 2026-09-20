/**
 * Making typeset maths look handwritten.
 *
 * MathJax v4 ships nine fonts and not one is handwritten, so the usual fix —
 * swap the typeface — is unavailable for maths. What IS available is the
 * geometry: every glyph is an outline, and an outline can be bent. This is
 * Excalidraw's trick applied to letterforms rather than boxes.
 *
 * ## Why control points, not resampling
 *
 * The obvious approach is to walk the outline with `getPointAtLength` and
 * re-emit displaced samples. Measured: **13ms per glyph**, so a fifteen-glyph
 * line costs 200ms — a visible stall before every write. It also degrades the
 * letterform, flattening curves into polylines and rounding off the sharp
 * corners that make a serif a serif.
 *
 * Displacing the existing control points instead touches nothing but numbers
 * in a string. Curves stay curves, corners stay corners, and the cost is
 * microseconds.
 *
 * ## Why the noise must be smooth
 *
 * White noise per point reads as a bad fax. A hand wanders slowly, so
 * displacement comes from summed sines at low frequency indexed by position
 * along the command list: neighbouring points move together and the letter
 * bends rather than frays.
 *
 * Each glyph is seeded by its codepoint and index, so the same character
 * written twice does not wobble identically — that repetition is the giveaway
 * that something was generated rather than written.
 */

export interface RoughenOptions {
  /** Peak displacement in glyph units (MathJax uses 1000 per em). */
  amount?: number;
  seed?: number;
  /**
   * Straight runs longer than this get intermediate points so they can bow.
   *
   * Without it the effect is nearly invisible where it matters most. A curve
   * carries many control points and bends readily, but an equals sign, a
   * fraction bar or the stem of an "l" is two points — displacing both just
   * slides the line and it stays perfectly straight. Long straight strokes are
   * exactly where a real hand bows most, so they have to be subdivided first.
   */
  bowAbove?: number;
}

/** Smooth 1-D noise from incommensurable sines, so it never repeats. */
function wobble(t: number, seed: number): number {
  return (
    Math.sin(t * 0.7 + seed * 1.7) * 0.6 +
    Math.sin(t * 1.9 + seed * 3.1) * 0.3 +
    Math.sin(t * 4.1 + seed * 5.3) * 0.1
  );
}

/**
 * How many numbers each command takes, and which of them are coordinate pairs.
 * Arc is the awkward one: of its seven parameters only the last two are a
 * point — displacing the radii or the flags would corrupt the curve.
 */
const COMMANDS: Record<string, { n: number; coordsFrom: number }> = {
  M: { n: 2, coordsFrom: 0 },
  L: { n: 2, coordsFrom: 0 },
  T: { n: 2, coordsFrom: 0 },
  C: { n: 6, coordsFrom: 0 },
  S: { n: 4, coordsFrom: 0 },
  Q: { n: 4, coordsFrom: 0 },
  A: { n: 7, coordsFrom: 5 },
  H: { n: 1, coordsFrom: 0 },
  V: { n: 1, coordsFrom: 0 },
  Z: { n: 0, coordsFrom: 0 },
};

const TOKENS = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;

/**
 * Break long absolute straight segments (L, H, V) into several, so a later
 * displacement can bow them. Everything else passes through untouched —
 * curves already have enough points to bend.
 */
function subdivideStraights(d: string, above: number): string {
  const out: string[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  let args: number[] = [];

  const lineTo = (x: number, y: number) => {
    const dist = Math.hypot(x - cx, y - cy);
    if (dist > above) {
      const n = Math.min(4, Math.max(2, Math.round(dist / above) + 1));
      for (let k = 1; k < n; k++) {
        const t = k / n;
        out.push(`L${(cx + (x - cx) * t).toFixed(1)} ${(cy + (y - cy) * t).toFixed(1)}`);
      }
    }
    out.push(`L${x.toFixed(1)} ${y.toFixed(1)}`);
    cx = x;
    cy = y;
  };

  const flush = () => {
    if (!cmd) return;
    const upper = cmd.toUpperCase();
    const spec = COMMANDS[upper];
    if (upper === 'Z') {
      out.push('Z');
      cx = sx;
      cy = sy;
    } else if (cmd === 'M') {
      for (let k = 0; k + 1 < args.length; k += 2) {
        // Only the first pair is a move; the rest are implicit line-tos.
        if (k === 0) {
          out.push(`M${args[0]} ${args[1]}`);
          cx = sx = args[0];
          cy = sy = args[1];
        } else lineTo(args[k], args[k + 1]);
      }
    } else if (cmd === 'L') {
      for (let k = 0; k + 1 < args.length; k += 2) lineTo(args[k], args[k + 1]);
    } else if (cmd === 'H') {
      for (const x of args) lineTo(x, cy);
    } else if (cmd === 'V') {
      for (const y of args) lineTo(cx, y);
    } else {
      // Curves and anything relative: pass through, but keep the cursor right.
      out.push(cmd + args.join(' '));
      if (spec && spec.n > 1 && cmd === upper && args.length >= 2) {
        cx = args[args.length - 2];
        cy = args[args.length - 1];
      }
    }
    args = [];
  };

  let m: RegExpExecArray | null;
  TOKENS.lastIndex = 0;
  while ((m = TOKENS.exec(d))) {
    if (m[1]) {
      flush();
      cmd = m[1];
    } else args.push(Number(m[2]));
  }
  flush();
  return out.join('');
}

export function roughenPathData(d: string, opts: RoughenOptions = {}): string {
  const { amount = 7, seed = 1, bowAbove = 90 } = opts;
  if (amount <= 0) return d;
  // Subdivide long straight runs first, so the wobble below has points to act
  // on where a hand would actually bow.
  d = subdivideStraights(d, bowAbove);

  const out: string[] = [];
  let cmd = '';
  let args: number[] = [];
  let i = 0; // point counter, drives the noise phase

  const flush = () => {
    if (!cmd) return;
    const upper = cmd.toUpperCase();
    const spec = COMMANDS[upper];
    if (!spec || spec.n === 0) {
      out.push(cmd);
      args = [];
      return;
    }
    // Relative commands accumulate error when displaced, so they pass through
    // untouched. MathJax emits absolute commands, so this is a safety net.
    const relative = cmd !== upper;
    const parts: string[] = [];
    for (let k = 0; k < args.length; k++) {
      const slot = k % spec.n;
      const isCoord = !relative && slot >= spec.coordsFrom;
      if (!isCoord) {
        parts.push(String(args[k]));
        continue;
      }
      if (upper === 'H' || upper === 'V') {
        parts.push((args[k] + wobble(i, seed) * amount).toFixed(1));
        i += 0.5;
        continue;
      }
      // x then y of a pair; a half-step between them keeps the two axes from
      // moving in lockstep, which would only ever slide the point diagonally.
      const isY = (slot - spec.coordsFrom) % 2 === 1;
      const phase = isY ? i + 0.5 : i;
      parts.push((args[k] + wobble(phase, isY ? seed + 3.7 : seed) * amount).toFixed(1));
      if (isY) i += 1;
    }
    out.push(cmd + parts.join(' '));
    args = [];
  };

  let m: RegExpExecArray | null;
  TOKENS.lastIndex = 0;
  while ((m = TOKENS.exec(d))) {
    if (m[1]) {
      flush();
      cmd = m[1];
    } else {
      args.push(Number(m[2]));
    }
  }
  flush();
  return out.join('');
}

/**
 * The rendered scale of a glyph, from the transforms above it.
 *
 * MathJax scales subscripts and exponents with a transform and leaves the path
 * data at full size, so the outline alone cannot tell a capital from a
 * superscript. Uniform displacement therefore hits a small glyph far harder
 * than a large one — a 0.5-scale exponent gets double the apparent wobble and
 * dissolves. Excalidraw hit exactly this and solved it the same way, scaling
 * roughness down with element size.
 */
function renderedScale(el: Element): number {
  let scale = 1;
  let node: Element | null = el;
  for (let hops = 0; node && hops < 8; hops++, node = node.parentElement) {
    const t = node.getAttribute?.('transform');
    if (!t) continue;
    const m = /scale\(\s*(-?[\d.]+)/.exec(t);
    if (m) scale *= Math.abs(Number(m[1])) || 1;
  }
  return scale;
}

/** Bounding box of a path's own coordinates, for rotating about its centre. */
function pathCentre(d: string): { cx: number; cy: number; size: number } {
  const nums = d.match(/-?\d*\.?\d+/g);
  if (!nums || nums.length < 4) return { cx: 0, cy: 0, size: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = Number(nums[i]);
    const y = Number(nums[i + 1]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    size: Math.max(maxX - minX, maxY - minY),
  };
}

/**
 * A hand does not set glyphs on a perfect baseline at a perfect angle.
 *
 * Tiny per-glyph rotation, vertical offset and scale — well under the
 * threshold where any single letter looks wrong, but unmistakable across a
 * line. Applied as a transform on the path, so the outline is untouched and
 * the stroke-dashoffset animation is unaffected.
 */
export function handJitter(
  glyphs: SVGPathElement[],
  opts: { rotateDeg?: number; driftY?: number; scaleVar?: number } = {},
): void {
  // Published guidance for faking handwriting puts rotation at 1–2 degrees;
  // measured on screen that is invisible for maths, where glyphs are small and
  // widely spaced. These are the values where a LINE reads as hand-set while no
  // single glyph looks wrong.
  const { rotateDeg = 2.6, driftY = 30, scaleVar = 0.034 } = opts;
  glyphs.forEach((g, i) => {
    const d = g.getAttribute('d');
    if (!d) return;
    const code = parseInt(g.getAttribute('data-c') ?? '', 16) || i * 31;
    const seed = (code % 173) + i * 2.1;
    const { cx, cy } = pathCentre(d);
    // Amplified: the raw sum-of-sines rarely reaches its bounds.
    const rot = Math.tanh(wobble(i * 1.9, seed) * 2.2) * rotateDeg;
    // Baseline drift is a slow sine across the line, not per-glyph noise:
    // independent jitter reads as a glitch, a drifting baseline reads as a
    // hand losing the line slightly as it writes.
    const dy = Math.sin(i * 0.6 + seed * 0.3) * driftY;
    const sc = 1 + Math.tanh(wobble(i * 3.3 + 11, seed) * 2.2) * scaleVar;
    const prev = g.getAttribute('transform');
    const t = `rotate(${rot.toFixed(2)} ${cx.toFixed(0)} ${cy.toFixed(0)}) translate(0 ${dy.toFixed(1)}) scale(${sc.toFixed(4)})`;
    g.setAttribute('transform', prev ? `${prev} ${t}` : t);
  });
}

/** Bend every glyph of a typeset expression, in place. */
export function roughenGlyphs(
  glyphs: SVGPathElement[],
  opts: RoughenOptions = {},
): void {
  const base = opts.amount ?? 7;
  glyphs.forEach((g, idx) => {
    const d = g.getAttribute('d');
    if (!d) return;
    // Seeded from the codepoint as well as the index, so a character repeated
    // within one expression still differs from its twin.
    const code = parseInt(g.getAttribute('data-c') ?? '', 16) || idx * 31;
    // Smaller glyphs get proportionally less, or exponents and subscripts
    // dissolve while capitals barely move.
    const amount = base * Math.min(1, Math.pow(renderedScale(g), 1.3));
    g.setAttribute(
      'd',
      roughenPathData(d, { ...opts, amount, seed: (code % 211) + idx * 1.3 }),
    );
  });
}
