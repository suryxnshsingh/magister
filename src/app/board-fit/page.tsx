'use client';

/**
 * M0 acceptance gate: does the screenplay's final board fit one page?
 *
 * Renders the end state of the lesson — all six derivation lines, the figure,
 * and every mark that is still on the board when the video ends — at true
 * scale with real typeset MathJax. Nothing here is estimated. If this
 * overflows, the screenplay gets shorter before any animation is built.
 *
 * Not the runtime. This is a static mock; the animated player lands next.
 */
import { useEffect, useRef, useState } from 'react';

import {
  CANVAS_H,
  CANVAS_W,
  DERIVATION,
  PX_PER_UNIT,
  toPx,
  type Pt,
} from '@/board/units';
import { makeFigure } from '@/board/templates/projectile-geometry';

const CHALK = '#f2efe4';
const CHALK_DIM = '#cfc9b6';
const YELLOW = '#f0d264';

/** The six lines, in the order the teacher writes them. */
const LINES: { id: string; tex: string; intent: string }[] = [
  { id: 'given', tex: String.raw`u = 20\ \text{m/s},\ \theta = 30^\circ`, intent: 'title' },
  { id: 'ux', tex: String.raw`u_x = u\cos\theta = 17.3\ \text{m/s}`, intent: 'under:given' },
  { id: 'uy', tex: String.raw`u_y = u\sin\theta = 10\ \text{m/s}`, intent: 'under:ux' },
  { id: 'T', tex: String.raw`T = \frac{2u_y}{g} = 2\ \text{s}`, intent: 'under:uy' },
  { id: 'range', tex: String.raw`R = u_x \times T = 34.6\ \text{m}`, intent: 'under:T' },
  { id: 'formula', tex: String.raw`R = \frac{u^2\sin 2\theta}{g}`, intent: 'under:range' },
];

/**
 * Line spacing. 0.46 spreads the six lines across ~6.1 of the 7.1 available
 * units; at 0.30 the derivation bunched into the top half and left a third of
 * the board dead, which reads as dumped text rather than a used board.
 */
const GAP = 0.46;

/** The sub-expression the teacher circles in beat 8. */
const CIRCLED_PART = { line: 'ux', prefix: String.raw`u_x =`, term: String.raw`u\cos\theta` };

/** Where "v = 0" lands in beat 8, relative to the apex. */
const V_ZERO_AT = (() => {
  const f = makeFigure();
  return { x: f.apex.x - 1.0, y: f.apex.y + 0.34 };
})();

