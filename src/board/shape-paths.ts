/**
 * Geometry for the drawable shapes, as SVG path data and nothing else.
 *
 * Path data is the one currency the chalk pipeline accepts: it roughens a `d`
 * string and draws it stroke by stroke. So every shape here is built from
 * strokes — a coil is a zigzag, a cell is two plates, a hatched floor is a
 * line and its hatches — never a fill, a `<use>` or a symbol font.
 *
 * These are the sub-parts the figure research found under most exam figures:
 * a free-body diagram, an incline, a spring, a circuit and a wave are the same
 * handful of strokes in different arrangements. With them the teacher builds
 * any of those one piece at a time, anchored to what is already drawn, which
 * is how a diagram is drawn on a real board.
 *
 * Pure — no DOM — so it is tested directly.
 */
import { arcD, arrowD, hatchD } from './templates/primitives';
import type { Pt } from './units';

const f = (n: number) => n.toFixed(1);

/** A frame along a→b: `at(t, s)` is t along, s to the left of travel. */
function frame(a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Screen y points down, so (uy, -ux) is to the left of travel.
  const vx = uy;
  const vy = -ux;
  return {
    len,
    at: (t: number, s = 0): Pt => ({ x: a.x + ux * t + vx * s, y: a.y + uy * t + vy * s }),
  };
}

