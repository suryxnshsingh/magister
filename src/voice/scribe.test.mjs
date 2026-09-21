/**
 * The scribe's client half: cutting the transcript into sentences, and
 * putting each call on the word it names.
 *
 *   node --experimental-transform-types --test src/voice/scribe.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scribe, findCue } from './scribe.ts';

/** A scribe whose requests are answered by hand. */
function harness() {
  const asked = [];
  const placed = [];
  const answers = [];
  const scribe = new Scribe({
    ask: (req) =>
      new Promise((resolve) => {
        asked.push(req);
        answers.push(resolve);
      }),
    board: () => '(board is empty)',
    pending: () => placed.map((c) => c.name),
    place: (c) => placed.push(c),
    note: () => {},
  });
  const answer = async (calls) => {
    answers.shift()({ calls, ms: 1 });
    await new Promise((r) => setTimeout(r, 0));
  };
  return { scribe, asked, placed, answer };
}

test('pieces become sentences at their full stops, and a decimal is not one', () => {
  const { scribe, asked } = harness();
  scribe.hear('Dekho, v equals omega r. Aur yahan', 0);
  scribe.hear(' r hai 3.', 24_000);
  scribe.hear('5 metre। Samjhe?', 48_000);
  assert.deepEqual(asked[0].said, ['Dekho, v equals omega r.']);
  scribe.end();
  assert.equal(asked.length, 1, 'one request at a time');
});

test('sentences that arrive while a request is out go together in the next one', async () => {
  const { scribe, asked, answer } = harness();
  scribe.hear('Pehli line. ', 0);
  scribe.hear('Doosri line. ', 10_000);
  scribe.hear('Teesri line. ', 20_000);
  assert.deepEqual(asked[0].said, ['Pehli line.']);
  await answer([{ name: 'write', args: { id: 'a', content: '$a$', cue: 'Pehli line' } }]);
  assert.deepEqual(asked[1].said, ['Doosri line.', 'Teesri line.']);
  assert.deepEqual(asked[1].pending, ['write'], 'told what the last request asked for');
  assert.deepEqual(asked[1].recent, ['Pehli line.']);
});

test('a call lands on the sample its cue is spoken at', async () => {
  const { scribe, placed, answer } = harness();
  // Two pieces: the first 24000 samples of audio say "Lens formula lagate hain — ".
  scribe.hear('Lens formula lagate hain — ', 0);
  scribe.hear('ek upon v minus ek upon u equals ek upon f.', 24_000);
  scribe.hear('Yahan', 96_000);
  await answer([
    { name: 'write', args: { id: 'lf', content: '$frac(1,v)$', cue: 'ek upon v minus' } },
    { name: 'mark', args: { target: 'lf', style: 'underline', cue: 'equals ek upon f' } },
  ]);
  assert.equal(placed[0].anchorSamples, 24_000, 'at the start of the piece that says it');
  assert.ok(placed[1].anchorSamples > 24_000 && placed[1].anchorSamples < 96_000, `${placed[1].anchorSamples}`);
  assert.equal(placed[0].args.cue, undefined, 'the cue is not passed on to the board');
  assert.match(placed[0].callId, /^scribe:/);
});

test('a cue that is not word for word still finds its place by its first words', () => {
  assert.equal(findCue('Dekho, yahan dekho: v hamesha perpendicular hai.', 'yahan dekho v hamesha kuch'), 7);
  assert.equal(findCue('Kuch aur', 'bilkul alag'), -1);
});

test('when the student cuts in, nothing past what they heard is drawn', async () => {
  const { scribe, placed, answer, asked } = harness();
  // One sentence over two pieces of audio, and a second sentence behind it.
  scribe.hear('Pehle ye likho, ', 0);
  scribe.hear('phir wo likho. ', 48_000);
  scribe.hear('Aur ye bhi. ', 72_000);
  // The first request is out; the student cuts in having heard up to 30000 —
  // the first half of the first sentence.
  scribe.cut(30_000);
  await answer([
    { name: 'write', args: { id: 'a', content: '$a$', cue: 'Pehle ye likho' } },
    { name: 'write', args: { id: 'b', content: '$b$', cue: 'phir wo likho' } },
  ]);
  assert.deepEqual(placed.map((c) => c.args.id), ['a']);
  assert.equal(asked.length, 1, 'the sentence behind it is never asked about');
});

test('a sentence is only cut at a real full stop', () => {
  const { scribe, asked } = harness();
  scribe.hear('Radius hai 3.', 0);
  assert.equal(asked.length, 0, '"3." may be "3.5" still arriving');
  scribe.hear('5 metre। ', 24_000);
  assert.deepEqual(asked[0].said, ['Radius hai 3.5 metre।']);
});
