/**
 * Is the student speaking? Decided from the microphone alone, block by block.
 *
 * Pure on purpose: it takes numbers and returns events, and the page turns
 * those into holding the teacher, telling the server, and settling the turn.
 * That keeps every rule here replayable from a log — see `gate.test.mjs` —
 * which matters because the live path (a real microphone, a real room) is the
 * one thing that cannot be exercised on a desk.
 *
 * The measure of speech is ACCUMULATED voicing, never a span of time.
 *
 * It used to be `lastVoice - startedAt`: the time from the first loud block to
 * the latest one. That is wrong in both directions. Two 8ms crackles of the
 * teacher's own residual echo 200ms apart span 200ms and passed as a word —
 * the phantom "¿Qué?" turns — while a real, unbroken 160ms syllable spans only
 * 152ms (its first block starts the clock) and was refused.
 *
 * What is summed instead is the voiced blocks inside a short sliding window.
 * Echo arrives at the teacher's syllable rate as sparse crackles and never
 * fills the window; a word does. Not a count of CONSECUTIVE blocks, which is
 * what model-driven detectors use: a peak detector drops below the bar inside
 * every word, at each stop consonant, so a strict run would reset mid-word and
 * a student could never be heard at all.
 */

/** Below this nothing is speech, however quiet the room. -40 dBFS. */
export const VAD_FLOOR_MIN = 0.01;
/** Speech has to stand this far above the room's own noise. */
export const VAD_MULTIPLE = 4;
/**
 * How far above the LEARNED echo the student has to be.
 *
 * Not a fraction of the speaker output: that is a guess about a room nobody
 * can see. The echo is measured instead — see {@link SpeechGate.echo}. A
 * headset drives it to nothing and barge-in stays easy; open speakers raise it
 * and the student has to genuinely out-talk the room.
 */
export const ECHO_MARGIN = 2.5;
/**
 * The echo estimate before anything has been heard.
 *
 * Starting from zero meant the first seconds of the first answer — right after
 * the student's "hello" — were judged against no echo at all, and the teacher's
 * opening words came straight back as a student turn. This is the top of the
 * residual measured in a failing session (mic 0.01–0.02 against output
 * 0.30–0.42), so the bar starts where that echo could not cross it and comes
 * down as this room is actually measured.
 */
export const ECHO_PRIOR = 0.02;
/**
 * Which quantile of the echo is tracked. A high one, not the mean: the mean of
 * a voice sits well below its peaks, and it is the peaks that cross the bar.
 */
const ECHO_QUANTILE = 0.9;
/**
 * Step of the quantile tracker, in natural-log units per block. Up by
 * `STEP * q` when the mic is above the estimate, down by `STEP * (1 - q)`
 * otherwise — so it climbs to a louder room within a few syllables and comes
 * down from {@link ECHO_PRIOR} over about two seconds. Small enough that the
 * few blocks of a real student before the teacher is held barely move it.
 */
const ECHO_STEP = 0.04;

/** The window voicing is summed over. */
export const ONSET_WINDOW_MS = 400;
/**
 * Voicing in the window before the teacher is held.
 *
 * Holding on the first loud block made every crackle of echo stop the voice for
 * the whole hang window — and a silent teacher makes no echo, so playback
 * resumed, echoed, and was held again. A real student reaches this within a
 * syllable; an isolated crackle never does.
 */
export const HOLD_VOICED_MS = 64;
/**
 * Voicing in the window before the server is told the student is speaking.
 *
 * Telling it ends the teacher's generation, so this is the bar that matters.
 * In line with what production stacks use to confirm speech (Pipecat and Vapi
 * both 200ms) — but as voiced time inside {@link ONSET_WINDOW_MS}, which a word
 * fills and scattered echo does not.
 */
export const MIN_VOICED_MS = 160;
/**
 * Silence that ends an utterance which never reached the server. Short: it was
 * judged not to be speech, and the teacher is waiting to carry on.
 */
export const REJECT_GAP_MS = 160;
/** Silence that ends an utterance the server has been told about. */
export const VAD_HANG_MS = 320;

export interface MicBlock {
  /** When the block arrived, ms. */
  now: number;
  /** Largest absolute sample in it, 0..1. */
  peak: number;
  /** How much audio it holds, ms. */
  ms: number;
  /** The teacher's voice may be reaching the microphone. */
  echoLive: boolean;
  /**
   * The speaker is playing right now, so what the microphone hears is the echo
   * — the one time it can be measured.
   */
  learnEcho: boolean;
}

