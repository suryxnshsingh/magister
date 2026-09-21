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
import { snapshotBoard, type Snapshot } from '@/board/snapshot';
import { AudioIO, INPUT_RATE } from '@/voice/audio';
import { OpScheduler } from '@/voice/scheduler';
import type { SessionState, ToolCall, VoiceSession } from '@/voice/session';
import { classifyInterruption } from '@/teacher/backchannel';
import { MIN_VOICED_MS, ONSET_WINDOW_MS, SpeechGate } from '@/voice/gate';
import { Wakeup } from '@/voice/wake';
import { startEarlyMs } from '@/teacher/pacing';
import { TEACHER_PROMPT, TEACHER_TOOLS } from '@/teacher/tools';
import { Camera, Mic, MicOff, PhoneOff, Video, VideoOff, X } from 'lucide-react';

import Presence from '@/ui/Presence';
import type { PresenceState } from '@/ui/presence-types';
import MathText from '@/ui/MathText';

const MODEL = 'gemini-3.8-live';
/**
 * Whether to tell the model in words that it was interrupted.
 * Disable if the teacher ever goes silent for good after a barge-in — the
 * turnComplete:false wedge report is still unresolved upstream.
 */
const INJECT_INTERRUPT_CONTEXT = true;
/**
 * How long a teacher that was told to carry on — a blocking tool answered, or
 * a board call it stopped to wait on — may stay silent before it is nudged.
 */
const STALL_MS = 3200;
/** A fresh picture of the board is rendered this long after it last changed. */
const SNAPSHOT_RENDER_MS = 800;
/** …and handed to the teacher once the board has been still this long. */
const SNAPSHOT_QUIET_MS = 3000;
/**
 * Mic audio held back so the start of an utterance is never clipped: the whole
 * window the commit was judged on, and a little of the breath before it.
 */
const PREROLL_MS = ONSET_WINDOW_MS + 100;
/**
 * The speaker has made a sound when a played sample reaches this. Quieter than
 * any syllable, louder than anything whose echo could be mistaken for one.
 */
const OUT_AUDIBLE = 0.01;
/**
 * How long after the speaker falls silent its echo can still reach the
 * microphone, on top of the output latency the browser reports: the capture
 * path, the echo canceller's alignment delay (Chromium's macOS loopback
 * reference adds 170ms, per its source), and the room's own decay.
 */
const ECHO_TAIL_MS = 250;
/**
 * The echo is measured only this soon after a sound was played — while the
 * speaker is genuinely talking, not in the silence after it.
 */
const ECHO_LEARN_MS = 60;

interface Line {
  role: 'teacher' | 'student' | 'system';
  text: string;
}

/**
 * One round control, the shape every call has.
 *
 * Icon only. A call's controls are the most over-learned three buttons on a
 * screen and a word under each one is noise — the state carries the meaning
 * instead: a live control is an outline, a switched-off one fills in, so a
 * muted microphone is the thing that catches the eye.
 *
 * Deliberately NOT `.group`, which globals.css gives a translateY on hover.
 * That lift belongs to the one button on the idle screen; a control bar that
 * shifts under the cursor reads as unsteady. Hover moves nothing here and
 * only warms the colour.
 */