const poly = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)},${f(p.y)}`).join('');

/** A spring between two points: straight ends, a zigzag of `coils` between. */
export function springD(a: Pt, b: Pt, coils?: number): string {
  const { len, at } = frame(a, b);
  const n = Math.max(3, Math.round(coils ?? len / 38));
  const lead = Math.min(28, len * 0.12);
  const body = len - lead * 2;
  const pts: Pt[] = [a, at(lead)];
  for (let i = 0; i < n * 2; i++) pts.push(at(lead + ((i + 0.5) / (n * 2)) * body, i % 2 ? -16 : 16));
  pts.push(at(len - lead), b);
  return poly(pts);
}

/** A sine wave from a to b, `cycles` full cycles of it. */
export function waveD(a: Pt, b: Pt, cycles?: number, amplitude = 34): string {
  const { len, at } = frame(a, b);
  const n = Math.max(1, Math.round(cycles ?? len / 150));
  const steps = n * 28;
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * len;
    pts.push(at(t, amplitude * Math.sin((i / steps) * n * 2 * Math.PI)));
  }
  return poly(pts);
}

/**
 * A curve from a to b that passes THROUGH `via` — a trajectory, a field line,
 * a bent ray. Without `via` it bows gently to the left of travel.
 */
export function curveD(a: Pt, b: Pt, via?: Pt | null): string {
  const { len, at } = frame(a, b);
  const mid = via ?? at(len / 2, len * 0.22);
  // The control point that makes a quadratic pass through `mid` at t = 0.5.
  const cx = 2 * mid.x - (a.x + b.x) / 2;
  const cy = 2 * mid.y - (a.y + b.y) / 2;
  return `M${f(a.x)},${f(a.y)}Q${f(cx)},${f(cy)} ${f(b.x)},${f(b.y)}`;
}

/** The same curve with a head at b, pointing along the curve as it arrives. */
export function curveArrowD(a: Pt, b: Pt, via?: Pt | null): string {
  const { len, at } = frame(a, b);
  const mid = via ?? at(len / 2, len * 0.22);
  const cx = 2 * mid.x - (a.x + b.x) / 2;
  const cy = 2 * mid.y - (a.y + b.y) / 2;
  // The tangent at the end of a quadratic runs from its control point to b.
  return `${curveD(a, b, via)}${arrowD({ x: cx, y: cy }, b, 16).replace(/^M[^M]*/, '')}`;
}

/**
 * A curved arrow around a centre — a torque, a rotation, a current loop.
 * Anticlockwise, as angular quantities are measured, unless `clockwise`.
 */
export function turnD(centre: Pt, rim: Pt, clockwise = false): string {
  const r = Math.max(24, Math.hypot(rim.x - centre.x, rim.y - centre.y));
  const start = (Math.atan2(centre.y - rim.y, rim.x - centre.x) * 180) / Math.PI;
  const sweep = clockwise ? -290 : 290;
  const end = start + sweep;
  const at = (d: number): Pt => ({
    x: centre.x + r * Math.cos((d * Math.PI) / 180),
    y: centre.y - r * Math.sin((d * Math.PI) / 180),
  });
  // arcD sweeps from its lower angle to its higher, so a clockwise turn is
  // drawn from where it ends; the head goes where the motion arrives either way.
  const arc = clockwise ? arcD(centre, r, end, start) : arcD(centre, r, start, end);
  const tip = at(end);
  const back = at(end - (clockwise ? -12 : 12));
  return `${arc}${arrowD(back, tip, 15).replace(/^M[^M]*/, '')}`;
}

/** A uniform field: `count` parallel arrows the length and direction of a→b. */
export function fieldD(a: Pt, b: Pt, count?: number): string[] {
  const { len, at } = frame(a, b);
  const n = Math.max(2, Math.min(9, Math.round(count ?? 4)));
  const gap = 46;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const s = (i - (n - 1) / 2) * gap;
    out.push(arrowD(at(0, s), at(len, s), 14));
  }
  return out;
}

/** A measured length: end stops, a double-headed line, and where its label sits. */
export function dimensionD(a: Pt, b: Pt): { d: string[]; label: Pt } {
  const { len, at } = frame(a, b);
  const stop = (t: number) => `M${f(at(t, -12).x)},${f(at(t, -12).y)}L${f(at(t, 12).x)},${f(at(t, 12).y)}`;
  const mid = at(len / 2);
  return {
    d: [stop(0), stop(len), arrowD(mid, a, 13), arrowD(mid, b, 13)],
    label: at(len / 2, 30),
  };
}

/** A surface with its hatching on the right of travel: draw a floor left to right. */
export function groundD(a: Pt, b: Pt): string[] {
  return [`M${f(a.x)},${f(a.y)}L${f(b.x)},${f(b.y)}`, ...hatchD(a, b, 18, 20)];
}

export function triangleD(a: Pt, b: Pt, c: Pt): string {
  return `${poly([a, b, c])}Z`;
}

/** A charge: a ring with its sign in strokes. */
export function chargeD(at: Pt, sign: '+' | '-'): string[] {
  const r = 18;
  const ring = `M${f(at.x - r)},${f(at.y)}a${r},${r} 0 1 0 ${r * 2},0a${r},${r} 0 1 0 ${-r * 2},0`;
  const bar = `M${f(at.x - 9)},${f(at.y)}L${f(at.x + 9)},${f(at.y)}`;
  const stem = `M${f(at.x)},${f(at.y - 9)}L${f(at.x)},${f(at.y + 9)}`;
  return sign === '+' ? [ring, bar, stem] : [ring, bar];
}

export type Component = 'resistor' | 'cell' | 'capacitor' | 'bulb' | 'switch' | 'inductor' | 'meter';

/**
 * A circuit component between two points: wire from each end to a body
 * centred between them, so components chain end to end into a circuit.
 * `centre` is where a meter's letter goes; `label` is beside the component,
 * off to the side of the wire — above a horizontal one, beside a vertical one
 * — never on the wire itself.
 */
export function componentD(kind: Component, a: Pt, b: Pt): { d: string[]; centre: Pt; label: Pt } {
  const { len, at } = frame(a, b);
  const mid = len / 2;
  const wire = (t0: number, t1: number) => `M${f(at(t0).x)},${f(at(t0).y)}L${f(at(t1).x)},${f(at(t1).y)}`;
  const across = (t: number, half: number) =>
    `M${f(at(t, -half).x)},${f(at(t, -half).y)}L${f(at(t, half).x)},${f(at(t, half).y)}`;
  const ring = (r: number) => {
    const c = at(mid);
    return `M${f(c.x - r)},${f(c.y)}a${r},${r} 0 1 0 ${r * 2},0a${r},${r} 0 1 0 ${-r * 2},0`;
  };
  const centre = at(mid);
  const label = at(mid, 42);
  switch (kind) {
    case 'resistor': {
      const half = Math.min(40, len / 3);
      const pts: Pt[] = [at(mid - half)];
      for (let i = 0; i < 6; i++) pts.push(at(mid - half + ((i + 0.5) / 6) * half * 2, i % 2 ? -13 : 13));
      pts.push(at(mid + half));
      return { d: [wire(0, mid - half), poly(pts), wire(mid + half, len)], centre, label };
    }
    case 'cell':
      // The long plate is the positive terminal.
      return { d: [wire(0, mid - 7), across(mid - 7, 24), across(mid + 7, 12), wire(mid + 7, len)], centre, label };
    case 'capacitor':
      return { d: [wire(0, mid - 8), across(mid - 8, 22), across(mid + 8, 22), wire(mid + 8, len)], centre, label };
    case 'bulb': {
      const r = 18;
      const k = r * 0.7;
      const c = at(mid);
      return {
        d: [
          wire(0, mid - r),
          ring(r),
          `M${f(c.x - k)},${f(c.y - k)}L${f(c.x + k)},${f(c.y + k)}M${f(c.x - k)},${f(c.y + k)}L${f(c.x + k)},${f(c.y - k)}`,
          wire(mid + r, len),
        ],
        centre,
        label,
      };
    }
    case 'switch': {
      const gap = Math.min(46, len / 3);
      const hinge = at(mid - gap / 2);
      const lever = at(mid + gap / 2, 22);
      return {
        d: [wire(0, mid - gap / 2), `M${f(hinge.x)},${f(hinge.y)}L${f(lever.x)},${f(lever.y)}`, wire(mid + gap / 2, len)],
        centre,
        label,
      };
    }
    case 'inductor': {
      const half = Math.min(44, len / 3);
      const loops = 4;
      const w = (half * 2) / loops;
      let d = `M${f(at(mid - half).x)},${f(at(mid - half).y)}`;
      for (let i = 0; i < loops; i++) {
        const p = at(mid - half + (i + 1) * w);
        d += `A${f(w / 2)},${f(w / 2)} 0 0 1 ${f(p.x)},${f(p.y)}`;
      }
      return { d: [wire(0, mid - half), d, wire(mid + half, len)], centre, label };
    }
    case 'meter':
      return { d: [wire(0, mid - 20), ring(20), wire(mid + 20, len)], centre, label };
  }
}
