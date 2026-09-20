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
  /** Output samples played through the speakers. */
  played: number;
  /** Smoothed loudness of the teacher's own voice, 0..1. */
  level: number;
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

  clock: ClockState = { played: 0, received: 0, queued: 0, level: 0 };
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
        autoGainControl: true,
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
