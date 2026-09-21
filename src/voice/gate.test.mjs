/**
 * The speech gate, replayed against what went wrong in real sessions.
 *
 *   node --test src/voice/gate.test.mjs
 *
 * A microphone in a room cannot be exercised on a desk, so the room is modelled
 * here instead: the teacher's voice leaves the speaker, comes back into the mic
 * late and quieter (the residual the echo canceller could not remove), and the
 * page's rules for holding the teacher are applied to it. The loud-crackle
 * cases use levels far above any bar, so they test the gate's judgement of
 * TIME — which is where the phantom turns came from — and not the threshold.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_VOICED_MS, SpeechGate } from './gate.ts';

const BLOCK = 8; // 128 samples at 16 kHz
const LOUD = 0.2;
const ROOM = 0.001;
/** Speaker to microphone, including the echo canceller's own delay. */
const LATENCY = 200;
/** How long after the speaker falls silent its echo may still arrive (the page's tail). */
const TAIL = 250;

/** Deterministic noise, so a failure reproduces. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r) {
  return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
}

/**
 * Drive a gate through a room.
 *
 * `teacher(t)` — is the teacher's voice queued to play at t (before any hold).
 * `residual(t)` — what the mic hears of it, if it is playing.
 * `student(t)` — the student's own mic level at t, or 0.
 *
 * Holds are applied the way the page applies them: a hold silences the
 * speaker until the utterance is rejected (resume) or ends (the turn is taken).
 */
function room({ ms, start = 0, teacher = () => false, residual = () => 0, student = () => 0, gate = new SpeechGate() }) {
  const events = [];
  const played = [];
  let held = false;
  let lastOut = -Infinity;
  for (let t = start; t < start + ms; t += BLOCK) {
    const playing = teacher(t) && !held;
    played.push(playing);
    if (playing) lastOut = t;
    const echoed = played[Math.floor((t - start - LATENCY) / BLOCK)] ? residual(t) : 0;
    const peak = Math.max(ROOM, echoed, student(t));
    for (const e of gate.push({ now: t, peak, ms: BLOCK, echoLive: t - lastOut < TAIL, learnEcho: playing })) {
      events.push({ t, ...e });
      if (e.type === 'hold' && teacher(t)) held = true;
      if (e.type === 'reject') held = false;
      if (e.type === 'end') held = false;
    }
  }
  return { events, gate, count: (type) => events.filter((e) => e.type === type).length };
}

/** Loud crackles of a given length at given times: every one of them clears any bar. */
function crackles(list) {
  return (t) => (list.some(([at, len]) => t >= at && t < at + len) ? LOUD : 0);
}

/**
 * The teacher speaking in phrases, with the pauses of real speech between
 * them — including the short ones that used to drag the echo estimate down.
 */
function phrases(seed, totalMs) {
  const r = rng(seed);
  const spans = [];
  let t = 0;
  while (t < totalMs) {
    const len = 1200 + r() * 3000;
    spans.push([t, t + len]);
    t += len + 150 + r() * 650;
  }
  return (at) => spans.some(([a, b]) => at >= a && at < b);
}

/**
 * Residual echo at a syllable rate, scattered: median about 0.006, with a tail
 * that reaches the 0.01–0.02 measured crossing the old bar in a failing session.
 */
function residualEcho(seed, level = 0.006) {
  const r = rng(seed);
  return (t) => {
    const syllable = 0.25 + 0.75 * Math.max(0, Math.sin((2 * Math.PI * 4.5 * t) / 1000));
    return level * syllable * Math.exp(0.45 * gauss(r)) * 1.6;
  };
}

test('the logged phantom blips never reach the server', () => {
  // 10, 20, 39 and 81ms — the lengths logged as student turns in a session
  // where the student said nothing after "hello".
  const { count, events } = room({
    ms: 5000,
    student: crackles([[500, 10], [1500, 20], [2500, 39], [3500, 81]]),
  });
  assert.equal(count('commit'), 0, JSON.stringify(events));
  // Only the 81ms one is long enough to hold the teacher, and it is let go.
  assert.equal(count('hold'), count('reject') - 3);
});

