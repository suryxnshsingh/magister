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
import { createDraw, createFadeIn, createWipe } from './animations/draw';
import { createWrite, type WriteAnimation } from './animations/write';
import { bboxIn, createMark, pointIn, unionBox, type BBox } from './annotate/marks';
import { interruptAt, resumeAt, SceneClock, type Animation } from './clock';
import { handJitter, roughenGlyphs } from './chalk/roughen';
import { findPart, typeset, DEFAULT_EM } from './math/mathjax';
import { baseId, OpLog, parseTarget, type Op, type Placement } from './oplog';
import { PenTrack, tapWindow, windowsOf, type PenWindow } from './pen';
import { type Template } from './templates/projectile';
import { getFigure, parseParams, stepOfPart } from './templates';
// Importing these registers them; without it the catalogue is empty.
import { normaliseContent } from '@/teacher/latex';
import { BOTTOM, DERIVATION, FIGURE, toPx, type Pt } from './units';
import { buildShape, type Shape } from './draw-shapes';

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

/**
 * A figure on the board, and how much of it is actually drawn.
 *
 * A template builds every piece up front and hides it; a step reveals what it
 * owns. So holding the template is not enough to answer the only question the
 * teacher keeps getting wrong — is this part on the board yet — and that
 * answer is what `point` and `mark` are checked against.
 */
