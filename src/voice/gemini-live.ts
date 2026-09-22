/**
 * Gemini Live transport.
 *
 * Implements {@link VoiceSession} over `ai.live.connect`. Everything here is
 * shaped by four findings that cost real debugging time elsewhere:
 *
 * 1. **`toolCall` is its own top-level server message**, not a part inside
 *    `serverContent`. That is what makes a call mid-spoken-sentence possible
 *    at all — and it arrives BEFORE the audio of the words around it, because
 *    the server generates faster than it speaks. So every call is stamped with
 *    the output-sample position at arrival and scheduled against playback.
 *
 * 2. **Never close or flush the audio pipeline on `toolCall`.** It precedes
 *    the turn's final audio chunks; doing so clips the sentence mid-syllable.
 *    Reported against both LiveKit and Pipecat.
 *
 * 3. **gemini-3.8-live made function calling NON_BLOCKING by default**, so
 *    `behavior` is set explicitly on every declaration rather than inherited.
 *
 * 4. **The client owns the flush on interruption.** The server only discards
 *    what it has not sent; whatever is already queued here keeps playing
 *    unless we drop it.
 */
import { GoogleGenAI, Behavior, FunctionResponseScheduling } from '@google/genai';
import type { LiveServerMessage, Session } from '@google/genai';

import type {
  SessionConfig,
  SessionState,
  ToolDeclaration,
  VoiceSession,
  VoiceSessionEvents,
} from './session';

const OUTPUT_RATE = 24_000;

function decodeBase64ToPCM(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
}

function encodePCMToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function toFunctionDeclarations(tools: ToolDeclaration[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    behavior: t.blocking ? Behavior.BLOCKING : Behavior.NON_BLOCKING,
    parametersJsonSchema: {
      type: 'object',
      properties: t.parameters,
      required: t.required ?? [],
    },
  }));
}

export class GeminiLiveSession implements VoiceSession {
  private session: Session | null = null;
  private _state: SessionState = 'idle';
  /** Total output samples received. The anchor space for board ops. */
  private received = 0;
  private seenCalls = new Map<string, number>();
  /** We closed it ourselves — the student ended the lesson. */
  private closing = false;

  constructor(
    private cfg: SessionConfig,
    private events: Partial<VoiceSessionEvents>,
    /** Output samples actually played, from the player worklet. */
    private getPlayed: () => number,
  ) {}

  get state() {
    return this._state;
  }

  private setState(s: SessionState, detail?: string) {
    this._state = s;
    this.events.state?.(s, detail);
  }

  async connect() {
    this.setState('connecting');

    const res = await fetch('/api/token', { method: 'POST' });
    const body = (await res.json()) as { token?: string; error?: string };
    if (!res.ok || !body.token) {
      this.setState('error', body.error ?? 'token request failed');
      this.events.error?.(body.error ?? 'token request failed');
      return;
    }

    // Ephemeral tokens are v1alpha-only, on the client as well as the mint.
    const ai = new GoogleGenAI({
      apiKey: body.token,
      httpOptions: { apiVersion: 'v1alpha' },
    });

    this.session = await ai.live.connect({
      model: this.cfg.model,
      config: {
        responseModalities: ['AUDIO' as never],
        systemInstruction: this.cfg.systemInstruction,
        tools: [{ functionDeclarations: toFunctionDeclarations(this.cfg.tools) }],
        outputAudioTranscription: {},
        inputAudioTranscription: {
          ...(this.cfg.inputLanguages?.length ? { languageCodes: this.cfg.inputLanguages } : {}),
          ...(this.cfg.inputVocabulary?.length ? { customVocabulary: this.cfg.inputVocabulary } : {}),
        },
        realtimeInputConfig: this.cfg.manualActivity
          ? { automaticActivityDetection: { disabled: true } }
          : {
              automaticActivityDetection: {
                // The ~800ms default is the whole latency budget by itself.
                silenceDurationMs: this.cfg.silenceDurationMs ?? 350,
                prefixPaddingMs: 20,
              },
            },
        // Removes the 15-minute cap; the ~10-minute connection lifetime is a
        // separate limit handled via goAway.
        contextWindowCompression: { slidingWindow: {} },
      },
      callbacks: {
        onopen: () => this.setState('listening'),
        onmessage: (m: LiveServerMessage) => this.onMessage(m),
        onerror: (e: ErrorEvent) => {
          this.setState('error', e.message);
          this.events.error?.(e.message);
        },
        /**
         * Say why, when it was not us. The server ends sessions for reasons a
         * student needs to hear — "Your project has exceeded its monthly
         * spending cap" arrives as close code 1011 — and dropping the reason
         * left a lesson that simply stopped, or sat on "thinking" for ever.
         */
        onclose: (e: CloseEvent) => {
          if (!this.closing) {
            this.events.error?.(`the connection closed (${e.code}${e.reason ? `: ${e.reason}` : ''})`);
          }
          this.setState('closed', e.reason || undefined);
        },
      },
    });
  }

  private trace(
    kind: 'audio' | 'toolCall' | 'turnComplete' | 'generationComplete' | 'interrupted' | 'transcript',
    detail?: string,
  ) {
    this.events.wire?.({ kind, at: performance.now(), samples: this.received, detail });
  }

