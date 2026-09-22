/**
 * The op scheduler — where the board and the voice are actually joined.
 *
 * Measured on gemini-3.8-live: a `toolCall` arrives with **5 to 13 seconds**
 * of speech still queued and unplayed. The server generates far faster than it
 * speaks, and tool calls travel on their own message without waiting for the
 * audio around them.
 *
 * So firing a board op when its call arrives would put the chalk five to
 * thirteen seconds ahead of the teacher's voice — a worse slideshow than
 * drawing late, and the exact failure the project is built to avoid. Ops are
 * therefore held until PLAYBACK reaches the point in the speech where the
 * model emitted them.
 *
 * Every call carries `anchorSamples` = total output samples received when it
 * arrived. Because audio is received strictly in order, that position *is*
 * where the model was in its own sentence. Fire when `samplesPlayed` reaches
 * it and the chalk lands on the word.
 */
import type { ToolCall } from './session';

const OUTPUT_RATE = 24_000;
const msToSamples = (ms: number) => Math.round((ms / 1000) * OUTPUT_RATE);

/**
 * How far one call of a batch may be pushed past the first. Spacing a batch
 * is about order and one stroke at a time, not about waiting for every write
 * to finish: measured batches run to seven calls, and spacing each by its full
 * duration put the last one 6.6s past its anchor — near the end of the words
 * it was about, against a lead of 5–13s.
 */
const STAGGER_CAP_MS = 4000;
/** The most any one call holds up the next. */
const STAGGER_STEP_MS = 1500;

export interface Scheduled {
  call: ToolCall;
  /** Playback position, in output samples, at which this should fire. */
  fireAt: number;
  enqueuedAt: number;
}

export interface SchedulerOptions {
  /**
   * Constant correction applied to every anchor, from M1's measurements.
   * Positive delays the chalk. A *slope* in the lead cannot be fixed here —
   * that would mean falling back to a transcript-rate estimate.
   */
  biasMs?: number;
  /**
   * Nothing is drawn until the turn has been audible for this long. Guards the
   * case where a call arrives at the very start of a turn and would otherwise
   * ink before the teacher has said anything about it. Pen travel may begin
   * earlier — a hand moving toward where it will write is exactly right.
   */
  turnLeadInMs?: number;
}

export class OpScheduler {
  private queue: Scheduled[] = [];
  private turnStartPlayed = 0;
  private lastPlayed = 0;
  /** The batch being spaced: its anchor, where its first call fired, and when the chalk is next free. */
  private batch: { anchor: number; start: number; until: number } | null = null;

  constructor(
    private fire: (call: ToolCall) => void,
    private opts: SchedulerOptions = {},
  ) {}

  /** Ops waiting for the voice to catch up to them. */
  get pending(): readonly Scheduled[] {
    return this.queue;
  }

  /** Playback position where the current turn's audio began. */
  markTurnStart(played: number) {
    this.turnStartPlayed = played;
  }

  /**
   * `startEarlyMs` is the whole difference between a teacher and a subtitle.
   *
   * The model emits a tool call AFTER speaking the phrase it belongs to — in
   * the transcript, "...u_x is equal to u cos theta." arrives, and only then
   * the `write`. So the anchor marks the END of the words, and firing on it
   * exactly produces speak-then-write: the chalk always trailing the voice.
   *
   * Starting the op early by roughly its own duration makes the stroke SPAN
   * the phrase instead of following it, which is what a real teacher does —
   * the sentence and the writing finish together. There is 5–13s of queued
   * audio to borrow from, so moving a couple of seconds earlier is free.
   */
  enqueue(call: ToolCall, startEarlyMs = 0, busyMs = 0) {
    const bias = msToSamples(this.opts.biasMs ?? 0);
    const leadIn = msToSamples(this.opts.turnLeadInMs ?? 300);
    const early = msToSamples(startEarlyMs);
    let fireAt = Math.max(
      call.anchorSamples + bias - early,
      // Never before the turn has been audible: an op cannot precede the
      // first word of the sentence that asked for it.
      this.turnStartPlayed + leadIn,
    );
    /**
     * Calls that arrived in one message share one anchor, so without this
     * they all fire on the same sample and a whole diagram appears at once.
     * Each waits for the one before it to finish, in the order the model
     * sent them. `busyMs` of zero opts out — an erase keeps its early place.
     */
    if (busyMs > 0) {
      const same = this.batch && this.batch.anchor === call.anchorSamples ? this.batch : null;
      if (same) fireAt = Math.max(fireAt, Math.min(same.until, same.start + msToSamples(STAGGER_CAP_MS)));
      this.batch = {
        anchor: call.anchorSamples,
        start: same ? same.start : fireAt,
        until: fireAt + msToSamples(Math.min(busyMs, STAGGER_STEP_MS)),
      };
    }
    this.queue.push({ call, fireAt, enqueuedAt: performance.now() });
    this.queue.sort((a, b) => a.fireAt - b.fireAt);
  }

  /** Driven by the player worklet's clock. */
  tick(played: number) {
    this.lastPlayed = played;
    while (this.queue.length && this.queue[0].fireAt <= played) {
      const next = this.queue.shift();
      if (next) this.fire(next.call);
    }
  }

  /**
   * The student cut in. Everything anchored past the point actually heard was
   * never spoken, so it must never be drawn — that is what keeps the board
   * honest about what the teacher said.
   *
   * Returns the dropped calls so their ids can be reported back to the model,
   * which otherwise believes it drew them.
   */
  dropUnheard(): ToolCall[] {
    const dropped = this.queue.filter((s) => s.fireAt > this.lastPlayed);
    this.queue = this.queue.filter((s) => s.fireAt <= this.lastPlayed);
    return dropped.map((s) => s.call);
  }

  /**
   * These calls ended a turn with no speech after them, so there is no word to
   * wait for and the model is waiting on them instead. Drop the lead-in: it
   * holds an op until the turn has been audible, and a turn with nothing to
   * hear never is — on a lesson opener, where nothing has played yet, the op
   * would wait for ever. They still wait for whatever audio is queued ahead.
   */
  release(callIds: string[]) {
    const ids = new Set(callIds);
    const bias = msToSamples(this.opts.biasMs ?? 0);
    for (const s of this.queue) {
      if (ids.has(s.call.callId)) s.fireAt = Math.min(s.fireAt, s.call.anchorSamples + bias);
    }
    this.queue.sort((a, b) => a.fireAt - b.fireAt);
  }

  /** Vendor cancelled these after an interruption. */
  cancel(callIds: string[]) {
    const ids = new Set(callIds);
    this.queue = this.queue.filter((s) => !ids.has(s.call.callId));
  }

  clear() {
    this.queue = [];
  }

  /** How far behind the voice the chalk currently is, in ms. */
  waitingMs(): number {
    if (!this.queue.length) return 0;
    return ((this.queue[0].fireAt - this.lastPlayed) / OUTPUT_RATE) * 1000;
  }
}
