/**
 * Board coordinate space.
 *
 * Manim units so the model's priors transfer: the board is 8 units tall, the
 * origin is at the centre, and y points UP. The SVG underneath is plain
 * pixels with y pointing DOWN, so everything crossing that boundary goes
 * through `toPx`. Glyphs are never flipped — we convert points, not axes.
 */

/** Board height in board units. Manim's frame height. */
export const FRAME_H = 8;

/**
 * 3:2, not 4:3.
 *
 * A real blackboard is wider than it is tall, and 4:3 left the board unable to
 * fill its column — the leftover width became dead padding on both sides while
 * the derivation and the figure fought for horizontal room. Widening gives
 * both columns more space AND hands the slack back to the rail.
 */
export const ASPECT = 3 / 2;

/** Board width in board units. 10.666… */
export const FRAME_W = FRAME_H * ASPECT;

/** Render scale. 135 px/unit puts the board at exactly 1440x1080. */
export const PX_PER_UNIT = 135;

export const CANVAS_W = FRAME_W * PX_PER_UNIT; // 1440
export const CANVAS_H = FRAME_H * PX_PER_UNIT; // 1080

/** Board-unit extents. x: [-5.33, 5.33], y: [-4, 4]. */
export const LEFT = -FRAME_W / 2;
export const RIGHT = FRAME_W / 2;
export const TOP = FRAME_H / 2;
export const BOTTOM = -FRAME_H / 2;

export interface Pt {
  x: number;
  y: number;
}

/** Board units -> SVG pixels (origin centre, y up -> origin top-left, y down). */
export function toPx(p: Pt): Pt {
  return {
    x: CANVAS_W / 2 + p.x * PX_PER_UNIT,
    y: CANVAS_H / 2 - p.y * PX_PER_UNIT,
  };
}

/** SVG pixels -> board units. */
export function toUnits(p: Pt): Pt {
  return {
    x: (p.x - CANVAS_W / 2) / PX_PER_UNIT,
    y: (CANVAS_H / 2 - p.y) / PX_PER_UNIT,
  };
}

/**
 * Column split. The derivation runs down the left, figures sit right.
 * These are the regions the layout manager will own in M2; M0 hand-places
 * inside them but records the symbolic intent alongside (see screenplay.md).
 */
/**
 * The derivation needs 4.52 units for its widest line (measured, see
 * mathjax.ts). 5.2 covers it comfortably; the extra width the 3:2 board gained
 * goes to the figure, whose parabola is what suffers when squeezed.
 */
export const DERIVATION = {
  x: LEFT + 0.35,
  top: TOP - 0.45,
  width: 5.2,
} as const;

export const FIGURE = {
  left: DERIVATION.x + DERIVATION.width + 0.35,
  right: RIGHT - 0.3,
  top: TOP - 0.5,
  bottom: BOTTOM + 0.5,
} as const;

export const FIGURE_W = FIGURE.right - FIGURE.left;
export const FIGURE_H = FIGURE.top - FIGURE.bottom;
