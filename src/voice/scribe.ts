/**
 * The client half of the scribe — see `teacher/scribe.ts` for the idea.
 *
 * The live model's output transcript arrives in pieces, each stamped with
 * the output sample its audio starts at, and seconds ahead of the student
 * hearing it. This cuts those pieces into sentences, hands them to the scribe
 * one request at a time, and places every call it gets back on the word its
 * `cue` names: find the cue in the sentence, find which piece of transcript
 * that character is in, and interpolate into that piece's audio. The op is
 * then scheduled against playback like any other, so the chalk moves on the
 * word.
 *
 * One request at a time, on purpose. Two in flight would each be blind to
 * what the other is about to draw, and the board would get everything twice.
 * Sentences that arrive meanwhile wait and go together in the next request,
 * which is told what the last one asked for.
 *
 * When the student cuts in and the teacher's queued audio is thrown away, the
 * scribe must not draw what was never said. Anything it was about to ask
 * about is dropped, and anything already asked about but not yet answered is
 * kept only as far as the student actually heard.
 */
import type { ScribeReply, ScribeRequest } from '@/teacher/scribe';
import type { ToolCall } from './session';

/** A sentence stops growing when the transcript pauses this long. */
export const SCRIBE_IDLE_MS = 700;
/** Sentences per request, at most. More wait for the next. */
const BATCH = 3;
/** Earlier sentences shown as context. */
const RECENT = 4;
/** Failures remembered and shown back. */
const FAILED = 4;

interface Piece {
  /** Offset of this piece in its sentence's text. */
  from: number;
  /** Output sample its audio starts at. */
  atSamples: number;
}

interface Sentence {
  text: string;
  pieces: Piece[];
  /** Where the next sentence's audio starts, once known — the end of this one. */
  end: number | null;
}

export interface ScribeHooks {
  ask(req: ScribeRequest): Promise<ScribeReply>;
  /** The board's manifest, now. */
  board(): string;
  /** Calls already placed that have not reached the board. */
  pending(): string[];
  /** Hand a call to the scheduler. */
  place(call: ToolCall): void;
  note(text: string): void;
}

const TERMINATOR = /[.?!।]+/g;

/** Lowercased, punctuation to spaces, whitespace collapsed — so a cue matches despite commas. */
function norm(s: string): { text: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let space = true;
  for (let i = 0; i < s.length; i++) {
    const c = s[i].toLowerCase();
    if (/[\p{L}\p{N}]/u.test(c)) {
      out.push(c);
      map.push(i);
      space = false;
    } else if (!space) {
      out.push(' ');
      map.push(i);
      space = true;
    }
  }
  return { text: out.join('').trimEnd(), map };
}

/** Where in `text` the cue begins, or -1. Falls back to its first words. */
export function findCue(text: string, cue: string): number {
  const t = norm(text);
  const c = norm(cue).text.trim();
  if (!c) return -1;
  const words = c.split(' ');
  for (let n = words.length; n >= Math.min(2, words.length); n--) {
    const at = t.text.indexOf(words.slice(0, n).join(' '));
    if (at >= 0) return t.map[at];
  }
  return -1;
}

/** A call the scribe placed, not one the live model made — nobody is waiting on its answer. */
export function isScribeCall(call: ToolCall): boolean {
  return call.callId.startsWith('scribe:');
}

export class Scribe {
  private buf = '';
  private bufPieces: { at: number; atSamples: number }[] = [];
  private ready: Sentence[] = [];
  private recent: string[] = [];
  private failed: string[] = [];
  private last: Sentence | null = null;
  private busy = false;
  private epoch = 0;
  /** Calls from before a cut are kept only if anchored at or before this. */
  private heardUpTo = Infinity;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(private hooks: ScribeHooks) {}

