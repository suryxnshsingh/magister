/**
 * The pen.
 *
 * One piece of chalk, and it never teleports. It follows the stroke while
 * something is being drawn, glides to the next place while nothing is, taps
 * when the teacher points, and rests where it was left.
 *
 * This does more work than it looks. A board where marks simply appear reads
 * as text being pasted; the same marks with a tip that travels between them
 * read as a person. It is also what makes a freeze legible — a half-drawn line
 * with the pen sitting on the break is a teacher stopping, whereas the same
 * line with no pen is just a bug.
 *
 * A window here is one {@link Segment} of one animation, so an interrupted
 * write contributes two: the pen leaves the line at the freeze and comes back
 * to the same spot when the teacher resumes. Position stays a pure function of
 * scene time, so freeze and replay need no handling of their own.
 */
import { clamp01, easeInOutCubic, type Animation } from './clock';
import type { Pt } from './units';

/** One drawing window in scene time. */
export interface PenWindow {
  id: string;
  at: number;
  len: number;
  /** Pen position at local time within the owning animation. */
  penAt(local: number): Pt | null;
  /** Local time at the window's start, so scene time maps onto it. */
  from: number;
  /** A tap arrives somewhere rather than tracing anything. */
  isTap?: boolean;
}

export type PenMode = 'hidden' | 'writing' | 'travelling' | 'resting' | 'tapping';

export interface PenState {
  pos: Pt | null;
  mode: PenMode;
  /** 0..1, drives the tap pulse. */
  tap: number;
}

const HIDDEN: PenState = { pos: null, mode: 'hidden', tap: 0 };

/** Travel time for a distance in board units. */
function travelMs(dist: number) {
  return Math.min(420, Math.max(130, dist * 58));
}

/** Every drawing window an animation contributes. */
export function windowsOf(a: Animation, isTap = false): PenWindow[] {
  if (!a.penAt) return [];
  const penAt = a.penAt.bind(a);
  return a.segments
    .filter((s) => s.len > 0)
    .map((s, i) => ({
      id: `${a.id}#${i}`,
      at: s.at,
      len: s.len,
      from: s.from,
      penAt,
      isTap,
    }));
}

export class PenTrack {
  private wins: PenWindow[];

  constructor(windows: PenWindow[]) {
    this.wins = [...windows].sort((a, b) => a.at - b.at);
  }

  private endOf(w: PenWindow): Pt | null {
    return w.penAt(w.from + w.len) ?? w.penAt(w.from + w.len * 0.999);
  }

  private startOf(w: PenWindow): Pt | null {
    return w.penAt(w.from) ?? w.penAt(w.from + w.len * 0.001);
  }

  at(t: number): PenState {
    const wins = this.wins;
    if (wins.length === 0) return HIDDEN;

    // Being drawn: follow the stroke.
    for (const w of wins) {
      if (t >= w.at && t <= w.at + w.len) {
        const p = w.penAt(w.from + (t - w.at));
        if (p) {
          return {
            pos: p,
            mode: w.isTap ? 'tapping' : 'writing',
            tap: w.isTap ? 1 - clamp01((t - w.at) / Math.max(1, w.len)) : 0,
          };
        }
      }
    }

    const first = wins[0];
    if (t < first.at) {
      // Approach the first stroke so the pen arrives with it rather than
      // blinking into existence on top of it.
      const to = this.startOf(first);
      if (!to || t < first.at - travelMs(2)) return HIDDEN;
      return { pos: to, mode: 'travelling', tap: 0 };
    }

    // Between strokes: rest where it was left, then glide to arrive on time.
    let prev: PenWindow | null = null;
    let next: PenWindow | null = null;
    for (const w of wins) {
      if (w.at + w.len <= t) prev = w;
      if (w.at > t && !next) next = w;
    }

    const from = prev ? this.endOf(prev) : null;
    if (!next) return from ? { pos: from, mode: 'resting', tap: 0 } : HIDDEN;

    const to = this.startOf(next);
    if (!from) return to ? { pos: to, mode: 'travelling', tap: 0 } : HIDDEN;
    if (!to) return { pos: from, mode: 'resting', tap: 0 };

    const dist = Math.hypot(to.x - from.x, to.y - from.y) / 135;
    const tm = travelMs(dist);
    const gapStart = prev ? prev.at + prev.len : t;
    const begin = Math.max(gapStart, next.at - tm);
    if (t < begin) return { pos: from, mode: 'resting', tap: 0 };

    const u = easeInOutCubic(clamp01((t - begin) / Math.max(1, next.at - begin)));
    return {
      pos: { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u },
      mode: 'travelling',
      tap: 0,
    };
  }
}

/**
 * A window for ops that trace nothing — `point`, and the arrival half of a
 * mark. The pen simply goes somewhere and taps it.
 */
export function tapWindow(
  id: string,
  at: number,
  len: number,
  where: () => Pt | null,
): PenWindow {
  return { id, at, len, from: 0, isTap: true, penAt: () => where() };
}
