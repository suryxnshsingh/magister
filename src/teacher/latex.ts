/**
 * Getting maths out of a tool call intact.
 *
 * ## The problem, measured
 *
 * Tool arguments travel as JSON. If a model emits raw, unescaped LaTeX, the
 * backslash is a JSON escape, and of 26 macros in the ordinary kinematics
 * vocabulary:
 *
 *   SILENTLY CORRUPTED (parses, wrong value)
 *     \theta \times \tan \text \frac \forall \beta \bar \nu \nabla \rho \right
 *     -> "\theta" becomes TAB + "heta"
 *
 *   HARD PARSE ERROR (the whole tool call is unusable)
 *     \cos \sin \alpha \lambda \pi \delta \mu \gamma \omega \vec \sqrt \int
 *     \underline \upsilon
 *     -> "\c" is not a valid JSON escape, so JSON.parse throws
 *
 * The screenplay's own `u_x = u\cos\theta` manages to hit both at once. A
 * well-behaved model emits `\\cos`, and Gemini may always do so — but that is
 * a bet, and the losing side of it is silent.
 *
 * ## The fix
 *
 * Do not put backslashes in tool arguments at all. The model writes a plain
 * notation — `u_x = u cos(theta) = 17.3 m/s` — which cannot be mangled by JSON
 * because it contains nothing JSON cares about, and this converts it to LaTeX
 * here. Real LaTeX still works if the model insists on emitting it; that path
 * just gets the control-character repair first, as a safety net.
 */

const GREEK = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta',
  'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'rho', 'sigma', 'tau',
  'phi', 'chi', 'psi', 'omega',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Sigma', 'Phi', 'Psi', 'Omega',
];