interface Placed {
  id: string;
  intent: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function BoardFit() {
  const mathLayer = useRef<SVGGElement>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { typeset } = await import('@/board/math/mathjax');
        if (cancelled || !mathLayer.current) return;
        const layer = mathLayer.current;
        layer.replaceChildren();

        const out: Placed[] = [];
        let cursorY = DERIVATION.top;

        for (const line of LINES) {
          const ts = typeset(line.tex);
          // cursorY is the top of the line's box; place by its top-left.
          const topLeft = toPx({ x: DERIVATION.x, y: cursorY });
          const holder = document.createElementNS(
            'http://www.w3.org/2000/svg',
            'g',
          );
          holder.setAttribute('transform', `translate(${topLeft.x}, ${topLeft.y})`);
          holder.setAttribute('data-id', line.id);
          ts.svg.setAttribute('x', '0');
          ts.svg.setAttribute('y', '0');
          ts.svg.setAttribute('overflow', 'visible');
          // Chalk, not ink.
          ts.glyphs.forEach((p) => {
            p.setAttribute('fill', CHALK);
            p.setAttribute('stroke', 'none');
          });
          holder.appendChild(ts.svg);
          layer.appendChild(holder);

          out.push({
            id: line.id,
            intent: line.intent,
            x: DERIVATION.x,
            y: cursorY,
            w: ts.width,
            h: ts.height,
          });
          cursorY -= ts.height + GAP;
        }
        if (!cancelled) setPlaced(out);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fig = makeFigure();
  const p = (pt: Pt) => toPx(pt);
  const pathD =
    fig.path
      .map((pt, i) => {
        const q = p(pt);
        return `${i === 0 ? 'M' : 'L'}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
      })
      .join(' ') ?? '';

  const lastLine = placed[placed.length - 1];
  const usedH = lastLine ? DERIVATION.top - (lastLine.y - lastLine.h) : 0;
  const widest = placed.reduce((m, l) => Math.max(m, l.w), 0);
  const availH = DERIVATION.top - (-4 + 0.45);
  const fits = usedH <= availH && widest <= DERIVATION.width;

  return (
    <div className="min-h-screen bg-neutral-950 p-6 text-neutral-200">
      <div className="mx-auto max-w-[1500px]">
        <h1 className="mb-1 text-lg font-medium">
          Board fit — final state of the screenplay
        </h1>
        <p className="mb-4 text-sm text-neutral-400">
          Real typeset MathJax at {CANVAS_W}×{CANVAS_H}. Nothing is erased during
          the lesson, so every line below must coexist.
        </p>

        <svg
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          className="w-full rounded-lg shadow-2xl"
          style={{ background: '#1d2b26' }}
        >
          <defs>
            {/* Chalk grain, baked once into a static pattern. Never a live
                filter on the ink group: re-evaluating feTurbulence every frame
                that a dashoffset changes will not hold 60fps. */}
            <filter id="grain">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.85"
                numOctaves="3"
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <radialGradient id="vignette" cx="50%" cy="45%" r="75%">
              <stop offset="0%" stopColor="#24352e" />
              <stop offset="100%" stopColor="#16201c" />
            </radialGradient>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,1 L10,5 L0,9 z" fill={CHALK} />
            </marker>
            <marker
              id="arrowY"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,1 L10,5 L0,9 z" fill={YELLOW} />
            </marker>
          </defs>

          <rect width={CANVAS_W} height={CANVAS_H} fill="url(#vignette)" />
          <rect
            width={CANVAS_W}
            height={CANVAS_H}
            filter="url(#grain)"
            opacity="0.045"
          />

          {/* ---- figure ---- */}
          <g strokeLinecap="round" fill="none">
            <line
              x1={p({ x: fig.ground.x1, y: fig.ground.y }).x}
              y1={p({ x: fig.ground.x1, y: fig.ground.y }).y}
              x2={p({ x: fig.ground.x2, y: fig.ground.y }).x}
              y2={p({ x: fig.ground.x2, y: fig.ground.y }).y}
              stroke={CHALK_DIM}
              strokeWidth={3}
            />
            <path d={pathD} stroke={CHALK} strokeWidth={3.5} opacity={0.95} />

            {/* launch velocity + components */}
            <line
              x1={p(fig.launch).x}
              y1={p(fig.launch).y}
              x2={p(fig.uTip).x}
              y2={p(fig.uTip).y}
              stroke={CHALK}
              strokeWidth={4}
              markerEnd="url(#arrow)"
            />
            <line
              x1={p(fig.launch).x}
              y1={p(fig.launch).y}
              x2={p(fig.uxTip).x}
              y2={p(fig.uxTip).y}
              stroke={YELLOW}
              strokeWidth={3.5}
              markerEnd="url(#arrowY)"
            />
            <line
              x1={p(fig.uxTip).x}
              y1={p(fig.uxTip).y}
              x2={p(fig.uyTip).x}
              y2={p(fig.uyTip).y}
              stroke={YELLOW}
              strokeWidth={3.5}
              markerEnd="url(#arrowY)"
              strokeDasharray="7 6"
            />

            {/* apex: the horizontal velocity that survives */}
            <circle cx={p(fig.apex).x} cy={p(fig.apex).y} r={6} fill={CHALK} />
            <line
              x1={p(fig.apexVel.from).x}
              y1={p(fig.apexVel.from).y}
              x2={p(fig.apexVel.to).x}
              y2={p(fig.apexVel.to).y}
              stroke={YELLOW}
              strokeWidth={4}
              markerEnd="url(#arrowY)"
            />

            {/* range bar */}
            <line
              x1={p({ x: fig.rangeBar.x1, y: fig.rangeBar.y }).x}
              y1={p({ x: fig.rangeBar.x1, y: fig.rangeBar.y }).y}
              x2={p({ x: fig.rangeBar.x2, y: fig.rangeBar.y }).x}
              y2={p({ x: fig.rangeBar.x2, y: fig.rangeBar.y }).y}
              stroke={CHALK_DIM}
              strokeWidth={2.5}
            />
            <circle cx={p(fig.landing).x} cy={p(fig.landing).y} r={7} fill={CHALK} />
          </g>

          {/* figure labels, in the chalk colour the single-line font will use */}
          <g
            fill={CHALK}
            fontFamily="ui-sans-serif, system-ui"
            fontSize={30}
            fontStyle="italic"
          >
            <text x={p(fig.uTip).x + 10} y={p(fig.uTip).y - 6}>
              u
            </text>
            {/* the misconception from beat 8, struck through by <Marks> */}
            <text x={p(V_ZERO_AT).x} y={p(V_ZERO_AT).y} fill="#e08a7a">
              v = 0
            </text>
            <text
              x={p(fig.apexVel.to).x + 10}
              y={p(fig.apexVel.to).y + 10}
              fill={YELLOW}
            >
              v = uₓ
            </text>
            <text
              x={p({ x: (fig.rangeBar.x1 + fig.rangeBar.x2) / 2, y: 0 }).x}
              y={p({ x: 0, y: fig.rangeBar.y }).y + 42}
              fill={CHALK_DIM}
              fontStyle="normal"
              textAnchor="middle"
            >
              R = 34.6 m
            </text>
          </g>

          {/* ---- derivation column (MathJax injects here) ---- */}
          <g ref={mathLayer} />

          {/* ---- marks still on the board at the end ---- */}
          {placed.length > 0 && <Marks placed={placed} />}
        </svg>

        <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-8 gap-y-1 font-mono text-xs">
          {err && <div className="col-span-2 text-red-400">MathJax error: {err}</div>}
          {placed.map((l) => (
            <div key={l.id} className="contents">
              <span className="text-neutral-500">
                {l.id.padEnd(8)} {l.intent}
              </span>
              <span className="text-neutral-400">
                w {l.w.toFixed(2)} × h {l.h.toFixed(2)} @ y {l.y.toFixed(2)}
              </span>
            </div>
          ))}
          {placed.length > 0 && (
            <>
              <span className={fits ? 'text-emerald-400' : 'text-red-400'}>
                {fits ? 'FITS' : 'OVERFLOW'}
              </span>
              <span className="text-neutral-400">
                height {usedH.toFixed(2)}/{availH.toFixed(2)} · widest{' '}
                {widest.toFixed(2)}/{DERIVATION.width.toFixed(2)} board units
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Underline on u_x, circle on u_x, box on the range line, strike on v = 0. */
function Marks({ placed }: { placed: Placed[] }) {
  const [paths, setPaths] = useState<{ d: string; stroke: string; w: number }[]>(
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rough = (await import('roughjs')).default;
      if (cancelled) return;
      const gen = rough.generator();
      const out: { d: string; stroke: string; w: number }[] = [];

      const by = (id: string) => placed.find((l) => l.id === id);
      const ux = by('ux');
      const range = by('range');

      const push = (
        drawable: ReturnType<typeof gen.line>,
        stroke: string,
        w: number,
      ) => {
        for (const op of gen.toPaths(drawable)) out.push({ d: op.d, stroke, w });
      };

      if (ux) {
        // beat 5: underline the whole line ("ye line yaad rakhna")
        const a = toPx({ x: ux.x, y: ux.y - ux.h - 0.06 });
        const b = toPx({ x: ux.x + ux.w, y: ux.y - ux.h - 0.06 });
        push(
          gen.line(a.x, a.y, b.x, b.y, { roughness: 1.4, strokeWidth: 3.5 }),
          CHALK,
          3.5,
        );

        // beat 8: circle the TERM, not the line. An oval circumscribing the
        // full line needs ~1.4x its width and would slice through "m/s".
        const { measure } = await import('@/board/math/mathjax');
        const start = measure(CIRCLED_PART.prefix).width;
        const termW = measure(CIRCLED_PART.term).width;
        const c = toPx({
          x: ux.x + start + termW / 2 + 0.1,
          y: ux.y - ux.h / 2 + 0.02,
        });
        push(
          gen.ellipse(
            c.x,
            c.y,
            (termW + 0.42) * PX_PER_UNIT,
            (ux.h + 0.46) * PX_PER_UNIT,
            { roughness: 1.6, strokeWidth: 4 },
          ),
          YELLOW,
          4,
        );
      }
      if (range) {
        const tl = toPx({ x: range.x - 0.14, y: range.y + 0.12 });
        push(
          gen.rectangle(
            tl.x,
            tl.y,
            (range.w + 0.28) * PX_PER_UNIT,
            (range.h + 0.25) * PX_PER_UNIT,
            { roughness: 1.5, strokeWidth: 3.5 },
          ),
          CHALK,
          3.5,
        );
      }

      // beat 8: the misconception, written at the apex and struck out. It sits
      // up-left of the apex because the surviving horizontal arrow claims the
      // space to its right.
      const vz = V_ZERO_AT;
      // Through the glyphs, not under them — above the baseline by roughly
      // half an x-height. Below reads as an underline, which is the opposite
      // of what a strike means.
      const s1 = toPx({ x: vz.x - 0.06, y: vz.y + 0.13 });
      const s2 = toPx({ x: vz.x + 0.68, y: vz.y + 0.16 });
      push(
        gen.line(s1.x, s1.y, s2.x, s2.y, { roughness: 1.6, strokeWidth: 3.5 }),
        '#e08a7a',
        3.5,
      );
      if (!cancelled) setPaths(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [placed]);

  return (
    <g fill="none" strokeLinecap="round">
      {paths.map((p, i) => (
        <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.w} />
      ))}
    </g>
  );
}
