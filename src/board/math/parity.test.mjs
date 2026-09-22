/**
 * Anything KaTeX can typeset, the board can.
 *
 * The board renders with MathJax, for the chalk; models write the LaTeX they
 * have seen most, much of it written for KaTeX. This runs every command and
 * environment KaTeX declares (read from its own source) through the board's
 * MathJax in a form KaTeX accepts — see scripts/katex-parity.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gaps } from '../../../scripts/katex-parity.mjs';

test('every KaTeX command typesets on the board', async () => {
  const r = await gaps();
  assert.ok(r.checked > 1000, `only ${r.checked} commands were checked — the KaTeX source moved?`);
  assert.deepEqual(
    r.gaps.map((g) => `${g.command}  ${g.tex}  ${g.problem}`),
    [],
    `${r.gaps.length} of ${r.checked} KaTeX commands fail on the board`,
  );
});
