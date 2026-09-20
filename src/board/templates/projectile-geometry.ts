/**
 * Geometry for the projectile figure.
 *
 * Pure maths, no rendering — the `projectile` template will animate these
 * same points step by step. Kept separate so the board-fit check and the
 * template can never disagree about where the apex is.
 *
 * Screenplay problem: u = 20 m/s, theta = 30 deg, g = 10 m/s^2.
 */
import { FIGURE, type Pt } from '../units';

export interface ProjectileParams {
  u: number;
  thetaDeg: number;
  g: number;
}

export const SCREENPLAY: ProjectileParams = { u: 20, thetaDeg: 30, g: 10 };

const rad = (d: number) => (d * Math.PI) / 180;

export function solve({ u, thetaDeg, g }: ProjectileParams) {
  const th = rad(thetaDeg);
  const ux = u * Math.cos(th);
  const uy = u * Math.sin(th);
  const T = (2 * uy) / g;
  const range = ux * T;
  const apexH = (uy * uy) / (2 * g);
  return { ux, uy, T, range, apexH, thetaRad: th };
}

/**
 * A real projectile at these numbers is 34.6 m long and 5 m tall — an arc
 * nearly 7:1, which on a board reads as a flat smear. Teachers don't draw it
 * that way and neither do we: x and y get independent scales so the parabola
 * is legible. The *numbers* stay honest; only the picture is stretched.
 */
const Y_EXAGGERATION = 4.0;

/** Most of the room above the ground the arc may use. */
const APEX_HEADROOM = 0.82;

/**
 * The teacher draws the figure first, top-right, and the derivation then grows
 * down the left. Sitting the ground just above board centre puts the arc in
 * the upper half where it pairs with the opening lines, and leaves the lower
 * right free — which is what a real board looks like, not a grid to fill.
 */
const GROUND_Y = 0.2;

export function makeFigure(params: ProjectileParams = SCREENPLAY) {
  const s = solve(params);

  const padL = 0.2;
  const usableW = FIGURE.right - FIGURE.left - padL - 0.15;
  const xScale = usableW / s.range;

  const groundY = GROUND_Y;
  /**
   * Exaggerate the arc, but never past the top of the board.
   *
   * A fixed multiplier only works for one angle. The model picks its own: at
   * 30° the apex is a fifth of the range, at 45° it is a quarter, at 60° very
   * nearly half — so the same multiplier that frames 30° nicely sends 45° off
   * the top edge. Take whichever is smaller, the exaggeration or the fit.
   */
  const headroom = (FIGURE.top - groundY) * APEX_HEADROOM;
  const yScale = Math.min(
    xScale * Y_EXAGGERATION,
    s.apexH > 0 ? headroom / s.apexH : xScale * Y_EXAGGERATION,
  );
  const originX = FIGURE.left + padL;

  const at = (xm: number, ym: number): Pt => ({
    x: originX + xm * xScale,
    y: groundY + ym * yScale,
  });

  const launch = at(0, 0);
  const landing = at(s.range, 0);
  const apex = at(s.range / 2, s.apexH);

  // Trajectory sampled in time, so a ball animated along it moves with the
  // real velocity profile (slow near the apex) rather than at constant speed.
  const STEPS = 96;
  const path: Pt[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS) * s.T;
    path.push(at(s.ux * t, s.uy * t - 0.5 * params.g * t * t));
  }

  // Velocity arrow at launch, drawn at the true 30 deg so the angle mark reads
  // correctly, with a fixed on-board length.
  const ARROW_LEN = 1.15;
  const uTip: Pt = {
    x: launch.x + ARROW_LEN * Math.cos(s.thetaRad),
    y: launch.y + ARROW_LEN * Math.sin(s.thetaRad),
  };
  const compLen = ARROW_LEN * 0.82;
  const uxTip: Pt = { x: launch.x + compLen * Math.cos(s.thetaRad), y: launch.y };
  const uyTip: Pt = { x: uxTip.x, y: launch.y + compLen * Math.sin(s.thetaRad) };

  return {
    solved: s,
    groundY,
    ground: { x1: FIGURE.left, x2: FIGURE.right, y: groundY },
    launch,
    landing,
    apex,
    path,
    uTip,
    uxTip,
    uyTip,
    /** Horizontal velocity arrow at the apex — the answer to the misconception. */
    apexVel: { from: apex, to: { x: apex.x + 0.85, y: apex.y } },
    rangeBar: { y: groundY - 0.5, x1: launch.x, x2: landing.x },
  };
}
