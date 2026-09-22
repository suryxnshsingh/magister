/**
 * KaTeX's own shorthands, taught to MathJax.
 *
 * The board typesets with MathJax — it is the one that gives each glyph as an
 * SVG path the chalk can trace — but models write the LaTeX they have seen
 * most, and much of that was written for KaTeX: \R for the reals, \degree,
 * \argmax, \rarr, \blue{...}. Anything KaTeX accepts should reach the board.
 * `scripts/katex-parity.mjs` finds what does not, and this is where most of
 * it is closed; the rest is MathJax's own packages, loaded in mathjax.ts.
 *
 * Where MathJax has no exact equivalent the nearest honest rendering is used
 * (a wide check becomes a check), noted beside it.
 */
import { INKS } from '../templates/primitives';

type Macro = string | [string, number];

// "##" is a literal "#" in a macro body — a lone "#8c…" reads as parameter 8.
const colour = (hex: string): [string, number] => [`\\textcolor{#${hex}}{#1}`, 1];

/** KaTeX's colour words, and Khan Academy's palette it ships, in the board's chalk. */
const COLOURS: Record<string, Macro> = {
  blue: colour(INKS.blue),
  red: colour(INKS.red),
  pink: colour(INKS.red),
  green: colour(INKS.green),
  orange: colour(INKS.orange),
  purple: colour(INKS.purple),
  gray: colour(INKS.dim),
  kaBlue: colour(INKS.blue),
  kaGreen: colour(INKS.green),
};
for (const [family, ink] of [
  ['blue', INKS.blue],
  ['teal', INKS.green],
  ['green', INKS.green],
  ['gold', INKS.yellow],
  ['red', INKS.red],
  ['maroon', INKS.red],
  ['purple', INKS.purple],
  ['mint', INKS.green],
  ['gray', INKS.dim],
] as const) {
  for (const shade of 'ABCDEFGHI') COLOURS[`${family}${shade}`] = colour(ink);
}

const rm = (letter: string) => `\\mathrm{${letter}}`;

