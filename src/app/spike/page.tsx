'use client';

/**
 * M1 — the voice spike. Throwaway UI, real numbers.
 *
 * The one question this exists to answer: does Gemini Live fire board tool
 * calls DURING a spoken sentence, and how far ahead of the words do they
 * arrive? Everything downstream — the op scheduler, the freeze design, the
 * whole single-model architecture — depends on the answer, so it is measured
 * before more is built on top of it.
 *
 * Board ops are logged, not drawn. Drawing here would mean debugging two
 * systems at once.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { AudioIO } from '@/voice/audio';
import { Metrics, looksCorrupted } from '@/voice/metrics';
import type { SessionState, ToolCall, WireEvent } from '@/voice/session';
import { TEACHER_PROMPT, TEACHER_TOOLS } from '@/teacher/tools';

const MODEL = 'gemini-3.8-live';
/**
 * Local VAD, adaptive.
 *
 * A fixed level gate is wrong for an unknown mic: at 0.055 a quiet setup never
 * trips it at all, so end-of-speech is never detected and TTFA has nothing to
 * measure (turns: 0, with the model replying perfectly well). So track the
 * room's noise floor and trigger relative to it, with an absolute floor so a
 * silent room cannot make the gate infinitely sensitive.
 */
const VAD_FLOOR_MIN = 0.010;
const VAD_MULTIPLE = 4;
const VAD_HANG_MS = 320;
/** No audio this long after a blocking tool answer means the model is stuck. */
const STRANDED_MS = 3500;

interface LogLine {
  t: number;
  kind: 'call' | 'turn' | 'state' | 'error' | 'text';
  text: string;
}

