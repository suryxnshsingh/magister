/**
 * Which board reply wakes the teacher — replayed against the turns that went
 * dead in real sessions.
 *
 *   node --test src/voice/wake.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wakeup } from './wake.ts';

/** Records every reply sent, in order, as `id:wake` or `id:silent`. */
function ledger() {
  const w = new Wakeup();
  const sent = [];
  const answer = (id) => w.answer(id, (wake) => sent.push(`${id}:${wake ? 'wake' : 'silent'}`));
  return { w, sent, answer };
}

test('a turn of nothing but board calls wakes the model on the last reply', () => {
  // The session that died: "write v_omega_r", then turnComplete, no speech.
  const { w, sent, answer } = ledger();
  w.call('write');
  assert.deepEqual(w.turnComplete(), ['write']);
  answer('write');
  assert.deepEqual(sent, ['write:wake']);
});

test('several calls with no speech wake on whichever is answered last', () => {
  // circle, r_vec, v_vec, origin — then silence.
  const { w, sent, answer } = ledger();
  for (const id of ['circle', 'r_vec', 'v_vec', 'origin']) w.call(id);
  w.turnComplete();
  answer('circle');
  answer('r_vec');
  answer('origin');
  answer('v_vec');
  assert.deepEqual(sent, ['circle:silent', 'r_vec:silent', 'origin:silent', 'v_vec:wake']);
});

test('a reply ready before the turn ends is held, then decides', () => {
  // The chalk can land within one clock tick, before turnComplete arrives.
  const { w, sent, answer } = ledger();
  w.call('a');
  w.call('b');
  answer('a');
  answer('b');
  assert.deepEqual(sent, [], 'nothing can be decided yet');
  w.turnComplete();
  assert.deepEqual(sent, ['a:silent', 'b:wake']);
});

test('a held reply waits for calls that have not fired yet', () => {
  const { w, sent, answer } = ledger();
  w.call('a');
  w.call('b');
  answer('a');
  w.turnComplete();
  assert.deepEqual(sent, ['a:silent']);
  answer('b');
  assert.deepEqual(sent, ['a:silent', 'b:wake']);
});

test('calls made while talking never wake anything', () => {
  // The ordinary case, and the reason board replies are SILENT at all: a
  // WHEN_IDLE here would start a new turn every time the chalk landed.
  const { w, sent, answer } = ledger();
  w.audio();
  w.call('a');
  w.audio();
  w.call('b');
  answer('a');
  w.audio();
  assert.deepEqual(w.turnComplete(), []);
  answer('b');
  assert.deepEqual(sent, ['a:silent', 'b:silent']);
});

test('a turn that talks and then ends on a call is waiting on that call', () => {
  const { w, sent, answer } = ledger();
  w.audio();
  w.call('a');
  w.audio();
  w.call('b');
  assert.deepEqual(w.turnComplete(), ['b']);
  answer('a');
  answer('b');
  assert.deepEqual(sent, ['a:silent', 'b:wake']);
});

test('a reply held while the model is still going is released when it speaks', () => {
  const { w, sent, answer } = ledger();
  w.call('a');
  answer('a');
  assert.deepEqual(sent, []);
  w.audio();
  assert.deepEqual(sent, ['a:silent']);
  assert.deepEqual(w.turnComplete(), []);
});

test('a turn the student cut into never wakes the model', () => {
  // Their own turn is what the model answers next.
  const { w, sent, answer } = ledger();
  w.call('a');
  answer('a');
  w.interrupted();
  assert.deepEqual(sent, ['a:silent']);
  assert.deepEqual(w.turnComplete(), []);
  w.call('b');
  w.interrupted();
  answer('b');
  assert.deepEqual(sent, ['a:silent', 'b:silent']);
});

test('a dropped call is not waited on', () => {
  const { w, sent, answer } = ledger();
  w.call('a');
  w.call('b');
  w.turnComplete();
  w.drop('b');
  answer('a');
  assert.deepEqual(sent, ['a:wake']);
});

test('each generation is judged on its own', () => {
  const { w, sent, answer } = ledger();
  w.call('a');
  w.turnComplete();
  answer('a');
  // The model woke and spoke, then ended on a call again.
  w.audio();
  w.call('b');
  w.turnComplete();
  answer('b');
  // And a turn that ends in speech — a question to the student — stays ended.
  w.audio();
  w.turnComplete();
  assert.deepEqual(sent, ['a:wake', 'b:wake']);
});

test('either end signal ends the generation, and the second changes nothing', () => {
  // generationComplete and turnComplete are separate server messages; the
  // wake must not depend on one of them turning up.
  const { w, sent, answer } = ledger();
  w.call('a');
  answer('a');
  assert.deepEqual(w.turnComplete(), ['a']);
  assert.deepEqual(w.turnComplete(), []);
  assert.deepEqual(sent, ['a:wake']);
});

test('a held reply is sent even if the turn never says it ended', () => {
  const { w, sent } = ledger();
  w.call('a');
  assert.equal(w.answer('a', (wake) => sent.push(`a:${wake ? 'wake' : 'silent'}`)), true);
  assert.deepEqual(w.expire('a'), ['a']);
  assert.deepEqual(sent, ['a:wake']);
  // And a later generation is untouched by it.
  w.call('b');
  assert.deepEqual(w.expire('a'), []);
  assert.equal(w.answer('b', () => {}), true);
});

test('expiring a reply that was already sent does nothing', () => {
  const { w, sent, answer } = ledger();
  w.call('a');
  answer('a');
  w.audio();
  assert.deepEqual(sent, ['a:silent']);
  assert.deepEqual(w.expire('a'), []);
  w.call('b');
  assert.deepEqual(w.turnComplete(), ['b'], 'the expiry did not end the new generation');
});
