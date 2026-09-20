'use client';

/**
 * Replay — a board played back from an op log, no model.
 *
 * Two sources. With no query it plays the M0 screenplay fixture: if a recording
 * of that doesn't look incredible, no amount of Gemini fixes it. With
 * `?session=<id>` it plays back a real lesson recorded by `/`, which is how a
 * live take gets judged by evidence instead of memory.
 *
 * Everything here is a pure function of scene time, so scrubbing backwards
 * lands on exactly the frame the forward playthrough showed — and the same
 * property is what makes the speed control honest: at 8x you are watching the
 * real lesson compressed, not an approximation of it.
 */
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useSearchParams } from 'next/navigation';

import { CANVAS_H, CANVAS_W } from '@/board/units';
import { OpLog } from '@/board/oplog';
import { createPenElements, renderPen, type PenElements } from '@/board/pen-render';
import type { Scene } from '@/board/scene';
import { SCREENPLAY_OPS } from '@/board/fixtures/screenplay';
import {
  serverSessionsSnapshot,
  sessionsSnapshot,
  subscribeSessions,
  type RecordedSession,
} from '@/board/sessions';
import type { Op } from '@/board/oplog';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TAIL_MS = 2500;

/**
 * `useSearchParams` client-side-renders everything up to the nearest Suspense
 * boundary, which is why the page is split. That is not just ceremony here: it
 * also means the localStorage reads below never run during prerender, so the
 * recorded-session list cannot mismatch between server and client.
 */
export default function Replay() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-neutral-950 p-6 text-neutral-500">
          Loading replay…
        </div>
      }
    >
      <ReplayInner />
    </Suspense>
  );
}

