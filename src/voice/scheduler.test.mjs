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
