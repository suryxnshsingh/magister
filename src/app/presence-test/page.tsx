'use client';

/**
 * Presence tuning bench — all four states at once, no API session.
 *
 * The aurora is judged by eye, and judging it inside a live lesson means
 * burning quota to look at a colour. Here the "voice" is synthesised, so the
 * speaking state can be watched pulsing for as long as it takes to get right.
 */
import { useEffect, useRef, useState } from 'react';

import Presence from '@/ui/Presence';
import type { PresenceState } from '@/ui/presence-types';

const STATES: { state: PresenceState; note: string }[] = [
  { state: 'connecting', note: 'Socket opening. Cold and searching — not live yet.' },
  { state: 'error', note: 'Dropped or refused. Slow, rust-coloured.' },
  { state: 'idle', note: 'Between lessons. Slow, dim, cool — standing back from the board.' },
  { state: 'listening', note: 'Student is talking. Driven by the mic, so it visibly attends.' },
  { state: 'thinking', note: 'Working it out. Faster, tighter band, violet.' },
  { state: 'speaking', note: 'Driven by the teacher’s OWN voice — surges and churns per syllable.' },
];

/** A stand-in for speech: syllable-rate bursts with pauses between phrases. */
function fakeVoice(t: number): number {
  // Phrases with pauses, syllables inside them, and only a little jitter —
  // the worklet's envelope does the smoothing in the real thing.
  const phrase = (Math.sin(t * 0.35) + 1) / 2 > 0.3 ? 1 : 0;
  const syllable = Math.abs(Math.sin(t * 4.2)) ** 1.3;
  const jitter = 0.85 + 0.15 * Math.sin(t * 11.3);
  return phrase * syllable * jitter * 0.45;
}

export default function PresenceTest() {
  const [level, setLevel] = useState(0);
  const [gazeOn, setGazeOn] = useState(true);
  const [t, setT] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    const loop = (ms: number) => {
      raf.current = requestAnimationFrame(loop);
      const s = ms / 1000;
      setT(s);
      setLevel(fakeVoice(s));
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  // A gaze that wanders, standing in for the pen crossing the board.
  const gaze = gazeOn
    ? { x: 0.5 + 0.45 * Math.sin(t * 0.4), y: 0.5 + 0.3 * Math.cos(t * 0.27) }
    : null;

  return (
    <div className="min-h-screen bg-neutral-950 p-6 text-neutral-200">
      <div className="mx-auto max-w-[1400px]">
        <h1 className="mb-1 text-lg font-medium">Presence — the four states</h1>
        <p className="mb-4 text-sm text-neutral-400">
          Synthesised voice, no session. Same state, same level, same gaze fed
          to both, so the comparison is like for like. Eight live WebGL
          contexts at once here &mdash; the session runs exactly one.
        </p>

        <div className="mb-4 flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={gazeOn}
              onChange={(e) => setGazeOn(e.target.checked)}
            />
            gaze drift (the lean toward the pen)
          </label>
          <div className="flex items-center gap-2 font-mono text-xs text-neutral-500">
            level
            <div className="h-1.5 w-32 overflow-hidden rounded bg-neutral-800">
              <div
                className="h-full bg-amber-400"
                style={{ width: `${Math.min(100, level * 240)}%` }}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-5 xl:grid-cols-3">
          {STATES.map(({ state, note }) => (
            <div key={state}>
              <div className="mb-1 font-mono text-xs text-neutral-300">{state}</div>
              <div className="mb-2 h-10 text-[11px] leading-snug text-neutral-500">{note}</div>
              <div className="h-56 overflow-hidden rounded-xl bg-neutral-900">
                <Presence
                  state={state}
                  level={state === 'speaking' || state === 'listening' ? level : 0}
                  gaze={gaze}
                />
              </div>
            </div>
          ))}
        </div>

        <p className="mt-6 text-xs text-neutral-600">
          Tune the four moods in <code>src/ui/Presence.tsx</code> &rarr;{' '}
          <code>LOOKS</code>. Loudness response lives in the render loop, just
          below the mood lerp.
        </p>
      </div>
    </div>
  );
}
