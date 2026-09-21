/**
 * The op scheduler's hold on a turn with nothing to hear.
 *
 *   node --experimental-transform-types --test src/voice/scheduler.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpScheduler } from './scheduler.ts';

const call = (id, anchorSamples) => ({ callId: id, name: 'write', args: {}, anchorSamples, playedSamples: 0, at: 0 });

test('a lesson that opens on board calls alone still draws them', () => {
  // Nothing has played, so the lead-in — "not before the turn is audible" —
  // held these for ever: no speech was ever coming to make it audible.
  const fired = [];
  const s = new OpScheduler((c) => fired.push(c.callId));
  s.enqueue(call('title', 0));
  s.tick(0);
  assert.deepEqual(fired, [], 'held by the lead-in');
  s.release(['title']);
  s.tick(0);
  assert.deepEqual(fired, ['title']);
});

test('a released call still waits for the speech queued ahead of it', () => {
  const fired = [];
  const s = new OpScheduler((c) => fired.push(c.callId));
  s.markTurnStart(0);
  s.enqueue(call('after', 48_000));
  s.release(['after']);
  s.tick(24_000);
  assert.deepEqual(fired, []);
  s.tick(48_000);
  assert.deepEqual(fired, ['after']);
});

test('calls sent together are drawn one after another, in order', () => {
  const fired = [];
  const s = new OpScheduler((c) => fired.push(c.callId));
  s.markTurnStart(0);
  // Three calls in one message: one anchor between them.
  s.enqueue(call('block', 48_000), 0, 650);
  s.enqueue(call('N', 48_000), 0, 650);
  s.enqueue(call('mg', 48_000), 0, 650);
  s.tick(48_000);
  assert.deepEqual(fired, ['block'], 'only the first is due at the anchor');
  s.tick(48_000 + 0.65 * 24_000);
  assert.deepEqual(fired, ['block', 'N']);
  s.tick(48_000 + 1.3 * 24_000);
  assert.deepEqual(fired, ['block', 'N', 'mg']);
});

test('an erase sent with new work keeps its place ahead of it', () => {
  const fired = [];
  const s = new OpScheduler((c) => fired.push(c.callId));
  s.markTurnStart(0);
  s.enqueue(call('write', 96_000), 0, 1500);
  // The model sent the erase second; it is preparation and starts early.
  s.enqueue(call('erase', 96_000), 2600, 0);
  s.tick(96_000);
  assert.deepEqual(fired, ['erase', 'write']);
});