export type GateEvent =
  /** First voiced block of an utterance. Nothing is decided yet. */
  | { type: 'onset'; peak: number; bar: number; overEcho: boolean }
  /** Enough voicing to stop the teacher while it is judged. */
  | { type: 'hold' }
  /** It is speech: tell the server. */
  | { type: 'commit'; voicedMs: number }
  /** It stopped before it was speech. Anything held should carry on. */
  | { type: 'reject'; voicedMs: number }
  /** A committed utterance is over. */
  | { type: 'end'; voicedMs: number };

export class SpeechGate {
  /** The room's own noise, tracked low. */
  floor = 0.02;
  /** What the teacher's voice comes back as through this room; 0 until heard. */
  echo = 0;
  /** An utterance is open — from its first voiced block until it ends. */
  speaking = false;
  /** The open utterance has been handed to the server. */
  committed = false;
  /** The open utterance asked for the teacher to be held. */
  holding = false;
  startedAt = 0;
  lastVoice = -Infinity;
  /** Voiced time in the current (or last) utterance. */
  voicedMs = 0;
  private voiced: { t: number; ms: number }[] = [];

  /** The bar a block has to clear. */
  bar(echoLive: boolean): number {
    const room = Math.max(VAD_FLOOR_MIN, this.floor * VAD_MULTIPLE);
    return echoLive ? Math.max(room, (this.echo || ECHO_PRIOR) * ECHO_MARGIN) : room;
  }

  /** Voiced time inside the window ending at `now`. */
  windowVoiced(now: number): number {
    while (this.voiced.length && this.voiced[0].t <= now - ONSET_WINDOW_MS) this.voiced.shift();
    let ms = 0;
    for (const v of this.voiced) ms += v.ms;
    return ms;
  }

  push(b: MicBlock): GateEvent[] {
    const events: GateEvent[] = [];
    this.floor =
      b.peak < this.floor ? this.floor * 0.9 + b.peak * 0.1 : this.floor * 0.9995 + b.peak * 0.0005;

    /**
     * Learn the echo only while the speaker is actually playing, and not once
     * this utterance has held the teacher or reached the server — past that
     * point the microphone may be hearing the student, and learning them as
     * echo would raise the bar against their own sentence.
     *
     * Loud blocks are NOT left out. Leaving out whatever crossed the bar is
     * how an estimate that starts too low stays too low: the echo that
     * crosses is exactly the echo it never gets to learn.
     */
    if (b.learnEcho && !this.holding && !this.committed) {
      if (!this.echo) this.echo = ECHO_PRIOR;
      const up = Math.log(Math.max(b.peak, 1e-5)) > Math.log(this.echo);
      this.echo *= Math.exp(up ? ECHO_STEP * ECHO_QUANTILE : -ECHO_STEP * (1 - ECHO_QUANTILE));
    }

    const bar = this.bar(b.echoLive);
    const isVoiced = b.peak > bar;
    if (isVoiced) {
      this.voiced.push({ t: b.now, ms: b.ms });
      this.lastVoice = b.now;
    }
    const inWindow = this.windowVoiced(b.now);

    if (isVoiced) {
      if (!this.speaking) {
        this.speaking = true;
        this.committed = false;
        this.holding = false;
        this.startedAt = b.now;
        this.voicedMs = 0;
        events.push({ type: 'onset', peak: b.peak, bar, overEcho: b.echoLive });
      }
      this.voicedMs += b.ms;
      if (!this.holding && inWindow >= HOLD_VOICED_MS) {
        this.holding = true;
        events.push({ type: 'hold' });
      }
      if (!this.committed && inWindow >= MIN_VOICED_MS) {
        this.committed = true;
        // Voicing from just before the onset still counts toward the word it
        // belongs to, so a commit never reports less than it took.
        this.voicedMs = Math.max(this.voicedMs, inWindow);
        events.push({ type: 'commit', voicedMs: this.voicedMs });
      }
    } else if (this.speaking) {
      const gap = b.now - this.lastVoice;
      if (!this.committed && gap > REJECT_GAP_MS) {
        this.speaking = false;
        this.holding = false;
        events.push({ type: 'reject', voicedMs: this.voicedMs });
      } else if (this.committed && gap > VAD_HANG_MS) {
        this.speaking = false;
        this.committed = false;
        this.holding = false;
        events.push({ type: 'end', voicedMs: this.voicedMs });
      }
    }
    return events;
  }
}
