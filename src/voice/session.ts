/**
 * VoiceSession — the boundary between "how speech gets here" and everything
 * that reacts to it.
 *
 * The board, the tool dispatcher and the op scheduler must never learn which
 * vendor is behind this. Gemini Live is the chosen transport, but the fallback
 * if it fails M1's sync test is a cascade (STT -> text LLM with inline op tags
 * -> TTS with word timestamps), which is three services rather than one socket.
 * Keeping that behind this interface makes the swap a swap instead of a
 * rewrite, and it is why the spike is worth running before anything is built
 * on top.
 *
 * The events deliberately expose AUDIO POSITION, not wall-clock time. The
 * server generates faster than realtime, so a tool call arrives before the
 * words it belongs to are heard. Every consumer schedules against
 * `samplesReceived` / `samplesPlayed`, never against arrival.
 */

export interface ToolCall {
  /** Vendor id, echoed back with the response. */
  callId: string;
  name: string;
  args: Record<string, unknown>;
  /**
   * Total output samples received from the server when this call arrived.
   * The op's anchor: it fires when playback reaches this position.
   */
  anchorSamples: number;
  /** Samples actually played at that moment — the two differ by the lead. */
  playedSamples: number;
  /** Wall clock, for logging only. Never for scheduling. */
  at: number;
}

export interface TurnEvent {
  /** Output samples received when the turn began / ended. */
  atSamples: number;
  at: number;
}

export interface TranscriptChunk {
  text: string;
  role: 'user' | 'model';
  at: number;
}

export type SessionState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'closed'
  | 'error';

/**
 * A raw server-message trace, in arrival order.
 *
 * "During speech" vs "between turns" is a conclusion; this is the evidence.
 * Seeing `audio audio audio | toolCall | audio audio | turnComplete` versus
 * `audio... turnComplete | toolCall` is the difference between a teacher and
 * a slideshow, and only the ordering shows which one is happening.
 */
export interface WireEvent {
  kind: 'audio' | 'toolCall' | 'turnComplete' | 'generationComplete' | 'interrupted' | 'transcript';
  at: number;
  /** Cumulative output samples received when this arrived. */
  samples: number;
  detail?: string;
}

export interface VoiceSessionEvents {
  state(s: SessionState, detail?: string): void;
  /** Every server message, unfiltered, for the M1 ordering question. */
  wire(e: WireEvent): void;
  /** A chunk of the teacher's voice. Already queued for playback. */
  audio(chunk: Int16Array, streamPos: number): void;
  toolCall(call: ToolCall): void;
  /** Vendor cancelled in-flight calls after an interruption. */
  toolCancel(callIds: string[]): void;
  turnStart(e: TurnEvent): void;
  turnEnd(e: TurnEvent): void;
  /** The server confirmed the student cut in. */
  interrupted(e: TurnEvent): void;
  transcript(c: TranscriptChunk): void;
  error(message: string): void;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  /** Flat, string-valued properties: realtime models call these far more reliably. */
  parameters: Record<string, { type: 'string'; description: string }>;
  required?: string[];
  /**
   * Blocking stops generation until the result is back — right for `calc`,
   * where the model must not voice a number it has not been handed, and wrong
   * for board ops, where it must keep talking.
   *
   * gemini-3.8-live flipped the default to NON_BLOCKING, so this is set
   * explicitly on every declaration rather than inherited.
   */
  blocking?: boolean;
}

export interface SessionConfig {
  model: string;
  systemInstruction: string;
  tools: ToolDeclaration[];
  /**
   * Server VAD silence before end-of-turn. The default (~800ms) is the entire
   * sub-800ms latency budget on its own, so it is the first thing to tune.
   */
  silenceDurationMs?: number;
  /** Drive turn boundaries from our own VAD instead of the server's. */
  manualActivity?: boolean;
}

export interface VoiceSession {
  connect(): Promise<void>;
  close(): void;
  /** Mic audio, 16-bit PCM at 16 kHz. */
  sendAudio(pcm: Int16Array): void;
  /** Manual activity mode only. */
  activityStart(): void;
  activityEnd(): void;
  /**
   * `resume` matters and is easy to get catastrophically wrong.
   *
   * A BLOCKING tool has stopped generation to wait. Answering it with SILENT
   * scheduling — "add to context, do not trigger generation" — leaves the
   * model stranded mid-lesson, waiting forever for a permission that never
   * comes. Blocking tools must resume; board ops must not, or the teacher
   * starts a fresh turn every time its own chalk lands.
   */
  sendToolResponse(
    callId: string,
    name: string,
    response: Record<string, unknown>,
    resume?: boolean,
  ): void;
  /** Inject text without asking for a reply — board summaries, nudges. */
  sendContext(text: string): void;
  /**
   * Force a turn. Unlike sendContext this DOES demand generation, so it is the
   * only way to restart a model that has gone quiet holding a blocking tool
   * result. Use sparingly: it interrupts if anything is still generating.
   */
  nudge(text: string): void;
  readonly state: SessionState;
}
