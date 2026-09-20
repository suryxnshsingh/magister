/**
 * Arithmetic the model is not allowed to do in its head.
 *
 * A wrong number said aloud and written on the board becomes a wrong number in
 * the student's notebook, so `calc` is the one BLOCKING tool: generation stops
 * until the result is back. It answers in well under a millisecond, so the
 * pause costs a network round trip and nothing more.
 *
 * TRIG IS IN DEGREES. Physics teaching is in degrees, the model will write
 * sin(30) meaning a half, and plain mathjs would read that as radians. On the
 * screenplay's own headline result that is the difference between
 *
 *     R = 20^2 * sin(2*30) / 10  =  34.64 m      (degrees, correct)
 *     R = 20^2 * sin(60)   / 10  = -12.19 m      (radians, and boxed on the
 *                                                 board as the final answer)
 *
 * so the override is not a nicety.
 */
import { create, all, type MathJsInstance } from 'mathjs';

const D = Math.PI / 180;

let instance: MathJsInstance | null = null;

function math(): MathJsInstance {
  if (instance) return instance;
  const m = create(all, {});
  m.import(
    {
      sin: (x: number) => Math.sin(x * D),
      cos: (x: number) => Math.cos(x * D),
      tan: (x: number) => Math.tan(x * D),
      asin: (x: number) => Math.asin(x) / D,
      acos: (x: number) => Math.acos(x) / D,
      atan: (x: number) => Math.atan(x) / D,
      atan2: (y: number, x: number) => Math.atan2(y, x) / D,
      /** Handy for kinematics; the model can write g instead of 9.8 or 10. */
      g: 10,
    },
    { override: true },
  );
  instance = m;
  return m;
}

export interface CalcResult {
  ok: boolean;
  value?: number;
  /** Rounded for speaking and writing: "34.6". */
  text?: string;
  error?: string;
}

/** Round for a board, not for a spreadsheet. */
function present(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  const r = Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2);
  return r.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

export function evaluate(expr: string): CalcResult {
  const src = expr.trim();
  if (!src) return { ok: false, error: 'empty expression' };
  try {
    const v = math().evaluate(src);
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, error: `not a finite number: ${String(v)}` };
    }
    return { ok: true, value: v, text: present(v) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
