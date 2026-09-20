/**
 * The `ray` figure: light meeting a boundary.
 *
 * Covers refraction (Snell's law) and reflection, which are the same drawing —
 * an interface, a normal, a ray in and a ray out, with the angles marked. They
 * differ only in where the outgoing ray goes, so they are one figure with a
 * `kind`, not two.
 *
 * Ray optics is the joint-highest weightage chapter in NEET physics, and the
 * construction IS the pedagogy: the angles are measured from the NORMAL, not
 * from the surface, and that is the single most common mistake students make.
 * So the normal is drawn first and the angle arcs sit against it.
 *
 * Like every figure here, it takes the problem's physics — refractive indices
 * and an angle of incidence — and never coordinates. Snell's law is solved
 * internally, so the picture cannot disagree with the arithmetic the teacher
 * says out loud.
 *
 * Parts (addressable as `<id>.<name>` by point/mark):
 *   interface normal incident refracted reflected point
 *   angle_i angle_r n1 n2 label_i label_r
 * Steps:
 *   setup      the boundary, the normal, the two media labelled
 *   incident   the incoming ray and the angle of incidence
 *   refract    the refracted ray bending toward or away from the normal
 *   reflect    the reflected ray, equal angle on the far side
 */
import { createDraw, createFadeIn } from '../animations/draw';
import type { Animation } from '../clock';
import { FIGURE, type Pt } from '../units';
import type { Template } from './projectile';
import {
  arcD,
  arrowD,
  CHALK,
  dashedD,
  DIM,
  FigureParts,
  hatchD,
  onArc,
  YELLOW,
} from './primitives';
import { registerFigure } from './registry';

interface RayParams {
  kind: 'refraction' | 'reflection';
  /** Refractive index above the boundary. */
  n1: number;
  /** Below it. Ignored for reflection. */
  n2: number;
  /** Angle of incidence, measured from the normal, in degrees. */
  i: number;
}

function read(p: Record<string, string>): RayParams {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n !== 0 ? n : d;
  };
  const k = (p.kind || '').toLowerCase();
  return {
    kind: k.startsWith('refl') || k === 'mirror' ? 'reflection' : 'refraction',
    n1: num(p.n1, 1),
    n2: num(p.n2, 1.5),
    i: Math.min(89, Math.max(1, num(p.i ?? p.angle ?? p.theta, 40))),
  };
}

const RAD = Math.PI / 180;

