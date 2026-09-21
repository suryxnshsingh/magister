'use client';

/**
 * Render what a model asked for: a list of tool calls, through the real
 * `dispatch` and `Scene`, to the finished board.
 *
 * The scribe and the live teacher both answer in tool calls, and a call list
 * says nothing about whether the diagram it describes is any good — whether
 * the anchors resolve, the colours read, the pieces land where they should.
 * This is the one place a call list becomes the board a student would see,
 * without a microphone or a live session.
 *
 * Driven from outside: `window.renderCalls([{ name, args }, ...])` draws them
 * one after another and resolves with each call's reply, so a harness can
 * read what failed as well as screenshot what worked.
 */
import { useEffect, useRef } from 'react';

import { Scene } from '@/board/scene';
import { CANVAS_H, CANVAS_W } from '@/board/units';
import { dispatch } from '@/teacher/dispatch';

type Call = { name: string; args: Record<string, unknown> };

declare global {
  interface Window {
    renderCalls?: (calls: Call[]) => Promise<{ name: string; ok: boolean; note: string; error?: string }[]>;
  }
}

export default function CallsTest() {
  const svgRef = useRef<SVGSVGElement>(null);
  const figRef = useRef<SVGGElement>(null);
  const inkRef = useRef<SVGGElement>(null);
  const markRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !figRef.current || !inkRef.current || !markRef.current) return;
    const scene = new Scene(svgRef.current, {
      figures: figRef.current,
      ink: inkRef.current,
      marks: markRef.current,
    });
    window.renderCalls = async (calls) => {
      const replies = [];
      let t = 0;
      for (const [i, c] of calls.entries()) {
        // The scene stamps what it applies with its own clock, so the clock
        // is moved to each call's moment first — one after another, as the
        // scheduler would, each given time to finish.
        scene.clock.seek(t);
        const r = dispatch({ callId: `t${i}`, name: c.name, args: c.args, anchorSamples: 0, playedSamples: 0, at: 0 }, scene, t);
        for (const op of r.ops) scene.applyOp(op);
        const res = r.response as { ok?: boolean; error?: string };
        replies.push({ name: c.name, ok: res.ok !== false, note: r.note, error: res.error });
        t += 1500;
      }
      scene.clock.seek(t + 5000);
      return replies;
    };
    return () => {
      delete window.renderCalls;
    };
  }, []);

  return (
    <main className="min-h-screen p-6" style={{ background: 'var(--void)' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        style={{ width: '100%', background: 'var(--board-lit)', borderRadius: 3 }}
      >
        <g ref={figRef} />
        <g ref={inkRef} />
        <g ref={markRef} />
      </svg>
    </main>
  );
}
