/**
 * Tool call -> board op -> response.
 *
 * The responses matter as much as the drawing. The model cannot see its own
 * board, so what comes back here is its entire picture of what it has written.
 * Every reply therefore names what actually happened, including when it
 * differs from what was asked — a silent correction is how a teacher ends up
 * pointing at something that is not there.
 *
 * Nothing throws. An unknown id, a malformed argument or an unknown tool comes
 * back as an ordinary response with an explanation, because a thrown error
 * during a lesson is just silence.
 */
import { measure, typesetProblem } from '@/board/math/mathjax';
import { asInk, inkOf } from '@/board/templates/primitives';
import { baseId, type MarkStyle, type Op } from '@/board/oplog';
import type { Scene } from '@/board/scene';
import { SHAPES } from '@/board/draw-shapes';
import { figureNames, getFigure } from '@/board/templates';
import type { ToolCall } from '@/voice/session';

import { evaluate } from './calc';
import { normaliseContent, toTypesettable } from './latex';

export interface DispatchResult {
  /**
   * The ops to apply, in order, if this call changes the board.
   *
   * A list rather than one op because a few calls are genuinely two acts: a
   * new figure has to clear the one already filling the column before it can
   * be drawn. Emitting both keeps the log honest about what was destroyed,
   * which the replay needs, and it keeps them in order without asking the
   * scheduler to hold two calls apart.
   */
  ops: Op[];
  response: Record<string, unknown>;
  /** Blocking tools must resume generation; board ops must not. */
  resume: boolean;
  /** Human-readable, for the session log. */
  note: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

const MARK_STYLES: MarkStyle[] = ['underline', 'circle', 'strike', 'box', 'cancel'];

/** Shapes drawn between two points, which are nothing without the second. */
const NEEDS_TO = new Set([
  'arrow', 'line', 'dashed', 'link', 'angle', 'curve', 'curvearrow', 'wave', 'spring', 'field',
  'dimension', 'ground', 'shade', 'resistor', 'cell', 'capacitor', 'bulb', 'switch', 'inductor', 'meter',
]);

/** A count as the model sends it — a number, or a direction for a turn. */
function countOf(raw: string): number | undefined {
  const t = raw.trim().toLowerCase();
  if (!t) return undefined;
  if (/anti|counter/.test(t)) return 1;
  if (/clock/.test(t)) return -1;
  const n = Number(t);
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}

/** Every id still on the board, in the order the teacher put them there. */
function liveIds(scene: Scene): string[] {
  return [...scene.objects.keys(), ...scene.drawings.keys(), ...scene.figures.keys()].filter(
    (id) => !scene.erased.has(id),
  );
}

/**
 * The erase a new figure needs before it can be drawn.
 *
 * A template fills the figure column — that is how they are all laid out — so
 * a second one does not sit beside the first, it sits ON it: two sets of rays,
 * two sets of labels, one unreadable board. There is no arrangement where both
 * survive, so the old one goes, and the reply says so rather than leaving the
 * teacher to refer back to a diagram that was wiped out from under it.
 */
function clearFigures(scene: Scene, now: number): Op[] {
  return scene.liveFigures().map((id) => ({ kind: 'erase', t: now, target: id }) as Op);
}

export function dispatch(call: ToolCall, scene: Scene, now: number): DispatchResult {
  const a = call.args;

  switch (call.name) {
    case 'write': {
      const id = str(a.id) || `line${scene.objects.size + 1}`;
      const raw = str(a.content);
      if (!raw) {
        return { ops: [], resume: false, note: 'write with no content', response: { ok: false, error: 'content was empty' } };
      }
      const { latex, wasCorrupted } = normaliseContent(raw);
      // Measure before placing: the layout manager needs the height to know
      // where the next line can go — and it has to measure the same string the
      // board will typeset, or a line of prose is measured as maths and the
      // one under it lands on top of it.
      const tex = toTypesettable(raw);
      const m = measure(tex);
      // Typeset anyway — as words where the TeX was broken — but say so, or
      // the model goes on writing the thing MathJax cannot read.
      const problem = typesetProblem(tex);
      const place = scene.resolvePlace(str(a.place) || undefined, m.height);

      // An id already in use would orphan every later reference to the
      // original, so it is suffixed and the model is told the new name.
      let finalId = id;
      if (scene.objects.has(id)) {
        let n = 2;
        while (scene.objects.has(`${id}${n}`)) n++;
        finalId = `${id}${n}`;
      }

      const op: Op = { kind: 'write', t: now, id: finalId, content: latex, place };
      return {
        ops: [op],
        resume: false,
        note: `write ${finalId} ${place.intent}`,
        response: {
          ok: true,
          id: finalId,
          renamed: finalId !== id ? `"${id}" was taken` : undefined,
          repaired: wasCorrupted ? 'notation was repaired in transit' : undefined,
          warning: problem
            ? `part of this could not be typeset (${problem}) and went up as plain words — ` +
              'write maths in plain notation, no backslashes: "=>" for implies, frac(a, b), theta'
            : undefined,
          where: place.intent,
          boardFullness: `${Math.round(scene.fullness() * 100)}%`,
        },
      };
    }

    case 'point':
    case 'mark': {
      const target = str(a.target);
      // Erased ink is still in the DOM — that is what makes the board seekable
      // — so it still resolves to a box. Pointing at it would tap a wiped part
      // of the board, which from the student's side is pointing at nothing.
      if (scene.erased.has(baseId(target))) {
        return {
          ops: [],
          resume: false,
          note: `${call.name} -> "${target}" was erased`,
          response: {
            ok: false,
            error: `"${target}" was erased — it is not on the board any more`,
            onBoard: liveIds(scene),
          },
        };
      }
      const box = scene.boxOf(target);
      if (!box) {
        // Deixis never errors, but the model must learn the id was wrong —
        // otherwise it keeps pointing at something that does not exist.
        return {
          ops: [],
          resume: false,
          note: `${call.name} -> unknown target "${target}"`,
          response: {
            ok: false,
            error: `nothing on the board called "${target}"`,
            onBoard: liveIds(scene),
          },
        };
      }
      // The box resolved, which is not the same as the chalk being there: a
      // figure builds every part up front and hides it until its step. Circling
      // one that has not been revealed draws a ring around empty slate — which
      // is exactly what happened to a ray diagram whose rays were never
      // stepped in.
      const hidden = scene.hiddenPart(target);
      if (hidden) {
        const fig = scene.figures.get(hidden.figure);
        return {
          ops: [],
          resume: false,
          note: `${call.name} -> "${target}" is not drawn yet`,
          response: {
            ok: false,
            error: `"${target}" is part of that figure but is NOT drawn yet — nothing was ${call.name === 'point' ? 'pointed at' : 'marked'}`,
            ...(hidden.step
              ? { fix: `call step id="${hidden.figure}" step="${hidden.step}" first, then point or mark it` }
              : {}),
            drawn: fig ? [...fig.shown] : [],
          },
        };
      }
      if (call.name === 'point') {
        return {
          ops: [{ kind: 'point', t: now, target }],
          resume: false,
          note: `point ${target}`,
          response: { ok: true, target },
        };
      }
      const wanted = str(a.style).toLowerCase();
      const style = (MARK_STYLES as string[]).includes(wanted)
        ? (wanted as MarkStyle)
        : 'circle';
      return {
        ops: [{
          kind: 'mark',
          t: now,
          id: `${target}-${style}-${Math.round(now)}`,
          target,
          style,
          // Unset is chalk, as marks always were.
          ...(asInk(str(a.colour)) ? { color: inkOf(asInk(str(a.colour))) } : {}),
        }],
        resume: false,
        note: `mark ${style} ${target}`,
        response: { ok: true, target, style, ...(style !== wanted ? { note: `"${wanted}" is not a style; used circle` } : {}) },
      };
    }

    case 'draw': {
      const id = str(a.id) || `s${scene.drawings.size + 1}`;
      const shape = str(a.shape).toLowerCase();
      if (!(SHAPES as string[]).includes(shape)) {
        return {
          ops: [],
          resume: false,
          note: `draw -> unknown shape "${shape}"`,
          response: { ok: false, error: `"${shape}" is not a shape`, shapes: SHAPES },
        };
      }
      const from = str(a.from);
      // Resolution proper happens at fire time, but an anchor that names
      // something nonexistent has to be reported NOW, while the model can still
      // recover. Answering ok and drawing nothing is how a teacher ends up
      // describing a diagram that is not there.
      const known = (ref: string) =>
        !ref ||
        /^\s*-?[\d.]+\s*,\s*-?[\d.]+\s*$/.test(ref) ||
        (!scene.erased.has(baseId(ref)) && scene.anchorOf(ref) !== null);
      const bad = [from, str(a.to), str(a.to2)].filter((r) => r && !known(r));
      if (!known(from)) {
        return {
          ops: [],
          resume: false,
          note: `draw -> unknown anchor "${from}"`,
          response: {
            ok: false,
            error: `nothing on the board called "${from}" — nothing was drawn`,
            onBoard: liveIds(scene),
            hint: 'use "x,y" from 0 to 1 for the first shape of a diagram',
          },
        };
      }
      // A shape that needs a second or third point and was not given one
      // draws nothing — say so now, while the model can still add it.
      const needs = shape === 'triangle' ? ['to', 'to2'] : NEEDS_TO.has(shape) ? ['to'] : [];
      const missing = needs.filter((k) => !str(a[k]));
      if (missing.length) {
        return {
          ops: [],
          resume: false,
          note: `draw ${shape} -> missing ${missing.join(', ')}`,
          response: { ok: false, error: `a ${shape} needs ${missing.join(' and ')} — nothing was drawn` },
        };
      }
      const a0 = scene.anchorOf(from);
      return {
        ops: [{
          kind: 'draw',
          t: now,
          id,
          shape,
          from,
          to: str(a.to) || undefined,
          to2: str(a.to2) || undefined,
          text: str(a.text) || undefined,
          colour: asInk(str(a.colour)),
          n: countOf(str(a.n)),
        }],
        resume: false,
        note: `draw ${shape} ${id}`,
        response: {
          ok: true,
          id,
          // Never clamp silently: the chalk went somewhere other than asked.
          ...(a0?.clamped ? { moved: 'that was outside the drawing area, so it was pulled inside' } : {}),
          ...(bad.length ? { ignored: `unknown anchor(s): ${bad.join(', ')}` } : {}),
          anchor: `you can attach the next shape to "${id}"`,
        },
      };
    }

    case 'scene': {
      const id = str(a.id) || 'fig';
      const name = str(a.name);
      const spec = getFigure(name);
      // A figure that is not registered draws nothing. Answering `ok` here
      // would leave the teacher describing a diagram that never appeared —
      // so the failure is reported while the model can still recover, in the
      // same turn, by building the explanation out of write and mark instead.
      if (!spec) {
        return {
          ops: [],
          resume: false,
          note: `scene -> no figure "${name}"`,
          response: {
            ok: false,
            error: `there is no prepared figure called "${name}" — nothing was drawn`,
            available: figureNames(),
            advice: 'draw it with write, point and mark instead, and keep talking',
          },
        };
      }
      const replaced = scene.liveFigures();
      return {
        ops: [...clearFigures(scene, now), { kind: 'scene', t: now, id, name, params: str(a.params) }],
        resume: false,
        note: `scene ${id} ${name} ${str(a.params)}${replaced.length ? ` (cleared ${replaced.join(' ')})` : ''}`,
        response: {
          ok: true,
          id,
          // Never silently: the teacher has to know the old diagram is gone,
          // or it will keep pointing into it.
          ...(replaced.length
            ? { cleared: `${replaced.join(', ')} had to be wiped — a figure fills the whole column` }
            : {}),
          // Naming the parts is what lets the teacher point INTO the figure.
          parts: spec.parts.map((p) => `${id}.${p}`),
          // A figure arrives with its setup and nothing else. Reporting the
          // rest as "steps" reads as a menu; reporting it as not drawn yet is
          // the truth, and it is the difference between a ray diagram with
          // rays and one the teacher only talks about.
          drawn: 'setup',
          notDrawnYet: spec.steps.filter((st) => st !== 'setup'),
        },
      };
    }

    case 'step': {
      const id = str(a.id);
      const step = str(a.step);
      const fig = scene.onBoard(id) ? scene.figures.get(id) : undefined;
      const tpl = fig?.tpl;
      if (!tpl) {
        return {
          ops: [],
          resume: false,
          note: `step -> no figure "${id}"`,
          response: { ok: false, error: `no figure called "${id}" on the board`, figures: scene.liveFigures() },
        };
      }
      // Same reasoning as an unregistered figure: a step name the template does
      // not have reveals nothing, and a silent `ok` would have the teacher
      // narrating a part of the diagram that never appeared.
      if (!tpl.stepNames.includes(step)) {
        return {
          ops: [],
          resume: false,
          note: `step -> "${id}" has no step "${step}"`,
          response: {
            ok: false,
            error: `"${id}" has no step called "${step}" — nothing was revealed`,
            steps: tpl.stepNames,
          },
        };
      }
      // A step fired twice draws nothing the second time — the animations are
      // already primed — so answering `ok` would tell the teacher chalk moved
      // when it did not, and it would go on to point at a part it thinks it
      // just revealed. Say it is already up instead.
      if (fig.shown.has(step)) {
        return {
          ops: [],
          resume: false,
          note: `step ${id}.${step} -> already drawn`,
          response: {
            ok: true,
            id,
            step,
            note: 'that stage was already on the board — nothing new was drawn',
            notDrawnYet: tpl.stepNames.filter((s) => !fig.shown.has(s)),
          },
        };
      }
      return {
        ops: [{ kind: 'step', t: now, id, step }],
        resume: false,
        note: `step ${id}.${step}`,
        response: { ok: true, id, step },
      };
    }

    case 'erase': {
      const target = str(a.target).trim() || 'board';
      const gone = scene.eraseTargets(target);
      // Saying `ok` to an erase that took nothing away would have the teacher
      // believing it has room it does not have, and writing into the mess.
      if (!gone.length) {
        return {
          ops: [],
          resume: false,
          note: `erase -> nothing called "${target}"`,
          response: {
            ok: false,
            error:
              target.toLowerCase() === 'board'
                ? 'the board is already empty — nothing was erased'
                : `nothing on the board called "${target}" — nothing was erased`,
            onBoard: liveIds(scene),
          },
        };
      }
      return {
        ops: [{ kind: 'erase', t: now, target }],
        resume: false,
        note: `erase ${target} (${gone.join(' ')})`,
        response: {
          ok: true,
          erased: gone,
          // Anything drawn around what went goes with it; a circle left on a
          // cleared board is the thing being pointed at now being nothing.
          note: 'anything marking those went too, and the space is free again',
        },
      };
    }

    case 'calc': {
      const r = evaluate(str(a.expr));
      return {
        ops: [],
        // BLOCKING: generation stopped for this, so it must be told to carry on.
        resume: true,
        note: `calc ${str(a.expr)} = ${r.ok ? r.text : r.error}`,
        response: r.ok
          ? { ok: true, value: r.value, text: r.text }
          : { ok: false, error: r.error, hint: 'trig is in degrees; use * for multiply' },
      };
    }

    default:
      return {
        ops: [],
        resume: false,
        note: `unknown tool ${call.name}`,
        response: { ok: false, error: `no tool called "${call.name}"` },
      };
  }
}

/**
 * What the model is told the board looks like.
 *
 * The model cannot see the board, so this is its only picture of it, and a
 * picture that stops at "there is a figure called fig" is how a teacher ends
 * up describing rays it never revealed. A figure therefore reports what it is
 * and, more importantly, what of it is still NOT drawn — step names, because
 * those are the thing the teacher can actually act on.
 *
 * Still kept short. It rides on every tool response, and every token here is
 * one the teacher could have spent talking, so the parts are left out: `scene`
 * named them once, and the point/mark guard names the missing one at the
 * moment it matters.
 */
export function boardSummary(scene: Scene): string {
  const lines = [...scene.objects.values()]
    .filter((o) => !scene.erased.has(o.id))
    .map((o) => `${o.id}: ${o.content}${o.partial ? ' [PARTIAL — you were interrupted]' : ''}`);
  const figs = [...scene.figures.entries()].filter(([id]) => !scene.erased.has(id)).map(([id, f]) => {
    const left = f.tpl.stepNames.filter((s) => !f.shown.has(s));
    return (
      `${id}: ${f.name} figure, drawn: ${[...f.shown].join(' ') || 'nothing yet'}` +
      (left.length ? ` — NOT drawn yet: ${left.join(' ')} (call step)` : '')
    );
  });
  const sketch = [...scene.drawings.keys()].filter((id) => !scene.erased.has(id));
  return (
    [...lines, ...figs, sketch.length ? `sketched: ${sketch.join(' ')}` : '']
      .filter(Boolean)
      .join('\n') || '(board is empty)'
  );
}
