/**
 * M1's measurements — the go/no-go for the whole architecture.
 *
 * The thresholds are deliberately stricter than "usually fine", because the
 * deliverable is a single unbroken take. An op that lands during speech 70% of
 * the time gives a clean run of ~25 ops essentially never (0.7^25). So the bar
 * is per-op, not per-session.
 *
 * | metric            | pass                  | why                          |
 * |-------------------|-----------------------|------------------------------|
 * | TTFA p80          | <= 800 ms             | above ~1.2s it reads machine |
 * | ops during speech | >= 95%                | one bad op ruins a take      |
 * | tool-call lead    | measured, not assumed | decides the anchor model     |
 * | audio gap per op  | <= 250 ms             | tool args cost silence       |
 * | LaTeX corruption  | 0                     | \theta -> TAB+"heta"         |
 * | duplicate calls   | reported              | Google advise filtering      |
 */
import { AudioIO } from './audio';
import type { ToolCall } from './session';

export interface TurnSample {
  /** Local end-of-speech -> first sample of the reply actually played. */
  ttfaMs: number;
}

export interface CallSample {
  name: string;
  /** Output samples between arrival and where playback was. */
  leadSamples: number;
  leadMs: number;
  /** Was the teacher mid-utterance when this landed? */
  duringSpeech: boolean;
  /** Position within the turn, to test whether lead drifts as a turn runs on. */
  turnPositionMs: number;
  /** Any control character that JSON unescaping turned a TeX macro into. */
  latexCorrupted: boolean;
  raw: string;
}

/** JSON unescaping turns \t \f \r \n \b into control characters, so a model
 *  emitting \theta, \frac, \rho, \nu or \beta can deliver TAB + "heta". */
const CONTROL_CHARS = /[\u0008\u0009\u000a\u000c\u000d]/;

export function looksCorrupted(args: Record<string, unknown>): boolean {
  return Object.values(args).some(
    (v) => typeof v === 'string' && CONTROL_CHARS.test(v),
  );
}

export class Metrics {
  turns: TurnSample[] = [];
  calls: CallSample[] = [];
  duplicates = 0;
  interruptions: { holdMs: number; serverMs: number }[] = [];

  /**
   * Times the model SPOKE a tool call instead of invoking it.
   *
   * Observed live: the transcript carried `write(id:"ux", content:"...")`
   * mid-sentence, placed exactly where the chalk should have moved. The model
   * had the timing right and the mechanism wrong — worth counting separately,
   * because it means the rhythm is achievable and only the invocation failed.
   */
  narratedCalls = 0;
  /** Utterances the model never answered, or answered too late to attribute. */
  unanswered = 0;
  /** Blips below MIN_UTTERANCE_MS, ignored rather than timed. */
  vadMisfires = 0;

  private pendingTtfa: number | null = null;
  private lastPlayed = 0;
  private turnStartAt = 0;

  /** Shorter than this is a cough, a keystroke or a chair — not a turn. */
  static MIN_UTTERANCE_MS = 250;
  /** Past this, the audio is not a reply to that utterance. */
  static TTFA_TIMEOUT_MS = 8000;

  /**
   * Local VAD says the student stopped. The TTFA clock starts here.
   *
   * Takes the utterance length because a naive level-gate fires on every
   * noise, and attributing the next reply to a chair creak produced a
   * 13.5-second "TTFA" that was pure measurement error.
   */
  markEndOfSpeech(utteranceMs: number) {
    if (utteranceMs < Metrics.MIN_UTTERANCE_MS) {
      this.vadMisfires++;
      return;
    }
    // A previous utterance that never got answered should not be silently
    // reassigned to this reply.
    if (this.pendingTtfa !== null) this.unanswered++;
    this.pendingTtfa = performance.now();
  }

