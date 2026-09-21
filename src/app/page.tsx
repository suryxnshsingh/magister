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
import { Camera, Mic, MicOff, PhoneOff, Video, VideoOff, X } from 'lucide-react';

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
 * At the moment of committing, the last voiced frame must be no older than
 * this — i.e. the student is still talking, not trailing off inside the hang
 * window that keeps `speaking` true after they stop.
 */
const VOICE_RECENT_MS = 120;
/**
 * And they must have been voicing for at least this long. Below it, nothing is
 * a word: a click, a chair, a breath, or the residue of the teacher's own
 * voice. Measured from a failing session, the phantom turns ran 10-81ms.
 */
const MIN_VOICED_MS = 160;
/**
 * How far above the LEARNED echo the student has to be.
 *
 * This used to be a fixed fraction of the speaker output, which is a guess
 * about a room nobody can see: too low and the teacher's own voice commits as
 * the student's, too high and a real barge-in is ignored. There is no single
 * number that is right for both headphones and open speakers.
 *
 * So the echo is measured rather than assumed — see `echoFloor`. A headset
 * drives it to the noise floor and barge-in stays easy; open speakers raise
 * it and the student has to genuinely out-talk the room, which is the honest
 * bar rather than an arbitrary one.
 */
const ECHO_MARGIN = 2.5;

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
  const vad = useRef({
    speaking: false,
    lastVoice: 0,
    floor: 0.02,
    startedAt: 0,
    /** What the microphone hears while the teacher talks and nobody else does. */
    echoFloor: 0,
  });
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
      dropped.forEach((d, i) => {
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
    const settleTurn = (committed: boolean) => {
      // Nothing of the teacher's was playing, so nothing was interrupted: an
      // ordinary turn, and it must not be reported to the model as a barge-in.
      // The queue is checked as well as the hold, because the hold only arms
      // while the teacher is audible and the VAD can miss that instant.
      if (!heldRef.current && io.clock.queued === 0) {
        bargeIn.current = false;
        return;
      }
      const v = vad.current;
      const verdict = classifyInterruption(
        Math.max(0, v.lastVoice - v.startedAt),
        lastHeard.current,
      );
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
      // turn, whatever else is true about it.
      if (Math.max(0, v.lastVoice - v.startedAt) < MIN_VOICED_MS) {
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
          io.push(pcm);
        },
        turnStart: () => {
          spoken.current = [];
          sched.markTurnStart(io.clock.played);
        },
        turnEnd: () => {
          speakingRef.current = false;
        },
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
          const v = vad.current;
          const recent = performance.now() - v.lastVoice < 1500;
          if (!v.speaking && !recent) {
            // The server heard something this microphone did not. Flushing
            // would bin the 5–13s of queued speech and the student would hear
            // almost nothing — which is what "can't hear the teacher" looks
            // like. Keep playing.
            push('system', 'ignored a server interrupt — no local speech');
            return;
          }
          if (v.speaking) {
            bargeIn.current = true;
            return;
          }
          // They have already stopped, so it can be settled now.
          settleTurn(streaming.current);
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
      /**
       * Learn what the teacher's voice comes back as.
       *
       * While the teacher is audible and nothing has yet been taken for
       * speech, whatever the microphone hears IS the leftover echo — the part
       * cancellation could not remove. Averaging it slowly gives a real
       * measurement of this room and these speakers, which is the thing the
       * threshold should be set against. It decays once the teacher stops, so
       * a student who moves to headphones is not held to yesterday's bar.
       */
      if (echo > 0.02 && !v.speaking) {
        v.echoFloor = v.echoFloor * 0.97 + peak * 0.03;
      } else if (echo <= 0.02) {
        v.echoFloor *= 0.999;
      }
      /**
       * Two bars, and the higher one wins: the room's own noise, and the
       * teacher's voice coming back through the speakers.
       *
       * There was a third — the noise floor multiplied by `1 + echo * 7` — and
       * it was a stand-in for the echo from before anything measured it.
       * Keeping it next to a real measurement counts the same thing twice and
       * puts the bar near shouting: a student speaking normally over the
       * teacher falls just under it and is never heard at all.
       */
      const thr = Math.max(
        VAD_FLOOR_MIN,
        v.floor * VAD_MULTIPLE,
        // Above the echo this room actually produces, not a guess at it.
        v.echoFloor * ECHO_MARGIN,
      );

      /**
       * Hold recent audio so a committed utterance can replay its own opening.
       *
       * Anything captured while the teacher was audible is echo, not speech,
       * and must never be replayed into the model. This was once relaxed to a
       * short window on the theory that a barge-in loses its first word
       * otherwise — and it cost far more than it bought. Prepending even a
       * fraction of a second of the teacher's own voice to the student's turn
       * made the recogniser return nonsense: "ray optics" came back as
       * "leucifix", "noticias", "game of fix", and the model, reasonably,
       * could not answer any of it.
       *
       * A clipped opening is a small problem. Feeding the model a mixture of
       * two voices and calling it the student is a total one.
       */
      if (echoRef.current > 0.02) preroll.current = [];
      if (!streaming.current) {
        preroll.current.push(pcm);
        const maxChunks = Math.ceil((PREROLL_MS / 1000) * 16000 / 128);
        while (preroll.current.length > maxChunks) preroll.current.shift();
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
          /**
           * Tell the server only once this really is speech.
           *
           * `speaking` is NOT the test for that, and using it alone is how a
           * silent room committed turn after turn. It stays true through the
           * whole hang window after the last voiced frame — 320ms — which
           * outlives this 260ms timer, so ten milliseconds of a chair creaking
           * was still "speaking" when the timer checked and went to the server
           * as a student turn. It came back transcribed as "¿Qué?".
           *
           * The two things that actually distinguish a word from a click: the
           * student is STILL voicing when we look, and they have been voicing
           * long enough for it to be a word. Re-armed rather than abandoned,
           * so a real sentence with a breath in it still commits.
           */
          window.clearTimeout(commitTimer.current);
          const tryCommit = () => {
            const s = vad.current;
            if (streaming.current || !s.speaking) return;
            const voicedFor = s.lastVoice - s.startedAt;
            if (performance.now() - s.lastVoice <= VOICE_RECENT_MS && voicedFor >= MIN_VOICED_MS) {
              streaming.current = true;
              session.activityStart();
              for (const chunk of preroll.current) session.sendAudio(chunk);
              preroll.current = [];
              return;
            }
            commitTimer.current = window.setTimeout(tryCommit, 60);
          };
          commitTimer.current = window.setTimeout(tryCommit, COMMIT_SPEECH_MS);
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
        const committed = streaming.current;
        if (committed) {
          streaming.current = false;
          session.activityEnd();
          // Handed over; now we are waiting on the teacher.
          setAwaiting(true);
        } else {
          // Never committed — a blip the server was never told about.
          push('system', 'blip ignored — teacher not interrupted');
        }
        /**
         * Settled AFTER the turn is handed over, never during it.
         *
         * Injecting context while the student's audio is still streaming was
         * measured to produce garbage — in one probe the model spoke its own
         * markup aloud. This order is the one that was measured clean, and
         * reasoning about ordering guarantees does not outrank that.
         *
         * The utterance is over, so there is finally something to judge it on.
         * A blip the server was never told about cannot have interrupted
         * anything, so the queued sentence simply carries on.
         */
        if (committed || bargeIn.current) settleTurn(committed);
        else if (heldRef.current) carryOn('blip');
      }
      if (streaming.current) session.sendAudio(pcm);
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
            <rect width={CANVAS_W} height={CANVAS_H} fill="url(#vig)" />
            <rect width={CANVAS_W} height={CANVAS_H} filter="url(#grain)" opacity="0.05" />
            <g ref={figRef} />
            <g ref={inkRef} />
            <g ref={markRef} />
            <g ref={penRef} />
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