  /** A piece of the teacher's transcript. */
  hear(text: string, atSamples: number) {
    // The previous sentence ends where this audio starts.
    if (this.last && this.last.end === null) this.last.end = atSamples;
    this.bufPieces.push({ at: this.buf.length, atSamples });
    this.buf += text;
    this.split(false);
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.end(), SCRIBE_IDLE_MS);
  }

  /** The teacher stopped: whatever is left is a sentence. */
  end() {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    this.split(true);
  }

  /** The student cut in; playback had reached `heard`. Nothing after it was said. */
  cut(heard: number) {
    this.epoch++;
    this.heardUpTo = heard;
    this.buf = '';
    this.bufPieces = [];
    this.ready = [];
    this.last = null;
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
  }

  /** A call did not work when it reached the board. Told to the scribe next time. */
  failure(text: string) {
    this.failed.push(text);
    if (this.failed.length > FAILED) this.failed.shift();
  }

  private split(all: boolean) {
    let from = 0;
    TERMINATOR.lastIndex = 0;
    for (let m = TERMINATOR.exec(this.buf); m; m = TERMINATOR.exec(this.buf)) {
      const stop = m.index + m[0].length;
      // "3." at the very end may be "3.5" still arriving.
      if (stop === this.buf.length && /\d/.test(this.buf[m.index - 1] ?? '') && m[0] === '.' && !all) break;
      // A full stop between two digits is a decimal point.
      if (m[0] === '.' && /\d/.test(this.buf[m.index - 1] ?? '') && /\d/.test(this.buf[stop] ?? '')) continue;
      this.take(from, stop);
      from = stop;
    }
    if (all && this.buf.slice(from).trim()) {
      this.take(from, this.buf.length);
      from = this.buf.length;
    }
    if (from > 0) {
      this.buf = this.buf.slice(from);
      // A piece straddling the cut starts the remainder at its own sample:
      // slightly early, never late.
      const keep = this.bufPieces.filter((p, i) => {
        const next = this.bufPieces[i + 1];
        return (next ? next.at : Infinity) > from;
      });
      this.bufPieces = keep.map((p) => ({ at: Math.max(0, p.at - from), atSamples: p.atSamples }));
    }
    this.pump();
  }

  private take(from: number, to: number) {
    const raw = this.buf.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (!text) return;
    const start = from + lead;
    const pieces = this.bufPieces
      .filter((p, i) => {
        const next = this.bufPieces[i + 1];
        return p.at < to && (next ? next.at : Infinity) > start;
      })
      .map((p) => ({ from: Math.max(0, p.at - start), atSamples: p.atSamples }));
    if (!pieces.length) return;
    const s: Sentence = { text, pieces, end: null };
    // Where it ends is known if a later piece has already started.
    const after = this.bufPieces.find((p) => p.at >= to);
    if (after) s.end = after.atSamples;
    if (this.last && this.last.end === null) this.last.end = pieces[0].atSamples;
    this.last = s;
    this.ready.push(s);
  }

  /** The sample the character at `pos` of sentence `s` is spoken at. */
  private sampleAt(s: Sentence, pos: number): number {
    let i = 0;
    while (i + 1 < s.pieces.length && s.pieces[i + 1].from <= pos) i++;
    const p = s.pieces[i];
    const nextFrom = i + 1 < s.pieces.length ? s.pieces[i + 1].from : s.text.length;
    const nextAt = i + 1 < s.pieces.length ? s.pieces[i + 1].atSamples : s.end;
    if (nextAt === null || nextFrom <= p.from) return p.atSamples;
    return Math.round(p.atSamples + ((pos - p.from) / (nextFrom - p.from)) * (nextAt - p.atSamples));
  }

  private pump() {
    if (this.busy || !this.ready.length) return;
    const batch = this.ready.splice(0, BATCH);
    const epoch = this.epoch;
    this.busy = true;
    const req: ScribeRequest = {
      said: batch.map((s) => s.text),
      recent: this.recent.slice(-RECENT),
      board: this.hooks.board(),
      pending: this.hooks.pending(),
      failed: [...this.failed],
    };
    this.failed = [];
    this.recent.push(...req.said);
    this.recent.splice(0, Math.max(0, this.recent.length - RECENT));
    this.hooks
      .ask(req)
      .then((reply) => {
        if (reply.error) this.hooks.note(`scribe: ${reply.error}`);
        reply.calls.forEach((c, i) => {
          const { cue, ...args } = c.args;
          const anchor = this.anchor(batch, typeof cue === 'string' ? cue : '', i, reply.calls.length);
          // Asked about before the student cut in: keep only what they heard.
          if (epoch !== this.epoch && anchor > this.heardUpTo) return;
          this.hooks.place({
            callId: `scribe:${++this.seq}`,
            name: c.name,
            args,
            anchorSamples: anchor,
            playedSamples: 0,
            at: performance.now(),
          });
        });
      })
      .catch((e) => this.hooks.note(`scribe failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        this.busy = false;
        this.pump();
      });
  }

  /** On the cue's word, or spread through the batch if the cue is not in it. */
  private anchor(batch: Sentence[], cue: string, i: number, n: number): number {
    for (const s of batch) {
      const at = cue ? findCue(s.text, cue) : -1;
      if (at >= 0) return this.sampleAt(s, at);
    }
    const s = batch[Math.min(batch.length - 1, Math.floor((i / Math.max(1, n)) * batch.length))];
    return s.pieces[0].atSamples;
  }
}