export function createRay(
  id: string,
  layer: SVGGElement,
  raw: Record<string, string>,
  toPx: (p: Pt) => Pt,
): Template {
  const p = read(raw);
  const f = new FigureParts(id, layer);

  // Snell's law, solved here so the drawing and the teacher's arithmetic
  // cannot disagree. Past the critical angle there is no refracted ray at all,
  // which is a real physical case and must not draw a bogus one.
  const sinR = (p.n1 * Math.sin(p.i * RAD)) / p.n2;
  const tir = p.kind === 'refraction' && sinR > 1;
  const r = tir ? 90 : (Math.asin(Math.min(1, sinR)) * 180) / Math.PI;

  // Geometry in board units: the boundary across the figure column, the point
  // of incidence at its centre.
  const midX = (FIGURE.left + FIGURE.right) / 2;
  const midY = (FIGURE.top + FIGURE.bottom) / 2;
  const halfW = (FIGURE.right - FIGURE.left) / 2 - 0.25;
  const L = Math.min(halfW * 0.92, (FIGURE.top - FIGURE.bottom) / 2 - 0.55);

  const O = { x: midX, y: midY };
  const P = (q: Pt) => toPx(q);
  const along = (deg: number, len: number, up: boolean) => ({
    x: O.x + len * Math.sin(deg * RAD),
    y: O.y + (up ? 1 : -1) * len * Math.cos(deg * RAD),
  });

  // ---- the boundary and the normal ---------------------------------------
  const ifaceL = { x: midX - halfW, y: midY };
  const ifaceR = { x: midX + halfW, y: midY };
  const iface = f.add(
    'interface',
    f.rough(`M${P(ifaceL).x},${P(ifaceL).y}L${P(ifaceR).x},${P(ifaceR).y}`, 0.7),
    CHALK,
    3.5,
  );

  // Hatching under the boundary reads as "the denser medium is solid stuff".
  // Only for reflection, where the surface is a mirror.
  const surface =
    p.kind === 'reflection'
      ? f.add('surface', hatchD(P(ifaceL), P(ifaceR), 26, 34), DIM, 2)
      : null;

  const normTop = { x: midX, y: midY + L };
  const normBot = { x: midX, y: midY - L };
  // Dashed, because it is a construction line and not a ray. That distinction
  // is the whole reason students mis-measure these angles from the surface.
  const normal = f.add('normal', dashedD(P(normTop), P(normBot)), DIM, 2.5);

  // ---- rays ---------------------------------------------------------------
  // Incident comes from the upper left, travelling down and to the right.
  const inStart = along(-p.i, L, true);
  const incident = f.add('incident', f.rough(arrowD(P(inStart), P(O)), 0.6), CHALK, 4);

  // Refracted continues below the boundary, bent toward the normal when
  // entering a denser medium and away when leaving one.
  const outEnd = along(r, L, false);
  const refracted = f.add(
    'refracted',
    f.rough(arrowD(P(O), P(outEnd)), 0.6),
    CHALK,
    4,
  );

  // Reflected leaves at the same angle on the other side of the normal.
  const reflEnd = along(p.i, L, true);
  const reflected = f.add(
    'reflected',
    f.rough(arrowD(P(O), P(reflEnd)), 0.6),
    p.kind === 'reflection' ? CHALK : DIM,
    p.kind === 'reflection' ? 4 : 3,
  );

  const op = P(O);
  const dot = f.dot('point', op, 6, CHALK);

  // ---- angle arcs, measured from the NORMAL -------------------------------
  // This is the whole teaching point, so the arcs sit against the normal and
  // never against the surface.
  const AR = 62;
  const angleI = f.add('angle_i', f.rough(arcD(op, AR, 90, 90 + p.i), 0.6), YELLOW, 2.5);
  const angleR = f.add(
    'angle_r',
    p.kind === 'reflection'
      ? f.rough(arcD(op, AR * 0.82, 90 - p.i, 90), 0.6)
      : f.rough(arcD(op, AR, 270 + r, 270), 0.6),
    YELLOW,
    2.5,
  );

  // ---- labels -------------------------------------------------------------
  // Each angle label sits on its own arc's bisector, just outside the arc, so
  // it can never land on top of the ray it is measuring.
  const LR = AR * 1.42;
  const labI = f.label('label_i', 'i', onArc(op, LR, 90 + p.i / 2));
  const labR = f.label(
    'label_r',
    'r',
    p.kind === 'reflection'
      ? onArc(op, LR * 0.9, 90 - p.i / 2)
      : onArc(op, LR, 270 + r / 2),
  );

  const medTop = f.label(
    'n1',
    p.kind === 'reflection' ? 'air' : `n₁ = ${p.n1}`,
    { x: P(ifaceL).x + 46, y: P(ifaceL).y - 26 },
    'start',
  );
  const medBot = f.label(
    'n2',
    p.kind === 'reflection' ? 'mirror' : `n₂ = ${p.n2}`,
    { x: P(ifaceL).x + 46, y: P(ifaceL).y + 52 },
    'start',
  );

  // ---- steps --------------------------------------------------------------
  const steps = new Map<string, (at: number) => Animation[]>();

  steps.set('setup', (at) => [
    createDraw(`${id}.interface`, iface, at, 560),
    ...(surface ? [createDraw(`${id}.surface`, surface, at + 300, 500)] : []),
    createDraw(`${id}.normal`, normal, at + 480, 420),
    // One fade per part, not one for both: an animation is named for the part
    // it reveals, and that name is how the board knows whether a part the
    // teacher points at is actually up yet.
    createFadeIn(`${id}.n1`, [medTop], at + 760, 300),
    createFadeIn(`${id}.n2`, [medBot], at + 760, 300),
  ]);

  steps.set('incident', (at) => [
    createDraw(`${id}.incident`, incident, at, 560),
    createFadeIn(`${id}.point`, [dot], at + 420, 200),
    createDraw(`${id}.angle_i`, angleI, at + 520, 320),
    createFadeIn(`${id}.label_i`, [labI], at + 700, 240),
  ]);

  steps.set('refract', (at) =>
    // Total internal reflection: there IS no refracted ray. Drawing one would
    // be a lie the teacher then has to talk around.
    tir
      ? [createDraw(`${id}.reflected`, reflected, at, 560)]
      : [
          createDraw(`${id}.refracted`, refracted, at, 620),
          createDraw(`${id}.angle_r`, angleR, at + 480, 320),
          createFadeIn(`${id}.label_r`, [labR], at + 660, 240),
        ],
  );

  steps.set('reflect', (at) => [
    createDraw(`${id}.reflected`, reflected, at, 560),
    ...(p.kind === 'reflection'
      ? [
          createDraw(`${id}.angle_r`, angleR, at + 420, 320),
          createFadeIn(`${id}.label_r`, [labR], at + 600, 240),
        ]
      : []),
  ]);

  return {
    root: f.root,
    parts: f.parts,
    steps,
    stepNames: [...steps.keys()],
    partNames: [...f.parts.keys()],
  };
}

registerFigure('ray', {
  description:
    'light hitting a boundary: the surface, the normal (dashed), the incoming ray ' +
    'and the angle of incidence; steps add the refracted ray (Snell’s law solved ' +
    'for you) or the reflected ray. kind=reflection draws a mirror instead. Use for ' +
    'refraction, Snell’s law, reflection, critical angle and total internal reflection.',
  params: 'kind=refraction, n1=1, n2=1.5, i=40',
  parts: [
    'interface',
    // Only built when kind=reflection. Declared anyway: pointing at it in the
    // refraction case fails gracefully with the list of what IS on the board,
    // whereas leaving it undeclared means the teacher never learns it can
    // point at the mirror at all.
    'surface',
    'normal',
    'incident',
    'refracted',
    'reflected',
    'point',
    'angle_i',
    'angle_r',
    'label_i',
    'label_r',
    'n1',
    'n2',
  ],
  steps: ['setup', 'incident', 'refract', 'reflect'],
  stepNotes: {
    incident: 'the incoming ray and the angle of incidence',
    refract: 'the refracted ray, bent by Snell’s law',
    reflect: 'the reflected ray, equal angle on the far side — the mirror case',
  },
  build: createRay,
});
