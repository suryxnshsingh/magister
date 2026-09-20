'use client';

/**
 * The session. 75% board, 25% presence and transcript.
 *
 * Where M0's board and M1's voice finally meet. The joint between them is the
 * scheduler: measured on gemini-3.8-live, a tool call arrives with 5–13
 * seconds of speech still queued, so ops are held until playback reaches the
 * point in the sentence where the model emitted them. Drawing on arrival would
 * put the chalk seconds ahead of the voice.
 *
 * Barge-in is local-first and two-stage. Local VAD holds audio and freezes the
 * pen within a frame or two; the server's `interrupted` then commits, dropping
 * every op anchored past what was actually heard. A teacher stopping
 * mid-stroke is the whole point, so the half-written line stays.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { CANVAS_H, CANVAS_W } from '@/board/units';
import type { Scene } from '@/board/scene';
import { createPenElements, renderPen, type PenElements } from '@/board/pen-render';
import { SessionRecorder } from '@/board/sessions';
import { AudioIO } from '@/voice/audio';
import { OpScheduler } from '@/voice/scheduler';
import type { SessionState, ToolCall, VoiceSession } from '@/voice/session';
import { classifyInterruption } from '@/teacher/backchannel';
import { startEarlyMs } from '@/teacher/pacing';
import { TEACHER_PROMPT, TEACHER_TOOLS } from '@/teacher/tools';
import Presence from '@/ui/Presence';
import type { PresenceState } from '@/ui/presence-types';
import MathText from '@/ui/MathText';

const MODEL = 'gemini-3.8-live';
const VAD_FLOOR_MIN = 0.01;
const VAD_MULTIPLE = 4;
const VAD_HANG_MS = 320;
/**
 * Whether to tell the model in words that it was interrupted.
 * Disable if the teacher ever goes silent for good after a barge-in — the
 * turnComplete:false wedge report is still unresolved upstream.
 */
const INJECT_INTERRUPT_CONTEXT = true;
/**
 * A blocking tool stops generation until it is answered. If the answer lands
 * and the teacher still says nothing, the lesson has died mid-explanation —
 * indistinguishable, to a student, from "it said one line and stopped". Nudge
 * it back rather than leaving the board frozen.
 */
const STALL_MS = 3200;
/**
 * How long speech must last before the server is told about it at all.
 *
 * Under manual activity the server only interrupts when WE say the student
 * spoke, so a blip shorter than this — "haan", a cough, a chair — never
 * reaches it and can never cut the teacher off. Real speech is not lost: the
 * pre-roll buffer below replays what was said during the wait.
 */
const COMMIT_SPEECH_MS = 260;
/** Mic audio held back so the start of an utterance is never clipped. */
const PREROLL_MS = 320;
/**
 * How much louder the student must be than the teacher to count as speech.
 *
 * Browser echo cancellation is not enough on open speakers: the teacher's own
 * voice comes back through the microphone, the local VAD calls it speech, and
 * we interrupt the teacher mid-explanation. The transcript gives it away —
 * the teacher's Hinglish comes back as a "student" turn in another language.
 *
 * Real barge-in is close-miked and loud; speaker bleed is not. Raising the bar
 * in proportion to what is currently coming out of the speakers separates the
 * two without needing headphones.
 */
const ECHO_GUARD = 7;
/**
 * The student must be at least this loud RELATIVE to what the speakers are
 * putting out. Scaling the threshold alone was not enough — bleed scales with
 * the teacher's own volume, so the comparison has to be against that volume
 * directly rather than against the room's noise floor.
 */
const ECHO_RATIO = 0.85;

interface Line {
  role: 'teacher' | 'student' | 'system';
  text: string;
}

