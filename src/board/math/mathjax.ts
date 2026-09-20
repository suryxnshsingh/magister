/**
 * LaTeX -> SVG with individually animatable glyphs.
 *
 * `fontCache: 'none'` is mandatory and is the whole reason this module exists.
 * MathJax's default ('local') hoists each glyph into a shared <defs> and emits
 * <use> references, so a repeated character is ONE path element: animating its
 * stroke-dashoffset would animate every occurrence at once, and getTotalLength()
 * would read from the definition rather than the instance. Verified against
 * @mathjax/src 4.1.3: 'local' -> 11 <use> + 1 <defs>; 'none' -> 11 inline
 * <path>, 0 <use>, and repeated glyphs each keep their own element.
 *
 * Note the v4 package rename: v4 lives at `@mathjax/src`, while `mathjax-full`
 * stopped at v3. `AllPackages` no longer exists; packages load individually and
 * 'base' covers everything the kinematics screenplay needs.
 */
import { mathjax } from '@mathjax/src/mjs/mathjax.js';
import { TeX } from '@mathjax/src/mjs/input/tex.js';
import { SVG } from '@mathjax/src/mjs/output/svg.js';
import { liteAdaptor } from '@mathjax/src/mjs/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/mjs/handlers/html.js';

import { PX_PER_UNIT } from '../units';

/** MathJax's internal SVG units per em. */
const UNITS_PER_EM = 1000;

/**
 * Default em size in board units, measured rather than guessed.
 *
 * Against the screenplay's six derivation lines (two of them fractions), the
 * binding constraint is `u_x = u\cos\theta = 17.3 m/s` on width, not the
 * stack on height:
 *
 *   em     height used      widest line
 *   0.44   5.28 / 7.10      4.52 / 5.37   <- chosen
 *   0.48   5.63 / 7.10      4.93 / 5.37
 *   0.52   5.97 / 7.10      5.34 / 5.37   <- at the wall
 *
 * 0.44 leaves 16% width and 26% height spare, which is headroom for the live
 * model in M2 phrasing a line longer than any I predicted.
 */
export const DEFAULT_EM = 0.44;

let adaptorRef: ReturnType<typeof liteAdaptor> | null = null;
let docRef: ReturnType<typeof mathjax.document> | null = null;

function ensureDoc() {
  if (docRef && adaptorRef) return { doc: docRef, adaptor: adaptorRef };
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const doc = mathjax.document('', {
    InputJax: new TeX({ packages: ['base'] }),
    // The one setting this module exists to enforce.
    OutputJax: new SVG({ fontCache: 'none' }),
  });
  adaptorRef = adaptor;
  docRef = doc;
  return { doc, adaptor };
}

export interface Typeset {
  /** The <svg> element, detached. Caller positions and appends it. */
  svg: SVGSVGElement;
  /** Glyph paths in document order — the units of a Write animation. */
  glyphs: SVGPathElement[];
  /** Top-level MathML children: the targets of eq[i] indexing. */
  parts: SVGGElement[];
  /** Size in board units at the requested em. */
  width: number;
  height: number;
  /** Distance from the baseline to the top, in board units. */
  ascent: number;
}

/** Strip the mjx-container wrapper and hand back the bare <svg> markup. */
function toSvgMarkup(tex: string): string {
  const { doc, adaptor } = ensureDoc();
  const node = doc.convert(tex, { display: true });
  const html: string = adaptor.outerHTML(node);
  const start = html.indexOf('<svg');
  const end = html.lastIndexOf('</svg>');
  if (start === -1 || end === -1) {
    throw new Error(`MathJax produced no <svg> for: ${tex}`);
  }
  return html.slice(start, end + '</svg>'.length);
}

/**
 * Typeset `tex` at `em` board units per em.
 *
 * Browser-only: needs DOMParser to hand back live elements. The markup step
 * above is environment-independent, so a future server-side pre-typeset can
 * reuse it directly.
 */
/**
 * Rewrite every <rect> as an equivalent <path>.
 *
 * MathJax draws fraction bars (and radical rules) as <rect>, not <path>. A
 * rect has no path length, so it cannot carry a stroke-dashoffset — it would
 * sit at full opacity from the moment it entered the DOM, which shows up as a
 * fraction bar hanging in mid-air seconds before its equation is written.
 * Converting them means one animation path for everything, and tracing a thin
 * rectangle's outline reads exactly like a bar drawn left to right.
 */
function rectsToPaths(svg: SVGSVGElement) {
  for (const rect of Array.from(svg.querySelectorAll('rect'))) {
    const x = Number(rect.getAttribute('x') ?? 0);
    const y = Number(rect.getAttribute('y') ?? 0);
    const w = Number(rect.getAttribute('width') ?? 0);
    const h = Number(rect.getAttribute('height') ?? 0);
    const path = svg.ownerDocument.createElementNS(
      'http://www.w3.org/2000/svg',
      'path',
    );
    path.setAttribute('d', `M${x},${y}H${x + w}V${y + h}H${x}Z`);
    path.setAttribute('data-rule', '1');
    for (const attr of Array.from(rect.attributes)) {
      if (!['x', 'y', 'width', 'height'].includes(attr.name)) {
        path.setAttribute(attr.name, attr.value);
      }
    }
    rect.parentNode?.replaceChild(path, rect);
  }
}

