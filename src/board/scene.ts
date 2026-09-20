/**
 * Scene — compiles an op log into animations, objects and a pen track.
 *
 * The op log is data; this turns it into something that moves. The same
 * compiler serves M0's hand-authored fixture and (in M2) ops arriving live
 * from the model, which is the point of having an IR at all: the board cannot
 * tell the difference between a replay and a lesson.
 *
 * Objects are registered by their semantic id so a later op can refer back to
 * one — `mark(target: "ux:u\cos\theta")` has to find a term written a minute
 * earlier. That registry is also what the board summary is derived from when
 * the model needs reminding what it has already put on the board.
 */
import { createWrite, type WriteAnimation } from './animations/write';
import { bboxIn, createMark, unionBox, type BBox } from './annotate/marks';
import { interruptAt, resumeAt, SceneClock, type Animation } from './clock';
import { handJitter, roughenGlyphs } from './chalk/roughen';
import { findPart, typeset, DEFAULT_EM } from './math/mathjax';
import { OpLog, parseTarget, type Op, type Placement } from './oplog';
import { PenTrack, tapWindow, windowsOf, type PenWindow } from './pen';
import { type Template } from './templates/projectile';
import { getFigure, parseParams } from './templates';
// Importing these registers them; without it the catalogue is empty.
import { normaliseContent } from '@/teacher/latex';
import { BOTTOM, DERIVATION, toPx, type Pt } from './units';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * How much the glyph outlines bend. Chosen on /chalk-test: below ~6 it still
 * reads as LaTeX, above ~18 the equals signs look broken rather than written.
 */
const CHALK_WOBBLE = 9;

/** Vertical breathing room between written lines, in board units. */
const LINE_GAP = 0.46;

export interface BoardObject {
  id: string;
  content: string;
  place: Placement;
  holder: SVGGElement;
  svg: SVGSVGElement;
  glyphs: SVGPathElement[];
  /** Board units, so a later `under:` can stack beneath it. */
  height: number;
  /** Set when an interruption left this object part-written. */
  partial: boolean;
}

export interface SceneLayers {
  /** Typeset maths and prose. */
  ink: SVGGElement;
  /** Figures, below the ink. */
  figures: SVGGElement;
  /** Annotation marks, above everything. */
  marks: SVGGElement;
}

export class Scene {
  readonly clock = new SceneClock();
  readonly objects = new Map<string, BoardObject>();
  readonly templates = new Map<string, Template>();
  pen: PenTrack = new PenTrack([]);

  constructor(
    private root: SVGSVGElement,
    private layers: SceneLayers,
  ) {}

  /** Board-units -> root user units, for placing an object. */
  private placeAt(p: Placement): Pt {
    return toPx(p.resolved);
  }

  /** Next free line in the derivation column. */
  private cursorY = DERIVATION.top;

  /**
   * Turn the model's symbolic placement into a point.
   *
   * The model never emits coordinates — it says "title" or "under:ux" — so
   * this is the only thing that decides where chalk goes. Overflow is reported
   * rather than wiped: auto-erasing could delete the very line the teacher is
   * about to refer back to, which is the one thing the lesson cannot survive.
   */
  resolvePlace(intent: string | undefined, height: number): Placement {
    const fallback = { x: DERIVATION.x, y: this.cursorY };
    if (!intent || intent === 'title') {
      const at = { x: DERIVATION.x, y: this.cursorY };
      this.cursorY -= height + LINE_GAP;
      return { intent: intent ?? 'auto', resolved: at };
    }
    const under = intent.startsWith('under:') ? intent.slice(6) : null;
    if (under) {
      const ref = this.objects.get(under);
      if (ref) {
        // Below the referenced line, or below everything already placed,
        // whichever is lower — so a late "under:ux" cannot land on top of uy.
        const y = Math.min(ref.place.resolved.y - ref.height - LINE_GAP, this.cursorY);
        this.cursorY = y - height - LINE_GAP;
        return { intent, resolved: { x: DERIVATION.x, y } };
      }
    }
    this.cursorY -= height + LINE_GAP;
    return { intent, resolved: fallback };
  }

  /** How full the derivation column is, 0..1. Fed back to the model. */
  fullness(): number {
    const used = DERIVATION.top - this.cursorY;
    return Math.max(0, Math.min(1, used / (DERIVATION.top - (BOTTOM + 0.45))));
  }