const FUNCS = ['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'log', 'ln', 'exp', 'max', 'min'];

/** Control characters back to the macro they were meant to be. */
const UNESCAPE: Record<string, string> = {
  '\u0008': '\\b',
  '\u0009': '\\t',
  '\u000a': '\\n',
  '\u000c': '\\f',
  '\u000d': '\\r',
};

const CONTROL = /[\u0008\u0009\u000a\u000c\u000d]/;

export function hasControlChars(s: string): boolean {
  return CONTROL.test(s);
}

/**
 * Undo JSON's silent mangling: TAB + "heta" back to `\theta`.
 * Only reached when a model emitted unescaped LaTeX and got lucky enough to
 * parse at all.
 */
export function repairControlChars(s: string): string {
  return s.replace(/[\u0008\u0009\u000a\u000c\u000d]/g, (c) => UNESCAPE[c] ?? c);
}

/**
 * Rewrite `name(...)` calls, matching parentheses properly.
 *
 * A regex cannot do this: `frac(u^2 sin(2 theta), g)` has a nested call in its
 * numerator, and any character class that excludes parens misses it while one
 * that allows them runs past the closing bracket.
 */
function replaceCalls(
  src: string,
  name: string,
  build: (args: string[]) => string,
): string {
  let out = '';
  let i = 0;
  // Not after a backslash: `\sin(\theta)` is already LaTeX, and rewriting
  // it would put a second backslash in front — a TeX line break.
  const pat = new RegExp(`(?<!\\\\)\\b${name}\\s*\\(`, 'g');
  for (;;) {
    pat.lastIndex = i;
    const m = pat.exec(src);
    if (!m) return out + src.slice(i);

    let depth = 1;
    let j = m.index + m[0].length;
    const args: string[] = [];
    let cur = '';
    for (; j < src.length && depth > 0; j++) {
      const ch = src[j];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) break;
      }
      if (ch === ',' && depth === 1) {
        args.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    if (depth !== 0) return out + src.slice(i); // unbalanced; leave it alone
    args.push(cur);
    out += src.slice(i, m.index) + build(args.map((a) => a.trim()));
    i = j + 1;
  }
}

/**
 * The board's inks, by the names `draw` uses — one vocabulary, so `blue(N)` in
 * an equation and a blue N arrow are visibly the same thing. Kept in step with
 * `INKS` in board/templates/primitives.ts, which this module cannot import
 * without pulling the board into the notation layer.
 */
const INKS: Record<string, string> = {
  accent: '#f0d264',
  yellow: '#f0d264',
  dim: '#cfc9b6',
  blue: '#8cc8ff',
  red: '#ff8a95',
  green: '#a6e89a',
  orange: '#ffb870',
  purple: '#c9a8ff',
};

/** Plain notation -> LaTeX. Order matters: longest names first. */
function plainToLatex(src: string): string {
  let s = src;

  // Innermost calls first, so a nested sin(...) is gone before frac sees it.
  // Words inside maths: text(same in series). Set as words, spaces kept —
  // otherwise it goes up as italic letters run together, "text(sameinseries)".
  s = replaceCalls(s, 'text', ([a]) => `\\text{ ${(a ?? '').replace(/[{}\\]/g, '')} }`);

  for (const f of FUNCS) {
    // sin(2 theta) is written "sin 2θ", but sin(omega t + phi) must keep its
    // brackets — without them it reads as (sin ωt) + φ, a different function.
    s = replaceCalls(s, f, ([a]) =>
      /[+\-−]/.test(a ?? '') ? `\\${f}\\left(${plainToLatex(a ?? '')}\\right)` : `\\${f}{${plainToLatex(a ?? '')}}`,
    );
  }
  s = replaceCalls(s, 'sqrt', ([a]) => `\\sqrt{${plainToLatex(a ?? '')}}`);

  // Vectors and derivatives, in the notation this subject is actually written
  // in. `physics` renders all of these as ordinary glyph paths, so they write
  // stroke by stroke like everything else.
  s = replaceCalls(s, 'vec', ([a]) => `\\va{${plainToLatex(a ?? '')}}`);
  s = replaceCalls(s, 'hat', ([a]) => `\\vu{${plainToLatex(a ?? '')}}`);
  s = replaceCalls(
    s,
    'pdv',
    (a) => `\\pdv{${plainToLatex(a[0] ?? '')}}{${plainToLatex(a[1] ?? '')}}`,
  );
  s = replaceCalls(
    s,
    'dv',
    (a) => `\\dv{${plainToLatex(a[0] ?? '')}}{${plainToLatex(a[1] ?? '')}}`,
  );

  // One quantity, one colour, across the equation and the figure beside it.
  // The names match `draw`'s colour words so there is one vocabulary to learn.
  for (const [name, hex] of Object.entries(INKS)) {
    if (name === 'chalk') continue;
    s = replaceCalls(s, name, ([a]) => `\\textcolor{${hex}}{${plainToLatex(a ?? '')}}`);
  }
  s = replaceCalls(
    s,
    'frac',
    (a) => `\\frac{${plainToLatex(a[0] ?? '')}}{${plainToLatex(a[1] ?? '')}}`,
  );

  // Bare function names, as in "u cos theta".
  // The (?<!\\\\) guard makes conversion idempotent: without it the \\b before
  // "theta" also matches inside an already-converted \\theta, and recursion
  // through nested calls turns it into \\\\theta.
  for (const f of FUNCS) {
    s = s.replace(new RegExp(`(?<!\\\\)\\b${f}\\b(?!\\{)`, 'g'), `\\${f} `);
  }

  // Greek names. Word-boundary only, so "theta" converts but "thetas" does not.
  for (const g of GREEK) {
    s = s.replace(new RegExp(`(?<!\\\\)\\b${g}\\b`, 'g'), `\\${g} `);
  }

  // Arrows and comparisons, as they are typed. Longest first, so "<=>" is not
  // read as "<=" and ">".
  s = s
    .replace(/<=>/g, ' \\iff ')
    .replace(/=>/g, ' \\implies ')
    .replace(/->/g, ' \\to ')
    .replace(/>=/g, ' \\geq ')
    .replace(/<=/g, ' \\leq ')
    .replace(/!=/g, ' \\neq ');

  // Braces a single token does not need: \cos{\theta} -> \cos\theta, \cos{30} -> \cos 30
  s = s.replace(/\\(\w+)\{\s*\\(\w+)\s*\}/g, '\\$1\\$2');
  s = s.replace(/\\(\w+)\{\s*(\d+)\s*\}/g, '\\$1 $2');
  // A subscript or power longer than one character: R_eq, v_max, F_net,
  // 10^19, e^-3. TeX takes only the next character without braces, so R_eq
  // went up as R-sub-e followed by a q.
  s = s.replace(/_([A-Za-z0-9]{2,})(?![{\w])/g, '_{$1}');
  s = s.replace(/\^(-?\d{2,}|-\d)(?![{\d])/g, '^{$1}');
  // "*" reads as multiplication on a board.
  s = s.replace(/\s*\*\s*/g, ' \\times ');
  // Units: bare "m/s", "m/s^2", "s", "m" after a number.
  s = s.replace(/(\d)\s*(m\/s\^2|m\/s|m|s|kg|N|J)\b/g, (_m, d, u) => `${d}\\ \\text{${u}}`);

  return s.replace(/\s+/g, ' ').trim();
}

export interface Normalised {
  latex: string;
  /** True when the input arrived already mangled by JSON. */
  wasCorrupted: boolean;
  /** True when the model sent real LaTeX rather than the plain notation. */
  wasLatex: boolean;
}

/**
 * Turn whatever the model sent into LaTeX we can typeset.
 *
 * Accepts both the plain notation we ask for and real LaTeX, because a model
 * told to avoid backslashes will still occasionally reach for them.
 */
export function normaliseMath(input: string): Normalised {
  const wasCorrupted = hasControlChars(input);
  const repaired = wasCorrupted ? repairControlChars(input) : input;
  const wasLatex = repaired.includes('\\');
  return {
    // Converted even when it is partly LaTeX already. Models mix the two in
    // one span — "\Delta x = (2n-1) frac(\lambda, 2)" — and passing any span
    // with a backslash through untouched left "frac(λ, 2)" on the board as
    // four italic letters and a bracket. Every rewrite below leaves real
    // LaTeX alone, so doing both is safe.
    latex: plainToLatex(repaired),
    wasCorrupted,
    wasLatex,
  };
}

/**
 * `write` content is prose with $...$ spans. Normalise only inside the spans,
 * so "Horizontal speed constant hai" stays prose while "$u cos(theta)$" becomes
 * maths.
 */
/**
 * Escape a run of prose so TeX renders it as the words that were written.
 *
 * Only the characters that would otherwise be read as syntax. A backslash is
 * dropped rather than escaped: prose is not supposed to contain one, and a
 * stray `\textbackslash` on a blackboard is worse than a missing mark.
 */
function escapeProse(run: string): string {
  return run
    .replace(/\\/g, '')
    .replace(/([{}&#%_$])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}');
}

/**
 * One TeX string for a whole line, with the prose in text mode.
 *
 * This is the difference between a sentence and a smear. Everything handed to
 * MathJax is typeset as MATHS unless it is wrapped, and maths mode gives a
 * space no width at all — so "Kaunsa chapter padhein aaj?" came out as
 * `Kaunsachapterpadheinaaj?`, in italics, with every space silently dropped.
 *
 * Splitting on the `$...$` spans and wrapping the rest in `\text{}` keeps the
 * spaces, sets the words upright, and leaves the maths in the mode it belongs
 * in — so one line can be half sentence and half equation, which is how a
 * teacher actually writes.
 */
export function toTypesettable(content: string): string {
  const normalised = normaliseContent(content).latex;
  const out: string[] = [];
  let i = 0;
  const span = /\$([^$]*)\$/g;
  for (let m = span.exec(normalised); m; m = span.exec(normalised)) {
    if (m.index > i) out.push(`\\text{${escapeProse(normalised.slice(i, m.index))}}`);
    out.push(m[1]);
    i = m.index + m[0].length;
  }
  if (i < normalised.length) {
    const tail = normalised.slice(i);
    // A line that is nothing but maths never needed wrapping in the first
    // place, and wrapping it would set the symbols upright.
    out.push(out.length === 0 && !/\$/.test(normalised) && /[=^_\\]/.test(tail)
      ? tail
      : `\\text{${escapeProse(tail)}}`);
  }
  return out.join('');
}

/**
 * Colour symbols in a line from a separate list — "N=blue, mg=red" — instead
 * of markup in the line itself.
 *
 * Markup in the content is what the live model reads aloud: with
 * "$red(mg)$" in its examples, its speech came out as "gravitational force
 * $red(mg)$ hamesha straight down". A list beside the line keeps the line
 * plain maths, which is all it narrates. Whole symbols only, and only inside
 * the maths — "mg" is coloured in "mg cos(theta)", not inside "mgh".
 */
export function applyColours(content: string, colours: string): string {
  const pairs = colours
    .split(',')
    .map((p) => p.split('=').map((x) => x.trim()))
    .filter((p): p is [string, string] => p.length === 2 && !!p[0] && p[1].toLowerCase() in INKS)
    // Longest first, so "F_net" is taken before "F".
    .sort((a, b) => b[0].length - a[0].length);
  if (!pairs.length) return content;
  // One pass over all of them, so a replacement is never matched again —
  // the "m" of a coloured "mg" stays inside it.
  const ink = new Map(pairs.map(([sym, name]) => [sym, name.toLowerCase()]));
  const alternatives = pairs.map(([sym]) => sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`(?<![\\w\\\\])(${alternatives})(?![\\w])`, 'g');
  const colour = (math: string) => math.replace(pattern, (sym) => `${ink.get(sym)}(${sym})`);
  return content.includes('$') ? content.replace(/\$([^$]*)\$/g, (_m, inner: string) => `$${colour(inner)}$`) : colour(content);
}

export function normaliseContent(content: string): Normalised {
  let corrupted = false;
  let sawLatex = false;
  const out = content.replace(/\$([^$]*)\$/g, (_m, inner: string) => {
    const r = normaliseMath(inner);
    corrupted = corrupted || r.wasCorrupted;
    sawLatex = sawLatex || r.wasLatex;
    return `$${r.latex}$`;
  });
  // No $...$ at all: treat the whole thing as maths if it looks like it.
  if (!/\$/.test(content) && /[=^_]/.test(content)) {
    const r = normaliseMath(content);
    return { latex: `$${r.latex}$`, wasCorrupted: r.wasCorrupted, wasLatex: r.wasLatex };
  }
  return { latex: out, wasCorrupted: corrupted, wasLatex: sawLatex };
}
