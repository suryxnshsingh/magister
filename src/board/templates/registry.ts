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

/** The catalogue, written for the model rather than for us. */
export function describeFigures(): string {
  return [...REGISTRY.entries()]
    .map(([name, f]) => `"${name}" — ${f.description} params: ${f.params}`)
    .join(' | ');
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