  /**
   * Apply a single op at the current scene time — the live path.
   *
   * Same compiler as replay, which is the entire point of having an IR: the
   * board cannot tell whether an op came from a fixture or from the model.
   */
  applyOp(op: Op): void {
    const now = this.clock.time;
    switch (op.kind) {
      case 'write': {
        const obj = this.createMath(op.id, op.content, op.place);
        const anim = createWrite(op.id, obj.glyphs, this.root, now, { strokeWidth: 1.8 });
        this.clock.add(anim);
        this.liveWrites.set(op.id, anim);
        break;
      }
      case 'mark':
        this.clock.add(
          createMark(op.id, op.style, () => this.boxOf(op.target), this.layers.marks, now, {
            color: op.color,
          }),
        );
        break;
      case 'point':
        this.liveTaps.push(
          tapWindow(`point:${op.target}:${now}`, now, 620, () => {
            const b = this.boxOf(op.target);
            return b ? { x: b.x + b.w / 2, y: b.y + b.h + 16 } : null;
          }),
        );
        break;
      case 'scene': {
        const spec = getFigure(op.name);
        if (!spec) break;
        const tpl = spec.build(op.id, this.layers.figures, parseParams(op.params), toPx);
        this.templates.set(op.id, tpl);
        for (const a of tpl.steps.get('setup')?.(now) ?? []) this.clock.add(a);
        break;
      }
      case 'step':
        for (const a of this.templates.get(op.id)?.steps.get(op.step)?.(now) ?? []) {
          this.clock.add(a);
        }
        break;
      default:
        break;
    }
    // Measure immediately: the pen needs stroke lengths before it can move.
    this.clock.prime();
    this.refreshPen();
    this.clock.seek(now);
  }

  /**
   * Freeze whatever is being written right now — the student cut in.
   *
   * Marks the object PARTIAL as well as stopping the pen. That flag is what
   * `summary()` reports back to the model, and without it the model is told a
   * half-written line is finished: it will never come back to complete it, and
   * it will happily refer to text that is not on the board. Setting it only in
   * the replay path (as `build()` does) leaves the live session blind.
   *
   * Returns what was interrupted, so the session can say so in words.
   */
  interruptActiveWrite(): { id: string; content: string; at: number } | null {
    const t = this.clock.time;
    for (const [id, anim] of this.liveWrites) {
      const s = anim.segments[anim.segments.length - 1];
      if (!s || t < s.at || t > s.at + s.len) continue;
      // Local time within the animation, honouring a segment that already
      // resumed once.
      const cut = anim.settleTime(s.from + (t - s.at));
      interruptAt(anim, cut);
      const obj = this.objects.get(id);
      if (obj) obj.partial = true;
      // The cut as a fraction of the whole line, which is the form the op log
      // records and `build()` replays — so a recorded lesson freezes in the
      // same place the student saw it freeze.
      return { id, content: obj?.content ?? '', at: anim.duration ? cut / anim.duration : 0 };
    }
    return null;
  }

  private refreshPen() {
    this.pen = new PenTrack([
      ...this.clock.animations.flatMap((a) => windowsOf(a)),
      ...this.liveTaps,
    ]);
  }

  private liveWrites = new Map<string, WriteAnimation>();
  private liveTaps: PenWindow[] = [];

  /**
   * Resolve "ux" or "ux:u\cos\theta" to a box in root user space.
   * A part that cannot be found falls back to the whole object: a slightly
   * generous circle beats a teacher who points at nothing.
   */
  boxOf(target: string): BBox | null {
    // A figure part — "fig.apex" — is addressed with a dot, so the teacher can
    // point into a construction rather than only at it.
    if (target.includes('.')) {
      const [tid, ...rest] = target.split('.');
      const tpl = this.templates.get(tid);
      const el = tpl?.parts.get(rest.join('.'));
      return el ? bboxIn(el, this.root) : null;
    }

    const { id, part } = parseTarget(target);
    const obj = this.objects.get(id);
    if (!obj) return null;
    if (part) {
      const els = findPart(obj.svg, part);
      if (els.length) {
        return unionBox(els.map((el) => bboxIn(el, this.root)));
      }
    }
    const g = obj.svg.querySelector('g[data-mml-node="math"]');
    return g ? bboxIn(g as SVGGraphicsElement, this.root) : null;
  }

