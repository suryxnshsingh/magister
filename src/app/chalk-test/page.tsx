'use client';

/**
 * Chalk bench — how much imperfection makes maths look written?
 *
 * MathJax has no handwritten font, so the only lever for maths is the geometry
 * of the glyphs themselves. This renders the same equation at several wobble
 * amounts so the sweet spot can be chosen by eye rather than argued about:
 * too little and it is still LaTeX, too much and it looks broken rather than
 * human.
 */
import { useEffect, useRef, useState } from 'react';

const TEX = String.raw`u_x = u\cos\theta = 17.3\ \text{m/s}`;
const TEX2 = String.raw`R = \frac{u^2\sin 2\theta}{g}`;

const LEVELS: { amount: number; jitter: boolean; label: string }[] = [
  { amount: 0, jitter: false, label: 'none — as MathJax sets it' },
  { amount: 9, jitter: false, label: 'wobble only (outlines bent)' },
  { amount: 0, jitter: true, label: 'jitter only (rotation / baseline drift)' },
  { amount: 9, jitter: true, label: 'both — wobble 9 + jitter' },
  { amount: 15, jitter: true, label: 'both — wobble 15 + jitter' },
];

export default function ChalkTest() {
  const host = useRef<HTMLDivElement>(null);
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ typeset }, { roughenGlyphs, handJitter }] = await Promise.all([
        import('@/board/math/mathjax'),
        import('@/board/chalk/roughen'),
      ]);
      if (cancelled || !host.current) return;
      const root = host.current;
      root.replaceChildren();

      const t0 = performance.now();
      for (const lvl of LEVELS) {
        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom:34px';
        const tag = document.createElement('div');
        tag.className = 'label';
        tag.style.cssText = 'color:var(--ash);margin-bottom:10px';
        tag.textContent = lvl.label;
        row.appendChild(tag);

        const line = document.createElement('div');
        line.style.cssText = 'display:flex;gap:56px;align-items:center';
        for (const tex of [TEX, TEX2]) {
          const ts = typeset(tex, 0.62);
          if (lvl.amount > 0) roughenGlyphs(ts.glyphs, { amount: lvl.amount });
          if (lvl.jitter) handJitter(ts.glyphs);
          ts.glyphs.forEach((g) => {
            g.style.fill = 'var(--chalk)';
            g.style.stroke = 'none';
          });
          ts.svg.setAttribute('overflow', 'visible');
          line.appendChild(ts.svg);
        }
        row.appendChild(line);
        root.appendChild(row);
      }
      if (!cancelled) setMs(Math.round(performance.now() - t0));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen p-10" style={{ background: 'var(--void)' }}>
      <h1 className="mb-1 text-[15px]" style={{ color: 'var(--chalk)' }}>
        Chalk — how much wobble?
      </h1>
      <p className="mb-8 text-sm" style={{ color: 'var(--ash)' }}>
        MathJax v4 ships nine fonts, none handwritten, so for maths the only
        lever is the glyph outlines. Smooth low-frequency displacement along
        each contour, seeded per glyph so repeated characters differ.
        {ms !== null && ` Typeset + roughen: ${ms}ms for 10 expressions.`}
      </p>
      <div
        ref={host}
        className="rounded-[3px] p-10"
        style={{ background: 'var(--board)', boxShadow: '0 0 0 1px var(--hairline)' }}
      />
    </div>
  );
}