export interface SceneFigure {
  /** The registry name: "ray", where the id is "fig". */
  name: string;
  tpl: Template;
  /** Steps whose chalk has actually gone up. */
  shown: Set<string>;
  /** Which step reveals each part, so an invisible one can name its cure. */
  stepOf: Map<string, string>;
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
  readonly figures = new Map<string, SceneFigure>();
  /** Freehand primitives, addressable by bare id like everything else. */
  readonly drawings = new Map<string, SVGGElement>();
  /** Annotation marks, by op id, with what each one was drawn around. */
  readonly marks = new Map<string, { el: SVGGElement; target: string }>();
  /**
   * Ids that have been wiped.
   *
   * A flag, not a deletion. The registries have to keep resolving — a mark
   * made at 0:20 is still compiled against a board that was cleared at 1:30,
   * and deleting the entry would silently drop it from every replay. What
   * erasing takes away is the teacher's right to refer to it, and that is a
   * question the dispatcher asks here.
   */
  readonly erased = new Set<string>();
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
          createMark(op.id, op.style, () => this.boxOf(op.target), this.hostMark(op.id, op.target), now, {
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
      case 'draw': {
        for (const a of this.addDrawing(op, now)) this.clock.add(a);
        break;
      }
      case 'scene': {
        this.addFigure(op.id, op.name, op.params);
        this.revealStep(op.id, 'setup', now);
        break;
      }
      case 'step':
        this.revealStep(op.id, op.step, now);
        break;
      case 'erase':
        this.wipe(this.eraseTargets(op.target), now);
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
   * Turn a `draw` op into a hidden shape plus the animation that reveals it.
   *
   * Resolution happens HERE, at fire time, never at enqueue. A primitive
   * anchored to another primitive would otherwise be resolved before the thing
   * it references exists, and silently dropped - exactly the bug `mark` had.
   */
  private addDrawing(op: Extract<Op, { kind: 'draw' }>, now: number): Animation[] {
    const from = this.anchorOf(op.from);
    if (!from) return [];
    const to = op.to ? this.anchorOf(op.to) : null;
    const to2 = op.to2 ? this.anchorOf(op.to2) : null;

    // A link joins two things, so it is drawn between their edges rather than
    // from the middle of one to the middle of the other.
    let a = from.pt;
    let b = to?.pt ?? null;
    if (op.shape === 'link' && op.to) {
      const ba = this.boxOf(op.from);
      const bb = this.boxOf(op.to);
      if (ba && bb) {
        a = edgeToward(ba, centreOf(bb));
        b = edgeToward(bb, centreOf(ba));
      }
    }

    const built = buildShape(op.id, {
      shape: op.shape as Shape,
      from: a,
      to: b,
      to2: to2?.pt ?? null,
      text: op.text,
      colour: op.colour,
    });
    this.layers.figures.appendChild(built.group);
    this.drawings.set(op.id, built.group);

    const out: Animation[] = [];
    if (built.paths.length) out.push(createDraw(op.id, built.paths, now, 520));
    if (built.fades.length) {
      out.push(createFadeIn(`${op.id}:t`, built.fades, now + (built.paths.length ? 320 : 0), 260));
    }
    return out;
  }

  /** The group a mark draws into, owned here so an erase can find it. */
  private hostMark(id: string, target: string): SVGGElement {
    const el = document.createElementNS(SVG_NS, 'g');
    el.setAttribute('data-mark', id);
    el.setAttribute('fill', 'none');
    this.layers.marks.appendChild(el);
    this.marks.set(id, { el, target });
    return el;
  }

  /**
   * What an erase would take off the board: "board" for all of it, or one id.
   *
   * Pure — the dispatcher calls it to answer the model before the op fires, so
   * naming what went and taking it away have to be separate acts.
   */
  eraseTargets(target: string): string[] {
    const live = (id: string) => !this.erased.has(id);
    const ids =
      target.trim().toLowerCase() === 'board'
        ? [...this.objects.keys(), ...this.drawings.keys(), ...this.figures.keys()]
        : [target];
    return ids.filter((id) => live(id) && this.holdersOf(id).length > 0);
  }

  /** Every element that makes up an id: its ink, plus anything marking it. */
  private holdersOf(id: string): SVGGraphicsElement[] {
    const out: SVGGraphicsElement[] = [];
    const obj = this.objects.get(id);
    if (obj) out.push(obj.holder);
    const drawn = this.drawings.get(id);
    if (drawn) out.push(drawn);
    const fig = this.figures.get(id);
    if (fig) out.push(fig.tpl.root);
    if (!out.length) return out;
    // An annotation outlives what it was drawn around unless it is taken with
    // it, and a circle on an empty board is the failure this whole guard rail
    // exists to stop.
    for (const [markId, m] of this.marks) {
      if (!this.erased.has(markId) && baseId(m.target) === id) {
        out.push(m.el);
      }
    }
    return out;
  }

  /** Is this id still on the board — drawn, and not since erased? */
  onBoard(id: string): boolean {
    return !this.erased.has(id) && this.holdersOf(id).length > 0;
  }

  /** The figures still up. At most one fits the column. */
  liveFigures(): string[] {
    return [...this.figures.keys()].filter((id) => !this.erased.has(id));
  }

  /** Wipe those ids: one sweep of the duster, and the board forgets them. */
  private wipe(ids: string[], at: number): string[] {
    const els = ids.flatMap((id) => this.holdersOf(id));
    if (!els.length) return [];
    for (const id of ids) {
      this.erased.add(id);
      for (const [markId, m] of this.marks) {
        if (baseId(m.target) === id) this.erased.add(markId);
      }
    }
    // Wide sweeps take longer, the way a real one does.
    const wide = els.length > 2 || ids.some((id) => this.figures.has(id));
    this.clock.add(createWipe(`erase:${ids.join('+')}:${at}`, els, this.root, at, wide ? 760 : 420));
    this.reclaimColumn();
    return ids;
  }

  /**
   * Give the derivation column back the space the erased lines were using.
   *
   * Only the tail is reclaimed — the cursor drops to the lowest line still on
   * the board. A hole in the middle stays a hole, because filling it would put
   * a new line between two that are already spaced against each other.
   */
  private reclaimColumn(): void {
    let y = DERIVATION.top;
    for (const [id, o] of this.objects) {
      if (this.erased.has(id)) continue;
      y = Math.min(y, o.place.resolved.y - o.height - LINE_GAP);
    }
    this.cursorY = y;
  }

  /** Build a figure and start tracking how much of it is up. */
  private addFigure(id: string, name: string, params: string): void {
    const spec = getFigure(name);
    if (!spec) return;
    const tpl = spec.build(id, this.layers.figures, parseParams(params), toPx);
    this.figures.set(id, {
      name,
      tpl,
      shown: new Set(),
      stepOf: stepOfPart(id, tpl),
    });
  }

  /**
   * Reveal one stage of a figure, and remember that it was revealed.
   *
   * The record is not bookkeeping for its own sake: it is what the model is
   * told the board looks like. Without it a figure reports as present the
   * moment `scene` lands, while three quarters of it is still invisible, and
   * the teacher talks about rays nobody can see.
   */
  private revealStep(id: string, step: string, at: number): boolean {
    const fig = this.figures.get(id);
    const make = fig?.tpl.steps.get(step);
    if (!fig || !make) return false;
    for (const a of make(at)) this.clock.add(a);
    fig.shown.add(step);
    return true;
  }

  /**
   * A figure part that resolves but is not on the board, and the step that
   * would put it there. Null for anything genuinely drawn.
   *
   * Every piece of a figure exists in the DOM from the moment `scene` fires,
   * hidden until its step. So `boxOf("fig.incident")` happily returns the box
   * of a ray that was never drawn, and a circle lands on empty slate while the
   * teacher says "yahan dekho". That is the same failure an unregistered
   * figure and a bad anchor already report — caught one layer deeper.
   */
  hiddenPart(target: string): { figure: string; part: string; step: string | null } | null {
    if (!target.includes('.')) return null;
    const [figure, ...rest] = target.split('.');
    const part = rest.join('.');
    const fig = this.figures.get(figure);
    const el = fig?.tpl.parts.get(part);
    if (!fig || !el) return null;
    const step = fig.stepOf.get(part) ?? null;
    // A step already fired counts as drawn even if the chalk has not reached
    // this part yet: a fade that has not begun still reads as invisible, and
    // rejecting a mark on ink that is half a second away would be a lie in the
    // other direction.
    if (step && fig.shown.has(step)) return null;
    return inked(el) ? null : { figure, part, step };
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
  /**
   * A point on a stroke already drawn, `t` of the way along it.
   *
   * The first subpath is the one measured. rough.js draws everything twice and
   * either pass traces the same shape, so six-tenths along the first is six
   * tenths along the thing itself — which is what "put the block here on the
   * incline" means.
   */
  private pointAlong(ref: string, t: number): Pt | null {
    const host =
      this.drawings.get(ref) ??
      (ref.includes('.')
        ? this.figures.get(ref.split('.')[0])?.tpl.parts.get(ref.split('.').slice(1).join('.'))
        : undefined);
    const path = host?.querySelector('path');
    if (!path) return null;
    const len = path.getTotalLength();
    if (!len) return null;
    return pointIn(path, path.getPointAtLength(len * Math.max(0, Math.min(1, t))), this.root);
  }

  /**
   * Resolve a `draw` anchor to a point in root pixel space.
   *
   * One grammar, extending the one `point`/`mark` already use: an id, an
   * "id.part", or - only as the fallback when nothing named exists yet -
   * normalised "x,y" inside the figure column, origin bottom-left, y up.
   * Offering three interchangeable address forms would mean three resolution
   * paths to debug and a model that picks between them at random.
   *
   * Two suffixes name a place ON a thing rather than the thing, because the
   * centre of a box is the one point a physics diagram almost never wants:
   * weight hangs from the middle, but the normal pushes off the TOP face and
   * friction runs ALONG the base. Without them a free-body diagram cannot be
   * drawn from anchors at all and the model is forced back to raw coordinates,
   * which is the thing anchoring exists to avoid.
   *
   *   "block.top"    the middle of an edge — top, bottom, left, right, centre
   *   "incline@0.6"  six tenths of the way along a stroke already drawn
   */
  anchorOf(ref: string): { pt: Pt; clamped: boolean } | null {
    const m = /^\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*$/.exec(ref ?? '');
    if (m) {
      const rawU = Number(m[1]);
      const rawV = Number(m[2]);
      const u = Math.max(0, Math.min(1, rawU));
      const v = Math.max(0, Math.min(1, rawV));
      const pt = toPx({
        x: FIGURE.left + u * (FIGURE.right - FIGURE.left),
        y: FIGURE.bottom + v * (FIGURE.top - FIGURE.bottom),
      });
      return { pt, clamped: u !== rawU || v !== rawV };
    }

    const along = /^(.+)@([\d.]+)$/.exec(ref);
    if (along) {
      const pt = this.pointAlong(along[1], Number(along[2]));
      if (pt) return { pt, clamped: false };
    }

    const dot = ref.lastIndexOf('.');
    const side = dot > 0 ? SIDES[ref.slice(dot + 1).toLowerCase()] : undefined;
    if (side) {
      // Tried after the figure-part lookup inside boxOf, so a part genuinely
      // named "left" still wins over the edge of the figure holding it.
      const whole = this.boxOf(ref);
      if (whole) return { pt: centreOf(whole), clamped: false };
      const host = this.boxOf(ref.slice(0, dot));
      if (host) return { pt: side(host), clamped: false };
    }

    const b = this.boxOf(ref);
    if (!b) return null;
    return { pt: centreOf(b), clamped: false };
  }

  boxOf(target: string): BBox | null {
    // A freehand primitive is addressable by its bare id, like everything else
    // the teacher puts on the board.
    const drawn = this.drawings.get(target);
    if (drawn) return bboxIn(drawn, this.root);

    // A figure part — "fig.apex" — is addressed with a dot, so the teacher can
    // point into a construction rather than only at it. Only a FIGURE id takes
    // this branch: it used to claim every dotted name and answer null for the
    // rest, which made "block.top" unresolvable before anything could offer to
    // resolve it.
    if (target.includes('.')) {
      const [tid, ...rest] = target.split('.');
      const fig = this.figures.get(tid);
      if (fig) {
        const el = fig.tpl.parts.get(rest.join('.'));
        return el ? bboxIn(el, this.root) : null;
      }
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
    this.drawings.clear();
    this.figures.clear();
    this.marks.clear();
    this.erased.clear();
    this.layers.figures.replaceChildren();
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
            createMark(op.id, op.style, () => this.boxOf(op.target), this.hostMark(op.id, op.target), op.t, {
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
        case 'draw': {
          // Same builder as the live path; a replayed sketch is the same
          // sketch, resolved against whatever is already on the board at op.t.
          for (const a of this.addDrawing(op, op.t)) this.clock.add(a);
          break;
        }
        case 'scene': {
          this.addFigure(op.id, op.name, op.params);
          this.revealStep(op.id, 'setup', op.t);
          break;
        }
        case 'step': {
          this.revealStep(op.id, op.step, op.t);
          break;
        }
        case 'erase':
          // Identical to the live path, and it can be, because an erase marks
          // ids as gone rather than removing anything. Compiling the same log
          // twice therefore wipes the same ink at the same time.
          this.wipe(this.eraseTargets(op.target), op.t);
          break;
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

/** Where on a box each named side sits. */
const SIDES: Record<string, (b: BBox) => Pt> = {
  top: (b) => ({ x: b.x + b.w / 2, y: b.y }),
  bottom: (b) => ({ x: b.x + b.w / 2, y: b.y + b.h }),
  left: (b) => ({ x: b.x, y: b.y + b.h / 2 }),
  right: (b) => ({ x: b.x + b.w, y: b.y + b.h / 2 }),
  centre: (b) => centreOf(b),
  center: (b) => centreOf(b),
};

function centreOf(b: BBox): Pt {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/**
 * The point on a box's edge facing `toward`, with a little air after it.
 *
 * A connector drawn centre to centre starts underneath the very thing it is
 * pointing out. This walks the direction out to the boundary instead, so a
 * link leaves an equation at its edge and arrives at the diagram's.
 */
function edgeToward(b: BBox, toward: Pt, gap = 12): Pt {
  const c = centreOf(b);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const len = Math.hypot(dx, dy);
  if (!len) return c;
  const scale = Math.min(
    dx ? b.w / 2 / Math.abs(dx) : Infinity,
    dy ? b.h / 2 / Math.abs(dy) : Infinity,
  );
  return { x: c.x + dx * scale + (dx / len) * gap, y: c.y + dy * scale + (dy / len) * gap };
}

/**
 * Is any of this part's chalk showing?
 *
 * Parts are built with `opacity: 0` and a step turns them on, so this is the
 * board's own answer rather than ours — which is what catches a part no step
 * happens to name, and a total-internal-reflection figure whose refracted ray
 * is built and, correctly, never drawn.
 */
function inked(el: SVGGraphicsElement): boolean {
  for (const child of Array.from(el.children)) {
    const o = (child as SVGElement).style?.opacity;
    // An empty string is nobody having hidden it, which means it is visible.
    if (o === '' || Number(o) > 0.02) return true;
  }
  return false;
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
