/**
 * Mic capture: Float32 -> 16-bit PCM, the format the Live API wants.
 *
 * Plain JS in public/ on purpose. Turbopack's worker bundling covers
 * `new Worker()`, not `audioWorklet.addModule`, so this file is served as-is.
 *
 * The AudioContext that loads this is created at 16 kHz, so there is no
 * resampling to do here — the graph runs at the wire rate.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.muted = false;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'mute') this.muted = !!e.data.value;
    };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || this.muted) return true;

    const pcm = new Int16Array(ch.length);
    let peak = 0;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      const a = s < 0 ? -s : s;
      if (a > peak) peak = a;
    }
    // Transfer rather than copy; this runs every 128 frames.
    this.port.postMessage({ type: 'pcm', pcm, peak }, [pcm.buffer]);
    return true;
  }
}

registerProcessor('capture', CaptureProcessor);