function ReplayInner() {
  const searchParams = useSearchParams();
  const svgRef = useRef<SVGSVGElement>(null);
  const inkRef = useRef<SVGGElement>(null);
  const figRef = useRef<SVGGElement>(null);
  const markRef = useRef<SVGGElement>(null);
  const sceneRef = useRef<Scene | null>(null);

  const penRef = useRef<SVGGElement>(null);
  const penEls = useRef<PenElements | null>(null);
  const [penMode, setPenMode] = useState('\u2014');
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [summary, setSummary] = useState('');
  const [rate, setRate] = useState(1);
  const [source, setSource] = useState(
    () => searchParams.get('session') ?? 'screenplay',
  );
  const recorded: RecordedSession[] = useSyncExternalStore(
    subscribeSessions,
    sessionsSnapshot,
    serverSessionsSnapshot,
  );

  /**
   * A recorded session that has gone missing falls back to the fixture rather
   * than rendering an empty board with no explanation. Resolved from the store
   * rather than from storage directly, so render stays a pure function of it.
   */
  const ops: Op[] = useMemo(
    () =>
      source === 'screenplay'
        ? SCREENPLAY_OPS
        : (recorded.find((r) => r.id === source)?.ops ?? SCREENPLAY_OPS),
    [source, recorded],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { Scene } = await import('@/board/scene');
      if (cancelled) return;
      if (!svgRef.current || !inkRef.current || !markRef.current || !figRef.current) return;

      const scene = new Scene(svgRef.current, {
        ink: inkRef.current,
        figures: figRef.current!,
        marks: markRef.current,
      });
      const log = new OpLog().appendAll(ops);
      scene.build(log);
      sceneRef.current = scene;

      if (penRef.current && !penEls.current) {
        penEls.current = createPenElements(penRef.current);
      }
      const end = log.duration + TAIL_MS;
      scene.clock.onTick((now) => {
        // Written straight to the DOM in the same tick as the ink, so the tip
        // never trails the stroke it is making.
        const p = scene.pen.at(now);
        renderPen(penEls.current, p);
        setT(Math.min(now, end));
        setPenMode(p.mode);
        setSummary(scene.summary());
        // Stop at the end of the lesson. Left running, the clock climbs past
        // the last op forever — the scrub bar pins at maximum and the readout
        // claims a length the lesson does not have. It matters most at 8x,
        // where the overrun arrives eight times faster.
        if (now >= end) {
          scene.clock.freeze();
          setPlaying(false);
        }
      });
      setDur(end);
      scene.clock.setRate(rate);
      scene.clock.seek(0);
      scene.clock.start();
      setPlaying(true);
    })();
    return () => {
      cancelled = true;
      sceneRef.current?.clock.freeze();
    };
    // `rate` is applied live below, so it must not rebuild the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops]);

  /**
   * Speed is a property of the clock, so it changes mid-playback without
   * rebuilding anything — and it is applied here, in the handler, because
   * changing playback speed is something the viewer did, not state to be
   * synchronised back into the scene on a later render.
   */
  const setSpeed = useCallback((r: number) => {
    setRate(r);
    const c = sceneRef.current?.clock;
    if (c) c.setRate(r);
  }, []);

  const toggle = useCallback(() => {
    const c = sceneRef.current?.clock;
    if (!c) return;
    if (c.phase === 'running') {
      c.freeze();
      setPlaying(false);
    } else {
      // Play at the end means play again. Without this the clock starts,
      // immediately trips the end check, and the button looks broken.
      if (dur > 0 && c.time >= dur) c.seek(0);
      c.start();
      setPlaying(true);
    }
  }, [dur]);

  const restart = useCallback(async () => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.build(new OpLog().appendAll(ops));
    scene.clock.setRate(rate);
    scene.clock.start();
    setPlaying(true);
  }, [rate, ops]);

  const scrub = useCallback((v: number) => {
    const c = sceneRef.current?.clock;
    if (!c) return;
    c.freeze();
    c.seek(v);
    setPlaying(false);
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 p-6 text-neutral-200">
      <div className="mx-auto max-w-[1500px]">
        <h1 className="mb-1 text-lg font-medium">
          Replay — a board played back from its op log
        </h1>
        <p className="mb-3 text-sm text-neutral-400">
          {source === 'screenplay'
            ? 'The M0 screenplay, no model. Beats 2–10: writing, a freeze mid-line at beat 7, the refer-back circle at beat 8, and the resume at beat 9.'
            : `A recorded lesson — ${ops.length} ops, exactly as they fired.`}
        </p>

        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
          >
            <option value="screenplay">screenplay (fixture)</option>
            {recorded.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.startedAt).toLocaleString()} — {r.title}
              </option>
            ))}
          </select>
          {recorded.length === 0 && (
            <span className="text-xs text-neutral-500">
              no recorded lessons yet — one is saved every time you teach at /
            </span>
          )}
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          className="w-full rounded-lg shadow-2xl"
          style={{ background: '#1d2b26' }}
        >
          <defs>
            <radialGradient id="vig" cx="50%" cy="45%" r="75%">
              <stop offset="0%" stopColor="#24352e" />
              <stop offset="100%" stopColor="#16201c" />
            </radialGradient>
            <filter id="grain">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.85"
                numOctaves="3"
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
            </filter>
          </defs>
          <rect width={CANVAS_W} height={CANVAS_H} fill="url(#vig)" />
          {/* Grain is a static overlay, never a filter on the ink group: a live
              feTurbulence re-evaluates every frame a dashoffset changes. */}
          <rect
            width={CANVAS_W}
            height={CANVAS_H}
            filter="url(#grain)"
            opacity="0.045"
          />

          {/* figures under the ink, marks over everything */}
          <g ref={figRef} />
          <g ref={inkRef} />
          <g ref={markRef} />

          <g ref={penRef} />
        </svg>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <button
            onClick={toggle}
            className="w-20 rounded bg-neutral-800 px-3 py-1.5 hover:bg-neutral-700"
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            onClick={restart}
            className="rounded bg-neutral-800 px-3 py-1.5 hover:bg-neutral-700"
          >
            Restart
          </button>
          {/* Speed is the clock's rate, so 8x is the real lesson compressed —
              every stroke still drawn, just faster. That is the time-lapse. */}
          {[1, 2, 4, 8].map((r) => (
            <button
              key={r}
              onClick={() => setSpeed(r)}
              className={`rounded px-2.5 py-1.5 font-mono text-xs ${
                rate === r
                  ? 'bg-amber-600/80 text-neutral-950'
                  : 'bg-neutral-800 hover:bg-neutral-700'
              }`}
            >
              {r}x
            </button>
          ))}
          <input
            type="range"
            min={0}
            max={Math.max(1, dur)}
            value={t}
            onChange={(e) => scrub(Number(e.target.value))}
            className="ml-2 flex-1"
          />
          <span className="w-28 text-right font-mono text-xs text-neutral-400">
            {(t / 1000).toFixed(1)}s / {(dur / 1000).toFixed(1)}s
          </span>
        </div>

        <div className="mt-4 flex gap-6 text-xs">
          <div className="flex-1">
            <div className="mb-1 text-neutral-500">
              Board summary — what the model would be told it has written
            </div>
            <pre className="whitespace-pre-wrap font-mono text-neutral-400">
              {summary}
            </pre>
          </div>
          <div className="w-56">
            <div className="mb-1 text-neutral-500">Pen</div>
            <div className="font-mono text-neutral-400">{penMode}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Keeps SVG_NS referenced for future layer creation without a lint warning. */
void SVG_NS;
