/**
 * The `lens` figure: image formation by a spherical mirror or a thin lens.
 *
 * `ray` covers light meeting a FLAT boundary. Every remaining mark in ray
 * optics — the biggest chapter in the paper — is spherical, and it is all one
 * drawing: an axis, an element, an object, two construction rays, an image.
 * Mirrors and lenses differ in which way the light leaves and in the sign of
 * one term, so they are one figure with a `kind`, not four.
 *
 * ## The sign convention is the figure
 *
 * Everything here is Cartesian, as NCERT sets it out: distances are measured
 * from the pole (or optical centre), positive in the direction the light
 * travels, which is left to right. So x on the board and the sign of a
 * distance are the same statement, and the drawing cannot drift from the
 * arithmetic — a negative v puts the image on the left because that is what
 * negative MEANS.
 *
 * The trap this figure exists to survive: a concave mirror's focal length is
 * NEGATIVE and a converging lens's is POSITIVE. A teacher saying "concave
 * mirror, focal length twenty" will send f=20, and feeding that to the mirror
 * equation draws a convex mirror while the voice says concave. So `f` and `u`
 * are read as MAGNITUDES and signed from `kind` — then the signed value is
 * what gets written on the board, because the sign is the teaching.
 *
 * Parts (addressable as `<id>.<name>` by point/mark):
 *   axis element pole focus focus2 centre centre2 object image
 *   ray_parallel ray_second ray_extension
 *   label_f label_u label_v label_h label_hprime label_m label_kind
 * Steps:
 *   setup    the axis, the element, the pole, the foci
 *   object   the object standing on the axis
 *   rays     the two construction rays, one after the other
 *   image    where they meet — dashed back to it when the image is virtual
 *   measure  u, v and f as signed distances, and the magnification
 */
import { createDraw, createFadeIn } from '../animations/draw';
import type { Animation } from '../clock';
import { FIGURE, type Pt } from '../units';
import type { Template } from './projectile';
import {
  arrowD,
  CHALK,
  dashedD,
  DIM,
  FigureParts,
  hatchD,
  polylineD,
  YELLOW,
} from './primitives';
import { registerFigure } from './registry';

type Kind = 'convexlens' | 'concavelens' | 'concavemirror' | 'convexmirror';

interface LensParams {
  kind: Kind;
  /** Signed focal length, cm. */
  f: number;
  /** Signed object distance, cm — negative for a real object on the left. */
  u: number;
  /** Object height, cm. Always positive: it stands up from the axis. */
  h: number;
  mirror: boolean;
}

function readKind(raw: string): Kind {
  const k = (raw || '').toLowerCase().replace(/[^a-z]/g, '');
  const mirror = k.includes('mirror');
  const concave = k.includes('concave');
  if (mirror) return concave ? 'concavemirror' : 'convexmirror';
  return concave ? 'concavelens' : 'convexlens';
}

function read(p: Record<string, string>): LensParams {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n !== 0 ? n : d;
  };
  const kind = readKind(p.kind ?? '');
  const mirror = kind.endsWith('mirror');
  // Converging elements have positive f on a lens and negative f on a mirror.
  // The same word, "concave", means opposite signs for the two, which is the
  // single most reliable way to draw the wrong picture.
  const converging = kind === 'convexlens' || kind === 'concavemirror';
  const fSign = mirror ? (converging ? -1 : 1) : converging ? 1 : -1;
  return {
    kind,
    mirror,
    f: fSign * Math.abs(num(p.f ?? p.focal, 20)),
    // A real object sits on the incoming side, so u is negative however the
    // model phrases it.
    u: -Math.abs(num(p.u ?? p.object ?? p.d, 30)),
    h: Math.abs(num(p.h ?? p.height, 5)),
  };
}

