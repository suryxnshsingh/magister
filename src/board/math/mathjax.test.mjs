/**
 * What reaches the board when the model's maths is broken, half-LaTeX, or fine.
 *
 *   npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, typesetProblem } from './mathjax.ts';
import { normaliseMath, toTypesettable } from '../../teacher/latex.ts';

test('half plain notation, half LaTeX, is still converted', () => {
  // The line that went up as "(2n − 1)frac(λ, 2)", in italics.
  const { latex } = normaliseMath('\\Delta x = (2n-1) frac(\\lambda, 2)');
  assert.ok(!latex.includes('frac('), latex);
  assert.match(latex, /\\frac/);
  assert.match(latex, /\\Delta/);
});

test('real LaTeX is left alone', () => {
  const { latex } = normaliseMath('\\sin(\\theta) = \\frac{a}{b}');
  assert.ok(!latex.includes('\\\\'), `a doubled backslash is a TeX line break: ${latex}`);
  assert.match(latex, /\\sin\(\\theta\)/);
});

test('arrows are typed the way people type them', () => {
  assert.match(normaliseMath('a => b').latex, /\\implies/);
  assert.match(normaliseMath('x >= 0').latex, /\\geq/);
  assert.match(normaliseMath('p <=> q').latex, /\\iff/);
});

test('an AMS command typesets cleanly', () => {
  const tex = toTypesettable('$d sin(theta) = n lambda \\implies theta = 30$');
  const m = measure(tex);
  assert.ok(m.glyphCount > 10);
  assert.equal(typesetProblem(tex), null);
});

test('an unknown command becomes a word, never an error box', () => {
  const tex = '\\Delta x \\notacommand d \\sin\\theta';
  const m = measure(tex);
  assert.ok(m.glyphCount > 5, 'something legible went up');
  assert.match(typesetProblem(tex) ?? '', /Undefined control sequence \\notacommand/);
});

test('TeX that cannot be rescued goes up as plain words', () => {
  const tex = '\\frac{a}{b';
  const m = measure(tex);
  assert.ok(m.glyphCount > 0);
  assert.ok(typesetProblem(tex));
});

test('an equation can name its quantities in the same inks as the diagram', async () => {
  const { INKS } = await import('../templates/primitives.ts');
  const { latex } = normaliseMath('blue(N) = red(mg) cos(theta)');
  assert.ok(latex.includes(`\\textcolor{${INKS.blue}}{N}`), latex);
  assert.ok(latex.includes(`\\textcolor{${INKS.red}}{mg}`), latex);
  // Every ink but plain chalk has an inline form, in exactly the board's colour.
  for (const [name, hex] of Object.entries(INKS)) {
    if (name === 'chalk') continue;
    assert.ok(normaliseMath(`${name}(x)`).latex.includes(`\\textcolor{${hex}}`), `${name} drifted from the board`);
  }
  const tex = toTypesettable('$blue(N) = red(mg) cos(theta)$');
  assert.ok(measure(tex).glyphCount > 5);
  assert.equal(typesetProblem(tex), null, 'every ink typesets');
});

test('a function of a sum keeps its brackets', () => {
  // "A sin ωt + φ" went up for sin(omega t + phi) — a different function.
  const { latex } = normaliseMath('x = A sin(omega t + phi)');
  assert.match(latex, /\\sin\\left\(/);
  assert.match(normaliseMath('sin(2 theta)').latex, /\\sin\{?2\s*\\theta/);
});

test('words inside maths keep their spaces', () => {
  const { latex } = normaliseMath('I = text(same in series)');
  assert.match(latex, /\\text\{ same in series \}/);
  assert.equal(typesetProblem(toTypesettable('$I = text(same in series)$')) ?? null, null);
});

test('a subscript or power longer than one character stays together', () => {
  assert.match(normaliseMath('R_eq = R_1 + R_2').latex, /R_\{eq\}/);
  assert.match(normaliseMath('v_max').latex, /v_\{max\}/);
  assert.match(normaliseMath('N = 10^19').latex, /10\^\{19\}/);
  assert.match(normaliseMath('u_x').latex, /u_x/);
  assert.match(normaliseMath('x^2').latex, /x\^2/);
});

test('symbols are coloured from a list beside the line, never from markup in it', async () => {
  const { applyColours } = await import('../../teacher/latex.ts');
  const { INKS } = await import('../templates/primitives.ts');
  const out = applyColours('$N - mg cos(theta) = 0$, and $(N)$ again, not mgh', 'N=blue, mg=red');
  assert.equal(out, '$blue(N) - red(mg) cos(theta) = 0$, and $(blue(N))$ again, not mgh');
  // Longest first, and a symbol inside another is left alone.
  assert.equal(applyColours('$F_net = F - f$', 'F=purple, F_net=yellow, f=orange'), '$yellow(F_net) = purple(F) - orange(f)$');
  assert.equal(applyColours('$x$', 'x=mauve'), '$x$', 'an unknown ink changes nothing');
  const tex = toTypesettable(out);
  assert.ok(tex.includes(`\\textcolor{${INKS.blue}}{N}`) && tex.includes(`\\textcolor{${INKS.red}}{mg}`), tex);
});

test('sums, integrals and the rest of the notation are symbols, not letters', () => {
  // The two lines from the board: "summ_i r_i^2" and "intr^2 dm".
  const sum = normaliseMath('I = sum m_i r_i^2').latex;
  assert.match(sum, /\\sum\s*m_i r_i\^2/, sum);
  const int = normaliseMath('I = int r^2 dm').latex;
  assert.match(int, /\\int\s*r\^2 \\,dm/, int);
  // With their limits, in brackets or not.
  assert.match(normaliseMath('sum_(i=1)^N m_i').latex, /\\sum\s*_\{i=1\}\^N/);
  assert.match(normaliseMath('int_0^R x dx').latex, /\\int\s*_0\^R x \\,dx/);
  assert.match(normaliseMath('lim_(x->0) sin(x)/x').latex, /\\lim\s*_\{x \\to 0\}/);
  assert.match(normaliseMath('q = q_0 e^(-t/tau)').latex, /e\^\{-t\/\\tau\s*\}/);
  // Symbols by name, and the Greek that was missing.
  for (const [plain, tex] of [['infinity', 'infty'], ['partial', 'partial'], ['approx', 'approx'], ['propto', 'propto'], ['pm', 'pm'], ['2 pi r', 'pi'], ['theta_1', 'theta'], ['omega_0', 'omega']]) {
    assert.match(normaliseMath(plain).latex, new RegExp(`\\\\${tex}`), plain);
  }
  assert.match(normaliseMath('theta = 30 deg').latex, /30\^\\circ/);
  // Leftover English is words; short algebra stays algebra.
  assert.match(normaliseMath('I = total current').latex, /\\text\{ total current \}/);
  assert.equal(normaliseMath('E = mgh').latex, 'E = mgh');
  assert.equal(normaliseMath('v = u + at').latex, 'v = u + at');
  // And nothing inside words set as words is touched.
  assert.match(normaliseMath('text(sum of pi values)').latex, /\\text\{ sum of pi values \}/);
  // Every one of them typesets.
  for (const line of ['I = sum m_i r_i^2', 'I = int r^2 dm', 'lim_(x->0) sin(x)/x', 'q = q_0 e^(-t/tau)', 'I = total current', 'x approx 2 pi r']) {
    const tex = toTypesettable(`$${line}$`);
    measure(tex);
    assert.equal(typesetProblem(tex), null, `${line} -> ${tex}`);
  }
});
