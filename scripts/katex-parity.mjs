/**
 * What KaTeX can typeset that the board's MathJax cannot.
 *
 *   node --experimental-transform-types --import ./scripts/test-resolve.mjs scripts/katex-parity.mjs
 *
 * Every command KaTeX declares — its functions, environments, symbols and
 * macros, read from its own source — is tried in the first form KaTeX
 * accepts, and that exact string is handed to the board's MathJax. Anything
 * KaTeX renders and MathJax refuses is a gap. `gaps()` is also what the
 * parity test asserts on.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const katex = require('katex');
const KATEX_SRC = new URL('../node_modules/katex/src/', import.meta.url);

/**
 * Commands left out on purpose, each for a reason:
 * links, pictures and HTML have no place on a blackboard; macro definition and
 * TeX plumbing are not notation; the mirror commands have no MathJax
 * counterpart and no use in physics; amsmath's \DOTS markers are internal;
 * digamma needs the extended Greek font, a megabyte for one archaic letter.
 * Anything named with an @ is KaTeX-internal and is skipped wholesale.
 */
export const NOT_FOR_A_BOARD = new Set([
  '\\href', '\\url', '\\includegraphics', '\\htmlClass', '\\htmlId', '\\htmlStyle', '\\htmlData',
  '\\def', '\\gdef', '\\edef', '\\xdef', '\\global', '\\long', '\\let', '\\futurelet',
  '\\newcommand', '\\renewcommand', '\\providecommand', '\\noexpand', '\\expandafter',
  '\\message', '\\errmessage', '\\TextOrMath', '\\char', '\\verb', '\\relax', '\\show',
  '\\reflectbox', '\\mathreflectbox', '\\DOTSI', '\\DOTSB', '\\DOTSX', '\\digamma',
]);

/** A string literal from KaTeX's source, unescaped: "\\frac" is \frac, "\\'" is \'. */
const unquote = (lit) =>
  lit.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(.)/g, '$1');

function read(dir, file) {
  return readFileSync(new URL(`${dir}${file}`, KATEX_SRC), 'utf8');
}

/** Every command and environment KaTeX declares. */
export function katexCommands() {
  const cmds = new Map();
  const envs = new Set();
  const names = (src) => [...src.matchAll(/names:\s*\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => unquote(x[1])));
  for (const f of readdirSync(new URL('functions/', KATEX_SRC))) {
    if (f.endsWith('.ts')) for (const n of names(read('functions/', f))) cmds.set(n, 'math');
  }
  for (const f of readdirSync(new URL('environments/', KATEX_SRC))) {
    if (f.endsWith('.ts')) for (const n of names(read('environments/', f))) envs.add(n);
  }
  for (const m of read('', 'symbols.ts').matchAll(/defineSymbol\(\s*(math|text)\s*,[^,]+,[^,]+,[^,]+,\s*"((?:[^"\\]|\\.)*)"/g)) {
    const n = unquote(m[2]);
    if (n.startsWith('\\') && !cmds.has(n)) cmds.set(n, m[1]);
  }
  for (const m of read('', 'macros.ts').matchAll(/defineMacro\(\s*"((?:[^"\\]|\\.)*)"/g)) {
    const n = unquote(m[1]);
    if (n.startsWith('\\') && !n.includes('@') && !cmds.has(n)) cmds.set(n, 'math');
  }
  for (const n of NOT_FOR_A_BOARD) cmds.delete(n);
  for (const n of [...cmds.keys()]) if (n.includes('@')) cmds.delete(n);
  return { cmds, envs };
}

function katexAccepts(tex) {
  try {
    katex.renderToString(tex, { throwOnError: true, displayMode: true, strict: 'ignore', trust: false });
    return true;
  } catch {
    return false;
  }
}

/** The first usage of a command KaTeX accepts — what MathJax is then asked to do. */
export function probeFor(name, mode) {
  const forms =
    mode === 'text'
      ? [`\\text{${name}}`, `\\text{${name}{a}}`]
      : [
          name, `${name}{a}`, `${name}{a}{b}`, `${name}{a}{b}{c}`, `${name}[2]{a}`, `${name} a`, `${name}(`,
          `\\left(${name}\\right)`, `\\left${name} a \\right.`, `a ${name} b`, `${name}{red}{a}`, `${name}{1em}`,
          `${name}{\\text{a}}`, `\\text{${name}}`,
        ];
  return forms.find(katexAccepts) ?? null;
}

export function envProbe(env) {
  return [
    `\\begin{${env}} a & b \\\\ c & d \\end{${env}}`,
    `\\begin{${env}}{cc} a & b \\\\ c & d \\end{${env}}`,
    `\\begin{${env}}{2} a & b \\\\ c & d \\end{${env}}`,
    `\\begin{${env}} a \\end{${env}}`,
  ].find(katexAccepts) ?? null;
}

/** Every KaTeX command whose KaTeX-accepted usage the board's MathJax refuses. */
export async function gaps() {
  const { measure, typesetProblem } = await import('../src/board/math/mathjax.ts');
  const { cmds, envs } = katexCommands();
  const out = [];
  let checked = 0;
  const check = (label, tex) => {
    if (!tex) return;
    checked++;
    measure(tex);
    const problem = typesetProblem(tex);
    if (problem) out.push({ command: label, tex, problem });
  };
  for (const [name, mode] of cmds) check(name, probeFor(name, mode));
  for (const env of envs) check(`{${env}}`, envProbe(env));
  return { gaps: out, checked, declared: cmds.size + envs.size };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = await gaps();
  console.log(`KaTeX declares ${r.declared} commands and environments; ${r.checked} have a usage KaTeX accepts.`);
  console.log(`${r.gaps.length} of them MathJax cannot typeset:`);
  for (const g of r.gaps) console.log(`  ${g.command.padEnd(24)} ${g.tex.padEnd(40)} ${String(g.problem).slice(0, 70)}`);
}