export function createLens(
  id: string,
  layer: SVGGElement,
  raw: Record<string, string>,
  toPx: (p: Pt) => Pt,
): Template {
  const p = read(raw);
  const f = new FigureParts(id, layer);

  // ---- the physics, solved once -------------------------------------------
  // Mirror  1/v + 1/u = 1/f  ->  v = uf/(u - f)
  // Lens    1/v - 1/u = 1/f  ->  v = uf/(u + f)
  const denom = p.mirror ? p.u - p.f : p.u + p.f;
  // An object AT the focus sends the rays out parallel and forms no image at
  // all. Drawing one would be a lie the teacher then has to talk around.
  const noImage = Math.abs(denom) < 1e-6;
  const v = noImage ? Infinity : (p.u * p.f) / denom;
  const m = noImage ? Infinity : p.mirror ? -v / p.u : v / p.u;
  const hp = noImage ? 0 : m * p.h;

  // Light travels left to right, and a mirror sends it back.
  const dir = p.mirror ? -1 : 1;
  // Real when the outgoing light actually reaches the image; otherwise the
  // image is where the back-extensions meet, and those are drawn dashed.
  const real = !noImage && Math.sign(v) === dir;

  // ---- board geometry -----------------------------------------------------
  const midX = (FIGURE.left + FIGURE.right) / 2;
  const midY = (FIGURE.top + FIGURE.bottom) / 2;
  const halfW = (FIGURE.right - FIGURE.left) / 2 - 0.2;

  const reach = Math.max(
    Math.abs(p.u),
    Number.isFinite(v) ? Math.abs(v) : 0,
    2 * Math.abs(p.f),
  );
  /** Board units per cm, along the axis. */
  const sx = (halfW * 0.86) / (reach || 1);
  /** Board units per cm, up the axis — its own scale, so a tiny object is visible. */
  const tall = Math.max(Math.abs(p.h), Math.abs(hp) || 0);
  const sy = Math.min(0.95 / p.h, 2.05 / (tall || 1));

  /** A signed distance in cm to a point on the axis. */
  const onAxis = (cm: number) => ({ x: midX + cm * sx, y: midY });
  /** A point at a signed distance and a signed height. */
  const at = (cm: number, cmUp: number) => ({ x: midX + cm * sx, y: midY + cmUp * sy });
  const P = (q: Pt) => toPx(q);

  const EH = 1.15; // element half-height, board units
  const pole = P(onAxis(0));
  const elemTop = P({ x: midX, y: midY + EH });
  const elemBot = P({ x: midX, y: midY - EH });

  // ---- axis ---------------------------------------------------------------
  const axisL = P({ x: midX - halfW, y: midY });
  const axisR = P({ x: midX + halfW, y: midY });
  const axis = f.add(
    'axis',
    f.rough(`M${axisL.x},${axisL.y}L${axisR.x},${axisR.y}`, 0.5),
    DIM,
    2,
  );

  // ---- the element --------------------------------------------------------
  // A lens is two faces; a mirror is one surface with its back hatched, which
  // is the only thing in the drawing that says which side reflects.
  const elementD: string[] = [];
  if (!p.mirror) {
    const bulge = p.kind === 'convexlens' ? 30 : 20;
    if (p.kind === 'convexlens') {
      elementD.push(
        `M${elemTop.x},${elemTop.y}Q${elemTop.x - bulge},${pole.y} ${elemBot.x},${elemBot.y}`,
        `M${elemTop.x},${elemTop.y}Q${elemTop.x + bulge},${pole.y} ${elemBot.x},${elemBot.y}`,
      );
    } else {
      // Hourglass: faces curving inward, with the thin waist capped top and
      // bottom so it reads as glass rather than as two stray arcs.
      const w = 11;
      elementD.push(
        `M${elemTop.x - w},${elemTop.y}Q${elemTop.x + bulge},${pole.y} ${elemBot.x - w},${elemBot.y}`,
        `M${elemTop.x + w},${elemTop.y}Q${elemTop.x - bulge},${pole.y} ${elemBot.x + w},${elemBot.y}`,
        `M${elemTop.x - w},${elemTop.y}L${elemTop.x + w},${elemTop.y}`,
        `M${elemBot.x - w},${elemBot.y}L${elemBot.x + w},${elemBot.y}`,
      );
    }
  } else {
    // The reflecting face is the one the light hits, so a concave mirror's
    // edges reach TOWARD the object and its pole is the far point.
    const d = p.kind === 'concavemirror' ? -34 : 34;
    elementD.push(
      `M${elemTop.x + d},${elemTop.y}Q${pole.x - d * 0.6},${pole.y} ${elemBot.x + d},${elemBot.y}`,
    );
  }
  const element = f.add('element', f.rough(elementD.join(' '), 0.5), CHALK, 3.5);

  const backing = p.mirror
    ? f.add(
        'backing',
        // Hatched on the side that does not reflect. Reversing the endpoints
        // flips which way the strokes lean.
        p.kind === 'concavemirror'
          ? hatchD(elemBot, elemTop, 22, 30)
          : hatchD(elemTop, elemBot, 22, 30),
        DIM,
        2,
      )
    : null;

  const poleDot = f.dot('pole', pole, 5, CHALK);

  // ---- foci and centres ---------------------------------------------------
  // NCERT prints C on a mirror diagram and 2F on a lens diagram, never both.
  const focusNear = P(onAxis(p.mirror ? p.f : -Math.abs(p.f)));
  const focusFar = P(onAxis(p.mirror ? -p.f : Math.abs(p.f)));
  const focus = f.dot('focus', focusNear, 4, DIM);
  const focus2 = f.dot('focus2', focusFar, 4, DIM);
  const centreNear = P(onAxis(p.mirror ? 2 * p.f : -2 * Math.abs(p.f)));
  const centreFar = P(onAxis(p.mirror ? -2 * p.f : 2 * Math.abs(p.f)));
  const centre = f.dot('centre', centreNear, 4, DIM);
  const centre2 = f.dot('centre2', centreFar, 4, DIM);

  const tick = (label: string, name: string, where: Pt) =>
    f.label(name, label, { x: where.x, y: where.y + 34 });
  const labF = tick('F', 'label_f', focusNear);
  const labF2 = tick(p.mirror ? '' : "F'", 'label_f2', focusFar);
  const labC = tick(p.mirror ? 'C' : '2F', 'label_c', centreNear);
  const labC2 = tick(p.mirror ? '' : "2F'", 'label_c2', centreFar);

  // ---- object and image ---------------------------------------------------
  const objFoot = P(onAxis(p.u));
  const objTip = P(at(p.u, p.h));
  const object = f.add('object', f.rough(arrowD(objFoot, objTip), 0.5), CHALK, 4);

  const imgFoot = noImage ? pole : P(onAxis(v));
  const imgTip = noImage ? pole : P(at(v, hp));
  const image = noImage
    ? null
    : f.add(
        'image',
        f.rough(arrowD(imgFoot, imgTip), 0.5),
        YELLOW,
        4,
      );

  // ---- construction rays --------------------------------------------------
  // Both rays start at the object's tip and end at the image's, because that
  // is what "the image is where the rays meet" means. What differs is where
  // each one strikes the element.
  const hitParallel = { x: pole.x, y: objTip.y };
  // The second ray: straight through the optical centre for a lens, and aimed
  // at the focus for a mirror — the mirror has no undeviated centre ray.
  const hitSecond = p.mirror
    ? crossAt(objTip, focusNear, pole.x)
    : { x: pole.x, y: pole.y };

  /** Where a line through two points crosses a vertical. */
  function crossAt(a: Pt, b: Pt, x: number): Pt {
    const dx = b.x - a.x;
    if (Math.abs(dx) < 1e-6) return { x, y: a.y };
    return { x, y: a.y + ((x - a.x) * (b.y - a.y)) / dx };
  }

  /** A ray: object tip to the element, then onward — or onward and back. */
  function rayOf(hit: Pt): { solid: string; dashed: string[] } {
    const incident = polylineD([objTip, hit]);
    if (noImage) {
      // Parallel emergent light: no image, so the outgoing ray leaves at the
      // height it struck and runs to the edge of the column — "forever" is the
      // point, and stopping short of the boundary says it better than
      // overshooting it.
      const end = { x: dir > 0 ? axisR.x - 8 : axisL.x + 8, y: hit.y };
      return { solid: `${incident} ${polylineD([hit, end])}`, dashed: [] };
    }
    const toImage = { x: imgTip.x - hit.x, y: imgTip.y - hit.y };
    const len = Math.hypot(toImage.x, toImage.y) || 1;
    if (real) {
      // The light itself reaches the image, and carries on a little past it.
      const past = { x: imgTip.x + (toImage.x / len) * 60, y: imgTip.y + (toImage.y / len) * 60 };
      return { solid: `${incident} ${polylineD([hit, past])}`, dashed: [] };
    }
    // Virtual: the outgoing light goes the OTHER way along the same line, and
    // only its back-extension passes through the image.
    const reachEdge = Math.abs((dir > 0 ? axisR.x - 8 : axisL.x + 8) - hit.x);
    const run = Math.min(320, Math.max(90, reachEdge));
    const out = { x: hit.x - (toImage.x / len) * run, y: hit.y - (toImage.y / len) * run };
    return {
      solid: `${incident} ${polylineD([hit, out])}`,
      dashed: dashedD(hit, imgTip),
    };
  }

  const rayA = rayOf(hitParallel);
  const rayB = rayOf(hitSecond);
  const rayParallel = f.add('ray_parallel', f.rough(rayA.solid, 0.5), CHALK, 3);
  const raySecond = f.add('ray_second', f.rough(rayB.solid, 0.5), CHALK, 3);
  const extension = f.add(
    'ray_extension',
    [...rayA.dashed, ...rayB.dashed],
    DIM,
    2,
  );

  // ---- the numbers, signed, because the sign is the lesson ----------------
  const fmt = (n: number) => (Number.isFinite(n) ? `${n > 0 ? '+' : ''}${round(n)}` : '∞');
  const round = (n: number) => (Math.abs(n % 1) < 0.05 ? n.toFixed(0) : n.toFixed(1));
  // Each dimension gets its own row under the axis, so u, v and f can span
  // overlapping stretches of it without landing on each other — and the first
  // row starts BELOW the element, which reaches a long way down from the axis
  // and would otherwise be written straight through.
  const ROW = P({ x: midX, y: midY - EH }).y + 36;
  const below = (a: Pt, b: Pt, row: number) => ({
    x: (a.x + b.x) / 2,
    y: ROW + row * 48,
  });

  const labU = f.label('label_u', `u = ${fmt(p.u)}`, below(objFoot, pole, 1), 'middle', YELLOW);
  const labV = noImage
    ? f.label('label_v', 'v = ∞', below(pole, axisR, 2), 'middle', YELLOW)
    : f.label('label_v', `v = ${fmt(v)}`, below(pole, imgFoot, 2), 'middle', YELLOW);
  // Below the axis, on its own row. Above it is where the object stands, and
  // for a mirror the focus is on the object's side — so an f label placed over
  // the axis lands on the object arrow every time.
  const labFocal = f.label(
    'label_focal',
    `f = ${fmt(p.f)}`,
    below(focusNear, pole, 0),
    'middle',
    YELLOW,
  );
  const labH = f.label('label_h', 'h', { x: objTip.x - 30, y: objTip.y + 12 });
  const labHp = f.label(
    'label_hprime',
    noImage ? '' : "h'",
    { x: imgTip.x + 34, y: imgTip.y + 12 },
  );
  const labM = f.label(
    'label_m',
    noImage
      ? 'no image — rays emerge parallel'
      : `m = ${round(m)}  (${m < 0 ? 'inverted' : 'erect'}, ${real ? 'real' : 'virtual'})`,
    { x: pole.x, y: P({ x: midX, y: FIGURE.bottom }).y - 18 },
    'middle',
    YELLOW,
  );
  const labKind = f.label(
    'label_kind',
    p.kind.replace('lens', ' lens').replace('mirror', ' mirror'),
    { x: pole.x, y: elemTop.y - 24 },
  );

  // ---- steps --------------------------------------------------------------
  const steps = new Map<string, (at: number) => Animation[]>();

  steps.set('setup', (t) => [
    createDraw(`${id}.axis`, axis, t, 520),
    createDraw(`${id}.element`, element, t + 380, 620),
    ...(backing ? [createDraw(`${id}.backing`, backing, t + 900, 420)] : []),
    createFadeIn(`${id}.pole`, [poleDot], t + 980, 200),
    // One animation per part — the board reads the part a step reveals from
    // the animation's name, so a shared fade hides everything but the first.
    createFadeIn(`${id}.focus`, [focus], t + 1080, 240),
    createFadeIn(`${id}.focus2`, [focus2], t + 1080, 240),
    createFadeIn(`${id}.centre`, [centre], t + 1160, 240),
    createFadeIn(`${id}.centre2`, [centre2], t + 1160, 240),
    createFadeIn(`${id}.label_f`, [labF], t + 1240, 260),
    createFadeIn(`${id}.label_f2`, [labF2], t + 1240, 260),
    createFadeIn(`${id}.label_c`, [labC], t + 1240, 260),
    createFadeIn(`${id}.label_c2`, [labC2], t + 1240, 260),
    createFadeIn(`${id}.label_kind`, [labKind], t + 1320, 260),
  ]);

  steps.set('object', (t) => [
    createDraw(`${id}.object`, object, t, 480),
    createFadeIn(`${id}.label_h`, [labH], t + 360, 220),
  ]);

  steps.set('rays', (t) => [
    createDraw(`${id}.ray_parallel`, rayParallel, t, 760),
    createDraw(`${id}.ray_second`, raySecond, t + 700, 760),
  ]);

  steps.set('image', (t) =>
    noImage
      ? [createFadeIn(`${id}.label_m`, [labM], t, 300)]
      : [
          ...(extension.length
            ? [createDraw(`${id}.ray_extension`, extension, t, 520)]
            : []),
          ...(image ? [createDraw(`${id}.image`, image, t + 300, 520)] : []),
          createFadeIn(`${id}.label_hprime`, [labHp], t + 700, 240),
        ],
  );

  steps.set('measure', (t) => [
    createFadeIn(`${id}.label_u`, [labU], t, 260),
    createFadeIn(`${id}.label_v`, [labV], t + 220, 260),
    createFadeIn(`${id}.label_focal`, [labFocal], t + 440, 260),
    createFadeIn(`${id}.label_m`, [labM], t + 660, 300),
  ]);

  return {
    root: f.root,
    parts: f.parts,
    steps,
    stepNames: [...steps.keys()],
    partNames: [...f.parts.keys()],
  };
}

