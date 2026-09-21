/**
 * The op log — the board's intermediate representation.
 *
 * Fast ops, template steps and (later) DSL blocks all lower to these records.
 * The log is append-only and timestamped, which is what makes replay, resume
 * and the end-of-session notes export nearly free rather than a rewrite.
 *
 * Two rules that are easy to get wrong and expensive to retrofit:
 *
 * 1. **Model granularity.** One record per plausible tool call, never per
 *    glyph. A hand-authored fixture at glyph granularity would encode a rhythm
 *    the live model can never reproduce, and M0 would be polishing a target
 *    that M2 cannot hit.
 *
 * 2. **Dual placement.** Every placed op carries the symbolic intent the model
 *    would emit *and* the resolved position actually used. Replay reads
 *    `resolved`, so a replay never depends on the version of the layout code
 *    that produced it. M2's layout manager is then testable against the
 *    hand-tuned demo board: does `under:ux` land where a human put it?
 */
import type { Pt } from './units';

/** Symbolic placement plus the concrete point it resolved to. */
export interface Placement {
  /** What the model says: "title", "under:ux", "at:fig.apex", "right_of:T". */
  intent: string;
  /** Where it actually goes, in board units. */
  resolved: Pt;
}

export type MarkStyle = 'underline' | 'circle' | 'strike' | 'box' | 'cancel';

interface Common {
  /** Scene time in ms at which this op fires. */
  t: number;
  /**
   * The word in the spoken line this op is anchored to. M0 resolves these to
   * times from TTS word timestamps; M2 replaces it with the audio playback
   * anchor. Kept in the record either way so a log stays self-describing.
   */
  anchor?: string;
  /** Manual nudge applied on top of the anchor. */
  offsetMs?: number;
}

export interface WriteOp extends Common {
  kind: 'write';
  /** Object id. Semantic — "ux", "range" — never "eq1". */
  id: string;
  /** Prose with $latex$ spans. */
  content: string;
  place: Placement;
  /**
   * Fraction of the write at which the student cuts in, 0..1. The freeze is
   * part of the authored record, not a live accident, so every replay of the
   * fixture breaks in exactly the same place.
   */
  interruptedAt?: number;
}

export interface RewriteOp extends Common {
  kind: 'rewrite';
  id: string;
  content: string;
}

/** Beat 9: the teacher returns to a line left half-written and finishes it. */
export interface ResumeOp extends Common {
  kind: 'resume';
  id: string;
}

export interface MarkOp extends Common {
  kind: 'mark';
  id: string;
  /** Target as the model writes it: "ux" or "ux:u\cos\theta". */
  target: string;
  style: MarkStyle;
  color?: string;
}

export interface PointOp extends Common {
  kind: 'point';
  target: string;
}

export interface SceneOp extends Common {
  kind: 'scene';
  id: string;
  name: string;
  params: string;
}

export interface StepOp extends Common {
  kind: 'step';
  id: string;
  step: string;
}

/**
 * A freehand primitive. One shape per op, each becoming an anchor for the next,
 * so the model names things rather than computing a layout.
 */
export interface DrawOp extends Common {
  kind: 'draw';
  id: string;
  shape: string;
  /** Anchor: an id, "id.part", or normalised "x,y" in the figure column. */
  from: string;
  to?: string;
  /** Second arm, for an angle mark. */
  to2?: string;
  text?: string;
  /** An ink name — see `INKS`. */
  colour?: string;
}

export interface EraseOp extends Common {
  kind: 'erase';
  target: string;
}

export type Op =
  | DrawOp
  | WriteOp
  | RewriteOp
  | ResumeOp
  | MarkOp
  | PointOp
  | SceneOp
  | StepOp
  | EraseOp;

/**
 * The board id a target names, whichever way it is addressed: "ux",
 * "ux:u\cos\theta" and "fig.incident" all belong to something erasable.
 */
export function baseId(target: string): string {
  return parseTarget(target).id.split('.')[0];
}

/** Split "ux:u\cos\theta" into its object id and optional sub-expression. */
export function parseTarget(target: string): { id: string; part?: string } {
  const i = target.indexOf(':');
  if (i === -1) return { id: target };
  return { id: target.slice(0, i), part: target.slice(i + 1) };
}

export class OpLog {
  private _ops: Op[] = [];

  get ops(): readonly Op[] {
    return this._ops;
  }

  append(op: Op) {
    this._ops.push(op);
    // Live sessions can deliver slightly out of order; keep the log sorted so
    // replay and scheduling never have to care.
    this._ops.sort((a, b) => a.t - b.t);
    return op;
  }

  appendAll(ops: Op[]) {
    for (const op of ops) this.append(op);
    return this;
  }

  /** Every op that has fired by scene time `t`. */
  upTo(t: number): Op[] {
    return this._ops.filter((o) => o.t <= t);
  }

  byId(id: string): Op[] {
    return this._ops.filter((o) => 'id' in o && o.id === id);
  }

  get duration(): number {
    return this._ops.reduce((m, o) => Math.max(m, o.t), 0);
  }

  toJSON(): string {
    return JSON.stringify(this._ops, null, 2);
  }

  static fromJSON(json: string): OpLog {
    return new OpLog().appendAll(JSON.parse(json) as Op[]);
  }
}
