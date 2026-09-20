/**
 * Telling "I'm following you" apart from "stop, I have a question".
 *
 * A Hinglish student says "haan", "hmm", "accha", "theek hai" constantly while
 * a teacher explains. That is backchannelling — the audible form of nodding —
 * and treating it as a barge-in is a real pedagogy bug: the teacher stops dead
 * every time the student agrees with it, the pen freezes mid-word, and queued
 * board ops are discarded.
 *
 * Practitioner runbooks test exactly this ("yes, okay, uh-huh, mm-hmm while the
 * agent is speaking") and the expected behaviour is that such utterances do not
 * cancel audio. The named failure is "agent stops, then forgets what it already
 * said" — which benchmarks of post-interruption recovery show frontier models
 * are unreliable at repairing on their own. Far better not to break the turn.
 *
 * Two signals, because neither alone is safe:
 *   - duration: a real question is rarely under ~700ms
 *   - words: the transcript, when it has arrived in time
 *
 * Ambiguity resolves toward "real interruption": wrongly ignoring a question is
 * much worse than wrongly pausing for a nod.
 */

/** Acknowledgement tokens, Hinglish and English. */
const TOKENS = new Set([
  'haan', 'ha', 'han', 'hmm', 'hm', 'mhm', 'mm', 'accha', 'acha', 'achha',
  'ji', 'jee', 'ok', 'okay', 'okey', 'theek', 'thik', 'sahi', 'right',
  'yeah', 'yes', 'yep', 'yup', 'uh', 'huh', 'uhhuh', 'mmhmm', 'samjha',
  'samjhi', 'bilkul', 'haanji', 'sir', 'oh',
  // Particles that only ever appear here as part of a two-word nod
  // ("theek hai", "sahi hai"). Safe because a match needs EVERY word to be an
  // acknowledgement and at most three of them.
  'hai', 'ho', 'na', 'chalo', 'aage', 'gaya', 'gayi',
]);

/** Below this, an utterance is too short to be a question. */
export const BACKCHANNEL_MAX_MS = 700;

export interface BackchannelCheck {
  isBackchannel: boolean;
  /**
   * Which evidence decided it. A verdict from the transcript is worth far more
   * than one from the clock: "haan" reaching us as the word "haan" is proof,
   * whereas a short DURATION is equally consistent with a real question whose
   * audio arrived in pieces.
   */
  via: 'transcript' | 'duration' | 'silence';
  /**
   * The server flagged an interruption but this microphone never heard the
   * student at all. Almost always the server's VAD reacting to room noise or
   * to the teacher's own voice leaking back in without headphones.
   *
   * This must not be treated as a real barge-in. Doing so flushes the audio
   * queue, and since generation runs 5–13s ahead of playback, flushing throws
   * away most of a turn — the symptom is a teacher you cannot hear at all.
   */
  spurious: boolean;
  reason: string;
}

/**
 * Called once the utterance is OVER, which is the only moment both signals
 * exist: the full duration, and the transcript if it has arrived.
 *
 * It used to be called the instant the server announced an interruption —
 * about a quarter of a second into the student's first word. At that point the
 * duration is always under {@link BACKCHANNEL_MAX_MS} and the transcript is
 * always empty, so every barge-in came back "backchannel" and the teacher
 * resumed the sentence the student had just cut into.
 */
export function classifyInterruption(
  durationMs: number,
  transcript?: string,
): BackchannelCheck {
  // No local speech at all: this microphone never heard the student, so there
  // is nothing to interrupt for. Ignore it rather than discarding the turn.
  if (durationMs <= 0 && !transcript?.trim()) {
    return { isBackchannel: false, spurious: true, via: 'silence', reason: 'no local speech' };
  }

  const words = (transcript ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean);

  // A transcript we actually have beats any duration heuristic.
  if (words.length > 0) {
    if (words.length > 3) {
      return { isBackchannel: false, spurious: false, via: 'transcript', reason: `${words.length} words` };
    }
    const allAck = words.every((w) => TOKENS.has(w));
    return allAck
      ? { isBackchannel: true, spurious: false, via: 'transcript', reason: `acknowledgement: "${words.join(' ')}"` }
      : { isBackchannel: false, spurious: false, via: 'transcript', reason: `"${words.join(' ')}"` };
  }

  if (durationMs < BACKCHANNEL_MAX_MS) {
    return { isBackchannel: true, spurious: false, via: 'duration', reason: `${Math.round(durationMs)}ms utterance` };
  }
  return { isBackchannel: false, spurious: false, via: 'duration', reason: `${Math.round(durationMs)}ms utterance` };
}