export function typeset(tex: string, em: number = DEFAULT_EM): Typeset {
  const markup = toSvgMarkup(tex);
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const svg = parsed.documentElement as unknown as SVGSVGElement;
  rectsToPaths(svg);

  const viewBox = (svg.getAttribute('viewBox') ?? '0 0 0 0')
    .split(/\s+/)
    .map(Number);
  const [, minY, vbW, vbH] = viewBox;

  // MathJax internal units -> board units, then -> px for the SVG's own size.
  const unitsToBoard = em / UNITS_PER_EM;
  const width = vbW * unitsToBoard;
  const height = vbH * unitsToBoard;
  // viewBox minY is negative above the baseline.
  const ascent = -minY * unitsToBoard;

  svg.setAttribute('width', String(width * PX_PER_UNIT));
  svg.setAttribute('height', String(height * PX_PER_UNIT));
  svg.removeAttribute('style');

  const glyphs = Array.from(svg.querySelectorAll('path')).filter((p) =>
    // Fraction bars and radicals are <rect>-like paths with no glyph data;
    // they still animate, so keep everything that carries a 'd'.
    (p.getAttribute('d') ?? '').length > 0,
  ) as SVGPathElement[];

  const root = svg.querySelector('g[data-mml-node="math"]');
  const parts = root
    ? (Array.from(root.children).filter((c) =>
        c.hasAttribute('data-mml-node'),
      ) as SVGGElement[])
    : [];

  return { svg, glyphs, parts, width, height, ascent };
}

/**
 * Locate a sub-expression inside a typeset equation — what `mark(target =
 * "ux:u\cos\theta")` needs in order to circle one term.
 *
 * MathJax v4 tags every MathML node with its own TeX source, which makes this
 * far more robust than matching glyph codepoints (where italic `u` is U+1D462
 * while `cos` is ASCII, and a repeated symbol is indistinguishable from its
 * twin). Two shapes occur in practice:
 *
 *   \frac{u^2\sin 2\theta}{g}  -> one <g data-latex="\frac{u^2\sin 2\theta}{g}">
 *   u\cos\theta                -> a RUN of siblings: u, \cos, an invisible
 *                                 operator carrying no data-latex, \theta
 *
 * so a single-node lookup alone would miss the common case. Whitespace is
 * stripped because MathJax normalises its own output ("u^2 \sin 2\theta")
 * differently from the source that was fed in.
 *
 * Returns the matching elements, or [] — callers fall back to the whole
 * object rather than failing, because deixis must never error.
 */
export function findPart(svg: SVGSVGElement, part: string): SVGGraphicsElement[] {
  const norm = (s: string) => s.replace(/\s+/g, '');
  const want = norm(part);
  if (!want) return [];

  const root = svg.querySelector('g[data-mml-node="math"]');
  if (!root) return [];

  // 1. A single node whose source matches outright. Prefer the smallest such
  // node: the <math> root also carries data-latex for the entire expression.
  const single = (Array.from(root.querySelectorAll('[data-latex]')) as SVGGraphicsElement[])
    .filter((el) => norm(el.getAttribute('data-latex') ?? '') === want)
    .sort((a, b) => a.querySelectorAll('path').length - b.querySelectorAll('path').length);
  if (single.length) return [single[0]];

  // 2. A contiguous run of siblings. Nodes with no data-latex (invisible
  // operators such as function application) contribute nothing to the source
  // but must stay inside the run so the box covers them.
  const scopes = [root, ...Array.from(root.querySelectorAll('g'))] as SVGGraphicsElement[];
  for (const scope of scopes) {
    const kids = Array.from(scope.children).filter((c) =>
      c.hasAttribute('data-mml-node'),
    ) as SVGGraphicsElement[];
    for (let i = 0; i < kids.length; i++) {
      let acc = '';
      for (let j = i; j < kids.length; j++) {
        acc += norm(kids[j].getAttribute('data-latex') ?? '');
        if (acc === want) return kids.slice(i, j + 1);
        if (acc.length > want.length) break;
      }
    }
  }
  return [];
}

/** Measure without building DOM — for layout passes and fit checks. */
export function measure(
  tex: string,
  em: number = DEFAULT_EM,
): { width: number; height: number; ascent: number; glyphCount: number } {
  const markup = toSvgMarkup(tex);
  const vb = markup.match(/viewBox="([^"]+)"/);
  const nums = (vb?.[1] ?? '0 0 0 0').split(/\s+/).map(Number);
  const [, minY, vbW, vbH] = nums;
  const k = em / UNITS_PER_EM;
  return {
    width: vbW * k,
    height: vbH * k,
    ascent: -minY * k,
    glyphCount: (markup.match(/<path/g) ?? []).length,
  };
}
