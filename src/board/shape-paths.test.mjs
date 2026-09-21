/**
 * The drawable shapes' geometry. The pictures are checked on /draw-test;
 * this checks the things a picture can hide.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { componentD, curveD, fieldD, springD, turnD, waveD } from './shape-paths.ts';

const A = { x: 100, y: 200 };
const B = { x: 500, y: 200 };
const points = (d) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

test('a spring starts and ends exactly on its anchors, with the coils asked for', () => {
  const d = springD(A, B, 5);
  const n = points(d);
  assert.deepEqual(n.slice(0, 2), [100, 200]);
  assert.deepEqual(n.slice(-2), [500, 200]);
  // Two ends, two lead points, two zigzag points per coil.
  assert.equal(d.split(/[ML]/).filter(Boolean).length, 4 + 5 * 2);
});

test('a wave spans a to b and stays within its amplitude', () => {
  const ys = points(waveD(A, B, 2)).filter((_, i) => i % 2 === 1);
  assert.ok(Math.max(...ys) <= 200 + 34.1 && Math.min(...ys) >= 200 - 34.1);
});

test('a curve passes through the point it is told to', () => {
  // A quadratic through `via` at its midpoint: the control point is 2·via − mid(a,b).
  const d = curveD(A, B, { x: 300, y: 100 });
  assert.match(d, /Q300\.0,0\.0 500\.0,200\.0/);
});

test('a turn goes the way it is told, with its head where the motion arrives', () => {
  assert.notEqual(turnD(A, { x: 160, y: 200 }), turnD(A, { x: 160, y: 200 }, true));
  assert.equal(turnD(A, { x: 160, y: 200 }).match(/M/g).length, 2, 'the arc, then the head');
});

test('a field is parallel arrows, as many as asked', () => {
  assert.equal(fieldD(A, B, 5).length, 5);
});

test('circuit components chain: every one begins and ends on its anchors', () => {
  for (const kind of ['resistor', 'cell', 'capacitor', 'bulb', 'switch', 'inductor', 'meter']) {
    const { d, label } = componentD(kind, A, B);
    assert.deepEqual(points(d[0]).slice(0, 2), [100, 200], `${kind} starts on a`);
    assert.deepEqual(points(d[d.length - 1]).slice(-2), [500, 200], `${kind} ends on b`);
    assert.notEqual(label.y, 200, `${kind}'s label is off the wire`);
  }
});