  build(log: OpLog) {
    this.clock.clear();
    this.objects.clear();
    this.cursorY = DERIVATION.top;
    this.liveWrites.clear();
    this.liveTaps = [];
    this.layers.ink.replaceChildren();
    this.layers.marks.replaceChildren();

    const taps: PenWindow[] = [];
    const writes = new Map<string, WriteAnimation>();
    // Deferred because a write's segments cannot be sized until its glyphs are
    // measured, and an interrupt has to be applied before the pen reads them.
    const pending: { anim: WriteAnimation; at: number }[] = [];
    const resumes: { id: string; t: number }[] = [];

    for (const op of log.ops) {
      switch (op.kind) {
        case 'write': {
          const obj = this.createMath(op.id, op.content, op.place);
          const anim = createWrite(op.id, obj.glyphs, this.root, op.t, {
            strokeWidth: 1.8,
          });
          this.clock.add(anim);
          writes.set(op.id, anim);
          if (op.interruptedAt !== undefined) {
            pending.push({ anim, at: op.interruptedAt });
            obj.partial = true;
          }
          break;
        }
        case 'resume':
          resumes.push({ id: op.id, t: op.t });
          break;
        case 'mark':
          this.clock.add(
            createMark(op.id, op.style, () => this.boxOf(op.target), this.layers.marks, op.t, {
              color: op.color,
            }),
          );
          break;
        case 'point': {
          const DWELL = 620;
          taps.push(
            tapWindow(`point:${op.target}`, op.t, DWELL, () => {
              const b = this.boxOf(op.target);
              return b ? { x: b.x + b.w / 2, y: b.y + b.h + 16 } : null;
            }),
          );
          break;
        }
        case 'scene': {
          const spec = getFigure(op.name);
          if (!spec) break;
          const tpl = spec.build(op.id, this.layers.figures, parseParams(op.params), toPx);
          this.templates.set(op.id, tpl);
          for (const a of tpl.steps.get('setup')?.(op.t) ?? []) this.clock.add(a);
          break;
        }
        case 'step': {
          const tpl = this.templates.get(op.id);
          for (const a of tpl?.steps.get(op.step)?.(op.t) ?? []) this.clock.add(a);
          break;
        }
        default:
          break;
      }
    }

    // Measure everything, then shape the timelines.
    this.clock.prime();

    for (const { anim, at } of pending) {
      // Authored, not accidental: the fixture breaks in the same place every
      // run. settleTime turns the break into a clean chalk edge.
      interruptAt(anim, anim.settleTime(anim.duration * at));
    }
    for (const r of resumes) {
      const anim = writes.get(r.id);
      if (!anim) continue;
      resumeAt(anim, r.t);
      const obj = this.objects.get(r.id);
      if (obj) obj.partial = false;
    }

    this.pen = new PenTrack([
      ...this.clock.animations.flatMap((a) => windowsOf(a)),
      ...taps,
    ]);
    this.clock.seek(0);
    return this;
  }

  private createMath(id: string, content: string, place: Placement): BoardObject {
    const ts = typeset(stripMath(content), DEFAULT_EM);
    // Chalk, not type. MathJax has no handwritten font, so the letterforms are
    // bent and set slightly off-baseline instead. Costs ~0.1ms per line and
    // leaves one <path> per glyph, so the stroke-by-stroke write is untouched.
    roughenGlyphs(ts.glyphs, { amount: CHALK_WOBBLE });
    handJitter(ts.glyphs);
    const at = this.placeAt(place);
    const holder = document.createElementNS(SVG_NS, 'g');
    holder.setAttribute('transform', `translate(${at.x}, ${at.y})`);
    holder.setAttribute('data-id', id);
    ts.svg.setAttribute('overflow', 'visible');
    holder.appendChild(ts.svg);
    this.layers.ink.appendChild(holder);

    const obj: BoardObject = {
      id,
      content,
      place,
      holder,
      svg: ts.svg,
      glyphs: ts.glyphs,
      height: ts.height,
      partial: false,
    };
    this.objects.set(id, obj);
    return obj;
  }

  /**
   * A summary of what is on the board, in the shape the model gets fed back.
   * Cheap here, and building it now means M2 is wiring rather than designing.
   */
  summary(): string {
    return Array.from(this.objects.values())
      .map((o) => `${o.id}: "${o.content}"${o.partial ? ' [PARTIAL]' : ''}`)
      .join('\n');
  }
}

/**
 * `write` content is prose with $latex$ spans. Runs through the normaliser
 * first, so the plain backslash-free notation the model is asked for becomes
 * LaTeX, and any JSON-mangled real LaTeX gets repaired. M0's fixture is all
 * maths, so the whole span is handed on.
 */
function stripMath(content: string): string {
  const normalised = normaliseContent(content).latex;
  // [\s\S] rather than the /s flag: tsconfig targets ES2017.
  const m = normalised.match(/^\s*\$([\s\S]*)\$\s*$/);
  return m ? m[1] : normalised;
}

export type { Animation };