export default function Spike() {
  const ioRef = useRef<AudioIO | null>(null);
  const sessRef = useRef<{ close(): void; sendToolResponse: (a: string, b: string, c: Record<string, unknown>) => void } | null>(null);
  const metricsRef = useRef(new Metrics());
  const speakingRef = useRef(false);
  const vadRef = useRef({ speaking: false, lastVoice: 0, startedAt: 0, floor: 0.02 });
  const awaitingAudio = useRef(0);
  const firstAudioSeen = useRef(false);

  const [state, setState] = useState<SessionState>('idle');
  const [log, setLog] = useState<LogLine[]>([]);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [level, setLevel] = useState(0);
  const [wire, setWire] = useState<WireEvent[]>([]);
  const [threshold, setThreshold] = useState(0.04);

  const say = useCallback((kind: LogLine['kind'], text: string) => {
    setLog((l) => [...l.slice(-160), { t: performance.now(), kind, text }]);
  }, []);

  const refresh = useCallback(() => setReport(metricsRef.current.report()), []);

  const start = useCallback(async () => {
    const { GeminiLiveSession } = await import('@/voice/gemini-live');
    const { evaluate } = await import('@/teacher/calc');

    const io = new AudioIO();
    ioRef.current = io;
    const m = metricsRef.current;

    io.onClock = (c) => {
      if (!firstAudioSeen.current && c.played > 0) {
        firstAudioSeen.current = true;
        m.markFirstAudio(c.played);
        refresh();
      }
    };

    const session = new GeminiLiveSession(
      {
        model: MODEL,
        systemInstruction: TEACHER_PROMPT,
        tools: TEACHER_TOOLS,
        silenceDurationMs: 350,
      },
      {
        wire: (e) => setWire((w) => [...w.slice(-400), e]),
        state: (s, d) => {
          setState(s);
          if (d) say('state', `${s}: ${d}`);
        },
        audio: (pcm) => {
          speakingRef.current = true;
          awaitingAudio.current = 0;
          io.push(pcm);
        },
        turnEnd: () => {
          speakingRef.current = false;
          firstAudioSeen.current = false;
          say('turn', 'turn complete');
          refresh();
        },
        interrupted: () => say('turn', 'server: interrupted'),
        transcript: (c) => {
          if (c.role !== 'model') return;
          // The model saying a tool call aloud instead of invoking it.
          if (/\b(write|point|mark|scene|step|calc)\s*\(/.test(c.text)) {
            m.narratedCalls++;
            say('error', `NARRATED (spoke the call instead of making it): ${c.text}`);
            refresh();
            return;
          }
          say('text', `teacher: ${c.text}`);
        },
        toolCall: (c: ToolCall) => {
          m.recordCall(c, speakingRef.current);
          const leadMs = Math.round(AudioIO.samplesToMs(c.anchorSamples - c.playedSamples));
          const bad = looksCorrupted(c.args) ? '  ⚠ LATEX CORRUPTED' : '';
          say(
            'call',
            `${c.name}(${JSON.stringify(c.args)})  lead ${leadMs}ms  ` +
              `${speakingRef.current ? 'DURING speech' : 'between turns'}${bad}`,
          );
          // calc is BLOCKING: generation has STOPPED waiting for this, so the
          // response must carry resume=true. Answering a blocking call with
          // SILENT scheduling strands the model permanently.
          if (c.name === 'calc') {
            const r = evaluate(String(c.args.expr ?? ''));
            say('call', `  calc -> ${r.ok ? r.text : 'ERROR ' + r.error}`);
            session.sendToolResponse(
              c.callId,
              c.name,
              r as unknown as Record<string, unknown>,
              true,
            );
            awaitingAudio.current = performance.now();
            window.setTimeout(() => {
              if (awaitingAudio.current && performance.now() - awaitingAudio.current >= STRANDED_MS) {
                say('error', `STRANDED: no audio ${STRANDED_MS}ms after answering ${c.name}`);
                awaitingAudio.current = 0;
              }
            }, STRANDED_MS + 100);
          } else {
            session.sendToolResponse(c.callId, c.name, { ok: true }, false);
          }
          refresh();
        },
        error: (msg) => say('error', msg),
      },
      () => io.clock.played,
    );

    await io.start();

    io.onPcm = (pcm, peak) => {
      setLevel(peak);
      const now = performance.now();
      const v = vadRef.current;
      // Fall to a quieter floor fast, rise slowly, so speech itself does not
      // drag the gate up behind it.
      v.floor = peak < v.floor ? v.floor * 0.9 + peak * 0.1 : v.floor * 0.9995 + peak * 0.0005;
      const thr = Math.max(VAD_FLOOR_MIN, v.floor * VAD_MULTIPLE);
      setThreshold(thr);
      if (peak > thr) {
        v.lastVoice = now;
        if (!v.speaking) {
          v.speaking = true;
          v.startedAt = now;
          // Local barge-in: hold instantly rather than waiting for the server.
          if (speakingRef.current) {
            io.hold();
            say('turn', 'local HOLD (student speaking over teacher)');
          }
        }
      } else if (v.speaking && now - v.lastVoice > VAD_HANG_MS) {
        v.speaking = false;
        // Length excludes the hang time, so a blip is reported as a blip.
        m.markEndOfSpeech(v.lastVoice - v.startedAt);
        io.resume();
      }
      session.sendAudio(pcm);
    };

    sessRef.current = session;
    await session.connect();
  }, [refresh, say]);

  const stop = useCallback(async () => {
    sessRef.current?.close();
    await ioRef.current?.stop();
    sessRef.current = null;
    ioRef.current = null;
    setState('idle');
    refresh();
  }, [refresh]);

  useEffect(() => () => { void stop(); }, [stop]);

  const download = () => {
    const blob = new Blob([metricsRef.current.toJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'spike-results.json';
    a.click();
  };

  return (
    <div className="min-h-screen bg-neutral-950 p-6 text-neutral-200">
      <div className="mx-auto max-w-[1200px]">
        <h1 className="mb-1 text-lg font-medium">M1 — voice spike</h1>
        <p className="mb-4 text-sm text-neutral-400">
          {MODEL}. Talk to it about any physics. Board ops are logged, not
          drawn. The question is whether tool calls land <em>during</em> speech,
          and how far ahead of their words they arrive.
        </p>

        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={state === 'idle' ? start : stop}
            className={`rounded px-4 py-2 text-sm ${
              state === 'idle' ? 'bg-emerald-700 hover:bg-emerald-600' : 'bg-red-800 hover:bg-red-700'
            }`}
          >
            {state === 'idle' ? 'Start session' : 'Stop'}
          </button>
          <span className="font-mono text-xs text-neutral-400">{state}</span>
          <div className="relative h-2 w-40 overflow-hidden rounded bg-neutral-800">
            <div
              className="h-full bg-emerald-500 transition-[width] duration-75"
              style={{ width: `${Math.min(100, level * 600)}%` }}
            />
            {/* the adaptive gate, so a mic that never trips it is obvious */}
            <div
              className="absolute top-0 h-full w-px bg-amber-400"
              style={{ left: `${Math.min(100, threshold * 600)}%` }}
            />
          </div>
          <button
            onClick={download}
            className="ml-auto rounded bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
          >
            Export JSON
          </button>
        </div>

        <div className="grid grid-cols-[1fr_360px] gap-5">
          <div className="h-[560px] overflow-auto rounded bg-neutral-900 p-3 font-mono text-xs">
            {log.length === 0 && (
              <div className="text-neutral-600">
                Nothing yet. Start a session and ask it something &mdash; a
                circuit, a lens, a collision.
              </div>
            )}
            {log.map((l, i) => (
              <div
                key={i}
                className={
                  l.kind === 'call'
                    ? 'text-amber-300'
                    : l.kind === 'error'
                      ? 'text-red-400'
                      : l.kind === 'turn'
                        ? 'text-sky-400'
                        : l.kind === 'text'
                          ? 'text-neutral-400'
                          : 'text-neutral-500'
                }
              >
                {l.text}
              </div>
            ))}
          </div>

          <div className="rounded bg-neutral-900 p-3">
            <div className="mb-1 text-xs text-neutral-500">
              Wire order &mdash; the actual question
            </div>
            <div className="mb-1 text-[10px] leading-relaxed text-neutral-600">
              <span className="text-neutral-400">&middot;</span> audio chunk
              &nbsp; <span className="text-amber-300">[tool]</span> call &nbsp;
              <span className="text-sky-400">|</span> turn end &nbsp;
              <span className="text-neutral-500">^</span> generation done
            </div>
            <div className="mb-3 max-h-28 overflow-auto break-all rounded bg-neutral-950 p-2 font-mono text-[11px] leading-5">
              {wire.map((e, i) => {
                if (e.kind === 'audio') return <span key={i} className="text-neutral-500">&middot;</span>;
                if (e.kind === 'toolCall') return <span key={i} className="text-amber-300">[{e.detail}]</span>;
                if (e.kind === 'turnComplete') return <span key={i} className="text-sky-400"> | </span>;
                if (e.kind === 'generationComplete') return <span key={i} className="text-neutral-600">^</span>;
                if (e.kind === 'interrupted') return <span key={i} className="text-red-400">!</span>;
                return null;
              })}
            </div>
            <div className="mb-2 text-xs text-neutral-500">Go / no-go</div>
            <pre className="whitespace-pre-wrap font-mono text-xs text-neutral-300">
              {report ? JSON.stringify(report, null, 1) : 'no data yet'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