  /** First sample of the reply reached the speakers. */
  markFirstAudio(played: number) {
    if (this.pendingTtfa === null) return;
    if (played <= this.lastPlayed) return;
    const dt = performance.now() - this.pendingTtfa;
    this.pendingTtfa = null;
    this.lastPlayed = played;
    this.turnStartAt = performance.now();
    if (dt > Metrics.TTFA_TIMEOUT_MS) {
      this.unanswered++;
      return;
    }
    this.turns.push({ ttfaMs: dt });
  }

  recordCall(c: ToolCall, speaking: boolean) {
    const lead = c.anchorSamples - c.playedSamples;
    this.calls.push({
      name: c.name,
      leadSamples: lead,
      leadMs: AudioIO.samplesToMs(lead),
      duringSpeech: speaking,
      turnPositionMs: this.turnStartAt ? c.at - this.turnStartAt : 0,
      latexCorrupted: looksCorrupted(c.args),
      raw: JSON.stringify(c.args).slice(0, 160),
    });
  }

  recordInterruption(holdMs: number, serverMs: number) {
    this.interruptions.push({ holdMs, serverMs });
  }

  private static pct(xs: number[], p: number) {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
  }

  /**
   * Does the lead grow as a turn runs on? A constant offset can be corrected
   * with a fixed bias; a slope means the server paces audio while sending tool
   * calls unpaced, and anchoring has to switch to a transcript-rate estimate.
   */
  leadSlope(): number {
    const pts = this.calls.filter((c) => c.turnPositionMs > 0);
    if (pts.length < 4) return 0;
    const n = pts.length;
    const mx = pts.reduce((a, c) => a + c.turnPositionMs, 0) / n;
    const my = pts.reduce((a, c) => a + c.leadMs, 0) / n;
    let num = 0;
    let den = 0;
    for (const c of pts) {
      num += (c.turnPositionMs - mx) * (c.leadMs - my);
      den += (c.turnPositionMs - mx) ** 2;
    }
    return den === 0 ? 0 : num / den;
  }

  report() {
    const ttfa = this.turns.map((t) => t.ttfaMs);
    const during = this.calls.filter((c) => c.duringSpeech).length;
    const corrupted = this.calls.filter((c) => c.latexCorrupted).length;
    const holds = this.interruptions.map((i) => i.holdMs);

    const ttfaP80 = Metrics.pct(ttfa, 0.8);
    const duringPct = this.calls.length ? (during / this.calls.length) * 100 : 0;

    return {
      turns: this.turns.length,
      ttfaP50: Math.round(Metrics.pct(ttfa, 0.5)),
      ttfaP80: Math.round(ttfaP80),
      ttfaMax: Math.round(Math.max(0, ...ttfa)),
      calls: this.calls.length,
      duringSpeechPct: Math.round(duringPct),
      leadMsP50: Math.round(Metrics.pct(this.calls.map((c) => c.leadMs), 0.5)),
      leadMsMax: Math.round(Math.max(0, ...this.calls.map((c) => c.leadMs))),
      leadSlope: +this.leadSlope().toFixed(3),
      latexCorrupted: corrupted,
      duplicatesDropped: this.duplicates,
      unansweredTurns: this.unanswered,
      narratedCalls: this.narratedCalls,
      vadMisfires: this.vadMisfires,
      callsPerTurn: this.turns.length
        ? +(this.calls.length / this.turns.length).toFixed(2)
        : 0,
      holdMsP50: Math.round(Metrics.pct(holds, 0.5)),
      verdict: {
        ttfa: ttfa.length >= 5 ? (ttfaP80 <= 800 ? 'PASS' : 'FAIL') : 'need >=5 turns',
        opsDuringSpeech:
          this.calls.length >= 10
            ? duringPct >= 95
              ? 'PASS'
              : 'FAIL'
            : 'need >=10 calls',
        latex: this.calls.length ? (corrupted === 0 ? 'PASS' : 'FAIL') : '-',
      },
    };
  }

  toJSON() {
    return JSON.stringify(
      { report: this.report(), turns: this.turns, calls: this.calls },
      null,
      2,
    );
  }
}
