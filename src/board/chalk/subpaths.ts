/**
 * One element per subpath, so a stroke draws as a stroke.
 *
 * `stroke-dashoffset` is the only mechanism this board has for putting a line
 * on over time, and SVG **restarts the dash pattern at every `M`**. A path with
 * eight subpaths therefore does not draw in eight movements: all eight advance
 * together, each at the same fraction of its own length. Measured in Chrome on
 * a three-subpath path at dashoffset 250 of 300 — 49% of every subpath painted,
 * where one continuous line would have been at 50%, 0%, 0%.
 *
 * That is not a corner case here, it is everything drawn with rough.js, which
 * hands back exactly ONE element however many strokes it describes:
 *
 *   line      1 element, 2 subpaths      (the two passes of a hand doubling back)
 *   ellipse   1 element, 2 subpaths
 *   rectangle 1 element, 8 subpaths      (four sides, twice)
 *
 * So every box on this board has been springing outward from four corners at
 * once, and `marks.ts`'s promise that "the pen follows the pass that is
 * currently being drawn" could not hold: with one element, `passAt` always
 * answers zero and the tip sits wherever the concatenated length happens to
 * land while several subpaths are visibly moving.
 *
 * Both `createDraw` and `createMark` already sequence across *elements*, so
 * they do the right thing the moment they are handed one per subpath. Nothing
 * else changes.
 */

/** A subpath so small it would only cost the pen a stop — rough.js emits these to open a fill. */
function degenerate(sub: string): boolean {
  const n = sub.match(/-?\d*\.?\d+(?:e-?\d+)?/g);
  if (!n || n.length < 2) return true;
  const xs: number[] = [];
  const ys: number[] = [];
  n.forEach((v, i) => (i % 2 ? ys : xs).push(Number(v)));
  const span = (a: number[]) => Math.max(...a) - Math.min(...a);
  return span(xs) < 0.5 && span(ys) < 0.5;
}

/**
 * Cut one path's data into one string per subpath.
 *
 * Only safe while every command is absolute, which is what rough.js emits — it
 * uses `M` and `C` and nothing else. A relative command would carry the pen
 * position across the cut and silently move the piece, so a path containing
 * one is handed back whole rather than mangled.
 */
export function splitSubpaths(d: string): string[] {
  const commands = d.match(/[a-zA-Z]/g) ?? [];
  if (commands.some((c) => c >= 'a' && c <= 'z')) return [d];

  const out = d
    .split(/(?=M)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !degenerate(s));

  // Never return nothing: a path that is all degenerate is still a path, and
  // an animation with no elements is a silent no-op rather than a visible one.
  return out.length ? out : [d];
}

/** {@link splitSubpaths} over a list, flattened — the shape rough.js returns. */
export function splitAll(ds: string[]): string[] {
  return ds.flatMap(splitSubpaths);
}
