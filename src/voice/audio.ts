/**
 * Mic in, teacher out.
 *
 * Two AudioContexts on purpose: capture runs at 16 kHz and playback at 24 kHz,
 * which are the Live API's wire rates in each direction. Letting each graph
 * run natively avoids resampling entirely.
 *
 * The player's sample counter is the master clock for board scheduling, so it
 * is surfaced here as plain numbers rather than hidden inside the worklet.
 */
const INPUT_RATE = 16_000;
const OUTPUT_RATE = 24_000;

export interface ClockState {
  /**
   * How far playback has got through everything the server sent, in output
   * samples — played, or thrown away by a flush. Every board op is anchored in
   * this space.
   */
  played: number;
  /** Smoothed loudness of the teacher's own voice, 0..1 — for display. */
  level: number;
  /**
   * Loudest sample played since the last update, unsmoothed — whether the
   * speaker is making a sound right now. The echo guard needs this and not
   * `level`, which lags the voice by over a second on the way down.
   */
  peak: number;
  /** Output samples handed to the player. */
  received: number;
  /** Still waiting to be heard. */
  queued: number;
}

export class AudioIO {
  private inCtx: AudioContext | null = null;
  private outCtx: AudioContext | null = null;
  private capture: AudioWorkletNode | null = null;
  private player: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;

  clock: ClockState = { played: 0, received: 0, queued: 0, level: 0, peak: 0 };
  /** Set when the browser refused to start audio. Surfaced, never swallowed. */
  blocked = false;
  /** Mic level 0..1, for the orb and for local VAD. */
  peak = 0;

  onPcm: ((pcm: Int16Array, peak: number) => void) | null = null;
  onClock: ((c: ClockState) => void) | null = null;

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        /**
         * OFF, deliberately.
         *
         * Automatic gain hunts for signal when the room is quiet — which is
         * exactly the state this app is in whenever the teacher is the one
         * talking. It ramps the microphone up until the residual echo that
         * cancellation could not remove is loud enough to look like speech,
         * and the teacher's own voice gets committed as the student's: the
         * symptom is a Hinglish lesson sprouting "¿Qué?" every time the
         * teacher pauses.
         *
         * It also breaks the only defence against that. The echo guard
         * compares what the microphone hears against what the speakers are
         * playing, and that comparison means nothing if the microphone's gain
         * is being rescaled underneath it.
         */
        autoGainControl: false,
        channelCount: 1,
      },
    });

    this.inCtx = new AudioContext({ sampleRate: INPUT_RATE });
    await this.inCtx.audioWorklet.addModule('/worklets/capture.js');
    const src = this.inCtx.createMediaStreamSource(this.stream);
    this.capture = new AudioWorkletNode(this.inCtx, 'capture');
    this.capture.port.onmessage = (e) => {
      const m = e.data;
      if (m?.type !== 'pcm') return;
      this.peak = m.peak;
      this.onPcm?.(m.pcm as Int16Array, m.peak as number);
    };
    src.connect(this.capture);
    // A worklet with no downstream connection is not guaranteed to be pulled.
    const sink = this.inCtx.createGain();
    sink.gain.value = 0;
    this.capture.connect(sink).connect(this.inCtx.destination);

    this.outCtx = new AudioContext({ sampleRate: OUTPUT_RATE });
    await this.outCtx.audioWorklet.addModule('/worklets/player.js');
    this.player = new AudioWorkletNode(this.outCtx, 'player');
    this.player.port.onmessage = (e) => {
      const m = e.data;
      if (m?.type !== 'clock') return;
      this.clock = {
        played: m.played,
        received: m.received,
        queued: m.queued,
        level: m.level ?? 0,
        peak: m.peak ?? 0,
      };
      this.onClock?.(this.clock);
    };
    this.player.connect(this.outCtx.destination);

    /**
     * Chrome creates an AudioContext suspended unless construction happens
     * inside a user gesture — and `start()` is reached only after awaiting
     * dynamic imports, which ends the gesture. A suspended output context is
     * silent with no error anywhere: the queue fills, `played` never advances.
     * The page has had a click by now, so resuming is permitted.
     */
    await Promise.all([this.inCtx.resume(), this.outCtx.resume()]).catch(() => {});
    this.blocked = this.outCtx.state !== 'running';
  }

  /** For diagnostics: is audio actually able to come out? */
  get outputState(): string {
    return this.outCtx?.state ?? 'none';
  }

  /**
   * From the player to the speaker, ms, as the browser reports it. Bluetooth
   * speakers can add a fifth of a second here, and the echo arrives that much
   * later, so the echo guard has to wait that much longer for it to clear.
   */
  get outputLatencyMs(): number {
    const c = this.outCtx;
    if (!c) return 0;
    return ((c.outputLatency || 0) + (c.baseLatency || 0)) * 1000;
  }

  /** What the browser actually applied to the microphone, which is not always what was asked. */
  micSettings(): MediaTrackSettings | null {
    return this.stream?.getAudioTracks()[0]?.getSettings() ?? null;
  }

  /** Queue a chunk of the teacher's voice. */
  push(pcm: Int16Array) {
    this.player?.port.postMessage({ type: 'push', pcm }, [pcm.buffer]);
  }

  /** Stop consuming but keep the queue — the student may only have coughed. */
  hold() {
    this.player?.port.postMessage({ type: 'hold' });
  }

  /** It was a false alarm; carry on where we left off. */
  resume() {
    this.player?.port.postMessage({ type: 'resume' });
  }

  /** The interruption was real. Drop everything still unheard. */
  flush() {
    this.player?.port.postMessage({ type: 'flush' });
  }

  setGain(v: number) {
    this.player?.port.postMessage({ type: 'gain', value: v });
  }

  muteMic(v: boolean) {
    this.capture?.port.postMessage({ type: 'mute', value: v });
  }

  /** Output samples -> milliseconds of speech. */
  static samplesToMs(n: number) {
    return (n / OUTPUT_RATE) * 1000;
  }

  async stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.inCtx?.close();
    await this.outCtx?.close();
    this.inCtx = this.outCtx = null;
    this.capture = this.player = null;
    this.stream = null;
  }
}

export { INPUT_RATE, OUTPUT_RATE };