test('echo crackling at the syllable rate never reaches the server', () => {
  // Two 8ms crossings 170–200ms apart committed under the old span rule; here
  // they are a whole train of them, at 5 Hz, for three seconds.
  for (const len of [8, 16, 24]) {
    const list = [];
    for (let at = 200; at < 3200; at += 200) list.push([at, len]);
    const { count } = room({ ms: 4000, student: crackles(list) });
    assert.equal(count('commit'), 0, `${len}ms crackles at 5 Hz`);
    assert.equal(count('hold'), 0, `${len}ms crackles at 5 Hz held the teacher`);
  }
});

test('an unbroken 160ms of voice commits — the old rule refused it', () => {
  const { events, count } = room({ ms: 1500, student: crackles([[300, MIN_VOICED_MS]]) });
  assert.equal(count('commit'), 1);
  const commit = events.find((e) => e.type === 'commit');
  assert.ok(commit.t < 300 + MIN_VOICED_MS, `committed at ${commit.t}`);
});

test('a short word with a stop consonant in it still commits', () => {
  // "haan", "B", "nahi": voicing broken inside the word, as a peak detector sees it.
  const { count } = room({ ms: 1500, student: crackles([[300, 104], [440, 96]]) });
  assert.equal(count('commit'), 1);
});

test('a sentence commits once and ends once, after the hang', () => {
  const words = [];
  for (let at = 300; at < 2300; at += 370) words.push([at, 250]);
  const { events, count } = room({ ms: 3500, student: crackles(words) });
  assert.equal(count('commit'), 1);
  assert.equal(count('end'), 1);
  const end = events.find((e) => e.type === 'end');
  assert.ok(end.t > 2300 && end.t < 2300 + 500, `ended at ${end.t}`);
});

test("the teacher's own residual echo never becomes a student turn", () => {
  // Thirty seconds of a lesson in an open room, from the very first word —
  // the estimate starts from nothing, which is when "hello" was followed by a
  // stream of phantom turns.
  for (const seed of [1, 2, 3, 4, 5]) {
    const { count, gate } = room({ ms: 30000, teacher: phrases(seed, 30000), residual: residualEcho(seed) });
    assert.equal(count('commit'), 0, `seed ${seed}: echo committed`);
    assert.ok(count('hold') <= 1, `seed ${seed}: echo held the teacher ${count('hold')} times`);
    assert.ok(gate.bar(true) > 0.02, `seed ${seed}: bar ${gate.bar(true).toFixed(4)}`);
  }
});

test('the bar does not sag in the pauses between phrases', () => {
  const teacher = phrases(7, 20000);
  const { gate } = room({ ms: 20000, teacher, residual: residualEcho(7) });
  const before = gate.bar(true);
  assert.ok(before > 0.02, `bar ${before.toFixed(4)}`);
  // Twelve hundred milliseconds of silence, then the teacher again.
  const after = room({ ms: 1200, start: 20000, gate }).gate.bar(true);
  assert.equal(after, before);
});

test('a student over the teacher is held at once and heard', () => {
  const teacher = (t) => t < 8000;
  const student = (t) => (t >= 5000 && t < 5700 && (t - 5000) % 240 < 200 ? 0.08 : 0);
  const { events } = room({ ms: 9000, teacher, residual: residualEcho(11), student });
  const hold = events.find((e) => e.type === 'hold' && e.t >= 5000);
  const commit = events.find((e) => e.type === 'commit');
  assert.ok(hold && hold.t - 5000 <= 80, `held ${hold && hold.t - 5000}ms after they began`);
  assert.ok(commit && commit.t - 5000 <= 260, `committed ${commit && commit.t - 5000}ms after they began`);
});

test('with a headset the bar comes down to the room', () => {
  const { gate } = room({ ms: 8000, teacher: () => true, residual: residualEcho(3, 0.0004) });
  assert.ok(gate.bar(true) < 0.012, `bar ${gate.bar(true).toFixed(4)}`);
});

test('an estimate that starts low climbs instead of starving', () => {
  // A headset, then open speakers. The echo that now crosses the bar is the
  // echo that has to be learned — leaving it out keeps the bar too low forever.
  const gate = room({ ms: 8000, teacher: () => true, residual: residualEcho(5, 0.0004) }).gate;
  const { count } = room({ ms: 15000, start: 8000, teacher: () => true, residual: residualEcho(5, 0.008), gate });
  assert.equal(count('commit'), 0);
  assert.ok(gate.bar(true) > 0.025, `bar ${gate.bar(true).toFixed(4)}`);
});