export default function Session() {
  const svgRef = useRef<SVGSVGElement>(null);
  const figRef = useRef<SVGGElement>(null);
  const inkRef = useRef<SVGGElement>(null);
  const markRef = useRef<SVGGElement>(null);

  const sceneRef = useRef<Scene | null>(null);
  const ioRef = useRef<AudioIO | null>(null);
  const schedRef = useRef<OpScheduler | null>(null);
  const sessRef = useRef<VoiceSession | null>(null);
  const recRef = useRef<SessionRecorder | null>(null);
  const [lastSession, setLastSession] = useState<string | null>(null);
  const vad = useRef({ speaking: false, lastVoice: 0, floor: 0.02, startedAt: 0 });
  /** Most recent student transcript, for telling a nod from a question. */
  const lastHeard = useRef('');
  /** Recent mic chunks, replayed when an utterance commits. */
  const preroll = useRef<Int16Array[]>([]);
  /** True between activityStart and activityEnd. */
  const streaming = useRef(false);
  const commitTimer = useRef(0);
  /** Live output level — React state is a frame stale inside the audio callback. */
  const outLevelRef = useRef(0);
  const echoRef = useRef(0);
  const speakingRef = useRef(false);
  const heldRef = useRef(false);
  /** What the local HOLD froze, so COMMIT can tell the model in words. */
  const cutRef = useRef<{ id: string; content: string; at: number } | null>(null);
  /** When a blocking tool was answered; cleared as soon as audio resumes. */
  const awaitingResume = useRef(0);

  /**
   * Whether WE are in a lesson — distinct from the transport's state.
   * `close()` reports 'idle' and the socket then reports 'closed' a moment
   * later, so deriving the UI from transport state leaves the session looking
   * permanently live after it has ended.
   */
  /**
   * idle -> starting -> live.
   *
   * "starting" exists because opening a session is not instant: dynamic
   * imports, getUserMedia, two AudioWorklets, a token fetch and a WebSocket
   * handshake. Revealing the room on click made it look ready while the mic
   * was not yet wired and the socket was still null — every word spoken in
   * that window was silently dropped, and the student had no way to know.
   * The gate now stays up, saying so, until audio can actually reach the model.
   */
  const [phase, setPhase] = useState<'idle' | 'starting' | 'live'>('idle');
  const active = phase === 'live';
  const [state, setState] = useState<SessionState>('idle');
  const penRef = useRef<SVGGElement>(null);
  const penEls = useRef<PenElements | null>(null);
  /** Throttled copy of the pen position, only for the presence lean. */
  const [gaze, setGaze] = useState<{ x: number; y: number } | null>(null);
  const lastGaze = useRef(0);
  const [lines, setLines] = useState<Line[]>([]);
  const feedRef = useRef<HTMLDivElement>(null);
  /**
   * Whether the reader is following the live edge.
   *
   * Auto-scroll that ignores this is the classic transcript bug: the student
   * scrolls up to re-read what the teacher said, and every new fragment yanks
   * them back down. Transcripts here arrive in fragments several times a
   * second, so that fight would be constant. Scrolling away opts out; scrolling
   * back to the bottom opts in again.
   */
  const pinned = useRef(true);
  const [level, setLevel] = useState(0);
  /** The teacher's own loudness, so the presence moves with its voice. */
  const [outLevel, setOutLevel] = useState(0);
  /** Unplayed audio still queued. Non-zero means the student is HEARING speech. */
  const [queued, setQueued] = useState(0);
  /**
   * The student has finished and nothing has come back yet.
   *
   * This is the only honest source of "thinking": the transport never reports
   * it, so without deriving it here the state is unreachable in a real
   * session. It is also the moment a student is watching hardest — waiting to
   * see whether they were understood.
   */
  const [awaiting, setAwaiting] = useState(false);

  // Follow the feed, but only while the reader is at the bottom.
  useEffect(() => {
    const el = feedRef.current;
    if (!el || !pinned.current) return;
    // 'auto', not 'smooth': fragments land faster than a smooth scroll can
    // finish, so queued animations would lag further behind with every line.
    el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
  }, [lines]);

  const push = useCallback((role: Line['role'], text: string) => {
    setLines((l) => {
      const last = l[l.length - 1];
      // Transcripts arrive in fragments; glue them into readable lines.
      if (last && last.role === role && role !== 'system') {
        return [...l.slice(0, -1), { role, text: `${last.text} ${text}`.slice(-400) }];
      }
      return [...l.slice(-40), { role, text }];
    });
  }, []);

  /**
   * Presence state comes from PLAYBACK, not from the socket.
   *
   * Transport events are 5–13s early: `audio` arrives long before it is heard
   * and `turnComplete` arrives while the teacher is still mid-sentence. Driving
   * the presence off them makes it flip to "speaking" before any sound, then
   * fall back to "listening" — and start following the (silent) microphone —
   * while the teacher is still talking. Which is exactly the desync you can
   * hear.
   *
   * What the student experiences is the player: audio still queued, or level
   * still coming out, means the teacher is speaking. Full stop.
   */
  /**
   * Connection status comes from the transport; everything after it comes from
   * playback.
   *
   * The split matters. Socket state is the truth about whether we are live,
   * and showing "listening" before the socket opens is how a first turn gets
   * spoken into a session that cannot hear it. But once live, transport events
   * run 5–13s ahead of what the student hears, so speaking/thinking/listening
   * must come from the player instead.
   */
  const audible = queued > 0 || outLevel > 0.012;
  const presenceState: PresenceState = phase === 'idle'
    ? 'idle'
    : phase === 'starting' || state === 'connecting' || state === 'idle'
      ? 'connecting'
      : state === 'error' || state === 'closed'
        ? 'error'
        : audible
          ? 'speaking'
          : awaiting
            ? 'thinking'
            : 'listening';

  /** Plain-language status, so the student never has to infer it. */
  const statusLabel =
    presenceState === 'connecting' ? 'connecting…'
    : presenceState === 'error' ? 'connection lost'
    : presenceState === 'speaking' ? 'teacher speaking'
    : presenceState === 'thinking' ? 'thinking…'
    : presenceState === 'listening' ? 'listening — go ahead'
    : 'idle';

  const start = useCallback(async () => {
    if (phase !== 'idle') return;
    setPhase('starting');
    // Explicit, because nothing else reports it until the socket opens — and
    // the gap is exactly when a student starts talking too early.
    setState('connecting');
    const [{ Scene }, { GeminiLiveSession }, { dispatch, boardSummary }] = await Promise.all([
      import('@/board/scene'),
      import('@/voice/gemini-live'),
      import('@/teacher/dispatch'),
    ]);
    if (!svgRef.current || !inkRef.current || !markRef.current || !figRef.current) return;

    const scene = new Scene(svgRef.current, {
      ink: inkRef.current,
      figures: figRef.current,
      marks: markRef.current,
    });
    sceneRef.current = scene;
    if (penRef.current && !penEls.current) penEls.current = createPenElements(penRef.current);
    scene.clock.onTick(() => {
      const p = scene.pen.at(scene.clock.time);
      renderPen(penEls.current, p);
      // Gaze is lerped inside Presence, so ~10Hz is plenty and keeps React
      // out of the 60fps path entirely.
      const now = performance.now();
      if (p.pos && now - lastGaze.current > 100) {
        lastGaze.current = now;
        setGaze({ x: 1 - p.pos.x / CANVAS_W, y: 1 - p.pos.y / CANVAS_H });
      }
    });
    scene.clock.start();

    const io = new AudioIO();
    ioRef.current = io;

    /**
     * Ops fire against playback, never against arrival — and are dispatched
     * exactly once, here, at the moment they are drawn.
     *
     * Dispatching at enqueue time instead would be wrong twice over.
     * `resolvePlace` advances the layout cursor, so a second call double-spaces
     * every line; and a `mark` targets something that has not been drawn yet
     * (its `write` is still queued seconds away), so the lookup fails and the
     * annotation is silently dropped. Both vanish if resolution happens when
     * the chalk actually moves.
     */
    const sched = new OpScheduler((call) => {
      const r = dispatch(call, scene, scene.clock.time);
      for (const op of r.ops) {
        scene.applyOp(op);
        // Recorded here, at the moment the chalk moves, so the replay has the
        // rhythm the student heard rather than the socket's 5–13s lead.
        recRef.current?.add(op);
      }
      push('system', r.note);
      // The reply describes what actually happened, so it is sent now rather
      // than on arrival. NON_BLOCKING means nothing is waiting on it.
      sessRef.current?.sendToolResponse(
        call.callId,
        call.name,
        { ...r.response, board: boardSummary(scene) },
        r.resume,
      );
    });
    schedRef.current = sched;

    const rec = new SessionRecorder();
    rec.start();
    recRef.current = rec;
    setLastSession(rec.id);

    const session = new GeminiLiveSession(
      {
        model: MODEL,
        systemInstruction: TEACHER_PROMPT,
        tools: TEACHER_TOOLS,
        /**
         * WE own turn boundaries, not the server.
         *
         * With server VAD the teacher's own voice leaking into the microphone
         * is heard as the student speaking, and the server ENDS GENERATION.
         * The symptom is a teacher that says one line and stops: the audio you
         * hear is what had already been generated, and nothing follows because
         * the model was cut off. Ignoring the interrupt client-side keeps the
         * queue playing but cannot restart generation the server has killed.
         *
         * In manual mode the model is interrupted only when this microphone
         * hears this student — and it never hears the teacher at all, because
         * audio is only streamed while the student is actually speaking.
         */
        manualActivity: true,
      },
      {
        state: (s) => {
          setState(s);
          // The room opens on the socket, not on the click.
          if (s === 'listening') setPhase('live');
          if (s === 'error' || s === 'closed') setPhase('idle');
        },
        audio: (pcm) => {
          speakingRef.current = true;
          awaitingResume.current = 0;
          io.push(pcm);
        },
        turnStart: () => sched.markTurnStart(io.clock.played),
        turnEnd: () => {
          speakingRef.current = false;
        },
        transcript: (c) => {
          if (c.role === 'user') lastHeard.current += ` ${c.text}`;
          push(c.role === 'model' ? 'teacher' : 'student', c.text);
        },
        interrupted: () => {
          /**
           * Not every sound is an interruption.
           *
           * "haan", "hmm", "accha" is a student nodding out loud, and stopping
           * the teacher for it is worse than not stopping at all. The queued
           * audio is the saving grace: because generation runs seconds ahead of
           * playback, simply resuming plays the REST OF THE SENTENCE the model
           * already produced — the perfect continuation, with nothing to repair
           * and no instruction needed.
           */
          const v = vad.current;
          // Count speech that has JUST ended too: the server's interrupt
          // usually lands a beat after the student stopped.
          const recent = performance.now() - v.lastVoice < 1500;
          const spokenMs = v.speaking
            ? performance.now() - v.startedAt
            : recent
              ? v.lastVoice - v.startedAt
              : 0;
          const verdict = classifyInterruption(spokenMs, lastHeard.current);

          if (verdict.spurious) {
            // The server heard something this microphone did not. Flushing here
            // would bin the 5–13s of queued speech and the student would hear
            // almost nothing — which is exactly what "can't hear the teacher"
            // looks like. Keep playing.
            push('system', 'ignored a server interrupt — no local speech');
            return;
          }

          if (verdict.isBackchannel) {
            heldRef.current = false;
            io.resume();
            scene.clock.start();
            push('system', `backchannel (${verdict.reason}) — carried on`);
            return;
          }

          // COMMIT: what was never heard is never drawn.
          const dropped = sched.dropUnheard();
          io.flush();
          heldRef.current = false;
          for (const d of dropped) {
            // Tell the model the chalk never moved. Otherwise it believes it
            // drew these and will refer back to things that are not there.
            session.sendToolResponse(
              d.callId,
              d.name,
              { ok: false, error: 'not drawn — the student interrupted before you said this', board: boardSummary(scene) },
              false,
            );
          }

          /**
           * Tell the model, in words, that it was cut off.
           *
           * Tool responses only say which chalk failed to land. They never say
           * "you did not finish your sentence", so without this the model
           * believes it spoke its whole turn and will never acknowledge the
           * interruption or go back to the half-written line. This is the one
           * carrier for that, and `sendContext` (turnComplete:false) adds it to
           * context without demanding a reply.
           *
           * There is an unresolved report that turnComplete:false can wedge
           * subsequent audio input, so it is behind a flag and logged: if the
           * teacher goes permanently silent after a barge-in, set this false.
           */
          if (INJECT_INTERRUPT_CONTEXT) {
            const cut = cutRef.current;
            const lines = [
              'SYSTEM: the student interrupted you. You did NOT finish your sentence.',
              cut
                ? `On the board, "${cut.id}" is only half-written. Finish it when you return to it.`
                : null,
              dropped.length
                ? `Never drawn: ${dropped.map((d) => d.name).join(', ')}. Do not refer to them.`
                : null,
              'Answer what they asked first. Do not restart your explanation from the beginning.',
            ].filter(Boolean);
            session.sendContext(lines.join(' '));
            push('system', 'told model it was cut off');
          }
          cutRef.current = null;
          if (dropped.length) push('system', `dropped ${dropped.length} unheard op(s)`);
        },
        toolCall: (call: ToolCall) => {
          // calc is BLOCKING: generation has stopped waiting for it, so it
          // cannot wait on the pen. Everything else is queued for playback.
          if (call.name === 'calc') {
            const r = dispatch(call, scene, scene.clock.time);
            push('system', r.note);
            session.sendToolResponse(call.callId, call.name, r.response, r.resume);
            // Generation stopped for this. Make sure it starts again.
            awaitingResume.current = performance.now();
            window.setTimeout(() => {
              if (!awaitingResume.current) return;
              if (performance.now() - awaitingResume.current < STALL_MS) return;
              awaitingResume.current = 0;
              push('system', 'teacher stalled after calc — nudged');
              session.nudge(
                'You stopped mid-explanation holding that result. Carry on from where you were and finish the whole explanation. Do not restart it.',
              );
            }, STALL_MS + 150);
            return;
          }
          // Start early enough that the stroke spans the phrase rather than
          // following it — the model emits the call after saying the words.
          sched.enqueue(call, startEarlyMs(call.name, call.args));
        },
        toolCancel: (ids) => sched.cancel(ids),
        error: (m) => push('system', `error: ${m}`),
      },
      () => io.clock.played,
    );
    sessRef.current = session;

    io.onClock = (c) => {
      sched.tick(c.played);
      setOutLevel(c.level);
      outLevelRef.current = c.level;
      setQueued(c.queued);
      if (c.queued > 0 || c.level > 0.012) setAwaiting(false);
    };

    await io.start();
    if (io.blocked) {
      push('system', `audio output is ${io.outputState} — the browser blocked playback`);
    }

    io.onPcm = (pcm, peak) => {
      setLevel(peak);
      const now = performance.now();
      const v = vad.current;
      v.floor = peak < v.floor ? v.floor * 0.9 + peak * 0.1 : v.floor * 0.9995 + peak * 0.0005;
      // While the teacher is audible, demand a much louder signal — otherwise
      // its own voice returning through the speakers reads as a barge-in.
      const echo = outLevelRef.current;
      echoRef.current = echo;
      const guard = 1 + echo * ECHO_GUARD;
      const thr = Math.max(
        VAD_FLOOR_MIN,
        v.floor * VAD_MULTIPLE * guard,
        // Directly proportional to what is coming out of the speakers.
        echo * ECHO_RATIO,
      );

      // Hold recent audio so a committed utterance can replay its own opening.
      // Anything captured while the teacher was audible is echo, not speech,
      // and must never be replayed into the model.
      if (echoRef.current > 0.02) preroll.current = [];
      if (!streaming.current) {
        preroll.current.push(pcm);
        const maxChunks = Math.ceil((PREROLL_MS / 1000) * 16000 / 128);
        if (preroll.current.length > maxChunks) preroll.current.shift();
      }

      if (peak > thr) {
        v.lastVoice = now;
        if (!v.speaking) {
          if (echo > 0.02) {
            // Loud enough to pass the echo bar while the teacher talks — a
            // genuine barge-in, worth noting so the guard can be tuned.
            push('system', `barge-in over teacher (mic ${peak.toFixed(2)} vs out ${echo.toFixed(2)})`);
          }
          v.speaking = true;
          v.startedAt = now;
          lastHeard.current = '';
          // Tell the server only once this looks like real speech. A blip that
          // ends first is never reported, so it cannot interrupt the teacher.
          window.clearTimeout(commitTimer.current);
          commitTimer.current = window.setTimeout(() => {
            if (!vad.current.speaking || streaming.current) return;
            streaming.current = true;
            session.activityStart();
            for (const chunk of preroll.current) session.sendAudio(chunk);
            preroll.current = [];
          }, COMMIT_SPEECH_MS);
          // HOLD: stop the voice and freeze the pen mid-stroke immediately,
          // without waiting for the server to confirm the interruption.
          if (speakingRef.current && !heldRef.current) {
            heldRef.current = true;
            io.hold();
            // Freezes the pen AND records the line as half-written, which is
            // what the model is told in the board summary.
            cutRef.current = scene.interruptActiveWrite();
            // The freeze comes from the microphone, not a tool call, so the
            // recorder has to be told about it separately or the replay shows
            // an uninterrupted line.
            if (cutRef.current) {
              recRef.current?.interrupt(cutRef.current.id, cutRef.current.at);
            }
            scene.clock.freeze();
          }
        }
      } else if (v.speaking && now - v.lastVoice > VAD_HANG_MS) {
        v.speaking = false;
        window.clearTimeout(commitTimer.current);
        if (streaming.current) {
          streaming.current = false;
          session.activityEnd();
          // Handed over; now we are waiting on the teacher.
          setAwaiting(true);
        } else {
          // Never committed — a blip the server was never told about.
          push('system', 'blip ignored — teacher not interrupted');
        }
        // RESUME: a cough, not an interruption. Nothing was lost.
        if (heldRef.current) {
          heldRef.current = false;
          io.resume();
          scene.clock.start();
        }
      }
      if (streaming.current) session.sendAudio(pcm);
    };

    await session.connect();
  }, [push, phase]);

  const stop = useCallback(async () => {
    setPhase('idle');
    sessRef.current?.close();
    await ioRef.current?.stop();
    sceneRef.current?.clock.freeze();
    sessRef.current = null;
    schedRef.current?.clear();
    // The board just built is the artefact; keep it before tearing down.
    recRef.current?.stop();
    recRef.current = null;
    setState('idle');
  }, []);

  useEffect(() => () => { void stop(); }, [stop]);

  const statusTone =
    presenceState === 'listening' ? 'var(--ember)'
    : presenceState === 'connecting' ? 'var(--slate)'
    : presenceState === 'thinking' ? 'var(--violet)'
    : presenceState === 'error' ? 'var(--rust)'
    : presenceState === 'speaking' ? 'var(--chalk)'
    : 'var(--ash)';

  return (
    <main className="relative h-screen overflow-hidden">
      {/* Everything behind the gate dims together. Dulling only the board left
          the rail bright and the eye had two places to go; dimming the whole
          room leaves exactly one lit thing on the screen. */}
      <div
        className="flex h-full"
        style={{
          filter: active ? 'none' : 'saturate(0.62) brightness(0.78)',
          transition: 'filter 900ms cubic-bezier(0.2,0.7,0.2,1)',
        }}
      >
      {/* ── the board ───────────────────────────────────────────────────────
          THE SVG SIZES ITSELF. A viewBox gives an inline <svg> an intrinsic
          aspect ratio, so `max-width/max-height: 100%` with auto width and
          height contains it exactly like an <img> — in both directions.

          Worth stating because two other approaches failed here, each leaving
          a letterbox that looked like a second border. `width:100%` +
          `aspect-ratio` + `max-height` collapses on a short, wide window (a
          1400x400 box yields ratio 3.5); `height:100%` + `max-width` collapses
          on a tall one. Definite sizes stop aspect-ratio re-deriving the other
          axis. Letting the element carry its own ratio removes the whole class
          of bug, and the element can never disagree with its viewBox because
          it IS its viewBox. */}
      <section className="flex min-w-0 flex-1 items-center justify-center py-7 pl-8 pr-6">
        <div className="relative flex h-full w-full items-center justify-center">
          {/* Light spilling off the board into the room. The only reason the
              rest of the screen is allowed to be this dark. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-24 -z-10 opacity-60 blur-3xl"
            style={{
              background:
                'radial-gradient(60% 50% at 50% 45%, color-mix(in srgb, var(--board-lit) 70%, transparent), transparent 70%)',
            }}
          />
          <svg
            ref={svgRef}
            viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
            className="rise block rounded-[3px]"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              width: 'auto',
              height: 'auto',
              boxShadow:
                '0 0 0 1px var(--hairline), 0 30px 80px -20px rgb(0 0 0 / 0.9)',
            }}
          >
            <defs>
              <radialGradient id="vig" cx="50%" cy="45%" r="75%">
                <stop offset="0%" stopColor="var(--board-lit)" />
                <stop offset="100%" stopColor="var(--board-deep)" />
              </radialGradient>
              <filter id="grain">
                <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" />
                <feColorMatrix type="saturate" values="0" />
              </filter>
            </defs>
            <rect width={CANVAS_W} height={CANVAS_H} fill="url(#vig)" />
            <rect width={CANVAS_W} height={CANVAS_H} filter="url(#grain)" opacity="0.05" />
            <g ref={figRef} />
            <g ref={inkRef} />
            <g ref={markRef} />
            <g ref={penRef} />
          </svg>

        </div>
      </section>

      {/* ── the rail ────────────────────────────────────────────────────────
          A panel, not a loose column — the same surface treatment as the board,
          so the two halves read as siblings. The title is gone: "Physics
          kinematics" was a label for something already obvious from the board,
          and the row is worth more as transcript. */}
      <aside
        className="rise flex w-[30%] min-w-[330px] max-w-[460px] flex-col py-7 pl-6 pr-8"
        style={{ animationDelay: '120ms' }}
      >
      <div
        className="flex h-full flex-col overflow-hidden rounded-[3px]"
        style={{ boxShadow: '0 0 0 1px var(--hairline)' }}
      >
        <div className="flex items-center gap-2 px-6 pt-5">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              presenceState === 'connecting' || presenceState === 'thinking' ? 'breathe' : ''
            }`}
            style={{ background: statusTone }}
          />
          <span className="label" style={{ color: statusTone }}>
            {statusLabel}
          </span>
          {/* Rarely pressed, so it sits opposite the status rather than taking
              a row of its own at the bottom — that edge belongs to the
              teacher now. */}
          {active && (
            <button
              onClick={stop}
              className="label ml-auto transition-colors hover:text-[color:var(--chalk-soft)]"
              style={{ color: 'var(--ash)' }}
            >
              End
            </button>
          )}
        </div>


        <div
          ref={feedRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            // A little slack, so a fractional scroll position or an in-flight
            // line does not count as having scrolled away.
            pinned.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          className="min-h-0 flex-1 overflow-y-auto px-6"
          style={{
            // No rule, no border. Lines dissolve into the room as they scroll
            // up under the presence, which is a softer division than a line
            // and costs no vertical space.
            // Fades into the presence below it, and lightly under the status
            // above — text dissolves at the edge it is travelling toward.
            maskImage:
              'linear-gradient(to bottom, transparent, #000 20px, #000 calc(100% - 44px), transparent)',
            WebkitMaskImage:
              'linear-gradient(to bottom, transparent, #000 20px, #000 calc(100% - 44px), transparent)',
          }}
        >
          {lines.map((l, i) =>
            l.role === 'system' ? (
              // Machine traces sit below the conversation in every sense:
              // smaller, monospaced, dimmer, indented out of the reading line.
              <p
                key={i}
                className="mb-1 pl-3 font-mono text-[10.5px] leading-snug"
                style={{ color: 'var(--ash)' }}
              >
                {l.text}
              </p>
            ) : (
              <p
                key={i}
                className="mb-3 text-[15px] leading-[1.65]"
                style={{
                  color: l.role === 'teacher' ? 'var(--chalk)' : 'var(--ember)',
                }}
              >
                <MathText>{l.text}</MathText>
              </p>
            ),
          )}
        </div>

        {/* The teacher sits at the BOTTOM of the panel, against the live edge
            of the transcript.
            Auto-scroll keeps the newest line at the bottom, so with the
            presence at the top the eye had to cross the whole panel between
            "who is talking" and "what they just said". Down here the glow
            pulses beside the words it is producing. */}
        <div className="relative h-44 shrink-0">
          <div
            className="absolute inset-0"
            style={{
              // Vertical fade only, full bleed to the panel's own sides.
              //
              // A radial mask fades on BOTH axes, so it pinched the band in
              // horizontally and left it floating. The band is horizontal — it
              // should run wall to wall and dissolve only into the rows above
              // and below it.
              maskImage:
                'linear-gradient(to bottom, transparent, #000 26%, #000 72%, transparent)',
              WebkitMaskImage:
                'linear-gradient(to bottom, transparent, #000 26%, #000 72%, transparent)',
            }}
          >
            <Presence
              state={presenceState}
              // Speaking: the teacher's OWN voice, measured at the speakers.
              // Listening: the student's mic, so it visibly attends.
              level={presenceState === 'speaking' ? outLevel : presenceState === 'listening' ? level : 0}
              gaze={gaze}
            />
          </div>
        </div>
      </div>
      </aside>
      </div>

      {/* ── the gate ────────────────────────────────────────────────────────
          One lit control in a dimmed room. A scrim deepens toward the centre so
          the eye lands on the button rather than on the brightest pixel
          elsewhere. Dim, not off: the board should still read as a chalkboard
          waiting and the teacher as present but dormant — a black screen with
          one button says "broken", not "not started yet". */}
      {!active && (
        <div className="absolute inset-0 grid place-items-center">
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(58% 54% at 50% 50%, rgb(0 0 0 / 0.30), rgb(0 0 0 / 0.58))',
            }}
          />
          <div className="relative flex flex-col items-center gap-4">
            <button
              onClick={start}
              disabled={phase === 'starting'}
              className={`rise relative flex items-center gap-3 rounded-full px-8 py-3.5 transition-all duration-500 ${
                phase === 'idle' ? 'group' : 'cursor-default'
              }`}
              style={{
                animationDelay: '220ms',
                color: phase === 'starting' ? 'var(--chalk-soft)' : 'var(--void)',
                background:
                  phase === 'starting'
                    ? 'color-mix(in srgb, var(--ember) 12%, transparent)'
                    : 'var(--ember)',
                boxShadow:
                  phase === 'starting'
                    ? '0 0 0 1px color-mix(in srgb, var(--ember) 30%, transparent)'
                    : '0 10px 40px -12px color-mix(in srgb, var(--ember) 75%, transparent)',
              }}
            >
              <span
                className="breathe h-1.5 w-1.5 rounded-full"
                style={{
                  background: phase === 'starting' ? 'var(--ember)' : 'var(--void)',
                  opacity: phase === 'starting' ? 1 : 0.7,
                }}
              />
              <span className="label" style={{ letterSpacing: '0.18em' }}>
                {phase === 'starting' ? 'Connecting' : 'Begin lesson'}
              </span>
            </button>
            {/* Say plainly not to talk yet. Nothing spoken now can be heard,
                and a student has no other way to know that. */}
            <span
              className="text-[13px] transition-opacity duration-500"
              style={{
                color: 'var(--ash)',
                opacity: phase === 'starting' ? 1 : 0,
              }}
            >
              opening the mic and the line — wait for the teacher
            </span>

            {/* The board the student just built is the thing they take away.
                It only appears once there is one, and only while idle, so it
                never competes with the lesson. */}
            {lastSession && phase === 'idle' && (
              <a
                href={`/replay?session=${lastSession}`}
                className="label rise underline underline-offset-4 transition-colors"
                style={{ animationDelay: '320ms', color: 'var(--ash)' }}
              >
                replay your last lesson
              </a>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
