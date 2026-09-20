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
import { measure } from '@/board/math/mathjax';
import type { MarkStyle, Op } from '@/board/oplog';
import type { Scene } from '@/board/scene';
import { SHAPES } from '@/board/draw-shapes';
import { figureNames, getFigure } from '@/board/templates';
import type { ToolCall } from '@/voice/session';

import { evaluate } from './calc';
import { normaliseContent } from './latex';

export interface DispatchResult {
  /** The op to schedule, if this call draws anything. */
  op: Op | null;
  response: Record<string, unknown>;
  /** Blocking tools must resume generation; board ops must not. */
  resume: boolean;
  /** Human-readable, for the session log. */
  note: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

const MARK_STYLES: MarkStyle[] = ['underline', 'circle', 'strike', 'box'];

export function dispatch(call: ToolCall, scene: Scene, now: number): DispatchResult {
  const a = call.args;

  switch (call.name) {
    case 'write': {
      const id = str(a.id) || `line${scene.objects.size + 1}`;
      const raw = str(a.content);
      if (!raw) {
        return { op: null, resume: false, note: 'write with no content', response: { ok: false, error: 'content was empty' } };
      }
      const { latex, wasCorrupted } = normaliseContent(raw);
      // Measure before placing: the layout manager needs the height to know
      // where the next line can go.
      const inner = latex.replace(/^\s*\$|\$\s*$/g, '');
      const m = measure(inner);
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
        op,
        resume: false,
        note: `write ${finalId} ${place.intent}`,
        response: {
          ok: true,
          id: finalId,
          renamed: finalId !== id ? `"${id}" was taken` : undefined,
          repaired: wasCorrupted ? 'notation was repaired in transit' : undefined,
          where: place.intent,
          boardFullness: `${Math.round(scene.fullness() * 100)}%`,
        },
      };
    }

    case 'point':
    case 'mark': {
      const target = str(a.target);
      const box = scene.boxOf(target);
      if (!box) {
        // Deixis never errors, but the model must learn the id was wrong —
        // otherwise it keeps pointing at something that does not exist.
        return {
          op: null,
          resume: false,
          note: `${call.name} -> unknown target "${target}"`,
          response: {
            ok: false,
            error: `nothing on the board called "${target}"`,
            onBoard: [...scene.objects.keys()],
          },
        };
      }
      if (call.name === 'point') {
        return {
          op: { kind: 'point', t: now, target },
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
        op: { kind: 'mark', t: now, id: `${target}-${style}-${Math.round(now)}`, target, style },
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
          op: null,
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
        !ref || /^\s*-?[\d.]+\s*,\s*-?[\d.]+\s*$/.test(ref) || scene.anchorOf(ref) !== null;
      const bad = [from, str(a.to), str(a.to2)].filter((r) => r && !known(r));
      if (!known(from)) {
        return {
          op: null,
          resume: false,
          note: `draw -> unknown anchor "${from}"`,
          response: {
            ok: false,
            error: `nothing on the board called "${from}" — nothing was drawn`,
            onBoard: [...scene.drawings.keys(), ...scene.objects.keys()],
            hint: 'use "x,y" from 0 to 1 for the first shape of a diagram',
          },
        };
      }
      const a0 = scene.anchorOf(from);
      return {
        op: {
          kind: 'draw',
          t: now,
          id,
          shape,
          from,
          to: str(a.to) || undefined,
          to2: str(a.to2) || undefined,
          text: str(a.text) || undefined,
          colour: (['chalk', 'dim', 'accent'] as string[]).includes(str(a.colour))
            ? (str(a.colour) as 'chalk' | 'dim' | 'accent')
            : undefined,
        },
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
          op: null,
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
      return {
        op: { kind: 'scene', t: now, id, name, params: str(a.params) },
        resume: false,
        note: `scene ${id} ${name} ${str(a.params)}`,
        response: {
          ok: true,
          id,
          // Naming the parts is what lets the teacher point INTO the figure.
          parts: spec.parts.map((p) => `${id}.${p}`),
          steps: spec.steps,
        },
      };
    }

    case 'step': {
      const id = str(a.id);
      const step = str(a.step);
      const tpl = scene.templates.get(id);
      if (!tpl) {
        return {
          op: null,
          resume: false,
          note: `step -> no figure "${id}"`,
          response: { ok: false, error: `no figure called "${id}"`, figures: [...scene.templates.keys()] },
        };
      }
      // Same reasoning as an unregistered figure: a step name the template does
      // not have reveals nothing, and a silent `ok` would have the teacher
      // narrating a part of the diagram that never appeared.
      if (!tpl.stepNames.includes(step)) {
        return {
          op: null,
          resume: false,
          note: `step -> "${id}" has no step "${step}"`,
          response: {
            ok: false,
            error: `"${id}" has no step called "${step}" — nothing was revealed`,
            steps: tpl.stepNames,
          },
        };
      }
      return {
        op: { kind: 'step', t: now, id, step },
        resume: false,
        note: `step ${id}.${step}`,
        response: { ok: true, id, step },
      };
    }

    case 'calc': {
      const r = evaluate(str(a.expr));
      return {
        op: null,
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
        op: null,
        resume: false,
        note: `unknown tool ${call.name}`,
        response: { ok: false, error: `no tool called "${call.name}"` },
      };
  }
}

/**
 * What the model is told the board looks like.
 *
 * Kept short — it rides on tool responses, and every token here is one the
 * teacher could have spent talking.
 */
export function boardSummary(scene: Scene): string {
  const lines = [...scene.objects.values()].map(
    (o) => `${o.id}: ${o.content}${o.partial ? ' [PARTIAL — you were interrupted]' : ''}`,
  );
  const figs = [...scene.templates.keys()].map((f) => `${f} (figure)`);
  return [...lines, ...figs].join('\n') || '(board is empty)';
}
