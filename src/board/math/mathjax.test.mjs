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
