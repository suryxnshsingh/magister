'use client';

/**
 * Every registered figure, at true board scale, with its steps drivable.
 *
 * A figure is the one board tier nobody sees before a live session: writes and
 * marks show up in `/replay`, but a template only appears when the model calls
 * `scene`, and by then it is too late to notice the axes are off the board.
 * This page is where a new figure gets looked at — build it with real params,
 * fire each step, check it fits inside the figure column.
 *
 * It resolves through the same registry the live `scene` op uses, so a figure
 * that renders here is reachable by the teacher, and one that is missing here
 * was never registered.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { SceneClock } from '@/board/clock';
import {
  figureNames,
  getFigure,
  parseParams,
} from '@/board/templates';
import type { Template } from '@/board/templates/projectile';
import { CANVAS_H, CANVAS_W, FIGURE, toPx } from '@/board/units';

export default function FigureTest() {
  const figRef = useRef<SVGGElement>(null);
  const clockRef = useRef<SceneClock | null>(null);
  const tplRef = useRef<Template | null>(null);

  const names = figureNames();
  const [name, setName] = useState(names[0] ?? '');
  const [params, setParams] = useState(getFigure(names[0] ?? '')?.params ?? '');
  const [steps, setSteps] = useState<string[]>([]);
  const [parts, setParts] = useState<string[]>([]);
  const [done, setDone] = useState<string[]>([]);
  const [showBounds, setShowBounds] = useState(true);
  const [drift, setDrift] = useState('');

  /** Rebuild from scratch — the same path `scene` takes on a live call. */
  const build = useCallback(() => {
    const layer = figRef.current;
    if (!layer) return;
    clockRef.current?.clear();
    layer.replaceChildren();

    const spec = getFigure(name);
    if (!spec) return;

    const clock = new SceneClock();
    clockRef.current = clock;
    const tpl = spec.build('fig', layer, parseParams(params), toPx);
    tplRef.current = tpl;
    setSteps(tpl.stepNames);
    setParts(tpl.partNames);
    setDone([]);

    // The registry declares parts and steps so `scene` can answer the model
    // before the figure is built. Nothing keeps those declarations honest
    // except this check, so it runs every time a figure is rendered.
    const missP = spec.parts.filter((p) => !tpl.partNames.includes(p));
    const extraP = tpl.partNames.filter((p) => !spec.parts.includes(p));
    const missS = spec.steps.filter((s) => !tpl.stepNames.includes(s));
    const extraS = tpl.stepNames.filter((s) => !spec.steps.includes(s));
    setDrift(
      [
        missP.length && `declared parts not built: ${missP.join(', ')}`,
        extraP.length && `built parts not declared: ${extraP.join(', ')}`,
        missS.length && `declared steps not built: ${missS.join(', ')}`,
        extraS.length && `built steps not declared: ${extraS.join(', ')}`,
      ]
        .filter(Boolean)
        .join(' · '),
    );

    for (const a of tpl.steps.get('setup')?.(0) ?? []) clock.add(a);
    clock.prime();
    clock.start();
    setDone(['setup']);
  }, [name, params]);

  useEffect(() => {
    build();
    return () => clockRef.current?.clear();
  }, [build]);

  /** Fire a reveal step at the current scene time, as the teacher would. */
  function fire(step: string) {
    const clock = clockRef.current;
    const tpl = tplRef.current;
    if (!clock || !tpl) return;
    for (const a of tpl.steps.get(step)?.(clock.time) ?? []) clock.add(a);
    clock.prime();
    clock.start();
    setDone((d) => (d.includes(step) ? d : [...d, step]));
  }

  const f = { x: toPx({ x: FIGURE.left, y: FIGURE.top }), w: 0 };
  const boundsPx = {
    x: f.x.x,
    y: f.x.y,
    w: toPx({ x: FIGURE.right, y: 0 }).x - f.x.x,
    h: toPx({ x: 0, y: FIGURE.bottom }).y - f.x.y,
  };

  return (
    <main className="min-h-screen bg-void p-8 text-chalk-soft">
      <div className="mx-auto max-w-[1500px]">
        <h1 className="mb-1 text-lg font-medium text-chalk">
          Figures — every registered template, at board scale
        </h1>
        <p className="mb-4 text-sm text-ash">
          Resolved through the same registry the live <code>scene</code> op
          uses. If a figure is missing here, the teacher cannot draw it either.
        </p>

        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <select
            value={name}
            onChange={(e) => {
              const n = e.target.value;
              setName(n);
              setParams(getFigure(n)?.params ?? '');
            }}
            className="rounded border border-hairline bg-raised px-2 py-1 text-chalk"
          >
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>

          <input
            value={params}
            onChange={(e) => setParams(e.target.value)}
            spellCheck={false}
            className="min-w-[30rem] flex-1 rounded border border-hairline bg-raised px-2 py-1 font-mono text-xs text-chalk"
          />

          <button
            onClick={build}
            className="rounded border border-ember-dim px-3 py-1 text-ember"
          >
            rebuild
          </button>

          <label className="flex items-center gap-1.5 text-xs text-ash">
            <input
              type="checkbox"
              checked={showBounds}
              onChange={(e) => setShowBounds(e.target.checked)}
            />
            figure column
          </label>
        </div>

        {drift && (
          <p className="mb-3 rounded border border-rust/50 px-3 py-2 text-xs text-rust">
            registry drift — the model would be told the wrong thing: {drift}
          </p>
        )}

        <svg
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          className="w-full rounded-lg shadow-2xl"
          style={{ background: '#1d2b26' }}
        >
          <defs>
            <radialGradient id="vig" cx="50%" cy="45%" r="75%">
              <stop offset="0%" stopColor="#24352e" />
              <stop offset="100%" stopColor="#16201c" />
            </radialGradient>
          </defs>
          <rect width={CANVAS_W} height={CANVAS_H} fill="url(#vig)" />

          {/* The column a figure is supposed to stay inside. Anything that
              crosses this line would collide with the derivation. */}
          {showBounds && (
            <rect
              x={boundsPx.x}
              y={boundsPx.y}
              width={boundsPx.w}
              height={boundsPx.h}
              fill="none"
              stroke="#f0d264"
              strokeWidth="2"
              strokeDasharray="10 10"
              opacity="0.35"
            />
          )}

          <g ref={figRef} />
        </svg>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          {steps.map((s) => (
            <button
              key={s}
              onClick={() => fire(s)}
              className={`rounded border px-3 py-1 ${
                done.includes(s)
                  ? 'border-hairline text-ash'
                  : 'border-ember-dim text-ember'
              }`}
            >
              {s}
            </button>
          ))}
          <span className="ml-3 text-xs text-ash">
            parts: <code className="font-mono">{parts.join(' ')}</code>
          </span>
        </div>
      </div>
    </main>
  );
}
