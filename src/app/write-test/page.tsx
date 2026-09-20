'use client';

/**
 * M0 visual test: stroke-by-stroke writing, and what a freeze looks like.
 *
 * Beat 7 of the screenplay is the whole project in one frame — the student
 * cuts in partway through `R = u_x \times T` and the pen stops dead. This page
 * animates that line, lets it be frozen anywhere, and shows the two freeze
 * strategies side by side on the same instant so the still frames can be
 * compared directly.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { CANVAS_H, CANVAS_W, toPx, type Pt } from '@/board/units';
import { interruptAt, localAt, resumeAt, SceneClock } from '@/board/clock';
import { createWrite, type WriteAnimation } from '@/board/animations/write';

const TEX = String.raw`R = u_x \times T`;
/** Where the student interrupts, as a fraction of the write. */
const BARGE_IN_AT = 0.46;

export default function WriteTest() {
  const svgRef = useRef<SVGSVGElement>(null);
  const layerRef = useRef<SVGGElement>(null);
  const clockRef = useRef<SceneClock | null>(null);
  const animRef = useRef<WriteAnimation | null>(null);

  const [pen, setPen] = useState<Pt | null>(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [phase, setPhase] = useState('idle');
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { typeset } = await import('@/board/math/mathjax');
      if (cancelled || !layerRef.current || !svgRef.current) return;

      const ts = typeset(TEX, 0.62);
      const layer = layerRef.current;
      layer.replaceChildren();
      const at = toPx({ x: -3.6, y: 0.9 });
      const holder = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      holder.setAttribute('transform', `translate(${at.x}, ${at.y})`);
      ts.svg.setAttribute('overflow', 'visible');
      holder.appendChild(ts.svg);
      layer.appendChild(holder);

      const clock = new SceneClock();
      const anim = createWrite('range', ts.glyphs, svgRef.current, 0, {
        strokeWidth: 1.8,
      });
      clock.add(anim);
      clock.prime();
      clock.onTick((now) => {
        setT(now);
        const { local, active } = localAt(anim, now);
        setPen(active ? anim.penAt(local) : null);
        setPhase(clock.phase);
      });
      clockRef.current = clock;
      animRef.current = anim;
      clock.seek(0);
      setDur(anim.duration);
      clock.start();
      setPhase('running');
    })();
    return () => {
      cancelled = true;
      clockRef.current?.freeze();
    };
  }, []);

  const freeze = useCallback(() => {
    clockRef.current?.freeze();
    setPhase('frozen');
  }, []);

  /**
   * Beat 7. Cutting the animation's first segment short IS the freeze — there
   * is no separate frozen flag, just a timeline that stops there until a
   * second segment is added.
   */
  const bargeIn = useCallback((settleIt: boolean) => {
    const clock = clockRef.current;
    const anim = animRef.current;
    if (!clock || !anim) return;
    const raw = anim.duration * BARGE_IN_AT;
    interruptAt(anim, settleIt ? anim.settleTime(raw) : raw);
    const seg = anim.segments[0];
    clock.freeze();
    clock.seek(seg.at + seg.len);
    setPhase('frozen');
    setTruncated(true);
  }, []);

  /**
   * Beat 9: the teacher comes back and finishes the line. Without a second
   * segment the pen would freeze forever and the `T` would never be written.
   */
  const resume = useCallback(() => {
    const clock = clockRef.current;
    const anim = animRef.current;
    if (!clock || !anim) return;
    resumeAt(anim, clock.time);
    setTruncated(false);
    clock.start();
    setPhase('running');
  }, []);

  const reset = useCallback(() => {
    const clock = clockRef.current;
    if (!clock) return;
    clock.rewind();
    setTruncated(false);
    clock.start();
    setPhase('running');
  }, []);

  const pct = dur ? Math.round((t / dur) * 100) : 0;

  return (
    <div className="min-h-screen bg-neutral-950 p-6 text-neutral-200">
      <div className="mx-auto max-w-[1500px]">
        <h1 className="mb-1 text-lg font-medium">
          Write &amp; freeze — beat 7 of the screenplay
        </h1>
        <p className="mb-4 text-sm text-neutral-400">
          DrawBorderThenFill over MathJax glyph outlines, driven by the scene
          clock. Freeze stops the pen exactly where it is; truncate makes that
          permanent.
        </p>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H / 2}`}
          className="w-full rounded-lg shadow-2xl"
          style={{ background: '#1d2b26' }}
        >
          <g ref={layerRef} />
          {pen && (
            <g>
              {/* chalk tip — without it a frozen half-line reads as lag */}
              <circle cx={pen.x} cy={pen.y} r={9} fill="#fff8e0" opacity={0.95} />
              <circle cx={pen.x} cy={pen.y} r={20} fill="#fff8e0" opacity={0.12} />
            </g>
          )}
        </svg>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <button
            onClick={() => (phase === 'running' ? freeze() : clockRef.current?.start())}
            className="rounded bg-neutral-800 px-3 py-1.5 hover:bg-neutral-700"
          >
            {phase === 'running' ? 'Freeze' : 'Play'}
          </button>
          <button
            onClick={() => bargeIn(false)}
            className="rounded bg-amber-700 px-3 py-1.5 hover:bg-amber-600"
          >
            Barge-in (raw)
          </button>
          <button
            onClick={() => bargeIn(true)}
            className="rounded bg-amber-800 px-3 py-1.5 hover:bg-amber-700"
          >
            Barge-in (settled)
          </button>
          <button
            onClick={resume}
            disabled={!truncated}
            className="rounded bg-emerald-700 px-3 py-1.5 hover:bg-emerald-600 disabled:opacity-35"
          >
            Resume (beat 9)
          </button>
          <button
            onClick={reset}
            className="rounded bg-neutral-800 px-3 py-1.5 hover:bg-neutral-700"
          >
            Reset
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(1, dur)}
            value={t}
            onChange={(e) => {
              clockRef.current?.freeze();
              clockRef.current?.seek(Number(e.target.value));
              setPhase('frozen');
            }}
            className="ml-2 w-72"
          />
          <span className="font-mono text-xs text-neutral-400">
            {phase} · {Math.round(t)}ms / {Math.round(dur)}ms · {pct}%
            {truncated && ' · TRUNCATED'}
          </span>
        </div>

        <FreezeComparison />
      </div>
    </div>
  );
}

/**
 * The same instant rendered both ways, as still frames. This is the call the
 * plan flagged for week 1: does a hollow half-traced glyph look like chalk
 * stopping, or like a bug?
 */
function FreezeComparison() {
  const midRef = useRef<SVGGElement>(null);
  const snapRef = useRef<SVGGElement>(null);
  const hostA = useRef<SVGSVGElement>(null);
  const hostB = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { typeset } = await import('@/board/math/mathjax');
      if (cancelled) return;

      const build = (
        layer: SVGGElement | null,
        host: SVGSVGElement | null,
        snap: boolean,
      ) => {
        if (!layer || !host) return;
        const ts = typeset(TEX, 0.62);
        layer.replaceChildren();
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', `translate(36, 150)`);
        ts.svg.setAttribute('overflow', 'visible');
        g.appendChild(ts.svg);
        layer.appendChild(g);

        const anim = createWrite('cmp', ts.glyphs, host, 0, { strokeWidth: 1.8 });
        anim.init?.();
        const raw = anim.duration * BARGE_IN_AT;
        anim.apply(snap ? anim.settleTime(raw) : raw);
      };

      build(midRef.current, hostA.current, false);
      build(snapRef.current, hostB.current, true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const panel = (
    label: string,
    note: string,
    layer: React.RefObject<SVGGElement | null>,
    host: React.RefObject<SVGSVGElement | null>,
  ) => (
    <div>
      <div className="mb-1 text-sm font-medium">{label}</div>
      <div className="mb-2 text-xs text-neutral-500">{note}</div>
      <svg
        ref={host}
        viewBox="0 0 560 210"
        className="w-full rounded-lg"
        style={{ background: '#1d2b26' }}
      >
        <g ref={layer} />
      </svg>
    </div>
  );

  return (
    <div className="mt-8">
      <h2 className="mb-3 text-base font-medium">
        Same instant, two freeze strategies
      </h2>
      <div className="grid grid-cols-2 gap-5">
        {panel(
          'Raw freeze',
          'Stops dead. The glyph in progress is a traced contour with partial fill — a ghost letter, not half a letter.',
          midRef,
          hostA,
        )}
        {panel(
          'Settled',
          'Finishes a glyph that is mostly drawn, erases one barely begun. A crisp chalk edge that holds for the length of a correction.',
          snapRef,
          hostB,
        )}
      </div>
    </div>
  );
}
