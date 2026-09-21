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
