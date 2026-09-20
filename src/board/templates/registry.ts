/**
 * The figures the teacher can draw.
 *
 * `scene` used to call `createProjectile` directly, which was fine while there
 * was one figure and wrong the moment the teacher could teach any chapter. A
 * registry means adding a figure is one entry here plus one file, and the tool
 * description can be generated from it rather than drifting out of sync with
 * what actually exists — a model told about a figure that is not implemented
 * will cheerfully call it and draw nothing.
 */
import type { Template } from './projectile';
import type { Pt } from '../units';

export interface FigureSpec {
  /** One line for the model, listing what it draws and when to reach for it. */
  description: string;
  /** Parameters, as the flat "a=1, b=2" string the tool takes. */
  params: string;
  /**
   * Addressable parts and reveal steps, declared rather than discovered.
   *
   * The dispatcher answers the model the instant `scene` arrives — long before
   * the figure is built at its playback anchor — so it cannot ask the template
   * what it contains. Declaring them here is what lets the reply name the
   * figure's real parts instead of guessing. `/figure-test` asserts these match
   * what `build` actually produces, so they cannot quietly drift.
   */
  parts: string[];
  steps: string[];
  /**
   * One phrase per reveal step, for the model choosing between them. Knowing
   * that `reflect` exists is not the same as knowing it is the one to call for
   * a mirror, and a realtime model picks a step name mid-sentence.
   */
  stepNotes?: Record<string, string>;
  build(
    id: string,
    layer: SVGGElement,
    params: Record<string, string>,
    toPx: (p: Pt) => Pt,
  ): Template;
}

const REGISTRY = new Map<string, FigureSpec>();

export function registerFigure(name: string, spec: FigureSpec) {
  REGISTRY.set(name, spec);
}

export function getFigure(name: string): FigureSpec | null {
  return REGISTRY.get(name) ?? null;
}

export function figureNames(): string[] {
  return [...REGISTRY.keys()];
}

/**
 * The catalogue, written for the model rather than for us.
 *
 * The reveal steps are named here and not only in the `scene` reply, because
 * that reply is sent when the chalk moves — five to thirteen seconds after the
 * call, by which time the turn that would have used them is already generated.
 * A figure whose steps the teacher learns too late is a figure that never gets
 * past its setup.
 */
export function describeFigures(): string {
  return [...REGISTRY.entries()]
    .map(
      ([name, f]) =>
        `"${name}" — ${f.description} params: ${f.params}. ` +
        `reveal steps: ${revealSteps(f).join(', ') || 'none'}`,
    )
    .join(' | ');
}

/** Everything after `setup`, which `scene` fires for you. */
function revealSteps(f: FigureSpec): string[] {
  return f.steps.filter((s) => s !== 'setup');
}

/** The steps, per figure, for the tool that fires them. */
export function describeSteps(): string {
  return [...REGISTRY.entries()]
    .map(([name, f]) => {
      const steps = revealSteps(f).map((s) =>
        f.stepNotes?.[s] ? `${s} (${f.stepNotes[s]})` : s,
      );
      return `${name}: ${steps.join(', ') || 'none'}`;
    })
    .join('. ');
}

/**
 * Which step reveals which part.
 *
 * Every piece of a figure is built up front and hidden, so a part's address
 * resolving is not the same as the part being on the board: `fig.incident`
 * gives a perfectly good bounding box while the ray is still invisible. The
 * answer is in the steps — a step's animations are named `<figure>.<part>`,
 * the same address `point` and `mark` use — so asking each step what it would
 * return says which parts it puts up.
 *
 * Safe to ask: a step factory only constructs animations. Nothing touches the
 * DOM until the clock calls `init`, and these are thrown away.
 */
export function stepOfPart(id: string, tpl: Template): Map<string, string> {
  const out = new Map<string, string>();
  for (const step of tpl.stepNames) {
    for (const a of tpl.steps.get(step)?.(0) ?? []) {
      const part = a.id.startsWith(`${id}.`) ? a.id.slice(id.length + 1) : '';
      if (tpl.parts.has(part) && !out.has(part)) out.set(part, step);
    }
  }
  return out;
}

/**
 * "u=20, theta=30" -> { u: "20", theta: "30" }.
 *
 * Values stay strings: a figure may want a number, a formula or a label, and
 * only the figure knows which.
 */
export function parseParams(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of s.split(/[,;]/)) {
    const i = pair.indexOf('=');
    if (i === -1) continue;
    const k = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}