export const KATEX_MACROS: Record<string, Macro> = {
  ...COLOURS,

  // Number sets and font shorthands.
  N: '\\mathbb{N}',
  R: '\\mathbb{R}',
  Z: '\\mathbb{Z}',
  Complex: '\\mathbb{C}',
  cnums: '\\mathbb{C}',
  natnums: '\\mathbb{N}',
  reals: '\\mathbb{R}',
  Reals: '\\mathbb{R}',
  Bbb: ['\\mathbb{#1}', 1],
  Bbbk: '\\mathbb{k}',
  bold: ['\\mathbf{#1}', 1],
  frak: ['\\mathfrak{#1}', 1],
  bm: ['\\boldsymbol{#1}', 1],
  // Sans-serif italic: MathJax has no such variant; sans-serif is the nearer half.
  mathsfit: ['\\mathsf{#1}', 1],

  // HTML-entity style names.
  real: '\\Re',
  image: '\\Im',
  alef: '\\aleph',
  alefsym: '\\aleph',
  infin: '\\infty',
  isin: '\\in',
  plusmn: '\\pm',
  sdot: '\\cdot',
  sub: '\\subset',
  sube: '\\subseteq',
  supe: '\\supseteq',
  bull: '\\bullet',
  clubs: '\\clubsuit',
  spades: '\\spadesuit',
  hearts: '\\heartsuit',
  diamonds: '\\diamondsuit',
  empty: '\\emptyset',
  exist: '\\exists',
  sect: '\\S',
  thetasym: '\\vartheta',
  weierp: '\\wp',
  Dagger: '\\ddagger',
  notni: '\\not\\ni',
  harr: '\\leftrightarrow',
  hArr: '\\Leftrightarrow',
  Harr: '\\Leftrightarrow',
  larr: '\\leftarrow',
  lArr: '\\Leftarrow',
  Larr: '\\Leftarrow',
  rarr: '\\rightarrow',
  rArr: '\\Rightarrow',
  Rarr: '\\Rightarrow',
  uarr: '\\uparrow',
  uArr: '\\Uparrow',
  Uarr: '\\Uparrow',
  darr: '\\downarrow',
  dArr: '\\Downarrow',
  Darr: '\\Downarrow',
  lrarr: '\\leftrightarrow',
  lrArr: '\\Leftrightarrow',
  Lrarr: '\\Leftrightarrow',
  lang: '\\langle',
  rang: '\\rangle',
  lparen: '(',
  rparen: ')',
  llbracket: '\\unicode{x27E6}',
  rrbracket: '\\unicode{x27E7}',
  lBrace: '\\unicode{x2983}',
  rBrace: '\\unicode{x2984}',
  mapsfrom: '\\unicode{x21A4}',
  minuso: '\\unicode{x29B5}',
  origof: '\\unicode{x22B6}',
  imageof: '\\unicode{x22B7}',

  // Capital Greek letters that are Latin capitals in print.
  Alpha: rm('A'),
  Beta: rm('B'),
  Chi: rm('X'),
  Epsilon: rm('E'),
  Eta: rm('H'),
  Iota: rm('I'),
  Kappa: rm('K'),
  Mu: rm('M'),
  Nu: rm('N'),
  Omicron: rm('O'),
  Rho: rm('P'),
  Tau: rm('T'),
  Zeta: rm('Z'),

  // Operators.
  argmin: '\\operatorname*{arg\\,min}',
  argmax: '\\operatorname*{arg\\,max}',
  plim: '\\operatorname*{plim}',
  operatornamewithlimits: ['\\operatorname*{#1}', 1],
  arctg: '\\operatorname{arctg}',
  arcctg: '\\operatorname{arcctg}',
  ch: '\\operatorname{ch}',
  cosec: '\\operatorname{cosec}',
  cotg: '\\operatorname{cotg}',
  ctg: '\\operatorname{ctg}',
  cth: '\\operatorname{cth}',
  sh: '\\operatorname{sh}',
  tg: '\\operatorname{tg}',
  th: '\\operatorname{th}',

  // Spacing.
  medspace: '\\:',
  thickspace: '\\;',
  enskip: '\\kern{0.5em}',

  // Enclosures.
  sout: ['\\enclose{horizontalstrike}{#1}', 1],
  phase: ['\\enclose{phasorangle}{#1}', 1],
  angl: ['\\enclose{actuarial}{#1}', 1],
  angln: '\\enclose{actuarial}{n}',

  KaTeX: '\\text{KaTeX}',
  lq: '`',
  rq: "'",

  // Accents written as in running text, used in maths.
  "'": ['\\acute{#1}', 1],
  '`': ['\\grave{#1}', 1],
  '^': ['\\hat{#1}', 1],
  '~': ['\\tilde{#1}', 1],
  '=': ['\\bar{#1}', 1],
  '.': ['\\dot{#1}', 1],
  u: ['\\breve{#1}', 1],
  // Ring and circle as combining marks, so they work inside \\text too —
  // \\mathring and \\enclose are maths-only.
  r: ['#1\u030A', 1],
  // Double acute and cedilla have no maths accent; the letter is kept.
  H: ['#1', 1],
  c: ['#1', 1],
  textcircled: ['#1\u20DD', 1],

  // Letters and signs from running text.
  // The characters themselves, which work in text and maths alike.
  i: '\u0131',
  j: '\u0237',
  ss: '\\unicode{xDF}',
  ae: '\\unicode{xE6}',
  oe: '\\unicode{x153}',
  o: '\\unicode{xF8}',
  aa: '\\unicode{xE5}',
  AE: '\\unicode{xC6}',
  OE: '\\unicode{x152}',
  O: '\\unicode{xD8}',
  pounds: '\\unicode{xA3}',
  mathsterling: '\\unicode{xA3}',
  copyright: '\\unicode{xA9}',
  P: '\\unicode{xB6}',
  dag: '\\dagger',
  ddag: '\\ddagger',
  mathellipsis: '\\ldots',
  varvdots: '\\vdots',
  dotsx: '\\dots',
  underbar: ['\\underline{#1}', 1],
  textmd: ['\\textrm{#1}', 1],
  emph: ['\\textit{#1}', 1],

  // KaTeX's wide accents. MathJax has the stretchy single arrow and the
  // paren; the rest are the nearest accent it has.
  widecheck: ['\\check{#1}', 1],
  Overrightarrow: ['\\overset{\\Longrightarrow}{#1}', 1],
  overgroup: ['\\overparen{#1}', 1],
  undergroup: ['\\underparen{#1}', 1],
  overlinesegment: ['\\overline{#1}', 1],
  underlinesegment: ['\\underline{#1}', 1],
  overleftharpoon: ['\\overset{\\leftharpoonup}{#1}', 1],
  overrightharpoon: ['\\overset{\\rightharpoonup}{#1}', 1],
  utilde: ['\\underset{\\sim}{#1}', 1],

  // KaTeX's equilibrium arrows, as the harpoons mathtools draws.
  xrightleftarrows: ['\\xrightleftharpoons{#1}', 1],
  xrightequilibrium: ['\\xrightleftharpoons{#1}', 1],
  xleftequilibrium: ['\\xrightleftharpoons{#1}', 1],

  // The colon family, under mathtools' names.
  vcentcolon: '\\mathrel{:}',
  ratio: '\\mathrel{:}',
  coloncolon: '\\mathrel{::}',
  colonequals: '\\coloneqq',
  coloncolonequals: '\\Coloneqq',
  equalscolon: '\\eqqcolon',
  equalscoloncolon: '\\Eqqcolon',
  colonminus: '\\coloneq',
  coloncolonminus: '\\Coloneq',
  minuscolon: '\\eqcolon',
  minuscoloncolon: '\\Eqcolon',
  coloncolonapprox: '\\Colonapprox',
  coloncolonsim: '\\Colonsim',
  simcoloncolon: '\\mathrel{\\sim::}',
  approxcoloncolon: '\\mathrel{\\approx::}',
};