  private onMessage(m: LiveServerMessage) {
    const sc = m.serverContent;

    /**
     * Where this message's audio begins — captured BEFORE the loop below
     * advances the counter.
     *
     * An output transcript describes the audio in the same message, but it is
     * parsed after it, by which time `received` has already moved past the
     * words it names. Stamping there would place every chunk later than it is
     * and claim the student heard words they never did, which is the exact
     * failure the position exists to prevent. Under-claim, always.
     */
    const startedAt = this.received;

    if (sc?.generationComplete) {
      this.trace('generationComplete');
      this.events.generationEnd?.({ atSamples: this.received, at: performance.now() });
    }

    if (sc?.modelTurn?.parts) {
      for (const part of sc.modelTurn.parts) {
        const data = part.inlineData?.data;
        if (!data) continue;
        const pcm = decodeBase64ToPCM(data);
        const pos = this.received;
        this.received += pcm.length;
        if (this._state !== 'speaking') {
          this.setState('speaking');
          this.events.turnStart?.({ atSamples: pos, at: performance.now() });
        }
        this.trace('audio', `${pcm.length} samples`);
        this.events.audio?.(pcm, pos);
      }
    }

    if (sc?.outputTranscription?.text) {
      this.events.transcript?.({
        text: sc.outputTranscription.text,
        role: 'model',
        at: performance.now(),
        atSamples: startedAt,
      });
    }
    if (sc?.inputTranscription?.text) {
      this.events.transcript?.({
        text: sc.inputTranscription.text,
        role: 'user',
        at: performance.now(),
        atSamples: startedAt,
      });
    }

    // The client owns the flush; the server only drops what it has not sent.
    if (sc?.interrupted) {
      this.trace('interrupted');
      this.events.interrupted?.({
        atSamples: this.getPlayed(),
        at: performance.now(),
      });
    }

    if (sc?.turnComplete) {
      this.trace('turnComplete');
      this.setState('listening');
      this.events.turnEnd?.({ atSamples: this.received, at: performance.now() });
    }

    // Separate top-level message — this is the one that can land mid-sentence.
    if (m.toolCall?.functionCalls) {
      for (const fc of m.toolCall.functionCalls) {
        const name = fc.name ?? '';
        const args = (fc.args ?? {}) as Record<string, unknown>;
        // Google's own notes recommend client-side duplicate filtering.
        const key = `${name}:${JSON.stringify(args)}`;
        const last = this.seenCalls.get(key) ?? -Infinity;
        const now = performance.now();
        if (now - last < 2000) continue;
        this.seenCalls.set(key, now);

        this.trace('toolCall', name);
        this.events.toolCall?.({
          callId: fc.id ?? `${name}-${now}`,
          name,
          args,
          anchorSamples: this.received,
          playedSamples: this.getPlayed(),
          at: now,
        });
      }
    }

    if (m.toolCallCancellation?.ids?.length) {
      this.events.toolCancel?.(m.toolCallCancellation.ids);
    }

    if (m.goAway) {
      this.events.error?.(
        `goAway: connection closing in ${m.goAway.timeLeft ?? '?'} — session resumption needed`,
      );
    }
  }

  sendAudio(pcm: Int16Array) {
    if (!this.session) return;
    this.session.sendRealtimeInput({
      audio: { data: encodePCMToBase64(pcm), mimeType: 'audio/pcm;rate=16000' },
    });
  }

  activityStart() {
    this.session?.sendRealtimeInput({ activityStart: {} });
  }

  activityEnd() {
    this.session?.sendRealtimeInput({ activityEnd: {} });
  }

  sendToolResponse(
    callId: string,
    name: string,
    response: Record<string, unknown>,
    resume = false,
    image?: { mimeType: string; data: string },
  ) {
    this.session?.sendToolResponse({
      functionResponses: [
        {
          id: callId,
          name,
          response,
          // An image comes back as a response PART. This is the channel that
          // works: frames pushed as realtime video are accepted and then not
          // seen — the model answers "I cannot see the image" — whereas a
          // picture attached to a function response is read.
          ...(image
            ? { parts: [{ inlineData: { mimeType: image.mimeType, data: image.data } }] }
            : {}),
          // WHEN_IDLE prompts generation without cutting anything off, which
          // is what a BLOCKING tool needs: it stopped to wait for this.
          // SILENT is right only for fire-and-forget board ops — using it on a
          // blocking call strands the model permanently, because it explicitly
          // means "do not trigger generation".
          scheduling: resume
            ? FunctionResponseScheduling.WHEN_IDLE
            : FunctionResponseScheduling.SILENT,
        },
      ],
    });
  }

  sendContext(text: string) {
    // turnComplete:false adds to context without forcing a reply. There is an
    // unresolved report of this wedging subsequent audio input, which is one
    // of the things M1 exists to test.
    this.session?.sendClientContent({
      turns: [{ role: 'user', parts: [{ text }] }],
      turnComplete: false,
    });
  }

  sendImageContext(text: string, image: { mimeType: string; data: string }) {
    this.session?.sendClientContent({
      turns: [{ role: 'user', parts: [{ text }, { inlineData: image }] }],
      turnComplete: false,
    });
  }

  /**
   * turnComplete:true "unconditionally interrupts generation" — which is
   * exactly right when generation has already stopped and we need it going
   * again. The recovery path for a teacher that went silent holding a
   * blocking tool result.
   */
  nudge(text: string) {
    this.session?.sendClientContent({
      turns: [{ role: 'user', parts: [{ text }] }],
      turnComplete: true,
    });
  }

  close() {
    this.closing = true;
    this.session?.close();
    this.session = null;
    this.setState('idle');
  }
}

export { OUTPUT_RATE };