registerFigure('lens', {
  description:
    'image formation by a spherical MIRROR or a thin LENS: principal axis, the ' +
    'element, F and C (or 2F), the object, the two construction rays and the ' +
    'image where they meet. Solves the mirror or lens equation for you on the ' +
    'Cartesian convention and shows the signed u, v, f and the magnification, ' +
    'so a virtual image comes out on the right side of the element with dashed ' +
    'back-extensions and an object at the focus correctly forms no image. Give ' +
    'f and u as plain positive magnitudes — the sign comes from kind. Use for ' +
    'concave/convex mirrors, converging/diverging lenses, magnification and the ' +
    'lens or mirror formula.',
  params: 'kind=convexlens, f=20, u=30, h=5',
  parts: [
    'axis',
    'element',
    // Only built for a mirror; declared anyway, so pointing at it on a lens
    // fails with the list of what IS there rather than never being offered.
    'backing',
    'pole',
    'focus',
    'focus2',
    'centre',
    'centre2',
    'object',
    'image',
    'ray_parallel',
    'ray_second',
    'ray_extension',
    'label_f',
    'label_f2',
    'label_c',
    'label_c2',
    'label_u',
    'label_v',
    'label_focal',
    'label_h',
    'label_hprime',
    'label_m',
    'label_kind',
  ],
  steps: ['setup', 'object', 'rays', 'image', 'measure'],
  stepNotes: {
    object: 'the object standing on the axis',
    rays: 'the two construction rays, one after the other',
    image: 'where they meet — dashed back to it when the image is virtual',
    measure: 'signed u, v and f, and the magnification',
  },
  build: createLens,
});
