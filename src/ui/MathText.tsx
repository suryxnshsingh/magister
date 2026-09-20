'use client';

/**
 * Prose with `$...$` maths, for the transcript.
 *
 * KaTeX, not MathJax — and the reason is worth stating, because the board
 * deliberately rejects KaTeX. The board needs glyphs as SVG `<path>` elements
 * so each one can be traced with a dash offset; KaTeX emits positioned HTML
 * spans, which cannot be drawn stroke by stroke. Here nothing is animated, so
 * that objection disappears and KaTeX's much smaller, faster render wins.
 *
 * Two sources feed this:
 *   - Gemini's own output transcription, which formats maths as LaTeX
 *     (`$u_x$`) even though the spoken audio is plain Hinglish.
 *   - Board content, which the model writes in our backslash-free notation
 *     (`u cos(theta)`).
 *
 * Both go through `normaliseContent` first, so either renders correctly.
 */
import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

import { normaliseContent } from '@/teacher/latex';

interface Piece {
  math: boolean;
  text: string;
}

function split(src: string): Piece[] {
  const out: Piece[] = [];
  const re = /\$([^$]+)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ math: false, text: src.slice(last, m.index) });
    out.push({ math: true, text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ math: false, text: src.slice(last) });
  return out;
}

export default function MathText({ children }: { children: string }) {
  const pieces = useMemo(() => {
    // Normalise first so plain notation and real LaTeX both arrive as LaTeX.
    const normalised = normaliseContent(children).latex;
    return split(normalised).map((p) => {
      if (!p.math) return p;
      try {
        return {
          math: true,
          text: katex.renderToString(p.text, {
            // A malformed fragment must never take the transcript down with
            // it; KaTeX renders the source in red instead.
            throwOnError: false,
            displayMode: false,
            output: 'html',
          }),
        };
      } catch {
        return { math: false, text: `$${p.text}$` };
      }
    });
  }, [children]);

  return (
    <>
      {pieces.map((p, i) =>
        p.math ? (
          <span key={i} dangerouslySetInnerHTML={{ __html: p.text }} />
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