function CallButton({
  on,
  danger,
  onClick,
  label,
  children,
}: {
  on: boolean;
  danger?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const background = danger
    ? 'var(--ember)'
    : on
      ? hover
        ? 'color-mix(in srgb, var(--chalk-soft) 12%, transparent)'
        : 'transparent'
      : 'var(--chalk-soft)';
  return (
    <button
      onClick={onClick}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      aria-label={label}
      aria-pressed={danger ? undefined : on}
      className="flex h-11 w-11 items-center justify-center rounded-full transition-colors"
      style={{
        background,
        boxShadow: danger || !on ? 'none' : '0 0 0 1px var(--hairline)',
        opacity: danger && hover ? 0.88 : 1,
        color: danger ? 'var(--void)' : on ? 'var(--chalk-soft)' : 'var(--void)',
      }}
    >
      {children}
    </button>
  );
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
  /** Whether the student is speaking — see `voice/gate.ts`. One per lesson. */
  const gate = useRef(new SpeechGate());
  /** Most recent student transcript, for telling a nod from a question. */
  const lastHeard = useRef('');
  /** Recent mic chunks, replayed when an utterance commits. */
  const preroll = useRef<Int16Array[]>([]);
  /**
   * The server announced an interruption while the student was still speaking.
   * Held until the utterance ends, because that is when it can be judged.
   */
  const bargeIn = useRef(false);
  /**
   * What the teacher has said this turn, each chunk tagged with the output
   * sample it starts at — so a barge-in can be told where the student's ears
   * actually stopped.
   */
  const spoken = useRef<{ text: string; atSamples: number }[]>([]);
  const [micOn, setMicOn] = useState(true);
  /** The viewfinder is open — the student is lining up a shot, briefly. */
  const [showing, setShowing] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const camStream = useRef<MediaStream | null>(null);
  const camVideo = useRef<HTMLVideoElement | null>(null);
  /**
   * The last thing the student held up, kept as a still.
   *
   * A still, not a stream. Holding a notebook up to a teacher is one act with
   * one picture in it, and a lesson does not need frames of a desk between
   * them — so the camera runs only while the viewfinder is open, and what
   * survives is the single frame the student chose.
   */
  const heldFrame = useRef<{ mimeType: string; data: string; at: number } | null>(null);
  /** True between activityStart and activityEnd. */
  const streaming = useRef(false);
  /** When the speaker last made a sound — the start of the echo's tail. */
  const lastOutAt = useRef(-Infinity);
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

  /**
   * A still from the student's camera, as a JPEG the model can be handed.
   *
   * Taken at the moment the teacher asks rather than streamed, because a
   * lesson does not need 2fps of a desk — it needs the one frame where the
   * notebook is being held up. 768px wide is enough to read handwriting and
   * small enough not to cost a noticeable pause.
   */
  const grabFrame = useCallback((): { mimeType: string; data: string } | null => {
    const video = camVideo.current;
    if (!video || !camStream.current || video.videoWidth === 0) return null;
    const w = 768;
    const h = Math.round((video.videoHeight / video.videoWidth) * w) || 576;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const url = canvas.toDataURL('image/jpeg', 0.72);
    return { mimeType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
  }, []);

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
    /**
     * The model has gone quiet on purpose — waiting on a result — and been
     * answered. If it still has not spoken after a while, the lesson has died
     * mid-explanation, indistinguishable to a student from "it said one line
     * and stopped". Nudge it back rather than leave the board frozen.
     */
    const expectSpeech = (after: string) => {
      awaitingResume.current = performance.now();
      window.setTimeout(() => {
        if (!awaitingResume.current) return;
        if (performance.now() - awaitingResume.current < STALL_MS) return;
        awaitingResume.current = 0;
        push('system', `teacher stalled after ${after} — nudged`);
        sessRef.current?.nudge(
          'You stopped mid-explanation. Carry on from where you were and finish the whole explanation. Do not restart it.',
        );
      }, STALL_MS + 150);
    };

    /** Which board reply wakes a teacher that stopped to wait for it — see `voice/wake.ts`. */
    const wake = new Wakeup();

    /**
     * The teacher SEES the board — the picture the student is looking at, not
     * a list of what it asked for. A figure clamped to fit, a label sitting
     * on a ray, a line half-written when it was cut off: none of that reaches
     * a list of ids, and all of it is in the picture. The manifest rides along
     * so it can still name what it wants to point at.
     *
     * Rendered in the background shortly after every change (25ms, no
     * network), and sent once the board has been still for a few seconds —
     * a trailing debounce, so a flurry of strokes costs one picture. And sent
     * on the spot the moment the student starts talking, before their audio,
     * so their question arrives after the board it is about.
     *
     * Never while their audio is streaming: context injected into that was
     * measured to come back as garbage. Anything that changed meanwhile goes
     * the moment they finish.
     */
    const snap = {
      version: 0,
      rendered: 0,
      sent: 0,
      latest: null as Snapshot | null,
      renderTimer: 0,
      sendTimer: 0,
    };
    const renderBoard = async () => {
      const svg = svgRef.current;
      if (!svg || snap.rendered === snap.version) return;
      const version = snap.version;
      try {
        const picture = await snapshotBoard(svg);
        if (version > snap.rendered) {
          snap.latest = picture;
          snap.rendered = version;
        }
      } catch (e) {
        push('system', `board snapshot failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    const showBoard = () => {
      if (streaming.current || !snap.latest || snap.sent >= snap.rendered) return;
      sessRef.current?.sendImageContext(
        `SYSTEM: the board right now, exactly as the student sees it. On it, by id:\n${boardSummary(scene)}\nNothing to reply to — carry on.`,
        snap.latest,
      );
      if (!snap.sent) push('system', 'the teacher can see the board now');
      snap.sent = snap.rendered;
    };
    const boardChanged = () => {
      snap.version++;
      window.clearTimeout(snap.renderTimer);
      window.clearTimeout(snap.sendTimer);
      snap.renderTimer = window.setTimeout(renderBoard, SNAPSHOT_RENDER_MS);
      snap.sendTimer = window.setTimeout(async () => {
        await renderBoard();
        showBoard();
      }, SNAPSHOT_QUIET_MS);
    };

    const sched = new OpScheduler((call) => {
      const r = dispatch(call, scene, scene.clock.time);
      for (const op of r.ops) {
        scene.applyOp(op);
        // Recorded here, at the moment the chalk moves, so the replay has the
        // rhythm the student heard rather than the socket's 5–13s lead.
        recRef.current?.add(op);
      }
      if (r.ops.length) boardChanged();
      push('system', r.note);
      // The reply describes what actually happened, so it is sent now rather
      // than on arrival — and SILENT, unless the model ended its turn on this
      // call and is waiting for it to carry on.
      const held = wake.answer(call.callId, (waiting) => {
        // Not while the student has the floor: their turn is what the model
        // answers next, and it restarts generation on its own.
        const resume = r.resume || (waiting && !streaming.current);
        sessRef.current?.sendToolResponse(
          call.callId,
          call.name,
          { ...r.response, board: boardSummary(scene) },
          resume,
        );
        if (resume && !r.resume) {
          push('system', 'teacher was waiting on the board — told it to carry on');
          expectSpeech('the board');
        }
      });
      // Held until the generation shows whether it was waiting. If neither
      // end signal ever comes, send it anyway rather than never.
      if (held) {
        window.setTimeout(() => {
          const waiting = wake.expire(call.callId);
          if (waiting.length) sched.release(waiting);
        }, STALL_MS);
      }
    });

    /** The model finished a generation: if it ended on board calls, it is waiting on them. */
    const generationOver = () => {
      const waiting = wake.turnComplete();
      // Drawn now, not after a lead-in for speech that is never coming.
      if (waiting.length) sched.release(waiting);
    };
    schedRef.current = sched;

    /**
     * Let the queued sentence carry on — the student was only nodding.
     *
     * Generation runs seconds ahead of playback, so what is still queued is the
     * REST OF THE SENTENCE the model already produced. Resuming is the perfect
     * continuation, with nothing to repair.
     */
    const carryOn = (reason: string) => {
      bargeIn.current = false;
      heldRef.current = false;
      io.resume();
      scene.clock.start();
      push('system', `backchannel (${reason}) — carried on`);
    };

    /**
     * The last words the student actually heard, quoted back.
     *
     * The server keeps whatever it SENT; the student heard whatever the
     * speaker reached, and those differ by the 5–13s of queued audio this
     * whole architecture is built around. So after a barge-in the model's
     * context holds a completed turn covering the entire explanation, and
     * telling it "you did not finish" contradicts the transcript sitting right
     * next to it — it believes the transcript, and carries on.
     *
     * Quoting the real boundary is the one thing that does not contradict
     * anything. Playback is held from the first moment the microphone hears
     * the student, so `played` has already stopped at exactly the right place.
     */
    const heardSoFar = () => {
      const upTo = io.clock.played;
      // A chunk counts as heard only once the NEXT one has also begun before
      // the boundary — otherwise the speaker was still inside it and the
      // student got part of those words, not all of them. Quoting slightly
      // less than they heard costs nothing; quoting more is the whole bug.
      const heard = spoken.current
        .filter((_, i) => {
          const next = spoken.current[i + 1];
          return next ? next.atSamples <= upTo : false;
        })
        .map((c) => c.text)
        .join('');
      const unheard = spoken.current.some((c) => c.atSamples >= upTo);
      // Cut at a word boundary and keep the tail: never quote half a word, and
      // never claim more than was played.
      const tail = heard.trimEnd().split(/\s+/).slice(-12).join(' ');
      return { tail, unheard };
    };

    /** The student really has taken the turn. Stop, and say what was heard. */
    const takeTheTurn = (reason: string) => {
      bargeIn.current = false;
      heldRef.current = false;
      const { tail, unheard } = heardSoFar();
      // COMMIT: what was never heard is never drawn.
      const dropped = sched.dropUnheard();
      io.flush();
      // The rest of that turn is gone for good, and the clock has now counted
      // it as passed — so none of it may be quoted as heard by a later cut.
      spoken.current = [];
      dropped.forEach((d, i) => {
        wake.drop(d.callId);
        // Tell the model the chalk never moved. Otherwise it believes it drew
        // these and will refer back to things that are not there. The board
        // summary rides on the FIRST one only — several copies of it is a lot
        // of tokens at the exact moment the student is waiting to be answered.
        sessRef.current?.sendToolResponse(
          d.callId,
          d.name,
          {
            ok: false,
            error: 'not drawn — the student interrupted before you said this',
            ...(i === 0 ? { board: boardSummary(scene) } : {}),
          },
          false,
        );
      });
      /**
       * One correction, sent as one message, immediately before the student's
       * turn is handed over — see the call site. Tool responses only say which
       * chalk failed to land; nothing else tells the model where its own voice
       * actually stopped.
       */
      if (INJECT_INTERRUPT_CONTEXT) {
        const cut = cutRef.current;
        const lines = [
          tail
            ? `SYSTEM: the student cut in. They heard you only as far as "...${tail}"${
                unheard ? ' and nothing after that' : ''
              } — the rest of that turn never reached them, so do not refer to it or assume they know it.`
            : 'SYSTEM: the student cut in before they heard any of that turn.',
          cut ? `On the board, "${cut.id}" is only half-written.` : null,
          dropped.length ? `Never drawn: ${dropped.map((d) => d.name).join(', ')}.` : null,
          'Answer what they just said. Do not restart, greet or apologise.',
        ].filter(Boolean);
        sessRef.current?.sendContext(lines.join(' '));
      }
      cutRef.current = null;
      push('system', `barge-in (${reason}) — heard up to "…${tail.slice(-40)}"`);
      if (dropped.length) push('system', `dropped ${dropped.length} unheard op(s)`);
    };

    /**
     * Decide what the student's utterance WAS — once it is over.
     *
     * This is the whole of the fix for a teacher that stops and then carries
     * on regardless. The decision used to be taken the instant the server
     * announced an interruption, which is roughly a quarter of a second into
     * the student's first word: too short to be anything but a nod by the
     * duration rule, and with the transcript not yet arrived. So a real
     * question was read as "haan", the queue resumed, and the teacher went
     * back to the sentence the student had just cut into.
     *
     * Both pieces of evidence — how long they spoke, and what they said —
     * only exist once they stop. So that is when this runs.
     */
    const settleTurn = (committed: boolean, heard: { voicedMs: number; spanMs: number }) => {
      // Nothing of the teacher's was playing, so nothing was interrupted: an
      // ordinary turn, and it must not be reported to the model as a barge-in.
      // The queue is checked as well as the hold, because the hold only arms
      // while the teacher is audible and the VAD can miss that instant.
      if (!heldRef.current && io.clock.queued === 0) {
        bargeIn.current = false;
        return;
      }
      // The span, which is what the nod/question cutoff was tuned on. Voiced
      // time runs short of it in every word — the gaps at each consonant —
      // and would read a real question as a nod whenever the transcript is
      // late. Whether it was speech at all is the gate's call, already made.
      const verdict = classifyInterruption(heard.spanMs, lastHeard.current);
      /**
       * A nod may only be called a nod on the evidence of the WORDS.
       *
       * `committed` means the server was told the student is speaking, and the
       * server kills the running generation the moment it hears that. Resuming
       * the queue afterwards plays out a turn that no longer exists, and the
       * answer to what was actually asked arrives behind all of it — which is
       * the failure this whole path exists to prevent.
       *
       * Measured: the transcript lands in 247-398ms, well inside the wait, so
       * a real "haan" does arrive as the word "haan" and still carries on. A
       * committed utterance that only LOOKS short is the other case entirely —
       * speech broken into pieces by the echo guard — and it is treated as
       * real, because the cost of being wrong is a sentence and the cost of
       * the alternative is ignoring the student.
       */
      // Too short to be a word at all — never escalate that to taking the
      // turn, whatever else is true about it. A committed utterance always
      // clears this; it guards a server interrupt the gate never committed.
      if (heard.voicedMs < MIN_VOICED_MS) {
        carryOn('too short to be speech');
        return;
      }
      if (committed && verdict.isBackchannel && verdict.via === 'duration') {
        takeTheTurn(`${verdict.reason}, but committed`);
        return;
      }
      // Nothing measurable was said: never throw a turn away on that.
      if (verdict.spurious) carryOn('nothing heard');
      else if (verdict.isBackchannel) carryOn(verdict.reason);
      else takeTheTurn(verdict.reason);
    };

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
          wake.audio();
          io.push(pcm);
        },
        turnStart: () => {
          spoken.current = [];
          sched.markTurnStart(io.clock.played);
        },
        turnEnd: () => {
          speakingRef.current = false;
          generationOver();
        },
        // Whichever of the two end signals comes first; the second is a no-op.
        generationEnd: generationOver,
        transcript: (c) => {
          if (c.role === 'model') spoken.current.push({ text: c.text, atSamples: c.atSamples });
          if (c.role === 'user') lastHeard.current += ` ${c.text}`;
          push(c.role === 'model' ? 'teacher' : 'student', c.text);
        },
        interrupted: () => {
          /**
           * The server has stopped generating. What it does NOT tell us is
           * whether the student was asking something or just agreeing — and
           * this arrives about a quarter of a second into their first word,
           * long before either answer exists.
           *
           * So nothing is decided here. The voice is already held from the
           * first moment the microphone heard them, so the student hears the
           * teacher stop either way; all that is deferred is whether the
           * queued sentence is thrown away or resumed, and that is settled
           * when they stop talking.
           */
          // Generation was cut off whatever is decided below, so nothing it
          // asked for is being waited on.
          wake.interrupted();
          const g = gate.current;
          const recent = performance.now() - g.lastVoice < 1500;
          if (!g.speaking && !recent) {
            // The server heard something this microphone did not. Flushing
            // would bin the 5–13s of queued speech and the student would hear
            // almost nothing — which is what "can't hear the teacher" looks
            // like. Keep playing.
            push('system', 'ignored a server interrupt — no local speech');
            return;
          }
          if (g.speaking) {
            bargeIn.current = true;
            return;
          }
          // They have already stopped, so it can be settled now.
          settleTurn(streaming.current, g);
        },
        toolCall: (call: ToolCall) => {
          /**
           * `look` is BLOCKING and answers from the camera, not the board, so
           * it never reaches the scheduler: there is no chalk to anchor it to
           * and the teacher has stopped to see the thing.
           */
          if (call.name === 'look') {
            const held = heldFrame.current;
            push('system', held ? 'looked at what the student showed' : 'look — nothing being shown');
            session.sendToolResponse(
              call.callId,
              call.name,
              held
                ? {
                    ok: true,
                    note: 'the picture is attached — this is what the student is holding up',
                    takenSecondsAgo: Math.round((Date.now() - held.at) / 1000),
                  }
                : {
                    ok: false,
                    error: 'the student is not showing you anything right now',
                    fix: 'ask them to press Show and hold it up to the camera',
                  },
              true,
              held ? { mimeType: held.mimeType, data: held.data } : undefined,
            );
            awaitingResume.current = performance.now();
            return;
          }
          // calc is BLOCKING: generation has stopped waiting for it, so it
          // cannot wait on the pen. Everything else is queued for playback.
          if (call.name === 'calc') {
            const r = dispatch(call, scene, scene.clock.time);
            push('system', r.note);
            session.sendToolResponse(call.callId, call.name, r.response, r.resume);
            // Generation stopped for this. Make sure it starts again.
            expectSpeech('calc');
            return;
          }
          wake.call(call.callId);
          // Start early enough that the stroke spans the phrase rather than
          // following it — the model emits the call after saying the words.
          sched.enqueue(call, startEarlyMs(call.name, call.args));
        },
        toolCancel: (ids) => {
          sched.cancel(ids);
          ids.forEach((id) => wake.drop(id));
        },
        error: (m) => push('system', `error: ${m}`),
      },
      () => io.clock.played,
    );
    sessRef.current = session;

    io.onClock = (c) => {
      sched.tick(c.played);
      setOutLevel(c.level);
      if (c.peak > OUT_AUDIBLE) lastOutAt.current = performance.now();
      setQueued(c.queued);
      if (c.queued > 0 || c.level > 0.012) setAwaiting(false);
    };

    await io.start();
    if (io.blocked) {
      push('system', `audio output is ${io.outputState} — the browser blocked playback`);
    }
    // What the browser really did with the microphone. Asking is not getting,
    // and the echo guard's numbers mean nothing without knowing which.
    const mic = io.micSettings();
    push(
      'system',
      `mic: echo cancellation ${mic?.echoCancellation ?? '?'}, noise suppression ${
        mic?.noiseSuppression ?? '?'
      }, auto gain ${mic?.autoGainControl ?? '?'} · output latency ${Math.round(io.outputLatencyMs)}ms`,
    );

    gate.current = new SpeechGate();
    /** The onset that started the current utterance, for the log. */
    let onset: { peak: number; bar: number } | null = null;

    io.onPcm = (pcm, peak) => {
      setLevel(peak);
      const now = performance.now();
      const sinceOut = now - lastOutAt.current;
      // The teacher's voice may still be arriving at the microphone.
      const echoLive = sinceOut < ECHO_TAIL_MS + io.outputLatencyMs;

      /**
       * Hold recent audio so a committed utterance can replay its own opening.
       *
       * Anything captured while the teacher's voice could still be reaching
       * the microphone is echo, not speech, and must never be replayed into
       * the model. This was once relaxed to a short window on the theory that
       * a barge-in loses its first word otherwise — and it cost far more than
       * it bought. Prepending even a fraction of a second of the teacher's own
       * voice to the student's turn made the recogniser return nonsense: "ray
       * optics" came back as "leucifix", "noticias", "game of fix", and the
       * model, reasonably, could not answer any of it.
       *
       * A clipped opening is a small problem. Feeding the model a mixture of
       * two voices and calling it the student is a total one.
       *
       * "Could still be reaching" is timed from the last sound the speaker
       * actually made. It used to be the display envelope, which takes over a
       * second to fall — so after the teacher was held, the student's first
       * second was thrown away with the echo that had already stopped. And
       * once the student is clearly talking over the teacher, what is left of
       * the echo is under their voice rather than ahead of it — see
       * `SpeechGate.prerollable`.
       */
      if (!gate.current.prerollable(echoLive)) preroll.current = [];
      if (!streaming.current) {
        preroll.current.push(pcm);
        const maxChunks = Math.ceil((PREROLL_MS / 1000) * 16000 / 128);
        while (preroll.current.length > maxChunks) preroll.current.shift();
      }

      let sent = false;
      const events = gate.current.push({
        now,
        peak,
        ms: (pcm.length / INPUT_RATE) * 1000,
        echoLive,
        learnEcho: sinceOut < ECHO_LEARN_MS,
      });
      for (const e of events) {
        switch (e.type) {
          case 'onset':
            lastHeard.current = '';
            onset = { peak: e.peak, bar: e.bar };
            break;

          case 'hold':
            /**
             * HOLD: stop the voice and freeze the pen mid-stroke, without
             * waiting for the server to confirm anything.
             *
             * Whenever the student can HEAR the teacher — which is not the
             * same as the teacher's turn being open. The server finishes
             * generating seconds before the speaker finishes playing it, and
             * testing only the open turn meant that for the whole tail of an
             * explanation a student talking over the teacher did not stop it:
             * the voice ran on underneath them until they gave up, and what
             * reached the model was the two of them at once.
             */
            if ((speakingRef.current || io.clock.queued > 0) && !heldRef.current) {
              heldRef.current = true;
              io.hold();
              // Freezes the pen AND records the line as half-written, which is
              // what the model is told in the board summary.
              cutRef.current = scene.interruptActiveWrite();
              // The freeze comes from the microphone, not a tool call, so the
              // recorder has to be told about it separately or the replay
              // shows an uninterrupted line.
              if (cutRef.current) {
                recRef.current?.interrupt(cutRef.current.id, cutRef.current.at);
              }
              scene.clock.freeze();
              // The pen stopped mid-stroke: that half-line is what they see.
              boardChanged();
              if (onset) {
                push(
                  'system',
                  `held the teacher (mic ${onset.peak.toFixed(3)} vs bar ${onset.bar.toFixed(3)})`,
                );
              }
            }
            break;

          case 'commit':
            // Tell the server only now — see `voice/gate.ts` for what makes
            // this speech rather than a crackle.
            // The board they are about to ask about, ahead of their words.
            showBoard();
            streaming.current = true;
            session.activityStart();
            // The pre-roll already holds this block, so it is not sent twice.
            for (const chunk of preroll.current) session.sendAudio(chunk);
            preroll.current = [];
            sent = true;
            break;

          case 'reject':
            // Never committed — the server was never told, so nothing of the
            // teacher's was interrupted and the queued sentence carries on.
            if (bargeIn.current) settleTurn(false, e);
            else if (heldRef.current) carryOn(`blip, ${Math.round(e.voicedMs)}ms`);
            break;

          case 'end':
            streaming.current = false;
            session.activityEnd();
            // Handed over; now we are waiting on the teacher.
            setAwaiting(true);
            /**
             * Settled AFTER the turn is handed over, never during it.
             *
             * Injecting context while the student's audio is still streaming
             * was measured to produce garbage — in one probe the model spoke
             * its own markup aloud. This order is the one that was measured
             * clean, and reasoning about ordering guarantees does not outrank
             * that.
             */
            settleTurn(true, e);
            // Whatever changed on the board while they were talking.
            showBoard();
            break;
        }
      }
      if (streaming.current && !sent) session.sendAudio(pcm);
    };

    await session.connect();
  }, [push, phase]);

  const closeViewfinder = useCallback(() => {
    if (camStream.current) {
      for (const t of camStream.current.getTracks()) t.stop();
      camStream.current = null;
    }
    if (camVideo.current) camVideo.current.srcObject = null;
    setShowing(false);
  }, []);

  /** Open the viewfinder. The camera runs only while it is open. */
  const openViewfinder = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Rear camera where there is one: the thing being shown is a notebook
        // on the desk, not the student's face.
        video: { width: { ideal: 1280 }, facingMode: { ideal: 'environment' } },
        audio: false,
      });
      camStream.current = stream;
      if (camVideo.current) {
        camVideo.current.srcObject = stream;
        await camVideo.current.play().catch(() => {});
      }
      setCameraError('');
      setShowing(true);
    } catch {
      setCameraError('camera blocked');
      setShowing(false);
    }
  }, []);

  /**
   * Hold it up: take the one frame, put the camera away, and tell the teacher
   * there is something to look at.
   *
   * The picture itself can only travel on a tool RESPONSE, so it waits here
   * until the teacher asks — which it does because this line tells it to. One
   * image per thing shown, and nothing at all in between.
   */
  const showIt = useCallback(() => {
    const frame = grabFrame();
    closeViewfinder();
    if (!frame) {
      setCameraError('could not take the picture');
      return;
    }
    heldFrame.current = { ...frame, at: Date.now() };
    push('system', 'showed the teacher a picture');
    sessRef.current?.sendContext(
      'SYSTEM: the student is holding something up to show you. Call look now to see it, then talk about what is actually in it.',
    );
  }, [grabFrame, closeViewfinder, push]);

  const toggleMic = useCallback(() => {
    setMicOn((on) => {
      ioRef.current?.muteMic(on);
      return !on;
    });
  }, []);

  const stop = useCallback(async () => {
    setPhase('idle');
    if (camStream.current) {
      for (const t of camStream.current.getTracks()) t.stop();
      camStream.current = null;
    }
    setShowing(false);
    heldFrame.current = null;
    setMicOn(true);
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
        className="flex h-full items-center"
        style={{
          /**
           * The height BOTH columns get.
           *
           * The board is an SVG that keeps its 3:2 ratio, so on a wide window
           * it is width-limited and its height lands wherever the ratio puts
           * it — while the rail, being `h-full`, ran the whole window. Nothing
           * tied them together and the two boxes disagreed by however much the
           * ratio happened to leave over.
           *
           * So the board's height is worked out here instead of discovered:
           * the smaller of the room available and what the width allows at
           * 3:2, with the rail's own width and both gutters taken out first.
           * Both columns are then given it and centred, and they agree at
           * every window size — including a tall narrow one, where the board
           * becomes height-limited and the rail shortens to meet it.
           */
          ['--stage-h' as string]:
            'min(calc(100vh - 3.5rem), calc((100vw - clamp(330px, 30vw, 460px) - 7rem) * 2 / 3))',
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
      <section
        className="flex min-w-0 flex-1 items-center justify-center pl-8 pr-6"
        style={{ height: 'var(--stage-h)' }}
      >
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
            {/* data-snapshot="skip": surface and hand, not board — see board/snapshot.ts */}
            <rect width={CANVAS_W} height={CANVAS_H} fill="url(#vig)" data-snapshot="skip" />
            <rect width={CANVAS_W} height={CANVAS_H} filter="url(#grain)" opacity="0.05" data-snapshot="skip" />
            <g ref={figRef} />
            <g ref={inkRef} />
            <g ref={markRef} />
            <g ref={penRef} data-snapshot="skip" />
          </svg>

          {/*
            The student's camera, in the board's corner — where a video call
            puts the other person.

            Pinned to the board's REAL corner, not the section's. The board is
            always exactly --stage-h tall and 3:2, centred, so its right edge
            sits half the leftover width in from the section's; the offsets
            below are that arithmetic, which lets the SVG keep sizing itself
            (wrapping it would change what its max-width/max-height mean).

            Mounted always, shown only while a shot is being lined up: the
            stream attaches the instant permission is granted, and an element
            that only appeared once `showing` flipped would not exist yet.
          */}
          <div
            className="absolute z-10 overflow-hidden rounded-lg transition-opacity duration-200"
            style={{
              right: 'calc((100% - var(--stage-h) * 1.5) / 2 + 18px)',
              bottom: '18px',
              width: 'calc(var(--stage-h) * 1.5 * 0.26)',
              aspectRatio: '4 / 3',
              opacity: showing ? 1 : 0,
              pointerEvents: showing ? 'auto' : 'none',
              background: 'var(--void)',
              boxShadow: '0 0 0 1px var(--hairline), 0 18px 40px -12px rgb(0 0 0 / 0.85)',
            }}
          >
            <video ref={camVideo} muted playsInline className="h-full w-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2.5 pb-2.5 pt-8"
              style={{ background: 'linear-gradient(to top, rgb(0 0 0 / 0.55), transparent)' }}
            >
              <button
                onClick={showIt}
                aria-label="Show this to the teacher"
                className="flex h-10 w-10 items-center justify-center rounded-full transition-opacity hover:opacity-85"
                style={{ background: 'var(--ember)', color: 'var(--void)' }}
              >
                <Camera size={18} strokeWidth={1.9} />
              </button>
              <button
                onClick={closeViewfinder}
                aria-label="Cancel"
                className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[color:rgb(255_255_255/0.16)]"
                style={{ background: 'rgb(255 255 255 / 0.1)', color: 'var(--chalk-soft)' }}
              >
                <X size={16} strokeWidth={1.9} />
              </button>
            </div>
          </div>

        </div>
      </section>

      {/* ── the rail ────────────────────────────────────────────────────────
          A panel, not a loose column — the same surface treatment as the board,
          so the two halves read as siblings. The title is gone: "Physics
          kinematics" was a label for something already obvious from the board,
          and the row is worth more as transcript. */}
      <aside
        className="rise flex w-[30%] min-w-[330px] max-w-[460px] flex-col pl-6 pr-8"
        style={{ height: 'var(--stage-h)', animationDelay: '120ms' }}
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
          {showing && (
            <span className="label ml-auto" style={{ color: 'var(--ember)' }}>
              camera on
            </span>
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

        {/*
          The student's own controls — the same three a call has, in the same
          order, because this IS a call and nobody should have to learn it.
          They live under the presence, on the student's side of the room; the
          board belongs to the teacher.

          The video element is always mounted, never conditional: the stream is
          attached to it the moment permission is granted, and an element that
          only appears once `cameraOn` flips would not exist yet at that point.
        */}
        {/*
          The student's own controls — the same three a call has, in the same
          order, because this IS a call and nobody should have to learn it.
          They live under the presence, on the student's side of the room; the
          board belongs to the teacher.
        */}
        <div className={active ? 'shrink-0 px-6 pb-5' : 'hidden'}>
          {cameraError && (
            <p className="label mb-3 text-center" style={{ color: 'var(--ember)' }}>
              {cameraError}
            </p>
          )}
          <div className="flex items-center justify-center gap-3">
            <CallButton on={micOn} onClick={toggleMic} label={micOn ? 'Mute' : 'Unmute'}>
              {micOn ? <Mic size={19} strokeWidth={1.75} /> : <MicOff size={19} strokeWidth={1.75} />}
            </CallButton>
            <CallButton
              on={!showing}
              onClick={showing ? closeViewfinder : openViewfinder}
              label={showing ? 'Put the camera away' : 'Show the teacher something'}
            >
              {showing ? <VideoOff size={19} strokeWidth={1.75} /> : <Video size={19} strokeWidth={1.75} />}
            </CallButton>
            <CallButton on={false} danger onClick={stop} label="End the lesson">
              <PhoneOff size={19} strokeWidth={1.75} />
            </CallButton>
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
