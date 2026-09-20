/**
 * The scene clock.
 *
 * Every animation on the board is a pure function of scene time. Nothing is
 * fire-and-forget: no CSS transitions, no WAAPI, no auto-playing timelines.
 * One clock ticks, and on each frame every animation is told what time it is.
 *
 * ## Why segments
 *
 * An animation does not have a start and a duration. It has a list of
 * SEGMENTS, each mapping a window of scene time onto a window of its own local
 * time. Outside a segment, local time holds at the end of the last one.
 *
 *   write "R = u_x x T = 34.6 m"
 *     segment 0:  scene 18.6s..19.8s  ->  local 0..1.2s     writes "R = u_x x"
 *     (gap: the student interrupts; local time holds at 1.2s — frozen)
 *     segment 1:  scene 25.4s..27.7s  ->  local 1.2s..3.5s  finishes the line
 *
 * A freeze is therefore not a flag or a special case: it is simply the gap
 * between two segments, and it falls out of the same arithmetic as everything
 * else. That matters because the alternative — a `truncatedAt` cap plus a
 * mutated start time — cannot answer "what did the board look like at 21s?"
 * once the line has been resumed, which breaks scrubbing, replay determinism
 * and the resume beat all at once.
 *
 * The corollary is that `seek` must apply EVERY animation on every frame,
 * including ones that have not started (local 0, undrawn) and ones long
 * finished. Skipping them leaves stale state on the board when time moves
 * backwards.
 */
import type { Pt } from './units';

export type Phase = 'idle' | 'running' | 'frozen';

/** Maps a window of scene time onto a window of an animation's local time. */
export interface Segment {
  /** Scene time this segment begins, ms. */
  at: number;
  /** Local time it picks up from, ms. */
  from: number;
  /** How long it runs, ms. */
  len: number;
}

export interface Animation {
  id: string;
  /** Sorted by `at`. An ordinary animation has exactly one. */
  segments: Segment[];
  /** Total local length, ms. */
  duration: number;
  /**
   * Render at local time `t`. Must be idempotent and total: calling it with
   * any value, in any order, must produce the same frame.
   */
  apply(t: number): void;
  init?(): void;
  /** Pen position at local time, for animations that are drawn by hand. */
  penAt?(t: number): Pt | null;
  /** Drop any extra state a freeze left behind (Write clears its hard stop). */
  onReset?(): void;
}

export interface LocalTime {
  local: number;
  /** True while scene time falls inside a segment — i.e. it is being drawn. */
  active: boolean;
  /** True once the first segment has begun. */
  begun: boolean;
}

/** Local time of `a` at scene time `t`. The whole model, in one function. */
export function localAt(a: Animation, t: number): LocalTime {
  let local = 0;
  let begun = false;
  for (const s of a.segments) {
    if (t < s.at) break;
    begun = true;
    if (t < s.at + s.len) {
      return { local: s.from + (t - s.at), active: true, begun };
    }
    local = s.from + s.len;
  }
  return { local, active: false, begun };
}

export function segEnd(s: Segment) {
  return s.at + s.len;
}

/** Scene time at which an animation last stops drawing. */
export function animEnd(a: Animation) {
  return a.segments.length ? segEnd(a.segments[a.segments.length - 1]) : 0;
}

type Listener = (t: number) => void;

export class SceneClock {
  private _t = 0;
  private _phase: Phase = 'idle';
  private raf: number | null = null;
  private lastWall = 0;
  private anims: Animation[] = [];
  private primed = new Set<string>();
  private listeners = new Set<Listener>();
  /** Speed multiplier, for catching a lagging pen up to speech. */
  private _rate = 1;

  get rate() {
    return this._rate;
  }

  /**
   * Change playback speed. A non-positive rate would stall the clock while it
   * still reported itself as running, so it is clamped rather than trusted —
   * a frozen clock is `freeze()`, which says so.
   */
  setRate(r: number) {
    this._rate = Math.max(0.05, r);
  }

  get time() {
    return this._t;
  }
  get phase() {
    return this._phase;
  }
  get animations(): readonly Animation[] {
    return this.anims;
  }

  add(anim: Animation) {
    this.anims.push(anim);
    return anim;
  }

  get(id: string) {
    return this.anims.find((a) => a.id === id) ?? null;
  }

  onTick(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Initialise every animation now rather than on the frame it first ticks.
   *
   * The pen has to know where a stroke *will* begin in order to travel there
   * before it starts. This also mirrors what the live runtime does with the
   * lead time between a tool call arriving and its audio playing: typeset and
   * lay out immediately, so firing is instant.
   */
  prime() {
    for (const a of this.anims) {
      if (this.primed.has(a.id)) continue;
      this.primed.add(a.id);
      a.init?.();
    }
  }

  start() {
    if (this._phase === 'running') return;
    this._phase = 'running';
    this.lastWall = performance.now();
    const loop = () => {
      if (this._phase !== 'running') return;
      const now = performance.now();
      const dt = (now - this.lastWall) * this._rate;
      this.lastWall = now;
      this.seek(this._t + dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Stop the clock. The pen stops mid-stroke; nothing else changes. */
  freeze() {
    if (this._phase !== 'running') return;
    this._phase = 'frozen';
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  /**
   * Render the whole scene at absolute scene time `t`.
   *
   * Applies every animation, not just the running ones — that is what makes
   * scrubbing backwards correct.
   */
  seek(t: number) {
    this._t = Math.max(0, t);
    for (const a of this.anims) {
      if (!this.primed.has(a.id)) {
        this.primed.add(a.id);
        a.init?.();
      }
      a.apply(localAt(a, this._t).local);
    }
    for (const fn of this.listeners) fn(this._t);
  }

  get duration() {
    return this.anims.reduce((m, a) => Math.max(m, animEnd(a)), 0);
  }

  /** Drop every animation — a full rebuild of the scene. */
  clear() {
    this.freeze();
    this.anims = [];
    this.primed.clear();
    this._t = 0;
    this._phase = 'idle';
  }

  /**
   * Back to the start, with every timeline restored to one unbroken segment.
   * Undoes interrupts and resumes, which segment edits would otherwise leave
   * baked in across a replay.
   */
  rewind() {
    this.freeze();
    for (const a of this.anims) {
      const at = a.segments[0]?.at ?? 0;
      a.segments = [{ at, from: 0, len: a.duration }];
      a.onReset?.();
    }
    this._t = 0;
    this._phase = 'idle';
    this.seek(0);
  }
}

/**
 * Cut an animation short at `atLocal` — the student interrupts.
 * Everything after stays unwritten until a matching {@link resumeAt}.
 */
export function interruptAt(a: Animation, atLocal: number) {
  const s = a.segments[0];
  if (!s) return;
  a.segments = [{ ...s, len: Math.max(0, atLocal - s.from) }];
}

/**
 * Continue an interrupted animation from scene time `at` — the teacher going
 * back to the half-written line and finishing it.
 */
export function resumeAt(a: Animation, at: number) {
  const last = a.segments[a.segments.length - 1];
  if (!last) return;
  const from = last.from + last.len;
  if (from >= a.duration) return;
  a.segments = [...a.segments, { at, from, len: a.duration - from }];
}

export const easeInOutCubic = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

export const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
