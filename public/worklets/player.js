/**
 * Playback of the model's 24 kHz PCM, and the master clock for the whole
 * board-sync design.
 *
 * `samplesPlayed` is the only honest measure of how far into the teacher's
 * speech we actually are. The server generates faster than realtime and sends
 * `toolCall` on its own message, so a board op that fires when its message
 * ARRIVES lands ahead of the words it belongs to. Ops are therefore scheduled
 * against this counter, never against arrival time.
 *
 * Two separate stop behaviours, and the difference matters:
 *   hold()  — stop consuming but keep the queue. The student may have coughed;
 *             if no interruption is confirmed we resume and nothing is lost.
 *   flush() — drop everything. The interruption was real.
 */
class PlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.cur = null;
    this.off = 0;
    this.played = 0;
    this.received = 0;
    this.held = false;
    this.gain = 1;
    this.tick = 0;
    /** Smoothed output loudness 0..1 — the teacher's voice. */
    this.level = 0;
    /** Loudest raw sample since the last clock message. Not smoothed. */
    this.peak = 0;

    this.port.onmessage = (e) => {
      const m = e.data;
      switch (m.type) {
        case 'push':
          this.queue.push(new Int16Array(m.pcm));
          this.received += m.pcm.length;
          break;
        case 'hold':
          this.held = true;
          break;
        case 'resume':
          this.held = false;
          break;
        case 'flush':
          this.queue = [];
          this.cur = null;
          this.off = 0;
          this.held = false;
          this.level = 0;
          break;
        case 'gain':
          this.gain = m.value;
          break;
      }
    };
  }

  queued() {
    let n = this.cur ? this.cur.length - this.off : 0;
    for (const b of this.queue) n += b.length;
    return n;
  }

  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;

    // The teacher's own loudness, block by block. This is the only place it is
    // knowable, and the presence needs it: the aurora stands for the teacher,
    // so it should surge with ITS voice, not sit at a constant brightness
    // while only reacting to the student's microphone.
    let peak = 0;
    for (let i = 0; i < out.length; i++) {
      if (this.held) {
        out[i] = 0;
        continue;
      }
      if (!this.cur || this.off >= this.cur.length) {
        this.cur = this.queue.shift() || null;
        this.off = 0;
      }
      if (!this.cur) {
        out[i] = 0;
        continue;
      }
      const v = (this.cur[this.off++] / 32768) * this.gain;
      out[i] = v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      this.played++;
    }
    // An envelope, not a level meter. A block is ~5.3ms at 24kHz.
    //
    // Fast up, slow down. Smoothing both directions equally is calm but
    // sluggish — the swell arrives after the syllable. ~30ms rise keeps it on
    // the voice; ~440ms fall keeps it from flickering between syllables.
    const ATTACK = 0.18;
    const RELEASE = 0.012;
    const k = peak > this.level ? ATTACK : RELEASE;
    this.level += (peak - this.level) * k;
    if (peak > this.peak) this.peak = peak;

    // ~every 10ms at 24kHz. Often enough to schedule ops against, cheap
    // enough not to flood the main thread.
    //
    // `level` is for the eye and `peak` is for the echo guard, and they must
    // not be swapped. The envelope takes over a second to fall after the voice
    // stops; the echo in the room stops at once. Judging the echo by the
    // envelope counted every pause in the teacher's speech as more echo, so
    // the bar sagged exactly when the teacher was about to start again.
    if (++this.tick % 2 === 0) {
      this.port.postMessage({
        type: 'clock',
        played: this.played,
        received: this.received,
        queued: this.queued(),
        level: this.level,
        peak: this.peak,
      });
      this.peak = 0;
    }
    return true;
  }
}

registerProcessor('player', PlayerProcessor);
