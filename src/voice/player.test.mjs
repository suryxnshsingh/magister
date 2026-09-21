/**
 * The player worklet's clock, run outside the browser.
 *
 *   node --test src/voice/player.test.mjs
 *
 * `played` is the space every board op is anchored in: an op fires when
 * playback reaches the position the server's stream had reached when the op
 * was asked for. So after any flush, the two must still agree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadPlayer() {
  let Player;
  const context = {
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (m) => this.posted.push(m), onmessage: null };
        this.posted = [];
      }
    },
    registerProcessor: (_name, cls) => {
      Player = cls;
    },
    Int16Array,
  };
  const src = readFileSync(new URL('../../public/worklets/player.js', import.meta.url), 'utf8');
  vm.runInNewContext(src, context);
  const p = new Player();
  const send = (data) => p.port.onmessage({ data });
  const render = (blocks) => {
    for (let i = 0; i < blocks; i++) p.process([], [[new Float32Array(128)]]);
  };
  return { p, send, render };
}

const chunk = (n) => new Int16Array(n).fill(1000);

test('a flush keeps playback and the op anchors in the same place', () => {
  const { p, send, render } = loadPlayer();
  let received = 0;
  const push = (n) => {
    send({ type: 'push', pcm: chunk(n) });
    received += n;
  };

  // Ten seconds of a turn arrive; the student cuts in two seconds into it.
  push(240_000);
  render(Math.ceil(48_000 / 128));
  send({ type: 'flush' });

  // The answer to them: one second of speech, and a board op asked for at
  // its end — anchored where the server's stream then stood.
  push(24_000);
  const anchor = received;
  render(Math.ceil(24_000 / 128) + 2);

  assert.equal(p.queued(), 0, 'the answer has finished playing');
  assert.ok(p.played >= anchor, `played ${p.played} never reaches the op at ${anchor}`);
});

test('holding does not move the clock', () => {
  const { p, send, render } = loadPlayer();
  send({ type: 'push', pcm: chunk(24_000) });
  render(10);
  const at = p.played;
  send({ type: 'hold' });
  render(50);
  assert.equal(p.played, at);
});
